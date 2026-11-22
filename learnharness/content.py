"""Loads static course content from the courses/ directory.

Layout of a course:
    courses/catalog.json                     ordered list of all courses (available or planned)
    courses/<slug>/course.json               parts -> items (chapter | milestone | checkpoint)
    courses/<slug>/chapters/<item>.html      chapter body (HTML with data-gw components)
    courses/<slug>/quizzes/<item>.json       quiz incl. answers -- never sent to the browser
    courses/<slug>/exercises/<exercise>.js   exercise definitions (prompt, starter code, tests)
    courses/<slug>/assets/...                images and other static files
"""

from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from html import unescape
from pathlib import Path

ROOT = Path(os.environ.get("GROUNDWORK_COURSES", Path(__file__).resolve().parent.parent / "courses"))
ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,80}$")


class NotFound(Exception):
    pass


def _safe(part: str) -> str:
    if not ID_RE.match(part or ""):
        raise NotFound(part)
    return part


def catalog() -> list[dict]:
    return json.loads((ROOT / "catalog.json").read_text())


@lru_cache(maxsize=32)
def _course_cached(slug: str, mtime: float) -> dict:
    data = json.loads((ROOT / slug / "course.json").read_text())
    data["slug"] = slug
    order = []
    for part in data["parts"]:
        for item in part["items"]:
            item["part"] = part["id"]
            item.setdefault("status", "ready")
            item.setdefault("exercises", [])
            item["has_quiz"] = (ROOT / slug / "quizzes" / f"{item['id']}.json").exists()
            item["has_problems"] = (ROOT / slug / "problems" / f"{item['id']}.json").exists()
            order.append(item)
    data["order"] = order
    return data


def course(slug: str) -> dict:
    path = ROOT / _safe(slug) / "course.json"
    if not path.exists():
        raise NotFound(slug)
    return _course_cached(slug, path.stat().st_mtime)


def item(slug: str, item_id: str) -> dict:
    for it in course(slug)["order"]:
        if it["id"] == item_id:
            return it
    raise NotFound(item_id)


def chapter_html(slug: str, item_id: str) -> str:
    p = ROOT / _safe(slug) / "chapters" / f"{_safe(item_id)}.html"
    return p.read_text() if p.exists() else ""


def quiz(slug: str, item_id: str) -> dict | None:
    p = ROOT / _safe(slug) / "quizzes" / f"{_safe(item_id)}.json"
    return json.loads(p.read_text()) if p.exists() else None


def public_quiz(q: dict | None) -> dict | None:
    """Quiz without answers or explanations."""
    if not q:
        return None
    return {
        "pass": q.get("pass", 0.8),
        "questions": [
            {k: v for k, v in question.items() if k not in ("answer", "explanation", "tolerance")}
            for question in q["questions"]
        ],
    }


def grade_quiz(q: dict, answers: dict) -> dict:
    results = []
    correct = 0
    for question in q["questions"]:
        qid = question["id"]
        given = answers.get(qid)
        ok = _check(question, given)
        correct += ok
        results.append({"id": qid, "correct": ok, "explanation": question.get("explanation", ""),
                        "answer": question["answer"]})
    total = len(q["questions"])
    score = correct / total if total else 1.0
    return {"score": round(score, 4), "correct": correct, "total": total,
            "passed": score >= q.get("pass", 0.8), "results": results}


def _check(question: dict, given) -> bool:
    kind = question["type"]
    ans = question["answer"]
    try:
        if kind == "single":
            return int(given) == int(ans)
        if kind == "multi":
            return sorted(int(x) for x in (given or [])) == sorted(int(x) for x in ans)
        if kind == "numeric":
            if given is None or str(given).strip() == "":
                return False
            val = float(str(given).replace(",", "").strip())
            tol = question.get("tolerance", 0)
            if isinstance(tol, str) and tol.endswith("%"):
                tol = abs(ans) * float(tol[:-1]) / 100
            return abs(val - ans) <= float(tol) + 1e-9 * max(1.0, abs(ans))
    except (TypeError, ValueError):
        return False
    return False


def problems(slug: str, item_id: str) -> dict | None:
    p = ROOT / _safe(slug) / "problems" / f"{_safe(item_id)}.json"
    return json.loads(p.read_text()) if p.exists() else None


def coding(slug: str, pid: str) -> dict | None:
    """A coding problem: courses/<slug>/coding/<pid>.json (see learnharness/runner.py)."""
    p = ROOT / _safe(slug) / "coding" / f"{_safe(pid)}.json"
    return json.loads(p.read_text()) if p.exists() else None


def public_coding(pr: dict) -> dict:
    """What the learner sees before solving: statement, starters, samples and hints."""
    langs = [l for l in ("python", "cpp") if (pr.get("entry") or {}).get(l) and pr.get("starter", {}).get(l)]
    return {"id": pr["id"], "title": pr["title"], "difficulty": pr.get("difficulty", "medium"), "pattern": pr.get("pattern", ""),
            "statement": pr["statement"], "starter": {l: pr["starter"][l] for l in langs}, "langs": langs,
            "samples": [{"args": t["args"], "expected": t["expected"]} if "args" in t else {"ops": t["ops"], "expected": t["expected"]}
                        for t in pr["tests"] if t.get("sample")],
            "tests": len(pr["tests"]), "hints": pr.get("hints", []), "target": pr.get("complexity", "")}


def exam(slug: str, item_id: str) -> dict | None:
    """Exam problems live in exams/<id>.json, in the problem-set format, plus
    {"minutes": ..., "pass": ...}. They're never sent with the item: only when an attempt starts."""
    p = ROOT / _safe(slug) / "exams" / f"{_safe(item_id)}.json"
    return json.loads(p.read_text()) if p.exists() else None


def exam_paper(ex: dict) -> list[dict]:
    """What a candidate sees during an attempt: statements and parts, no hints, answers or solutions."""
    hide = ("answer", "tolerance", "explanation")
    return [{"id": pr["id"], "level": pr.get("level", 1), "title": pr.get("title", ""), "statement": pr.get("statement", ""),
             "parts": [{k: v for k, v in part.items() if k not in hide} for part in pr["parts"]]}
            for pr in ex["problems"]]


def grade_exam(ex: dict, answers: dict) -> dict:
    """Partial credit: every part is worth the same."""
    per, got, total = {}, 0, 0
    for pr in ex["problems"]:
        g = grade_problem(pr, answers.get(pr["id"]) or {})
        per[pr["id"]] = g["parts"]
        got += sum(g["parts"].values()); total += len(g["parts"])
    return {"parts": per, "score": got / total if total else 0.0, "correct": got, "total": total}


def public_problems(ps: dict | None) -> dict | None:
    """Problem set without answers or worked solutions (hints are public)."""
    if not ps:
        return None
    hide = ("answer", "tolerance", "explanation")
    return {
        "pass": ps.get("pass", 0.7),
        "problems": [
            {**{k: v for k, v in pr.items() if k != "solution"},
             "parts": [{k: v for k, v in part.items() if k not in hide} for part in pr["parts"]]}
            for pr in ps["problems"]
        ],
    }


def find_problem(ps: dict, pid: str) -> dict:
    for pr in ps["problems"]:
        if pr["id"] == pid:
            return pr
    raise NotFound(pid)


def grade_problem(pr: dict, answers: dict) -> dict:
    parts = {part["id"]: _check(part, answers.get(part["id"])) for part in pr["parts"]}
    return {"parts": parts, "solved": all(parts.values())}


def asset_path(slug: str, kind: str, rel: str) -> Path:
    """Resolve a public course file (exercises/ or assets/ only)."""
    if kind not in ("exercises", "assets"):
        raise NotFound(kind)
    base = (ROOT / _safe(slug) / kind).resolve()
    target = (base / rel).resolve()
    if not target.is_relative_to(base) or not target.is_file():
        raise NotFound(rel)
    return target


EXERCISE_MIN = {"chapter": 30, "scenario": 60, "paper": 45, "milestone": 120, "checkpoint": 30}


def estimate(slug: str, it: dict) -> dict:
    """Time estimates in minutes, calibrated for careful study rather than skimming:
    reading  technical prose at ~130 words/min, +0.75 min per displayed equation or code block,
             +90 min for a paper chapter (reading the paper itself);
    assigned the "Required" readings listed in the chapter (textbook sections, papers), 45 min each;
    practice problems by level (5/10/20), exercises by kind (chapter drill 30 min, milestone 2 h,
             paper project 3 h, capstone 10 h), quiz 10 min, write-up words/10, labs' hours, exam length."""
    html = chapter_html(slug, it["id"])
    words = len(plain_text(html).split())
    eqs = html.count('class="eq"') + html.count("<pre>")
    reading = max(1, round(words / 130 + eqs * 0.75))
    if it.get("type") == "paper":
        reading += 90
    assigned = 45 * html.count("<strong>Required:</strong>")
    ps = problems(slug, it["id"]) or {"problems": []}
    per_level = {1: 5, 2: 10, 3: 20}
    practice = sum(per_level.get(p.get("level", 1), 5) for p in ps["problems"])
    per_ex = EXERCISE_MIN.get(it.get("type"), 30)
    if it["id"].startswith("PP-"):
        per_ex = 180
    if it["id"] == "capstone":
        per_ex = 600
    practice += per_ex * len(it.get("exercises", []))
    practice += sum({"easy": 15, "medium": 30, "hard": 50}.get((coding(slug, c) or {}).get("difficulty", "medium"), 30)
                    for c in it.get("coding", []))
    practice += (20 if it.get("type") == "checkpoint" else 10) if it.get("has_quiz") else 0
    wu = it.get("writeup")
    practice += round(wu.get("min_words", 150) / 10) if wu else 0
    if it.get("type") == "lab":
        practice += int(it.get("hours", 2) * 60)
    if it.get("type") == "exam":
        practice += (exam(slug, it["id"]) or {}).get("minutes", 60)
    return {"reading": reading, "assigned": assigned, "practice": practice, "words": words,
            "total": reading + assigned + practice}


_hours_cache: dict = {}


def part_hours(slug: str) -> dict:
    """Estimated hours per Part (ready items only). Cached for a minute: it reads every chapter."""
    import time
    hit = _hours_cache.get(slug)
    if hit and time.time() - hit[0] < 60:
        return hit[1]
    out = {}
    for part in course(slug)["parts"]:
        mins = sum(estimate(slug, it)["total"] for it in part["items"] if it.get("status", "ready") == "ready")
        out[part["id"]] = round(mins / 60, 1)
    _hours_cache[slug] = (time.time(), out)
    return out


def plain_text(html: str) -> str:
    """Rough HTML -> text for giving the Q&A agent chapter context."""
    html = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    html = re.sub(r"<svg[\s\S]*?</svg>", " [diagram] ", html, flags=re.I)
    html = re.sub(r"<(br|/p|/h\d|/li|/tr|/pre|/figure)>", "\n", html, flags=re.I)
    text = unescape(re.sub(r"<[^>]+>", " ", html))
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()
