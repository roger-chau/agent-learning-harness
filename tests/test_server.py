import json

import pytest
from fastapi.testclient import TestClient

from learnharness import content, server
from learnharness.progress import Progress

SLUG = "gpus-from-first-principles"


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "0")
    monkeypatch.setattr(server, "progress", Progress(tmp_path / "p.json"))
    return TestClient(server.app)


def quiz_answers(item_id):
    q = content.quiz(SLUG, item_id)
    return {x["id"]: x["answer"] for x in q["questions"]}


def test_catalog_and_course(client):
    cat = client.get("/api/catalog").json()
    gpu = next(c for c in cat if c["slug"] == SLUG)
    assert gpu["status"] == "available" and gpu["stats"]["chapters"] == 41
    c = client.get(f"/api/courses/{SLUG}").json()
    states = {i["id"]: i["state"] for p in c["parts"] for i in p["items"]}
    assert states["0-1"] == "open"
    assert states["0-2"] == "locked"
    assert states["1-1"] == "locked"
    assert states["9-1"] == "locked"


def test_course_content_is_consistent():
    c = content.course(SLUG)
    for it in c["order"]:
        if it["status"] != "ready":
            continue
        if it["type"] == "chapter":
            assert content.chapter_html(SLUG, it["id"]).strip(), it["id"]
            assert len(it.get("blocks", [])) in (5, 7), it["id"]
        for ex in it["exercises"]:
            assert content.asset_path(SLUG, "exercises", f"{ex}.js").exists()
        q = content.quiz(SLUG, it["id"])
        if q:
            for question in q["questions"]:
                assert question["type"] in ("single", "multi", "numeric")
                if question["type"] != "numeric":
                    idx = question["answer"] if question["type"] == "multi" else [question["answer"]]
                    assert all(0 <= i < len(question["options"]) for i in idx)
                # grading the reference answer must succeed
            assert content.grade_quiz(q, {x["id"]: x["answer"] for x in q["questions"]})["score"] == 1.0


def test_item_hides_quiz_answers_and_locks(client):
    it = client.get(f"/api/courses/{SLUG}/items/0-1").json()
    assert it["quiz"]["questions"] and all("answer" not in q for q in it["quiz"]["questions"])
    assert "explanation" not in json.dumps(it["quiz"])
    assert client.get(f"/api/courses/{SLUG}/items/0-2").status_code == 403
    assert client.get(f"/api/courses/{SLUG}/items/1-1").status_code == 403


def test_quiz_answers_never_served_as_files(client):
    assert client.get(f"/content/{SLUG}/quizzes/0-1.json").status_code == 404
    assert client.get(f"/content/{SLUG}/exercises/../quizzes/0-1.json").status_code == 404
    assert client.get(f"/content/{SLUG}/exercises/0-1-a.js").status_code == 200


def test_gating_flow(client):
    base = f"/api/courses/{SLUG}/items/0-1"
    # wrong quiz: not passed, wrong answers' explanations withheld
    bad = client.post(f"{base}/quiz", json={"answers": {}}).json()
    assert not bad["passed"] and all(r["explanation"] == "" for r in bad["results"])
    # quiz alone isn't enough
    r = client.post(f"{base}/quiz", json={"answers": quiz_answers("0-1")}).json()
    assert r["passed"] and r["state"]["state"] == "open"
    # failing exercise doesn't unlock
    r = client.post(f"{base}/exercises/0-1-a", json={"passed": False, "results": []}).json()
    assert r["state"]["state"] == "open"
    r = client.post(f"{base}/exercises/0-1-a", json={"passed": True, "results": []}).json()
    r = client.post(f"{base}/exercises/0-1-b", json={"passed": True, "results": []}).json()
    assert r["state"]["state"] == "open"  # the problem set isn't done yet
    ps = content.problems(SLUG, "0-1")
    probs = ps["problems"]
    # a wrong attempt: no solution, and reveal refused before two attempts
    w = client.post(f"{base}/problems/{probs[0]['id']}", json={"answers": {}}).json()
    assert not w["solved"] and "solution" not in w
    assert client.post(f"{base}/problems/{probs[0]['id']}/reveal").status_code == 409
    client.post(f"{base}/problems/{probs[0]['id']}", json={"answers": {}})
    rv = client.post(f"{base}/problems/{probs[0]['id']}/reveal").json()
    assert rv["solution"] and rv["record"]["revealed"]
    # a revealed problem can't count as solved afterwards
    right = lambda pr: {pt["id"]: pt["answer"] for pt in pr["parts"]}
    again = client.post(f"{base}/problems/{probs[0]['id']}", json={"answers": right(probs[0])}).json()
    assert again["solved"] and not again["record"]["solved"]
    # solve enough of the rest (70% of the set)
    need = -(-int(round(ps["pass"] * len(probs) * 1000)) // 1000)
    for pr in probs[1:need + 1]:
        r = client.post(f"{base}/problems/{pr['id']}", json={"answers": right(pr)}).json()
        assert r["solved"] and "solution" in r
    assert r["state"]["state"] == "complete"
    # the public item never carries answers or solutions
    pub = client.get(base).json()["problems"]["problems"][0]
    assert "solution" not in pub and all("answer" not in pt for pt in pub["parts"])
    assert client.get(f"/api/courses/{SLUG}/items/0-2").status_code == 200
    # a later failure doesn't re-lock
    client.post(f"{base}/exercises/0-1-a", json={"passed": False, "results": []})
    assert client.get(f"/api/courses/{SLUG}/items/0-2").status_code == 200
    # unknown exercise / locked submission
    assert client.post(f"{base}/exercises/nope", json={"passed": True}).status_code == 404
    assert client.post(f"/api/courses/{SLUG}/items/0-3/quiz", json={"answers": {}}).status_code == 403


def test_numeric_tolerance():
    q = {"questions": [
        {"id": "a", "type": "numeric", "answer": 100, "tolerance": "1%"},
        {"id": "b", "type": "numeric", "answer": 10.25, "tolerance": 0.05},
        {"id": "c", "type": "multi", "answer": [0, 2]},
    ]}
    g = content.grade_quiz(q, {"a": "100.9", "b": "10.3", "c": [2, 0]})
    assert g["correct"] == 3
    g = content.grade_quiz(q, {"a": "102", "b": "abc", "c": [0]})
    assert g["correct"] == 0


def test_unlock_all_env(client, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "1")
    assert client.get(f"/api/courses/{SLUG}/items/0-4").status_code == 200
    assert client.get(f"/api/courses/{SLUG}/items/1-1").status_code == 200
    assert client.get(f"/api/courses/{SLUG}/items/9-1").status_code == 200
    assert client.get(f"/api/courses/{SLUG}/items/no-such-item").status_code == 404


def test_unlocked_by_default(client, monkeypatch):
    monkeypatch.delenv("GROUNDWORK_UNLOCK", raising=False)
    assert client.get(f"/api/courses/{SLUG}/items/9-1").status_code == 200


def test_problem_sets_are_self_consistent():
    c = content.course(SLUG)
    seen = 0
    for it in c["order"]:
        ps = content.problems(SLUG, it["id"])
        if not ps:
            continue
        ids = [p["id"] for p in ps["problems"]]
        assert len(ids) == len(set(ids)), it["id"]
        for pr in ps["problems"]:
            assert pr["parts"] and pr.get("solution") and pr.get("level") in (1, 2, 3), (it["id"], pr["id"])
            right = {pt["id"]: pt["answer"] for pt in pr["parts"]}
            assert content.grade_problem(pr, right)["solved"], (it["id"], pr["id"])
            wrong = {pt["id"]: (pt["answer"] * 3 + 7 if pt["type"] == "numeric" else -1) for pt in pr["parts"]}
            assert not content.grade_problem(pr, wrong)["solved"], (it["id"], pr["id"])
            seen += 1
    assert seen >= 40
