"""Local web server: JSON API + server-sent-event chat stream + static frontend."""

from __future__ import annotations

import asyncio
import json
import os
from collections import defaultdict
from pathlib import Path

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import agent
from .prompts import REVIEW_KICKOFF, START_KICKOFF
from .store import Store

STATIC = Path(__file__).parent / "static"

app = FastAPI(title="Groundwork")
store = Store()
_client: anthropic.AsyncAnthropic | None = None
_locks: dict[str, asyncio.Lock] = defaultdict(asyncio.Lock)


def client() -> anthropic.AsyncAnthropic:
    global _client
    if _client is None:
        _client = anthropic.AsyncAnthropic()
    return _client


def _topic_or_404(tid: str) -> dict:
    try:
        return store.topic(tid)
    except KeyError:
        raise HTTPException(404, "topic not found")


class NewTopic(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    goal: str = Field(default="", max_length=2000)


class ChatIn(BaseModel):
    message: str = Field(default="", max_length=20000)
    mode: str = Field(default="chat", pattern="^(chat|start|review)$")


@app.get("/api/config")
def config():
    return {"model": agent.MODEL, "effort": agent.EFFORT,
            "has_key": bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))}


@app.get("/api/topics")
def list_topics():
    return [store.topic_summary(t) for t in store.list_topics()]


@app.post("/api/topics")
def create_topic(body: NewTopic):
    t = store.create_topic(body.title, body.goal)
    return store.topic_summary(t)


@app.get("/api/topics/{tid}")
def get_topic(tid: str):
    t = _topic_or_404(tid)
    return store.topic_summary(t) | {"transcript": agent.transcript(t), "sources": t["sources"],
                                     "busy": _locks[tid].locked()}


@app.delete("/api/topics/{tid}")
def delete_topic(tid: str):
    _topic_or_404(tid)
    store.delete_topic(tid)
    return {"ok": True}


@app.post("/api/topics/{tid}/reset")
def reset_topic(tid: str):
    _topic_or_404(tid)
    store.reset_conversation(tid)
    return {"ok": True}


@app.get("/api/reviews")
def reviews():
    out = []
    for t in store.list_topics():
        for c in store.due(t):
            out.append({"topic_id": t["id"], "topic": t["title"]} | store.concept_view(t, c))
    return out


@app.post("/api/topics/{tid}/chat")
async def chat(tid: str, body: ChatIn):
    t = _topic_or_404(tid)
    if body.mode == "start":
        text = START_KICKOFF.format(title=t["title"], goal_part=f" My goal: {t['goal']}" if t["goal"] else "")
    elif body.mode == "review":
        text = REVIEW_KICKOFF
    else:
        text = body.message.strip()
        if not text:
            raise HTTPException(400, "empty message")
    lock = _locks[tid]
    if lock.locked():
        raise HTTPException(409, "the tutor is still answering")

    async def events():
        async with lock:
            yield _sse({"type": "user", "text": text})
            try:
                async for ev in agent.run_turn(client(), store, tid, text):
                    yield _sse(ev)
                    if ev["type"] in ("graph", "tool"):
                        yield _sse({"type": "topic", "topic": store.topic_summary(store.topic(tid))})
            except Exception as e:  # surface unexpected failures to the UI instead of a dead stream
                yield _sse({"type": "error", "message": f"{type(e).__name__}: {e}"})
                yield _sse({"type": "done"})

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


def _sse(obj: dict) -> str:
    return f"data: {json.dumps(obj, ensure_ascii=False)}\n\n"


app.mount("/static", StaticFiles(directory=STATIC), name="static")


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


def main():
    import argparse

    import uvicorn

    p = argparse.ArgumentParser(description="Run the Groundwork tutor locally.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8000)
    a = p.parse_args()
    print(f"Groundwork running at http://{a.host}:{a.port}")
    uvicorn.run(app, host=a.host, port=a.port, log_level="warning")


if __name__ == "__main__":
    main()
