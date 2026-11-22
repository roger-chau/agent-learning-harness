"""Local web server: course content, progress and gating, quiz grading, and the Ask panel."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent, content
from .progress import Progress
from .prompts import chapter_context

STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Groundwork")
progress = Progress()
_client: anthropic.AsyncAnthropic | None = None
_ask_lock = asyncio.Lock()


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


def _course(slug: str) -> dict:
    try:
        return content.course(slug)
    except content.NotFound:
        raise HTTPException(404, "course not found")


def _item(slug: str, item_id: str) -> dict:
    try:
        return content.item(slug, item_id)
    except content.NotFound:
        raise HTTPException(404, "item not found")


def _require_open(slug: str, item_id: str) -> dict:
    st = progress.states(slug)[item_id]
    if st["state"] == "planned":
        raise HTTPException(403, "This chapter hasn't been written yet.")
    if st["state"] == "locked":
        raise HTTPException(403, f"Locked: complete '{st['blocked_by']}' first.")
    return st


def _part_of(course: dict, item: dict) -> dict:
    return next(p for p in course["parts"] if p["id"] == item["part"])


# ---- catalogue & course ------------------------------------------------------
@app.get("/api/config")
def config():
    return {"model": agent.MODEL, "effort": agent.EFFORT,
            "has_key": bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))}


@app.get("/api/catalog")
def catalog():
    out = []
    for entry in content.catalog():
        e = dict(entry)
        if e.get("status") == "available":
            try:
                c = content.course(e["slug"])
                e["stats"] = _course_stats(c)
                e["progress"] = progress.summary(e["slug"])
            except content.NotFound:
                e["status"] = "planned"
        out.append(e)
    return out


def _course_stats(c: dict) -> dict:
    chapters = [i for i in c["order"] if i["type"] == "chapter"]
    return {
        "parts": len(c["parts"]),
        "chapters": len(chapters),
        "written": sum(1 for i in chapters if i["status"] == "ready"),
        "projects": len(c.get("projects", [])),
        "milestones": sum(1 for i in c["order"] if i["type"] == "milestone"),
        "scenarios": sum(1 for i in c["order"] if i["type"] == "scenario"),
        "papers": sum(1 for i in c["order"] if i["type"] == "paper"),
        "quizzes": sum(1 for i in c["order"] if i["has_quiz"]),
    }


@app.get("/api/courses/{slug}")
def get_course(slug: str):
    c = _course(slug)
    states = progress.states(slug)
    parts = []
    for p in c["parts"]:
        parts.append({k: v for k, v in p.items() if k != "items"} | {
            "items": [{k: it[k] for k in ("id", "type", "title", "status", "exercises", "has_quiz")}
                      | {"summary": it.get("summary", ""), "project": it.get("project")}
                      | states[it["id"]] for it in p["items"]]
        })
    return {k: v for k, v in c.items() if k not in ("parts", "order")} | {
        "parts": parts, "stats": _course_stats(c), "progress": progress.summary(slug)}


@app.get("/api/courses/{slug}/items/{item_id}")
def get_item(slug: str, item_id: str):
    c = _course(slug)
    it = _item(slug, item_id)
    st = _require_open(slug, item_id)
    order = [i for i in c["order"] if i["status"] == "ready"]
    idx = next(k for k, i in enumerate(order) if i["id"] == item_id)
    part = _part_of(c, it)
    return {
        "id": it["id"], "type": it["type"], "title": it["title"], "summary": it.get("summary", ""),
        "blocks": it.get("blocks", []), "project": it.get("project"),
        "part": {"id": part["id"], "n": part.get("n"), "title": part["title"], "hp": part.get("hp", "")},
        "html": content.chapter_html(slug, item_id),
        "exercises": it["exercises"],
        "quiz": content.public_quiz(content.quiz(slug, item_id)),
        "state": st,
        "prev": order[idx - 1]["id"] if idx > 0 else None,
        "next": order[idx + 1]["id"] if idx + 1 < len(order) else None,
        "qa": agent.transcript(progress.qa(slug, item_id)),
        "writeup": it.get("writeup"),
        "writeup_text": progress.writeup(slug, item_id),
    }


class QuizIn(BaseModel):
    answers: dict


@app.post("/api/courses/{slug}/items/{item_id}/quiz")
def submit_quiz(slug: str, item_id: str, body: QuizIn):
    _course(slug)
    _item(slug, item_id)
    _require_open(slug, item_id)
    q = content.quiz(slug, item_id)
    if not q:
        raise HTTPException(404, "no quiz for this item")
    result = content.grade_quiz(q, body.answers)
    progress.record_quiz(slug, item_id, result)
    if not result["passed"]:
        # Don't reveal answers for questions they got wrong until they pass.
        for r in result["results"]:
            if not r["correct"]:
                r.pop("answer", None)
                r["explanation"] = ""
    return result | {"state": progress.states(slug)[item_id], "progress": progress.summary(slug)}


class WriteupIn(BaseModel):
    text: str = Field(max_length=40000)


@app.post("/api/courses/{slug}/items/{item_id}/writeup")
def save_writeup(slug: str, item_id: str, body: WriteupIn):
    _course(slug)
    it = _item(slug, item_id)
    _require_open(slug, item_id)
    if not it.get("writeup"):
        raise HTTPException(404, "this item has no write-up")
    progress.save_writeup(slug, item_id, body.text)
    return {"state": progress.states(slug)[item_id], "progress": progress.summary(slug)}


class ExerciseIn(BaseModel):
    passed: bool
    results: list = Field(default_factory=list)


@app.post("/api/courses/{slug}/items/{item_id}/exercises/{ex_id}")
def submit_exercise(slug: str, item_id: str, ex_id: str, body: ExerciseIn):
    _course(slug)
    it = _item(slug, item_id)
    _require_open(slug, item_id)
    if ex_id not in it["exercises"]:
        raise HTTPException(404, "no such exercise in this item")
    progress.record_exercise(slug, item_id, ex_id, body.passed, body.results)
    return {"state": progress.states(slug)[item_id], "progress": progress.summary(slug)}


@app.post("/api/courses/{slug}/items/{item_id}/read")
def mark_read(slug: str, item_id: str):
    _course(slug)
    _item(slug, item_id)
    _require_open(slug, item_id)
    progress.mark_read(slug, item_id)
    return {"state": progress.states(slug)[item_id], "progress": progress.summary(slug)}


@app.post("/api/courses/{slug}/reset")
def reset_course(slug: str):
    _course(slug)
    progress.reset_course(slug)
    return {"ok": True}


@app.get("/content/{slug}/{kind}/{path:path}")
def course_file(slug: str, kind: str, path: str):
    try:
        return FileResponse(content.asset_path(slug, kind, path),
                            media_type="text/javascript" if path.endswith(".js") else None)
    except content.NotFound:
        raise HTTPException(404, "not found")


# ---- Ask panel ---------------------------------------------------------------
class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=8000)


@app.post("/api/courses/{slug}/items/{item_id}/ask")
async def ask(slug: str, item_id: str, body: AskIn):
    c = _course(slug)
    it = _item(slug, item_id)
    _require_open(slug, item_id)
    part = _part_of(c, it)
    ctx = chapter_context(c["title"], part["title"], it["title"],
                          content.plain_text(content.chapter_html(slug, item_id)), it["exercises"])
    history = progress.qa(slug, item_id)
    if _ask_lock.locked():
        raise HTTPException(409, "Still answering the previous question.")

    async def events():
        async with _ask_lock:
            try:
                async for ev in agent.answer(client(), ctx, history, body.question.strip()):
                    yield _sse(ev)
                progress.save()
            except Exception as e:  # surface unexpected failures instead of a dead stream
                yield _sse({"type": "error", "message": f"{type(e).__name__}: {e}"})
                yield _sse({"type": "done"})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.delete("/api/courses/{slug}/items/{item_id}/ask")
def clear_ask(slug: str, item_id: str):
    progress.clear_qa(slug, item_id)
    return {"ok": True}


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


def main():
    import argparse

    import uvicorn

    p = argparse.ArgumentParser(description="Run Groundwork locally.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8765)
    p.add_argument("--locked", action="store_true", help="enforce chapter gating (each item unlocks when the previous ones are complete)")
    a = p.parse_args()
    if a.locked:
        os.environ["GROUNDWORK_UNLOCK"] = "0"
    mode = "locked: complete items in order" if os.environ.get("GROUNDWORK_UNLOCK", "1") == "0" else "everything unlocked"
    print(f"Groundwork running at http://{a.host}:{a.port} ({mode})")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
