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


def estimate(slug: str, it: dict) -> dict:
    """Rough time estimates in minutes: reading (technical prose at ~180 wpm, plus time per
    displayed equation and code block) and practice (exercises, problems by level, quiz, write-up)."""
    html = chapter_html(slug, it["id"])
    words = len(plain_text(html).split())
    eqs = html.count('class="eq"') + html.count("<pre>")
    reading = max(1, round(words / 180 + eqs * 0.5))
    ps = problems(slug, it["id"]) or {"problems": []}
    per_level = {1: 5, 2: 10, 3: 20}
    practice = sum(per_level.get(p.get("level", 1), 5) for p in ps["problems"])
    practice += 25 * len(it.get("exercises", []))
    practice += 8 if it.get("has_quiz") else 0
    wu = it.get("writeup")
    practice += round(wu.get("min_words", 150) / 10) if wu else 0
    return {"reading": reading, "practice": practice, "words": words}


def plain_text(html: str) -> str:
    """Rough HTML -> text for giving the Q&A agent chapter context."""
    html = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", html, flags=re.I)
    html = re.sub(r"<svg[\s\S]*?</svg>", " [diagram] ", html, flags=re.I)
    html = re.sub(r"<(br|/p|/h\d|/li|/tr|/pre|/figure)>", "\n", html, flags=re.I)
    text = unescape(re.sub(r"<[^>]+>", " ", html))
    text = re.sub(r"[ \t]+", " ", text)
    return re.sub(r"\n\s*\n+", "\n\n", text).strip()
