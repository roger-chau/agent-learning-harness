"""Learner progress and hard gating.

An item is complete when:
  chapter    -> all its exercises passed and its quiz passed (if it has one)
  milestone  -> all its exercises passed
  checkpoint -> its quiz passed
An item is unlocked when every earlier ready item in the course is complete.
Planned (not yet written) items are always locked and don't block anything.
Everything is unlocked by default (GROUNDWORK_UNLOCK unset or 1); set GROUNDWORK_UNLOCK=0, or run
`groundwork --locked`, to enforce gating.
"""

from __future__ import annotations

import json
import os
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from . import content


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def default_path() -> Path:
    """Where progress lives: $GROUNDWORK_DATA if set, else ~/.groundwork/progress.json, the same
    file whichever folder the server is started from. A progress file from older versions
    (data/progress.json, relative to the start folder or the repository) is copied over once."""
    env = os.environ.get("GROUNDWORK_DATA")
    if env:
        return Path(env)
    home = Path.home() / ".groundwork" / "progress.json"
    if not home.exists():
        for old in (Path("data/progress.json"), Path(__file__).resolve().parent.parent / "data" / "progress.json"):
            if old.exists():
                home.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(old, home)
                break
    return home


class Progress:
    BACKUPS_KEPT = 14

    def __init__(self, path: str | os.PathLike | None = None):
        self.path = Path(path) if path else default_path()
        self._lock = threading.RLock()
        self.data = {"courses": {}, "qa": {}}
        if self.path.exists():
            self.data = json.loads(self.path.read_text())
            self.data.setdefault("qa", {})

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            self._daily_backup()
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=1))
            tmp.replace(self.path)  # atomic: a crash mid-write never leaves a half-written file

    def _daily_backup(self) -> None:
        """Before the first save of each day, keep a copy of yesterday's file (last 14 days)."""
        if not self.path.exists():
            return
        bdir = self.path.parent / "backups"
        target = bdir / f"{self.path.stem}-{datetime.now().date().isoformat()}.json"
        if target.exists():
            return
        bdir.mkdir(exist_ok=True)
        shutil.copy2(self.path, target)
        for old in sorted(bdir.glob(f"{self.path.stem}-*.json"))[:-self.BACKUPS_KEPT]:
            old.unlink()

    # ---- export / import ------------------------------------------------------
    def export(self) -> dict:
        with self._lock:
            return json.loads(json.dumps(self.data))

    def restore(self, data: dict) -> None:
        if not isinstance(data, dict) or not isinstance(data.get("courses"), dict):
            raise ValueError("not a Groundwork progress file")
        with self._lock:
            if self.path.exists():  # keep what was there, in case the restore was a mistake
                self.path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(self.path, self.path.with_name(f"{self.path.stem}-before-restore.json"))
            self.data = {"courses": data["courses"], "qa": data.get("qa") or {}}
            self.save()

    def _item(self, slug: str, item_id: str) -> dict:
        c = self.data["courses"].setdefault(slug, {"items": {}})
        return c["items"].setdefault(item_id, {"exercises": {}, "quiz": None, "completed_at": None})

    # ---- state -------------------------------------------------------------
    def is_complete(self, slug: str, it: dict) -> bool:
        if it["status"] != "ready":
            return False
        rec = self.data["courses"].get(slug, {}).get("items", {}).get(it["id"]) or {}
        wu = it.get("writeup")
        if not it["exercises"] and not it["has_quiz"] and not wu and it["type"] != "lab":
            return bool(rec.get("read"))  # nothing to pass: reading it is enough
        ex_ok = all(rec.get("exercises", {}).get(e, {}).get("passed") for e in it["exercises"])
        quiz_ok = (not it["has_quiz"]) or bool((rec.get("quiz") or {}).get("passed"))
        wu_ok = (not wu) or (rec.get("writeup") or {}).get("words", 0) >= wu.get("min_words", 100)
        if it["type"] == "lab":
            return bool((rec.get("lab") or {}).get("passed"))
        pr_ok = True
        if it.get("has_problems"):
            ps = content.problems(slug, it["id"]) or {"problems": []}
            solved = sum(1 for p in ps["problems"] if (rec.get("problems", {}).get(p["id"]) or {}).get("solved"))
            pr_ok = not ps["problems"] or solved / len(ps["problems"]) >= ps.get("pass", 0.7) - 1e-9
        return ex_ok and quiz_ok and wu_ok and pr_ok

    def states(self, slug: str) -> dict[str, dict]:
        unlock_all = os.environ.get("GROUNDWORK_UNLOCK", "1") != "0"
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
                "problems": rec.get("problems", {}),
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

    def record_problem(self, slug: str, item_id: str, pid: str, solved: bool | None = None, reveal: bool = False) -> dict:
        """Record an attempt (solved given) or a reveal. A revealed problem can't count as solved."""
        with self._lock:
            rec = self._item(slug, item_id)
            probs = rec.setdefault("problems", {})
            p = probs.get(pid) or {"attempts": 0, "solved": False, "revealed": False}
            if reveal:
                p["revealed"] = True
            else:
                p["attempts"] += 1
                if solved and not p["revealed"]:
                    p["solved"] = True
            p["at"] = _now()
            probs[pid] = p
            self._mark(slug, item_id, rec)
            self.save()
            return dict(p)

    def record_lab(self, slug: str, item_id: str, data: dict, result: dict) -> None:
        with self._lock:
            rec = self._item(slug, item_id)
            prev = rec.get("lab") or {"passed": False, "submissions": 0}
            rec["lab"] = {
                "passed": prev["passed"] or result["passed"],
                "submissions": prev["submissions"] + 1,
                "last": {"device": data.get("device"), "metrics": data.get("metrics"), "checks": data.get("checks"),
                         "targets": result["targets"], "passed": result["passed"], "at": _now()},
                "best": prev.get("best") if prev.get("best") and not result["passed"] else
                        {"device": data.get("device"), "metrics": data.get("metrics"), "at": _now()} if result["passed"] else prev.get("best"),
            }
            self._mark(slug, item_id, rec)
            self.save()

    def lab(self, slug: str, item_id: str) -> dict | None:
        return (self.data["courses"].get(slug, {}).get("items", {}).get(item_id) or {}).get("lab")

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
