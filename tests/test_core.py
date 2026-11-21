import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from anthropic.types.beta import BetaMessage
from fastapi.testclient import TestClient

from learnharness import agent, scheduler, server
from learnharness.store import Store
from learnharness.tools import ToolError, run_tool


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "learner.json")


# ---------- scheduler ----------
def test_schedule_grows_and_resets():
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    r = scheduler.schedule(None, 4, t0)
    assert r["interval"] == 1.0
    r = scheduler.schedule(r, 4, t0)
    assert r["interval"] == 3.0
    r = scheduler.schedule(r, 5, t0)
    assert r["interval"] > 3.0
    r = scheduler.schedule(r, 1, t0)
    assert r["reps"] == 0 and r["interval"] == 0.0
    assert datetime.fromisoformat(r["due"]) == t0 + timedelta(minutes=10)
    assert r["ease"] >= scheduler.MIN_EASE


def test_is_due():
    past = {"due": (scheduler.now() - timedelta(minutes=1)).isoformat()}
    future = {"due": (scheduler.now() + timedelta(days=1)).isoformat()}
    assert scheduler.is_due(past) and not scheduler.is_due(future) and not scheduler.is_due(None)


# ---------- store ----------
def test_graph_depths_chain_and_cycles(store):
    t = store.create_topic("Calculus")
    store.upsert_concept(t, "Derivative", "rate of change", ["Limit", "Slope"])
    store.upsert_concept(t, "Limit", "approach", ["Function"])
    # Would create a cycle Function -> Derivative -> Limit -> Function; must be ignored.
    store.upsert_concept(t, "Function", "", ["Derivative"])
    d = store.depths(t)
    assert d["function"] == 0 and d["slope"] == 0 and d["limit"] == 1 and d["derivative"] == 2
    assert [c["id"] for c in store.chain(t, "derivative")][-1] == "derivative"
    assert t["concepts"]["function"]["prerequisites"] == []


def test_assess_and_persist(store, tmp_path):
    t = store.create_topic("TLS")
    c = store.upsert_concept(t, "Public key crypto")
    store.assess(t, c, "gap", "couldn't say what a key pair is", "thinks the public key decrypts")
    store.save()
    again = Store(tmp_path / "learner.json")
    c2 = again.topic(t["id"])["concepts"]["public-key-crypto"]
    assert c2["mastery"] == 1 and c2["misconceptions"] and c2["review"]["due"]


# ---------- tools ----------
def test_tools_validate_and_mutate(store):
    t = store.create_topic("Bayes")
    out, changes = run_tool(store, t["id"], "map_concepts", {"concepts": [
        {"name": "Conditional probability", "summary": "P(A|B)", "prerequisites": ["Probability"]}]})
    assert json.loads(out)["ok"] and "graph" in changes
    run_tool(store, t["id"], "record_assessment", {"concept": "Probability", "result": "solid", "evidence": "explained it"})
    run_tool(store, t["id"], "set_focus", {"concept": "Conditional probability"})
    state = json.loads(run_tool(store, t["id"], "get_learner_state", {})[0])
    assert state["focus"] == "conditional-probability"
    assert {c["name"] for c in state["concepts"]} == {"Conditional probability", "Probability"}
    chain = json.loads(run_tool(store, t["id"], "get_prerequisite_chain", {"concept": "conditional probability"})[0])
    assert [c["name"] for c in chain["chain"]] == ["Probability", "Conditional probability"]
    with pytest.raises(ToolError):
        run_tool(store, t["id"], "record_assessment", {"concept": "x", "result": "great", "evidence": "?"})
    with pytest.raises(ToolError):
        run_tool(store, t["id"], "map_concepts", {"concepts": "nope"})


# ---------- agent loop with a fake streaming client ----------
def _msg(content, stop_reason):
    return BetaMessage.model_validate({
        "id": "msg_x", "type": "message", "role": "assistant", "model": "claude-opus-5-5",
        "content": content, "stop_reason": stop_reason, "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 10},
    })


class FakeStream:
    def __init__(self, message):
        self.message = message

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    def __aiter__(self):
        async def gen():
            for b in self.message.content:
                yield SimpleNamespace(type="content_block_start", content_block=b)
                if b.type == "text":
                    for word in b.text.split(" "):
                        yield SimpleNamespace(type="content_block_delta", delta=SimpleNamespace(type="text_delta", text=word + " "))
        return gen()

    async def get_final_message(self):
        return self.message


class FakeClient:
    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._stream))

    def _stream(self, **kwargs):
        self.calls.append(json.loads(json.dumps(kwargs["messages"])))  # snapshot, must be JSON-serialisable
        assert kwargs["fallbacks"] == "default" and kwargs["thinking"]["type"] == "adaptive"
        return FakeStream(self.script.pop(0))


SCRIPT = [
    _msg([
        {"type": "thinking", "thinking": "Plan the map.", "signature": "sig"},
        {"type": "tool_use", "id": "tu_1", "name": "map_concepts", "input": {"concepts": [
            {"name": "Derivative", "summary": "instantaneous rate", "prerequisites": ["Limit"]},
            {"name": "Limit", "summary": "value approached", "prerequisites": [], "foundational": True}]}},
        {"type": "tool_use", "id": "tu_2", "name": "set_focus", "input": {"concept": "Limit"}},
    ], "tool_use"),
    _msg([
        {"type": "server_tool_use", "id": "srv_1", "name": "web_search", "input": {"query": "limit definition"}},
        {"type": "web_search_tool_result", "tool_use_id": "srv_1", "content": [
            {"type": "web_search_result", "url": "https://example.org/limits", "title": "Limits", "encrypted_content": "x"}]},
        {"type": "text", "text": "What happens to $f(x)$ as $x$ gets close to 2?"},
    ], "end_turn"),
]


async def _collect(gen):
    return [e async for e in gen]


@pytest.mark.anyio
async def test_run_turn_tools_and_sources(store):
    t = store.create_topic("Calculus")
    fake = FakeClient(SCRIPT)
    events = await _collect(agent.run_turn(fake, store, t["id"], "Teach me derivatives"))
    types = [e["type"] for e in events]
    assert types[-1] == "done"
    assert "tool" in types and "search" in types and "sources" in types and "text" in types
    t = store.topic(t["id"])
    assert set(t["concepts"]) == {"derivative", "limit"} and t["focus"] == "limit"
    assert t["sources"][0]["url"] == "https://example.org/limits"
    # Second request carries assistant tool_use + user tool_result pairing.
    second = fake.calls[1]
    assert second[1]["role"] == "assistant" and second[1]["content"][0]["type"] == "thinking"
    assert second[2]["role"] == "user" and {r["tool_use_id"] for r in second[2]["content"]} == {"tu_1", "tu_2"}
    tr = agent.transcript(t)
    assert tr[0] == {"role": "user", "text": "Teach me derivatives"}
    assert tr[1]["role"] == "tutor" and "$f(x)$" in tr[1]["text"]
    assert any(a["label"] == "Searched" for a in tr[1]["activity"])


@pytest.mark.anyio
async def test_refusal_not_appended(store):
    t = store.create_topic("X")
    fake = FakeClient([_msg([], "refusal")])
    events = await _collect(agent.run_turn(fake, store, t["id"], "hi"))
    assert any(e["type"] == "error" for e in events)
    assert [m["role"] for m in store.topic(t["id"])["messages"]] == ["user"]


@pytest.fixture
def anyio_backend():
    return "asyncio"


# ---------- server ----------
def test_server_endpoints(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "store", Store(tmp_path / "s.json"))
    monkeypatch.setattr(server, "_client", FakeClient(SCRIPT))
    c = TestClient(server.app)
    assert c.get("/").status_code == 200
    t = c.post("/api/topics", json={"title": "Calculus", "goal": "understand derivatives"}).json()
    with c.stream("POST", f"/api/topics/{t['id']}/chat", json={"mode": "start"}) as r:
        body = "".join(r.iter_text())
    events = [json.loads(line[6:]) for line in body.split("\n") if line.startswith("data: ")]
    assert events[0]["type"] == "user" and "Calculus" in events[0]["text"]
    assert any(e["type"] == "topic" for e in events) and events[-1]["type"] == "done"
    full = c.get(f"/api/topics/{t['id']}").json()
    assert full["stats"]["concepts"] == 2 and len(full["transcript"]) == 2
    assert c.get("/api/reviews").json() == []
    assert c.post(f"/api/topics/{t['id']}/chat", json={"mode": "chat", "message": "  "}).status_code == 400
    assert c.delete(f"/api/topics/{t['id']}").json() == {"ok": True}
    assert c.get(f"/api/topics/{t['id']}").status_code == 404
