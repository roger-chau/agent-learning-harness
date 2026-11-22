"""The Ask panel: a question-answering agent with the current chapter as context.

`answer` is an async generator of small dict events for the UI:
  text deltas, searches, sources, errors, done.
"""

from __future__ import annotations

import os
from typing import AsyncIterator

import anthropic

from .prompts import SYSTEM_PROMPT

MODEL = os.environ.get("GROUNDWORK_MODEL", "claude-opus-5-5")
EFFORT = os.environ.get("GROUNDWORK_EFFORT", "medium")
MAX_STEPS = 6
WEB_SEARCH = {"type": "web_search_20260209", "name": "web_search", "max_uses": 3}


def _request_kwargs(context: str, messages: list, system: str = SYSTEM_PROMPT) -> dict:
    return dict(
        model=MODEL,
        max_tokens=16000,
        system=[
            {"type": "text", "text": system},
            {"type": "text", "text": context, "cache_control": {"type": "ephemeral"}},
        ],
        tools=[WEB_SEARCH],
        messages=messages,
        thinking={"type": "adaptive"},
        output_config={"effort": EFFORT},
        cache_control={"type": "ephemeral"},
        # On a safety-classifier decline, re-run on Anthropic's recommended fallback model.
        betas=["server-side-fallback-2026-07-01"],
        fallbacks="default",
    )


def _sources(content: list) -> list[dict]:
    found = []
    for b in content:
        if b.type == "web_search_tool_result" and isinstance(b.content, list):
            found += [{"url": r.url, "title": getattr(r, "title", None)} for r in b.content if getattr(r, "url", None)]
        if b.type == "text" and getattr(b, "citations", None):
            found += [{"url": c.url, "title": getattr(c, "title", None)} for c in b.citations if getattr(c, "url", None)]
    seen, out = set(), []
    for s in found:
        if s["url"] not in seen:
            seen.add(s["url"])
            out.append(s)
    return out


async def answer(client: anthropic.AsyncAnthropic, context: str, history: list, question: str,
                 system: str = SYSTEM_PROMPT) -> AsyncIterator[dict]:
    """Stream an answer. `history` (API-format messages) is extended in place on success."""
    messages = history + [{"role": "user", "content": question}]
    new: list = [messages[-1]]
    for _ in range(MAX_STEPS):
        try:
            async with client.beta.messages.stream(**_request_kwargs(context, messages, system)) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        b = event.content_block
                        if b.type == "text":
                            yield {"type": "text_start"}
                        elif b.type == "server_tool_use":
                            yield {"type": "search_start"}
                    elif event.type == "content_block_delta" and event.delta.type == "text_delta":
                        yield {"type": "text", "text": event.delta.text}
                response = await stream.get_final_message()
        except anthropic.AuthenticationError:
            yield {"type": "error", "message": "No valid Anthropic credentials. Set ANTHROPIC_API_KEY and restart the server."}
            return
        except anthropic.RateLimitError:
            yield {"type": "error", "message": "Rate limited by the API. Wait a moment and ask again."}
            return
        except anthropic.APIStatusError as e:
            yield {"type": "error", "message": f"API error {e.status_code}: {e.message}"}
            return
        except anthropic.APIConnectionError:
            yield {"type": "error", "message": "Couldn't reach the Anthropic API. Check your connection."}
            return

        for b in response.content:
            if b.type == "server_tool_use" and isinstance(b.input, dict) and b.input.get("query"):
                yield {"type": "search", "query": b.input["query"]}
        src = _sources(response.content)
        if src:
            yield {"type": "sources", "sources": src}

        if response.stop_reason == "refusal":
            yield {"type": "error", "message": "The model declined this question. Try rephrasing."}
            return

        assistant = {"role": "assistant", "content": [b.to_dict() for b in response.content]}
        messages.append(assistant)
        new.append(assistant)
        if response.stop_reason == "pause_turn":
            continue  # server-side web search wants to keep going
        break

    history.extend(new)
    yield {"type": "done"}


def transcript(history: list) -> list[dict]:
    out = []
    for m in history:
        if m["role"] == "user" and isinstance(m["content"], str):
            out.append({"role": "user", "text": m["content"]})
        elif m["role"] == "assistant":
            text = "".join(b.get("text", "") for b in m["content"] if b.get("type") == "text")
            if out and out[-1]["role"] == "tutor":
                out[-1]["text"] += text
            else:
                out.append({"role": "tutor", "text": text})
    return out
