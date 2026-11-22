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
    assert gpu["status"] == "available" and gpu["stats"]["chapters"] == 50
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


def test_lab_submission(client, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "1")
    base = f"/api/courses/{SLUG}/items/L0"
    item = client.get(base).json()
    assert item["lab"]["dir"] == "labs/L0-hello" and item["lab"]["targets"]
    good = {"lab": "L0", "device": {"name": "NVIDIA GeForce RTX 2060 SUPER", "cc": "7.5"},
            "checks": {"copy1 copies correctly": True}, "metrics": {"copy_best_pct": 86.0}}
    slow = dict(good, metrics={"copy_best_pct": 50.0})
    wrong = dict(good, checks={"copy1 copies correctly": False})
    assert client.post(base + "/lab", json=dict(good, lab="L1")).status_code == 400
    r = client.post(base + "/lab", json=slow).json()
    assert not r["passed"] and r["targets"][0]["met"] is False
    r = client.post(base + "/lab", json=wrong).json()
    assert not r["passed"] and not r["checks_ok"]
    r = client.post(base + "/lab", json=good).json()
    assert r["passed"] and r["state"]["state"] in ("open", "complete")
    rec = client.get(base).json()["lab_record"]
    assert rec["passed"] and rec["submissions"] == 3 and rec["best"]["metrics"]["copy_best_pct"] == 86.0
    # a later bad run doesn't undo a pass
    client.post(base + "/lab", json=slow)
    assert client.get(base).json()["lab_record"]["passed"]
    assert client.post(f"/api/courses/{SLUG}/items/0-1/lab", json=good).status_code == 404


def test_progress_export_import_roundtrip(client, tmp_path):
    client.post("/api/courses/gpus-from-first-principles/items/0-1/read")
    exp = client.get("/api/progress/export").json()
    assert exp["groundwork"] == "progress" and "courses" in exp["progress"]
    # wipe, then restore from the export (as the UI does, with drafts alongside)
    client.post("/api/courses/gpus-from-first-principles/reset")
    r = client.post("/api/progress/import", json={**exp, "drafts": {"gw-ex-x": "code"}})
    assert r.status_code == 200
    assert client.get("/api/progress/export").json()["progress"]["courses"] == exp["progress"]["courses"]
    assert client.post("/api/progress/import", json={"nope": 1}).status_code == 400


def test_progress_default_path_and_daily_backup(tmp_path, monkeypatch):
    from learnharness import progress as pmod
    monkeypatch.delenv("GROUNDWORK_DATA", raising=False)
    monkeypatch.setattr(pmod.Path, "home", lambda: tmp_path)
    monkeypatch.chdir(tmp_path)
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "progress.json").write_text('{"courses": {"x": {"items": {}}}, "qa": {}}')
    p = pmod.Progress()
    assert p.path == tmp_path / ".groundwork" / "progress.json"
    assert "x" in p.data["courses"]  # migrated from the old location
    p.save()
    assert list((tmp_path / ".groundwork" / "backups").glob("progress-*.json"))


def test_exam_flow(client, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "1")
    base = "/api/courses/gpus-from-first-principles/items/midterm"
    it = client.get(base).json()
    assert it["type"] == "exam" and it["problems"] is None and it["exam"]["count"] >= 10
    assert it["exam"]["active"] is None
    # the Ask panel is closed during exams
    assert client.post(base + "/ask", json={"question": "hi"}).status_code == 403
    r = client.post(base + "/exam/start").json()
    paper = r["paper"]
    assert paper and all("answer" not in q for p in paper for q in p["parts"])
    assert all(not p.get("hints") and "solution" not in p for p in paper)
    # starting again resumes the same attempt
    assert client.post(base + "/exam/start").json()["active"] == r["active"]
    # answer everything correctly from the server-side file
    from learnharness import content
    ex = content.exam("gpus-from-first-principles", "midterm")
    answers = {p["id"]: {q["id"]: q["answer"] for q in p["parts"]} for p in ex["problems"]}
    res = client.post(base + "/exam/submit", json={"answers": answers}).json()
    assert res["score"] == 1.0 and res["passed"] and res["review"][0]["solution"]
    st = client.get(base).json()
    assert st["state"]["state"] == "complete"
    # retake is closed for 12 hours; submitting without an attempt fails
    assert client.post(base + "/exam/start").status_code == 409
    assert client.post(base + "/exam/submit", json={"answers": {}}).status_code == 409


def test_exam_partial_credit_and_late(client, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "1")
    base = "/api/courses/gpus-from-first-principles/items/final"
    from learnharness import server
    client.post(base + "/exam/start")
    real = server.time.time
    monkeypatch.setattr(server.time, "time", lambda: real() + 4 * 3600)  # far past the deadline
    res = client.post(base + "/exam/submit", json={"answers": {}}).json()
    assert res["late"] and not res["passed"] and res["score"] == 0.0


def test_coding_flow(client, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "1")
    base = "/api/courses/interview-ready/items/1-1"
    it = client.get(base).json()
    ids = [c["id"] for c in it["coding"]]
    assert "two-sum" in ids and all("tests" not in c or isinstance(c["tests"], int) for c in it["coding"])
    wrong = "def two_sum(nums, target):\n    return [0, 1]\n"
    r = client.post(base + "/coding/two-sum", json={"lang": "python", "code": wrong, "mode": "run"}).json()
    assert any(not x["pass"] for x in r["results"]) and "expected" in r["results"][0]
    r = client.post(base + "/coding/two-sum", json={"lang": "python", "code": wrong, "mode": "submit"}).json()
    assert r["passed"] < r["total"] and r["failing"] and "solution" not in r
    assert client.post(base + "/coding/two-sum/reveal").status_code == 409
    right = "def two_sum(nums, target):\n    seen = {}\n    for i, x in enumerate(nums):\n        if target - x in seen:\n            return [seen[target - x], i]\n        seen[x] = i\n"
    r = client.post(base + "/coding/two-sum", json={"lang": "python", "code": right, "mode": "submit"}).json()
    assert r["passed"] == r["total"] and r["record"]["solved"] and r["solution"]["python"]
    assert client.post(base + "/coding/nope", json={"lang": "python", "code": "", "mode": "run"}).status_code == 404


def test_course_coding_ids_unique_and_present():
    import collections, json, pathlib
    root = pathlib.Path(__file__).resolve().parent.parent / "courses"
    for course in root.iterdir():
        cj = course / "course.json"
        if not cj.exists():
            continue
        c = json.loads(cj.read_text())
        ids = [x for part in c["parts"] for it in part["items"] for x in it.get("coding", [])]
        dups = [k for k, v in collections.Counter(ids).items() if v > 1]
        assert not dups, f"{course.name}: coding ids used twice: {dups}"
        missing = [x for x in ids if not (course / "coding" / f"{x}.json").exists()]
        assert not missing, f"{course.name}: missing coding files: {missing}"


def test_coding_exam_flow(client, monkeypatch):
    monkeypatch.setenv("GROUNDWORK_UNLOCK", "1")
    from learnharness import content
    base = "/api/courses/interview-ready/items/oa-1"
    it = client.get(base).json()
    assert it["type"] == "exam" and it["exam"]["coding"] == 3
    r = client.post(base + "/exam/start").json()
    assert len(r["coding"]) == 3 and r["paper"] == []
    assert all("hints" not in p and "solution" not in p for p in r["coding"])
    ex = content.exam("interview-ready", "oa-1")
    sols = {pid: content.coding("interview-ready", pid)["solution"]["python"] for pid in ex["coding"]}
    first = ex["coding"][0]
    # sample runs work during the attempt; unknown problems don't
    run = client.post(base + "/exam/run", json={"pid": first, "lang": "python", "code": sols[first]}).json()
    assert run["results"] and all(x["pass"] for x in run["results"])
    assert client.post(base + "/exam/run", json={"pid": "two-sum", "lang": "python", "code": "x"}).status_code == 404
    # one problem fully right, one wrong, one blank: 4 + 0 + 0 of 12 points
    code = {first: {"lang": "python", "code": sols[first]}, ex["coding"][1]: {"lang": "python", "code": "def smallest_distance_pair(nums, k):\n    return 0\n"}}
    res = client.post(base + "/exam/submit", json={"answers": {}, "code": code}).json()
    c1 = res["coding"][first]
    assert c1["passed"] == c1["total"] and res["coding"][ex["coding"][2]]["skipped"]
    assert 4 / 12 - 1e-9 <= res["score"] < 0.6 and not res["passed"]
    assert c1["solution"]["explanation"]
    # sample runs are refused once the attempt is over
    assert client.post(base + "/exam/run", json={"pid": first, "lang": "python", "code": sols[first]}).status_code == 409
