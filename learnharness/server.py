"""Local web server: course content, progress and gating, quiz grading, and the Ask panel."""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path

import anthropic
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import runner, agent, content
from .progress import Progress
from .prompts import chapter_context
from . import prompts

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
        "problems": sum(len((content.problems(c["slug"], i["id"]) or {"problems": []})["problems"]) for i in c["order"] if i.get("has_problems")),
    }


@app.get("/api/courses/{slug}")
def get_course(slug: str):
    c = _course(slug)
    states = progress.states(slug)
    parts = []
    hours = content.part_hours(slug)
    for p in c["parts"]:
        parts.append({k: v for k, v in p.items() if k != "items"} | {"hours": hours.get(p["id"]),
            "items": [{k: it[k] for k in ("id", "type", "title", "status", "exercises", "has_quiz", "has_problems")}
                      | {"summary": it.get("summary", ""), "project": it.get("project")}
                      | states[it["id"]] for it in p["items"]]
        })
    return {k: v for k, v in c.items() if k not in ("parts", "order")} | {
        "parts": parts, "stats": _course_stats(c), "progress": progress.summary(slug),
        "hours": round(sum(h for h in hours.values() if h), 0)}


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
        "part": {"id": part["id"], "n": part.get("n"), "title": part["title"], "hp": part.get("hp", ""), "pmpp": part.get("pmpp", "")},
        "html": content.chapter_html(slug, item_id),
        "exercises": it["exercises"],
        "quiz": content.public_quiz(content.quiz(slug, item_id)),
        "problems": content.public_problems(content.problems(slug, item_id)),
        "estimate": content.estimate(slug, it),
        "state": st,
        "prev": order[idx - 1]["id"] if idx > 0 else None,
        "next": order[idx + 1]["id"] if idx + 1 < len(order) else None,
        "qa": agent.transcript(progress.qa(slug, item_id)),
        "writeup": it.get("writeup"),
        "mock": it.get("mock"),
        "lab": {"dir": it.get("dir"), "targets": it.get("targets", []), "cloud": it.get("cloud", False)} if it["type"] == "lab" else None,
        "lab_record": progress.lab(slug, item_id) if it["type"] == "lab" else None,
        "writeup_text": progress.writeup(slug, item_id),
        "exam": _exam_info(slug, item_id) if it["type"] == "exam" else None,
        "coding": [content.public_coding(content.coding(slug, c)) for c in it.get("coding", []) if content.coding(slug, c)],
    }


# ---------- Spaced repetition ----------
REVIEW_NEW_PER_DAY = 15


def _review_pool(slug: str) -> dict:
    """Cards from items the learner has completed: quiz questions, and solved coding problems."""
    c = _course(slug)
    states = progress.states(slug)
    pool = {}
    for it in c["order"]:
        st = states.get(it["id"]) or {}
        if st.get("state") == "complete":
            q = content.quiz(slug, it["id"])
            for qq in (q or {}).get("questions", []):
                pool[f"q~{it['id']}~{qq['id']}"] = {"kind": "quiz", "item": it, "q": qq}
        for pid, rec in ((st.get("coding") or {}).items()):
            if rec.get("solved"):
                pr = content.coding(slug, pid)
                if pr:
                    pool[f"c~{pid}"] = {"kind": "code", "item": it, "p": pr}
    return pool


def _card_public(cid: str, card: dict) -> dict:
    it = card["item"]
    base = {"id": cid, "kind": card["kind"], "item": {"id": it["id"], "title": it["title"]}}
    if card["kind"] == "quiz":
        q = card["q"]
        return base | {"type": q["type"], "prompt": q["prompt"], "options": q.get("options", [])}
    pr = card["p"]
    return base | {"title": pr["title"], "difficulty": pr.get("difficulty", ""), "statement": pr["statement"]}


@app.get("/api/courses/{slug}/review")
def review_queue(slug: str):
    pool = _review_pool(slug)
    rec = progress.review(slug)
    now = time.time()
    due = sorted((cid for cid in pool if cid in rec and rec[cid].get("due", 0) <= now), key=lambda k: rec[k]["due"])
    today = now - now % 86400
    started_today = sum(1 for v in rec.values() if v.get("first", 0) >= today)
    new = [cid for cid in pool if cid not in rec][:max(0, REVIEW_NEW_PER_DAY - started_today)]
    cards = [_card_public(cid, pool[cid]) for cid in due + new]
    upcoming = sorted(v["due"] for k, v in rec.items() if k in pool and v.get("due", 0) > now)
    return {"due": len(due), "new": len(new), "total": len(pool), "seen": sum(1 for k in rec if k in pool),
            "next_due": upcoming[0] if upcoming else None, "cards": cards}


class ReviewIn(BaseModel):
    grade: int | None = None
    answer: object = None


@app.post("/api/courses/{slug}/review/{card_id}")
def review_answer(slug: str, card_id: str, body: ReviewIn):
    pool = _review_pool(slug)
    card = pool.get(card_id)
    if not card:
        raise HTTPException(404, "no such review card")
    out = {}
    grade = body.grade
    if card["kind"] == "quiz":
        q = card["q"]
        if body.answer is not None:
            ok = content.grade_quiz({"questions": [q]}, {q["id"]: body.answer})["correct"] == 1
            out |= {"correct": ok, "answer": q["answer"], "explanation": q.get("explanation", "")}
            if grade is None:
                grade = 2 if ok else 0
    elif grade is None:  # code card: reveal the key idea before self-grading
        pr = card["p"]
        return {"pattern": pr.get("pattern", ""), "complexity": pr.get("complexity", ""), "hints": pr.get("hints", [])[:1],
                "explanation": (pr.get("solution") or {}).get("explanation", "")}
    if grade is None:
        raise HTTPException(400, "grade or answer required")
    out["record"] = progress.review_grade(slug, card_id, grade, time.time())
    return out


# ---------- Coding problems ----------
CODING_REVEAL_AFTER = 3


class CodeIn(BaseModel):
    lang: str
    code: str = Field(max_length=100_000)
    mode: str = "run"  # "run": samples only, full detail; "submit": every test


@app.post("/api/courses/{slug}/items/{item_id}/coding/{pid}")
async def run_coding(slug: str, item_id: str, pid: str, body: CodeIn):
    it = _item(slug, item_id)
    _require_open(slug, item_id)
    if pid not in it.get("coding", []):
        raise HTTPException(404, "no such coding problem in this item")
    pr = content.coding(slug, pid)
    if body.lang not in ("python", "cpp") or not (pr.get("entry") or {}).get(body.lang):
        raise HTTPException(400, "language not available for this problem")
    tests = [t for t in pr["tests"] if t.get("sample")] if body.mode == "run" else pr["tests"]
    try:
        res = await asyncio.to_thread(runner.run, pr, body.lang, body.code, tests)
    except ValueError as e:
        raise HTTPException(400, str(e))
    out = {"mode": body.mode, "compile_error": res.get("compile_error")}
    rs = res["results"]
    if body.mode == "run":
        out["results"] = [r | {"args": t.get("args", t.get("ops")), "expected": t["expected"]} for r, t in zip(rs, tests)]
        return out
    passed = sum(1 for r in rs if r["pass"])
    out |= {"passed": passed, "total": len(tests), "max_ms": max((r.get("ms") or 0) for r in rs) if rs else 0}
    fail = next((k for k, r in enumerate(rs) if not r["pass"]), None)
    if fail is not None:  # show the first failing case, as judges do
        t = tests[fail]
        out["failing"] = {"args": t.get("args", t.get("ops")), "expected": t["expected"], "got": rs[fail].get("got"), "error": rs[fail].get("error")}
    if res.get("compile_error"):
        passed = 0
    rec = progress.record_coding(slug, item_id, pid, body.lang, passed, len(tests))
    out |= {"record": rec, "state": progress.states(slug)[item_id], "progress": progress.summary(slug)}
    if rec["solved"] or rec.get("revealed"):
        out["solution"] = pr.get("solution", {})
    return out


@app.post("/api/courses/{slug}/items/{item_id}/coding/{pid}/reveal")
def reveal_coding(slug: str, item_id: str, pid: str):
    it = _item(slug, item_id)
    _require_open(slug, item_id)
    if pid not in it.get("coding", []):
        raise HTTPException(404, "no such coding problem")
    pr = content.coding(slug, pid)
    rec = (progress.states(slug)[item_id].get("coding") or {}).get(pid) or {"submissions": 0, "solved": False}
    if not rec.get("solved") and rec.get("submissions", 0) < CODING_REVEAL_AFTER:
        raise HTTPException(409, f"submit at least {CODING_REVEAL_AFTER} times before revealing the solution")
    rec = progress.record_coding(slug, item_id, pid, "", 0, 0, reveal=not rec.get("solved"))
    return {"solution": pr.get("solution", {}), "record": rec, "state": progress.states(slug)[item_id]}


# ---------- Exams ----------
EXAM_GRACE_S = 120          # submissions this late still count (network, a slow click)
EXAM_RETAKE_S = 12 * 3600   # a new attempt opens 12 hours after the last one


def _exam_info(slug: str, item_id: str) -> dict:
    ex = content.exam(slug, item_id) or {"problems": []}
    rec = progress.exam(slug, item_id)
    now = time.time()
    active = rec["active"]
    if active and now > active["deadline"] + EXAM_GRACE_S:
        progress.exam_finish(slug, item_id, {"started": active["started"], "submitted": None, "score": 0.0,
                                             "passed": False, "late": True, "expired": True})
        rec = progress.exam(slug, item_id); active = None
    last = rec["attempts"][-1] if rec["attempts"] else None
    next_at = (last["started"] + EXAM_RETAKE_S) if last and not active else None
    return {"minutes": ex.get("minutes", 60), "pass": ex.get("pass", 0.7), "count": len(ex.get("problems", [])),
            "parts": sum(len(p["parts"]) for p in ex.get("problems", [])), "coding": len(ex.get("coding", [])),
            "coding_weight": ex.get("coding_weight", 4), "active": active, "now": now,
            "attempts": rec["attempts"], "next_attempt_at": next_at if next_at and next_at > now else None,
            "best": max((a["score"] for a in rec["attempts"]), default=None)}


@app.post("/api/courses/{slug}/items/{item_id}/exam/start")
def exam_start(slug: str, item_id: str):
    it = _item(slug, item_id)
    if it["type"] != "exam":
        raise HTTPException(404, "not an exam")
    _require_open(slug, item_id)
    ex = content.exam(slug, item_id)
    if not ex:
        raise HTTPException(404, "exam paper missing")
    info = _exam_info(slug, item_id)
    active = info["active"]
    if not active:
        if info["next_attempt_at"]:
            raise HTTPException(409, "retake not open yet")
        now = time.time()
        active = progress.exam_start(slug, item_id, now, now + 60 * ex.get("minutes", 60))
    return {"active": active, "now": time.time(), "paper": content.exam_paper(ex), "coding": content.exam_coding(slug, ex)}


class ExamIn(BaseModel):
    answers: dict
    code: dict | None = None


@app.post("/api/courses/{slug}/items/{item_id}/exam/submit")
async def exam_submit(slug: str, item_id: str, body: ExamIn):
    it = _item(slug, item_id)
    if it["type"] != "exam":
        raise HTTPException(404, "not an exam")
    ex = content.exam(slug, item_id)
    active = progress.exam(slug, item_id)["active"]
    if not active:
        raise HTTPException(409, "no attempt in progress")
    now = time.time()
    late = now > active["deadline"] + EXAM_GRACE_S
    code_results, coding_scores = {}, {}
    for pid in ex.get("coding", []):
        sub = (body.code or {}).get(pid) or {}
        pr = content.coding(slug, pid)
        lang, src = sub.get("lang"), sub.get("code") or ""
        if not pr or lang not in ("python", "cpp") or not (pr.get("entry") or {}).get(lang) or not src.strip():
            code_results[pid] = {"passed": 0, "total": len(pr["tests"]) if pr else 0, "skipped": True}
            coding_scores[pid] = 0.0
            continue
        try:
            res = await asyncio.to_thread(runner.run, pr, lang, src, pr["tests"])
        except ValueError as e:
            res = {"compile_error": str(e), "results": []}
        passed = 0 if res.get("compile_error") else sum(1 for r in res["results"] if r["pass"])
        code_results[pid] = {"passed": passed, "total": len(pr["tests"]), "lang": lang, "compile_error": res.get("compile_error"),
                             "solution": pr.get("solution", {})}
        coding_scores[pid] = passed / len(pr["tests"]) if pr["tests"] else 0.0
    g = content.grade_exam(ex, body.answers, coding_scores)
    passed = (not late) and g["score"] >= ex.get("pass", 0.7) - 1e-9
    progress.exam_finish(slug, item_id, {"started": active["started"], "submitted": now, "score": g["score"],
                                         "correct": g["correct"], "total": g["total"], "passed": passed, "late": late})
    review = [{"id": pr["id"], "parts": g["parts"][pr["id"]], "solution": pr.get("solution", ""),
               "answers": {q["id"]: q["answer"] for q in pr["parts"]}} for pr in ex.get("problems", [])]
    return {"score": g["score"], "correct": g["correct"], "total": g["total"], "passed": passed, "late": late, "review": review,
            "coding": code_results}


class ExamRunIn(BaseModel):
    pid: str
    lang: str
    code: str


@app.post("/api/courses/{slug}/items/{item_id}/exam/run")
async def exam_run(slug: str, item_id: str, body: ExamRunIn):
    """Run the SAMPLE tests of an exam coding problem during an active attempt."""
    it = _item(slug, item_id)
    if it["type"] != "exam":
        raise HTTPException(404, "not an exam")
    ex = content.exam(slug, item_id) or {}
    info = _exam_info(slug, item_id)
    if not info["active"] or time.time() > info["active"]["deadline"] + EXAM_GRACE_S:
        raise HTTPException(409, "no attempt in progress")
    if body.pid not in ex.get("coding", []):
        raise HTTPException(404, "no such problem on this exam")
    pr = content.coding(slug, body.pid)
    if body.lang not in ("python", "cpp") or not (pr.get("entry") or {}).get(body.lang):
        raise HTTPException(400, "language not available for this problem")
    tests = [t for t in pr["tests"] if t.get("sample")]
    try:
        res = await asyncio.to_thread(runner.run, pr, body.lang, body.code, tests)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {"compile_error": res.get("compile_error"),
            "results": [r | {"args": t.get("args", t.get("ops")), "expected": t["expected"]} for r, t in zip(res["results"], tests)]}


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


class ProblemIn(BaseModel):
    answers: dict


REVEAL_AFTER = 2  # wrong attempts before a worked solution can be revealed


@app.post("/api/courses/{slug}/items/{item_id}/problems/{pid}")
def submit_problem(slug: str, item_id: str, pid: str, body: ProblemIn):
    _course(slug)
    _item(slug, item_id)
    _require_open(slug, item_id)
    ps = content.problems(slug, item_id)
    if not ps:
        raise HTTPException(404, "no problems for this item")
    try:
        pr = content.find_problem(ps, pid)
    except content.NotFound:
        raise HTTPException(404, "no such problem")
    g = content.grade_problem(pr, body.answers)
    rec = progress.record_problem(slug, item_id, pid, solved=g["solved"])
    out = g | {"record": rec, "state": progress.states(slug)[item_id], "progress": progress.summary(slug)}
    if g["solved"] or rec["revealed"]:
        out["solution"] = pr.get("solution", "")
        out["answers"] = {part["id"]: part["answer"] for part in pr["parts"]}
    return out


@app.post("/api/courses/{slug}/items/{item_id}/problems/{pid}/reveal")
def reveal_problem(slug: str, item_id: str, pid: str):
    _course(slug)
    _item(slug, item_id)
    _require_open(slug, item_id)
    ps = content.problems(slug, item_id)
    if not ps:
        raise HTTPException(404, "no problems for this item")
    try:
        pr = content.find_problem(ps, pid)
    except content.NotFound:
        raise HTTPException(404, "no such problem")
    rec = (progress.states(slug)[item_id]["problems"] or {}).get(pid) or {"attempts": 0, "solved": False}
    if not rec.get("solved") and rec.get("attempts", 0) < REVEAL_AFTER:
        raise HTTPException(409, f"try at least {REVEAL_AFTER} times before revealing the solution")
    rec = progress.record_problem(slug, item_id, pid, reveal=not rec.get("solved"))
    return {"solution": pr.get("solution", ""), "answers": {part["id"]: part["answer"] for part in pr["parts"]},
            "record": rec, "state": progress.states(slug)[item_id], "progress": progress.summary(slug)}


OPS = {">=": lambda v, t: v >= t, "<=": lambda v, t: v <= t, ">": lambda v, t: v > t, "<": lambda v, t: v < t}


def evaluate_lab(it: dict, data: dict) -> dict:
    """Check a lab's results against the item's targets. Metrics come from the learner's own GPU."""
    metrics = data.get("metrics") or {}
    checks = data.get("checks") or {}
    targets = []
    for t in it.get("targets", []):
        v = metrics.get(t["metric"])
        met = isinstance(v, (int, float)) and OPS[t.get("op", ">=")](v, t["value"])
        targets.append({"label": t.get("label", t["metric"]), "metric": t["metric"], "op": t.get("op", ">="),
                        "target": t["value"], "value": v, "met": bool(met)})
    checks_ok = bool(checks) and all(bool(x) for x in checks.values())
    return {"passed": checks_ok and all(t["met"] for t in targets), "checks_ok": checks_ok, "targets": targets}


@app.post("/api/courses/{slug}/items/{item_id}/lab")
def submit_lab(slug: str, item_id: str, body: dict):
    _course(slug)
    it = _item(slug, item_id)
    if it["type"] != "lab":
        raise HTTPException(404, "this item isn't a lab")
    _require_open(slug, item_id)
    if body.get("lab") != item_id:
        raise HTTPException(400, f"these results are for lab {body.get('lab')!r}, not {item_id!r}")
    result = evaluate_lab(it, body)
    progress.record_lab(slug, item_id, body, result)
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


@app.get("/api/progress/export")
def export_progress():
    return {"groundwork": "progress", "version": 1, "exported_at": datetime.now(timezone.utc).isoformat(),
            "file": str(progress.path), "progress": progress.export()}


@app.post("/api/progress/import")
def import_progress(body: dict = Body(...)):
    try:
        progress.restore(body.get("progress") if "progress" in body else body)
    except ValueError as e:
        raise HTTPException(400, str(e))
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
    if _item(slug, item_id)["type"] == "exam":
        raise HTTPException(403, "The Ask panel is closed during exams.")
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
                kw = {"system": prompts.mock_prompt(it["mock"]["kind"])} if it.get("mock") else {}
                async for ev in agent.answer(client(), ctx, history, body.question.strip(), **kw):
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
