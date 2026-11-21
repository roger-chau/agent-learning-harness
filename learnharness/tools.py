"""Tools the tutor agent can call. Each handler mutates/reads the learner model."""

from __future__ import annotations

import json

from .store import Store

RESULTS = ["gap", "shaky", "solid", "mastered"]


def _tool(name: str, description: str, properties: dict, required: list[str]) -> dict:
    return {
        "name": name,
        "description": description,
        "eager_input_streaming": True,
        "input_schema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": False,
        },
    }


CUSTOM_TOOLS = [
    _tool(
        "get_learner_state",
        "Read the learner model for this topic: the goal, every mapped concept with its mastery "
        "(unseen/gap/shaky/solid/mastered), known misconceptions, current focus, and how many reviews are due. "
        "Call this at the start of a session and whenever you need to decide what to teach next.",
        {},
        [],
    ),
    _tool(
        "map_concepts",
        "Add or update concepts in the topic's prerequisite graph. Use it to lay out the chain from the "
        "learner's goal down to foundational ideas they can be assumed to know or can check quickly. "
        "Prerequisites are concept names; missing ones are created. Keep concepts small: one idea each.",
        {
            "concepts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string", "description": "Short concept name, e.g. 'Derivative as a limit'."},
                        "summary": {"type": "string", "description": "One sentence stating the idea precisely."},
                        "prerequisites": {"type": "array", "items": {"type": "string"}, "description": "Names of concepts this one directly builds on."},
                        "foundational": {"type": "boolean", "description": "True if this is a bedrock idea that needs nothing else in this map."},
                    },
                    "required": ["name", "summary", "prerequisites"],
                    "additionalProperties": False,
                },
            }
        },
        ["concepts"],
    ),
    _tool(
        "record_assessment",
        "Record evidence about how well the learner understands one concept, after they answer a probe "
        "question or exercise. This sets mastery and schedules spaced review. Base it on what the learner "
        "actually said, not on what you explained.",
        {
            "concept": {"type": "string", "description": "Concept name (must already be mapped, or it will be created)."},
            "result": {"type": "string", "enum": RESULTS, "description": "gap: cannot explain it; shaky: partial or with a misconception; solid: correct and can apply it; mastered: can explain why and handle edge cases."},
            "evidence": {"type": "string", "description": "What the learner said or did that supports this judgement (one or two sentences)."},
            "misconception": {"type": "string", "description": "A specific misconception revealed, if any. Empty string if none."},
        },
        ["concept", "result", "evidence"],
    ),
    _tool(
        "set_focus",
        "Mark the concept you are now teaching or probing, so the learner's map highlights it.",
        {"concept": {"type": "string"}},
        ["concept"],
    ),
    _tool(
        "get_prerequisite_chain",
        "Get the full chain of prerequisites under a concept, ordered from foundations up, with mastery for "
        "each. Use it to find the lowest block the learner is missing.",
        {"concept": {"type": "string"}},
        ["concept"],
    ),
    _tool(
        "get_due_reviews",
        "List concepts whose spaced-review date has arrived, with their summaries and past misconceptions.",
        {},
        [],
    ),
]

WEB_SEARCH_TOOL = {"type": "web_search_20260209", "name": "web_search", "max_uses": 4}

ALL_TOOLS = CUSTOM_TOOLS + [WEB_SEARCH_TOOL]
CUSTOM_NAMES = {t["name"] for t in CUSTOM_TOOLS}


class ToolError(Exception):
    pass


def _require_str(args: dict, key: str, allow_empty: bool = False) -> str:
    v = args.get(key)
    if not isinstance(v, str) or (not allow_empty and not v.strip()):
        raise ToolError(f"'{key}' must be a non-empty string")
    return v


def run_tool(store: Store, tid: str, name: str, args) -> tuple[str, list[str]]:
    """Execute a custom tool. Returns (result_json, list_of_ui_change_kinds)."""
    if not isinstance(args, dict):
        raise ToolError("input must be an object")
    t = store.topic(tid)

    if name == "get_learner_state":
        summary = store.topic_summary(t)
        return json.dumps({
            "goal": t["goal"] or t["title"],
            "focus": t["focus"],
            "stats": summary["stats"],
            "concepts": [
                {k: c[k] for k in ("name", "summary", "mastery_label", "misconceptions", "depth", "due")}
                | {"prerequisites": [t["concepts"][p]["name"] for p in c["prerequisites"] if p in t["concepts"]]}
                for c in summary["concepts"]
            ],
        }), []

    if name == "map_concepts":
        items = args.get("concepts")
        if not isinstance(items, list) or not items:
            raise ToolError("'concepts' must be a non-empty array")
        names = []
        for item in items:
            if not isinstance(item, dict):
                raise ToolError("each concept must be an object")
            cname = _require_str(item, "name")
            prereqs = item.get("prerequisites") or []
            if not isinstance(prereqs, list) or not all(isinstance(p, str) for p in prereqs):
                raise ToolError("'prerequisites' must be an array of strings")
            store.upsert_concept(t, cname, item.get("summary") or "", prereqs, bool(item.get("foundational")))
            names.append(cname)
        store.save()
        return json.dumps({"ok": True, "mapped": names, "total_concepts": len(t["concepts"])}), ["graph"]

    if name == "record_assessment":
        cname = _require_str(args, "concept")
        result = args.get("result")
        if result not in RESULTS:
            raise ToolError(f"'result' must be one of {RESULTS}")
        c = store.find_concept(t, cname) or store.upsert_concept(t, cname)
        store.assess(t, c, result, args.get("evidence") or "", args.get("misconception") or "")
        store.save()
        return json.dumps({"ok": True, "concept": c["name"], "mastery": result, "next_review": c["review"]["due"]}), ["graph", "assessment"]

    if name == "set_focus":
        cname = _require_str(args, "concept")
        c = store.find_concept(t, cname) or store.upsert_concept(t, cname)
        t["focus"] = c["id"]
        store.save()
        return json.dumps({"ok": True, "focus": c["name"]}), ["graph"]

    if name == "get_prerequisite_chain":
        cname = _require_str(args, "concept")
        c = store.find_concept(t, cname)
        if c is None:
            raise ToolError(f"concept '{cname}' is not mapped yet; call map_concepts first")
        return json.dumps({"chain": [
            {"name": x["name"], "summary": x["summary"], "mastery": store.concept_view(t, x)["mastery_label"]}
            for x in store.chain(t, c["id"])
        ]}), []

    if name == "get_due_reviews":
        return json.dumps({"due": [
            {"name": c["name"], "summary": c["summary"], "misconceptions": c["misconceptions"],
             "mastery": store.concept_view(t, c)["mastery_label"]}
            for c in store.due(t)
        ]}), []

    raise ToolError(f"unknown tool {name}")
