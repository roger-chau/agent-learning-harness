"""The tutor's agent loop: stream a turn from Claude, run tools, repeat until the turn ends.

`run_turn` is an async generator of small dict events the web UI renders live:
  text / thinking deltas, tool activity, searches, sources, graph changes, errors, done.
"""

from __future__ import annotations

import json
import os
from typing import AsyncIterator

import anthropic

from .prompts import SYSTEM_PROMPT
from .store import Store
from .tools import ALL_TOOLS, CUSTOM_NAMES, ToolError, run_tool

MODEL = os.environ.get("GROUNDWORK_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("GROUNDWORK_EFFORT", "medium")
MAX_STEPS = 16

TOOL_LABELS = {
    "get_learner_state": "Reading your learner model",
    "map_concepts": "Mapping concepts",
    "record_assessment": "Recording what you showed",
    "set_focus": "Choosing the next block",
    "get_prerequisite_chain": "Walking down the prerequisite chain",
    "get_due_reviews": "Checking reviews due",
}


def _request_kwargs(messages: list) -> dict:
    return dict(
        model=MODEL,
        max_tokens=32000,
        system=[{"type": "text", "text": SYSTEM_PROMPT, "cache_control": {"type": "ephemeral"}}],
        tools=ALL_TOOLS,
        messages=messages,
        thinking={"type": "adaptive", "display": "summarized"},
        output_config={"effort": EFFORT},
        cache_control={"type": "ephemeral"},
        # On a safety-classifier decline, re-run on Anthropic's recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )


def _sources_from(content: list) -> list[dict]:
    found = []
    for b in content:
        if b.type == "web_search_tool_result" and isinstance(b.content, list):
            for r in b.content:
                if getattr(r, "url", None):
                    found.append({"url": r.url, "title": getattr(r, "title", None)})
        if b.type == "text" and getattr(b, "citations", None):
            for c in b.citations:
                if getattr(c, "url", None):
                    found.append({"url": c.url, "title": getattr(c, "title", None)})
    return found


def _summarize_tool(name: str, args) -> str:
    if not isinstance(args, dict):
        return ""
    if name == "map_concepts" and isinstance(args.get("concepts"), list):
        return ", ".join(str(c.get("name")) for c in args["concepts"] if isinstance(c, dict))[:160]
    if name == "record_assessment":
        return f"{args.get('concept', '')}: {args.get('result', '')}"
    if name in ("set_focus", "get_prerequisite_chain"):
        return str(args.get("concept", ""))
    return ""


async def run_turn(client: anthropic.AsyncAnthropic, store: Store, tid: str, user_text: str) -> AsyncIterator[dict]:
    t = store.topic(tid)
    messages = t["messages"]
    messages.append({"role": "user", "content": user_text})
    store.save()

    json_retries = 0
    step = 0
    while step < MAX_STEPS:
        step += 1
        try:
            async with client.beta.messages.stream(**_request_kwargs(messages)) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        b = event.content_block
                        if b.type == "text":
                            yield {"type": "text_start"}
                        elif b.type == "thinking":
                            yield {"type": "thinking_start"}
                        elif b.type == "tool_use" and b.name in CUSTOM_NAMES:
                            yield {"type": "tool_start", "name": b.name, "label": TOOL_LABELS.get(b.name, b.name)}
                        elif b.type == "server_tool_use":
                            yield {"type": "search_start"}
                    elif event.type == "content_block_delta":
                        d = event.delta
                        if d.type == "text_delta":
                            yield {"type": "text", "text": d.text}
                        elif d.type == "thinking_delta" and d.thinking:
                            yield {"type": "thinking", "text": d.thinking}
                response = await stream.get_final_message()
            json_retries = 0
        except ValueError:
            # Tool input JSON the SDK could not parse at all; re-issue the turn (bounded).
            json_retries += 1
            if json_retries > 2:
                yield {"type": "error", "message": "The tutor produced malformed tool input repeatedly. Try again."}
                break
            step -= 1
            continue
        except anthropic.AuthenticationError:
            yield {"type": "error", "message": "No valid Anthropic credentials. Set ANTHROPIC_API_KEY (or run `ant auth login`) and restart."}
            break
        except anthropic.RateLimitError:
            yield {"type": "error", "message": "Rate limited by the API. Wait a moment and send again."}
            break
        except anthropic.APIStatusError as e:
            yield {"type": "error", "message": f"API error {e.status_code}: {e.message}"}
            break
        except anthropic.APIConnectionError:
            yield {"type": "error", "message": "Couldn't reach the Anthropic API. Check your connection."}
            break

        # Searches and sources from this step.
        for b in response.content:
            if b.type == "server_tool_use" and isinstance(b.input, dict) and b.input.get("query"):
                yield {"type": "search", "query": b.input["query"]}
        added = store.add_sources(t, _sources_from(response.content))
        if added:
            store.save()
            yield {"type": "sources", "sources": added}

        if response.stop_reason == "refusal":
            yield {"type": "error", "message": "The model declined this request. Try rephrasing."}
            break

        messages.append({"role": "assistant", "content": [b.to_dict() for b in response.content]})
        store.save()

        if response.stop_reason == "pause_turn":
            continue

        tool_uses = [b for b in response.content if b.type == "tool_use"]
        if not tool_uses:
            break
        if response.stop_reason == "max_tokens":
            # A truncated tool input parses as a partial object; never run it.
            messages.pop()
            store.save()
            yield {"type": "error", "message": "The response was cut off mid tool call. Send again to retry."}
            break

        results = []
        for b in tool_uses:
            try:
                out, changes = run_tool(store, tid, b.name, b.input)
                results.append({"type": "tool_result", "tool_use_id": b.id, "content": out})
                yield {"type": "tool", "name": b.name, "label": TOOL_LABELS.get(b.name, b.name),
                       "detail": _summarize_tool(b.name, b.input), "changes": changes}
            except (ToolError, KeyError) as e:
                results.append({"type": "tool_result", "tool_use_id": b.id, "is_error": True,
                                "content": json.dumps({"error": str(e)})})
        messages.append({"role": "user", "content": results})
        store.save()
        if any(r.get("is_error") is not True for r in results):
            yield {"type": "graph"}

    t["turns"] = t.get("turns", 0) + 1
    store.save()
    yield {"type": "done"}


def transcript(t: dict) -> list[dict]:
    """Render stored API messages as a simple chat transcript for the UI."""
    out: list[dict] = []
    for m in t["messages"]:
        if m["role"] == "user":
            if isinstance(m["content"], str):
                out.append({"role": "user", "text": m["content"]})
            continue
        if m["role"] != "assistant":
            continue
        entry = out[-1] if out and out[-1]["role"] == "tutor" else None
        if entry is None:
            entry = {"role": "tutor", "text": "", "activity": []}
            out.append(entry)
        for b in m["content"]:
            if b.get("type") == "text":
                entry["text"] += ("\n\n" if entry["text"] else "") + b.get("text", "")
            elif b.get("type") == "tool_use" and b.get("name") in CUSTOM_NAMES:
                entry["activity"].append({"label": TOOL_LABELS.get(b["name"], b["name"]),
                                          "detail": _summarize_tool(b["name"], b.get("input"))})
            elif b.get("type") == "server_tool_use":
                q = (b.get("input") or {}).get("query")
                if q:
                    entry["activity"].append({"label": "Searched", "detail": q})
    return out
