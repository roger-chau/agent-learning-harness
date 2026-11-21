"""Learner progress and hard gating.

An item is complete when:
  chapter    -> all its exercises passed and its quiz passed (if it has one)
  milestone  -> all its exercises passed
  checkpoint -> its quiz passed
An item is unlocked when every earlier ready item in the course is complete.
Planned (not yet written) items are always locked and don't block anything.
Set GROUNDWORK_UNLOCK=1 to unlock everything (for authoring).
"""

from __future__ import annotations

import json
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import content


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Progress:
    def __init__(self, path: str | os.PathLike | None = None):
        self.path = Path(path or os.environ.get("GROUNDWORK_DATA", "data/progress.json"))
        self._lock = threading.RLock()
        self.data = {"courses": {}, "qa": {}}
        if self.path.exists():
            self.data = json.loads(self.path.read_text())
            self.data.setdefault("qa", {})

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=1))
            tmp.replace(self.path)

    def _item(self, slug: str, item_id: str) -> dict:
        c = self.data["courses"].setdefault(slug, {"items": {}})
        return c["items"].setdefault(item_id, {"exercises": {}, "quiz": None, "completed_at": None})

    # ---- state -------------------------------------------------------------
    def is_complete(self, slug: str, it: dict) -> bool:
        if it["status"] != "ready":
            return False
        rec = self.data["courses"].get(slug, {}).get("items", {}).get(it["id"]) or {}
        wu = it.get("writeup")
        if not it["exercises"] and not it["has_quiz"] and not wu:
            return bool(rec.get("read"))  # nothing to pass: reading it is enough
        ex_ok = all(rec.get("exercises", {}).get(e, {}).get("passed") for e in it["exercises"])
        quiz_ok = (not it["has_quiz"]) or bool((rec.get("quiz") or {}).get("passed"))
        wu_ok = (not wu) or (rec.get("writeup") or {}).get("words", 0) >= wu.get("min_words", 100)
        return ex_ok and quiz_ok and wu_ok

    def states(self, slug: str) -> dict[str, dict]:
        unlock_all = os.environ.get("GROUNDWORK_UNLOCK") == "1"
        course = content.course(slug)
        out = {}
        blocked_by = None
        for it in course["order"]:
            done = self.is_complete(slug, it)
            rec = self.data["courses"].get(slug, {}).get("items", {}).get(it["id"], {})
            if it["status"] != "ready":
                state = "planned"
            elif blocked_by is None or unlock_all:
                state = "complete" if done else "open"
            else:
                state = "locked"
            wu = rec.get("writeup") or {}
            out[it["id"]] = {
                "state": state,
                "writeup_words": wu.get("words", 0),
                "blocked_by": None if state != "locked" else blocked_by,
                "exercises": {e: bool(rec.get("exercises", {}).get(e, {}).get("passed")) for e in it["exercises"]},
                "quiz": rec.get("quiz"),
            }
            if it["status"] == "ready" and not done and blocked_by is None:
                blocked_by = it["id"]
        return out

    def summary(self, slug: str) -> dict:
        st = self.states(slug)
        ready = [k for k, v in st.items() if v["state"] != "planned"]
        done = [k for k, v in st.items() if v["state"] == "complete"]
        nxt = next((k for k, v in st.items() if v["state"] == "open"), None)
        return {"ready": len(ready), "complete": len(done), "next": nxt}

    # ---- updates -----------------------------------------------------------
    def record_exercise(self, slug: str, item_id: str, ex_id: str, passed: bool, detail: list) -> None:
        with self._lock:
            rec = self._item(slug, item_id)
            prev = rec["exercises"].get(ex_id, {})
            rec["exercises"][ex_id] = {
                "passed": bool(passed) or bool(prev.get("passed")),
                "last": {"passed": bool(passed), "at": _now(), "detail": detail[:40]},
            }
            self._mark(slug, item_id, rec)
            self.save()

    def record_quiz(self, slug: str, item_id: str, result: dict) -> None:
        with self._lock:
            rec = self._item(slug, item_id)
            prev = rec.get("quiz") or {"best": 0, "attempts": 0, "passed": False}
            rec["quiz"] = {
                "best": max(prev["best"], result["score"]),
                "attempts": prev["attempts"] + 1,
                "passed": prev["passed"] or result["passed"],
                "last": result["score"],
                "at": _now(),
            }
            self._mark(slug, item_id, rec)
            self.save()

    def save_writeup(self, slug: str, item_id: str, text: str) -> None:
        with self._lock:
            rec = self._item(slug, item_id)
            rec["writeup"] = {"text": text, "words": len(text.split()), "at": _now()}
            self._mark(slug, item_id, rec)
            self.save()

    def writeup(self, slug: str, item_id: str) -> str:
        rec = self.data["courses"].get(slug, {}).get("items", {}).get(item_id) or {}
        return (rec.get("writeup") or {}).get("text", "")

    def mark_read(self, slug: str, item_id: str) -> None:
        with self._lock:
            rec = self._item(slug, item_id)
            rec["read"] = True
            self._mark(slug, item_id, rec)
            self.save()

    def _mark(self, slug: str, item_id: str, rec: dict) -> None:
        if rec.get("completed_at") is None and self.is_complete(slug, content.item(slug, item_id)):
            rec["completed_at"] = _now()

    def reset_course(self, slug: str) -> None:
        with self._lock:
            self.data["courses"].pop(slug, None)
            self.save()

    # ---- Q&A history -------------------------------------------------------
    def qa(self, slug: str, item_id: str) -> list:
        return self.data["qa"].setdefault(f"{slug}/{item_id}", [])

    def clear_qa(self, slug: str, item_id: str) -> None:
        with self._lock:
            self.data["qa"].pop(f"{slug}/{item_id}", None)
            self.save()
