"""Learner model persistence: topics, a concept graph per topic, and conversations.

Everything lives in one JSON file (default ./data/learner.json) so it is easy to
inspect, back up, or reset. Writes are atomic (temp file + rename).
"""

from __future__ import annotations

import json
import os
import re
import threading
import uuid
from pathlib import Path

from . import scheduler

MASTERY_LABELS = {0: "unseen", 1: "gap", 2: "shaky", 3: "solid", 4: "mastered"}


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")[:60] or "concept"


class Store:
    def __init__(self, path: str | os.PathLike | None = None):
        self.path = Path(path or os.environ.get("GROUNDWORK_DATA", "data/learner.json"))
        self._lock = threading.RLock()
        self.data = {"topics": {}}
        if self.path.exists():
            self.data = json.loads(self.path.read_text())

    # ---- persistence -------------------------------------------------------
    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, indent=1, ensure_ascii=False))
            tmp.replace(self.path)

    # ---- topics ------------------------------------------------------------
    def create_topic(self, title: str, goal: str = "") -> dict:
        with self._lock:
            tid = uuid.uuid4().hex[:10]
            topic = {
                "id": tid,
                "title": title.strip(),
                "goal": goal.strip(),
                "created": scheduler.now().isoformat(),
                "concepts": {},
                "focus": None,
                "messages": [],
                "sources": [],
                "turns": 0,
            }
            self.data["topics"][tid] = topic
            self.save()
            return topic

    def topic(self, tid: str) -> dict:
        t = self.data["topics"].get(tid)
        if t is None:
            raise KeyError(tid)
        return t

    def list_topics(self) -> list[dict]:
        return sorted(self.data["topics"].values(), key=lambda t: t["created"], reverse=True)

    def delete_topic(self, tid: str) -> None:
        with self._lock:
            self.data["topics"].pop(tid, None)
            self.save()

    def reset_conversation(self, tid: str) -> None:
        with self._lock:
            t = self.topic(tid)
            t["messages"] = []
            self.save()

    # ---- concept graph -----------------------------------------------------
    def find_concept(self, t: dict, name_or_id: str) -> dict | None:
        cid = slugify(name_or_id)
        if cid in t["concepts"]:
            return t["concepts"][cid]
        low = name_or_id.strip().lower()
        for c in t["concepts"].values():
            if c["name"].lower() == low:
                return c
        return None

    def upsert_concept(self, t: dict, name: str, summary: str = "", prerequisites=(), foundational=False) -> dict:
        with self._lock:
            c = self.find_concept(t, name)
            if c is None:
                cid = slugify(name)
                c = {
                    "id": cid,
                    "name": name.strip(),
                    "summary": "",
                    "prerequisites": [],
                    "foundational": False,
                    "mastery": 0,
                    "misconceptions": [],
                    "evidence": [],
                    "review": None,
                    "created": scheduler.now().isoformat(),
                }
                t["concepts"][cid] = c
            if summary:
                c["summary"] = summary.strip()
            c["foundational"] = bool(foundational) or c["foundational"]
            for p in prerequisites or []:
                if not p or not p.strip():
                    continue
                pc = self.find_concept(t, p) or self.upsert_concept(t, p)
                if pc["id"] != c["id"] and pc["id"] not in c["prerequisites"] and not self._reaches(t, pc["id"], c["id"]):
                    c["prerequisites"].append(pc["id"])
            return c

    def _reaches(self, t: dict, start: str, target: str) -> bool:
        """True if `target` is a prerequisite (transitively) of `start` -> adding edge would create a cycle."""
        seen, stack = set(), [start]
        while stack:
            cur = stack.pop()
            if cur == target:
                return True
            if cur in seen:
                continue
            seen.add(cur)
            stack.extend(t["concepts"].get(cur, {}).get("prerequisites", []))
        return False

    def assess(self, t: dict, c: dict, result: str, evidence: str = "", misconception: str = "", grade: int | None = None) -> dict:
        """Record evidence about the learner's understanding and reschedule review."""
        with self._lock:
            mastery_by_result = {"gap": 1, "shaky": 2, "solid": 3, "mastered": 4}
            c["mastery"] = mastery_by_result.get(result, c["mastery"])
            if evidence:
                c["evidence"].append({"at": scheduler.now().isoformat(), "result": result, "note": evidence.strip()})
                c["evidence"] = c["evidence"][-12:]
            if misconception and misconception.strip() not in c["misconceptions"]:
                c["misconceptions"].append(misconception.strip())
            if grade is None:
                grade = {"gap": 1, "shaky": 3, "solid": 4, "mastered": 5}.get(result, 3)
            c["review"] = scheduler.schedule(c.get("review"), grade)
            return c

    def depths(self, t: dict) -> dict[str, int]:
        """Layer index per concept: 0 for foundations, else 1 + max(depth of prerequisites)."""
        memo: dict[str, int] = {}

        def d(cid: str, stack: frozenset = frozenset()) -> int:
            if cid in memo:
                return memo[cid]
            if cid in stack:
                return 0
            prereqs = [p for p in t["concepts"].get(cid, {}).get("prerequisites", []) if p in t["concepts"]]
            val = 0 if not prereqs else 1 + max(d(p, stack | {cid}) for p in prereqs)
            memo[cid] = val
            return val

        for cid in t["concepts"]:
            d(cid)
        return memo

    def chain(self, t: dict, cid: str) -> list[dict]:
        """All transitive prerequisites of a concept plus itself, ordered foundations-first."""
        depth = self.depths(t)
        seen: set[str] = set()

        def walk(x: str):
            if x in seen or x not in t["concepts"]:
                return
            seen.add(x)
            for p in t["concepts"][x]["prerequisites"]:
                walk(p)

        walk(cid)
        return sorted((t["concepts"][x] for x in seen), key=lambda c: (depth.get(c["id"], 0), c["created"]))

    def due(self, t: dict) -> list[dict]:
        return [c for c in t["concepts"].values() if scheduler.is_due(c.get("review"))]

    # ---- sources -----------------------------------------------------------
    def add_sources(self, t: dict, sources: list[dict]) -> list[dict]:
        with self._lock:
            known = {s["url"] for s in t["sources"]}
            added = []
            for s in sources:
                if s.get("url") and s["url"] not in known:
                    known.add(s["url"])
                    entry = {"url": s["url"], "title": s.get("title") or s["url"], "at": scheduler.now().isoformat()}
                    t["sources"].append(entry)
                    added.append(entry)
            return added

    # ---- views -------------------------------------------------------------
    def concept_view(self, t: dict, c: dict, depth: dict | None = None) -> dict:
        depth = depth if depth is not None else self.depths(t)
        return {
            "id": c["id"],
            "name": c["name"],
            "summary": c["summary"],
            "prerequisites": c["prerequisites"],
            "foundational": c["foundational"],
            "mastery": c["mastery"],
            "mastery_label": MASTERY_LABELS[c["mastery"]],
            "misconceptions": c["misconceptions"],
            "depth": depth.get(c["id"], 0),
            "due": scheduler.is_due(c.get("review")),
            "next_review": (c.get("review") or {}).get("due"),
        }

    def topic_summary(self, t: dict) -> dict:
        concepts = list(t["concepts"].values())
        depth = self.depths(t)
        return {
            "id": t["id"],
            "title": t["title"],
            "goal": t["goal"],
            "created": t["created"],
            "focus": t["focus"],
            "turns": t.get("turns", 0),
            "stats": {
                "concepts": len(concepts),
                "mastered": sum(1 for c in concepts if c["mastery"] >= 3),
                "gaps": sum(1 for c in concepts if c["mastery"] in (1, 2)),
                "due": len(self.due(t)),
                "sources": len(t["sources"]),
            },
            "concepts": [self.concept_view(t, c, depth) for c in concepts],
        }
