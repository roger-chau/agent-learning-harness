"""Run learner code (Python or C++) against tests, locally, with time and memory limits.

A coding problem (courses/<slug>/coding/<id>.json) declares:
  entry:    {"python": "two_sum", "cpp": {"name": "twoSum", "ret": "vector<int>",
             "params": [["vector<int>", "nums"], ["int", "target"]]}}
  tests:    [{"args": [...], "expected": ..., "sample": true?}, ...]
  compare:  "exact" | "unordered" | "float" | "nested_unordered"
  kind:     "function" (default) or "class" (Python only): tests are
            {"ops": [["Cls", *ctor_args], ["method", *args], ...], "expected": [null, out, ...]}
  time_limit_ms: per test (default 2000)

Python runs as `python3 -I` in a temporary directory; C++ is compiled with g++ -O2 -std=c++17.
Both get an address-space limit, a CPU-time limit and a wall-clock timeout. This is a local,
single-user tool: the limits protect against runaway code, not against a hostile user.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

MEM_BYTES = 1 << 30

HARNESS_PY = r'''
import json, sys, time, copy, importlib.util, traceback
spec = importlib.util.spec_from_file_location("solution", sys.argv[1])
mod = importlib.util.module_from_spec(spec)
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val; self.next = next
class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val; self.left = left; self.right = right
mod.ListNode = ListNode; mod.TreeNode = TreeNode
def to_list(a):
    head = None
    for v in reversed(a): head = ListNode(v, head)
    return head
def from_list(h):
    out = []; seen = 0
    while h is not None and seen < 10**6:
        out.append(h.val); h = h.next; seen += 1
    return out
def to_tree(a):
    if not a or a[0] is None: return None
    root = TreeNode(a[0]); q = [root]; i = 1; k = 0
    while k < len(q) and i < len(a):
        node = q[k]; k += 1
        if i < len(a) and a[i] is not None: node.left = TreeNode(a[i]); q.append(node.left)
        i += 1
        if i < len(a) and a[i] is not None: node.right = TreeNode(a[i]); q.append(node.right)
        i += 1
    return root
def from_tree(r):
    out = []; q = [r]; k = 0
    while k < len(q):
        n = q[k]; k += 1
        if n is None: out.append(None); continue
        out.append(n.val); q.append(n.left); q.append(n.right)
    while out and out[-1] is None: out.pop()
    return out
CONV_IN = {"list": to_list, "tree": to_tree}
CONV_OUT = {"list": from_list, "tree": from_tree}
try:
    spec.loader.exec_module(mod)
except Exception as e:
    print(json.dumps({"fatal": "".join(traceback.format_exception_only(type(e), e)).strip()})); sys.exit(0)
cfg = json.load(open(sys.argv[2]))
def norm(v):
    if isinstance(v, tuple): return [norm(x) for x in v]
    if isinstance(v, list): return [norm(x) for x in v]
    return v
for k, t in enumerate(cfg["tests"]):
    t0 = time.perf_counter()
    try:
        if cfg.get("kind") == "class":
            ops = t["ops"]; cls = getattr(mod, ops[0][0]); obj = cls(*copy.deepcopy(ops[0][1:])); out = [None]
            for op in ops[1:]:
                out.append(norm(getattr(obj, op[0])(*copy.deepcopy(op[1:]))))
        else:
            fn = getattr(mod, cfg["entry"])
            args = copy.deepcopy(t["args"]); kinds = cfg.get("arg_kinds") or []
            args = [CONV_IN[kinds[i]](a) if i < len(kinds) and kinds[i] in CONV_IN else a for i, a in enumerate(args)]
            res = fn(*args)
            if cfg.get("ret_kind") in CONV_OUT: res = CONV_OUT[cfg["ret_kind"]](res)
            out = norm(res)
        print(json.dumps({"k": k, "out": out, "ms": round((time.perf_counter() - t0) * 1000, 2)}), flush=True)
    except Exception as e:
        print(json.dumps({"k": k, "error": "".join(traceback.format_exception_only(type(e), e)).strip(), "ms": round((time.perf_counter() - t0) * 1000, 2)}), flush=True)
'''

CPP_PRELUDE = r'''#include <bits/stdc++.h>
using namespace std;
struct ListNode { int val; ListNode* next; ListNode(int x = 0, ListNode* n = nullptr) : val(x), next(n) {} };
struct TreeNode { int val; TreeNode *left, *right; TreeNode(int x = 0, TreeNode* l = nullptr, TreeNode* r = nullptr) : val(x), left(l), right(r) {} };
'''

CPP_PRINT = r'''
static void gw_print(long long v) { cout << v; }
static void gw_print(int v) { cout << v; }
static void gw_print(double v) { if (std::isfinite(v)) cout << setprecision(17) << v; else cout << "null"; }
static void gw_print(bool v) { cout << (v ? "true" : "false"); }
static void gw_print(const string& s) {
  cout << '"';
  for (char c : s) { if (c == '"' || c == '\\') cout << '\\' << c; else if (c == '\n') cout << "\\n"; else cout << c; }
  cout << '"';
}
static void gw_print(ListNode* h) { cout << '['; bool first = true; int guard = 0; while (h && guard++ < 1000000) { if (!first) cout << ','; first = false; cout << h->val; h = h->next; } cout << ']'; }
static void gw_print(TreeNode* r) {
  vector<TreeNode*> q{r}; vector<string> out;
  for (size_t k = 0; k < q.size(); k++) { TreeNode* n = q[k]; if (!n) { out.push_back("null"); continue; } out.push_back(to_string(n->val)); q.push_back(n->left); q.push_back(n->right); }
  while (!out.empty() && out.back() == "null") out.pop_back();
  cout << '['; for (size_t i = 0; i < out.size(); i++) { if (i) cout << ','; cout << out[i]; } cout << ']';
}
template <class T> static void gw_print(const vector<T>& v) {
  cout << '['; for (size_t i = 0; i < v.size(); i++) { if (i) cout << ','; gw_print(v[i]); } cout << ']';
}
'''


def _limits():
    try:
        import resource
        resource.setrlimit(resource.RLIMIT_AS, (MEM_BYTES, MEM_BYTES))
        resource.setrlimit(resource.RLIMIT_CPU, (30, 31))
    except Exception:
        pass


CPP_READ = r'''
static void gw_read(int& x) { cin >> x; }
static void gw_read(long long& x) { cin >> x; }
static void gw_read(double& x) { cin >> x; }
static void gw_read(bool& x) { int v; cin >> v; x = v != 0; }
static void gw_read(char& x) { int v; cin >> v; x = char(v); }
static void gw_read(string& x) { size_t n; cin >> n; cin.get(); x.resize(n); if (n) cin.read(&x[0], n); }
template <class T> static void gw_read(vector<T>& v) { size_t n; cin >> n; v.resize(n); for (auto& e : v) gw_read(e); }
static void gw_read(ListNode*& h) { size_t n; cin >> n; vector<int> a(n); for (auto& x : a) cin >> x; h = nullptr; for (size_t i = n; i-- > 0;) h = new ListNode(a[i], h); }
static void gw_read(TreeNode*& root) {
  size_t n; cin >> n; vector<string> a(n); for (auto& x : a) cin >> x;
  root = nullptr; if (n == 0 || a[0] == "null") return;
  root = new TreeNode(stoi(a[0])); vector<TreeNode*> q{root}; size_t i = 1, k = 0;
  while (k < q.size() && i < n) {
    TreeNode* node = q[k++];
    if (i < n && a[i] != "null") { node->left = new TreeNode(stoi(a[i])); q.push_back(node->left); } i++;
    if (i < n && a[i] != "null") { node->right = new TreeNode(stoi(a[i])); q.push_back(node->right); } i++;
  }
}
'''


def _cpp_serialise(typ: str, v, out: list) -> None:
    """Whitespace-separated encoding read by gw_read: vectors as length then items; strings as
    byte length, one space, then the raw bytes (so they may contain spaces)."""
    t = typ.replace(" ", "")
    if t.startswith("vector<") and t.endswith(">"):
        inner = t[7:-1]
        out.append(str(len(v)))
        for x in v:
            _cpp_serialise(inner, x, out)
    elif t in ("int", "longlong", "long"):
        out.append(str(int(v)))
    elif t == "double":
        out.append(repr(float(v)))
    elif t == "bool":
        out.append("1" if v else "0")
    elif t == "char":
        out.append(str(ord(v)))
    elif t == "string":
        b = v.encode()
        out.append(f"{len(b)} " + v)
    elif t == "ListNode*":
        out.append(str(len(v))); out.extend(str(int(x)) for x in v)
    elif t == "TreeNode*":
        out.append(str(len(v))); out.extend("null" if x is None else str(int(x)) for x in v)
    else:
        raise ValueError(f"unsupported C++ type {typ}")


def compare(mode: str, got, want) -> bool:
    if mode == "float":
        def close(a, b):
            if isinstance(a, list) and isinstance(b, list):
                return len(a) == len(b) and all(close(x, y) for x, y in zip(a, b))
            if isinstance(a, (int, float)) and isinstance(b, (int, float)):
                return abs(a - b) <= 1e-6 * max(1.0, abs(b))
            return a == b
        return close(got, want)
    if mode == "unordered":
        try:
            return sorted(map(json.dumps, got)) == sorted(map(json.dumps, want))
        except TypeError:
            return False
    if mode == "nested_unordered":
        try:
            canon = lambda xs: sorted(json.dumps(sorted(x)) for x in xs)
            return canon(got) == canon(want)
        except TypeError:
            return False
    return got == want


def run(problem: dict, lang: str, code: str, tests: list[dict]) -> dict:
    """Returns {"results": [{"pass", "ms", "error"?, "got"?}], "compile_error"?: str}."""
    if lang == "python":
        return _run_python(problem, code, tests)
    if lang == "cpp":
        return _run_cpp(problem, code, tests)
    raise ValueError("language must be python or cpp")


def _collect(lines: str, tests: list[dict], mode: str, stderr: str, timed_out: bool) -> dict:
    by_k = {}
    fatal = None
    for line in lines.splitlines():
        try:
            rec = json.loads(line)
        except json.JSONDecodeError:
            continue
        if "fatal" in rec:
            fatal = rec["fatal"]
        elif "k" in rec:
            by_k[rec["k"]] = rec
    results = []
    for k, t in enumerate(tests):
        rec = by_k.get(k)
        if rec is None:
            err = fatal or ("time limit exceeded" if timed_out else (stderr.strip().splitlines() or ["crashed"])[-1][:300])
            results.append({"pass": False, "error": err})
        elif "error" in rec:
            results.append({"pass": False, "error": rec["error"][:500], "ms": rec.get("ms")})
        else:
            ok = compare(mode, rec["out"], t["expected"])
            r = {"pass": ok, "ms": rec.get("ms")}
            if not ok:
                r["got"] = rec["out"]
            results.append(r)
    return {"results": results}


def _run_python(problem: dict, code: str, tests: list[dict]) -> dict:
    d = Path(tempfile.mkdtemp(prefix="gw-run-"))
    try:
        (d / "solution.py").write_text(code)
        (d / "harness.py").write_text(HARNESS_PY)
        cfg = {"entry": (problem.get("entry") or {}).get("python"), "kind": problem.get("kind", "function"), "tests": tests,
               "arg_kinds": problem.get("arg_kinds"), "ret_kind": problem.get("ret_kind")}
        (d / "tests.json").write_text(json.dumps(cfg))
        limit = problem.get("time_limit_ms", 2000) / 1000 * len(tests) + 3
        try:
            p = subprocess.run([sys.executable, "-I", "harness.py", "solution.py", "tests.json"], cwd=d, capture_output=True,
                               text=True, timeout=limit, preexec_fn=_limits if os.name == "posix" else None)
            return _collect(p.stdout, tests, problem.get("compare", "exact"), p.stderr, False)
        except subprocess.TimeoutExpired as e:
            out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
            return _collect(out, tests, problem.get("compare", "exact"), "", True)
    finally:
        shutil.rmtree(d, ignore_errors=True)


def _run_cpp(problem: dict, code: str, tests: list[dict]) -> dict:
    sig = (problem.get("entry") or {}).get("cpp")
    if not sig or problem.get("kind", "function") != "function":
        raise ValueError("this problem has no C++ version")
    if not shutil.which("g++"):
        return {"compile_error": "g++ not found: install a C++ compiler to use C++ here.", "results": []}
    # One small main() that reads each test's arguments from stdin: compile time doesn't grow
    # with the tests, and large inputs don't become huge source files.
    decls = "".join(f"    {typ} a{i}{{}}; gw_read(a{i});\n" for i, (typ, _) in enumerate(sig["params"]))
    args = ", ".join(f"a{i}" for i in range(len(sig["params"])))
    main = f"""int main() {{
  ios::sync_with_stdio(false);
  int T; cin >> T;
  for (int k = 0; k < T; k++) {{
{decls}    auto t0 = chrono::steady_clock::now();
    auto r = {sig['name']}({args});
    double ms = chrono::duration<double, milli>(chrono::steady_clock::now() - t0).count();
    cout << "{{\\"k\\":" << k << ",\\"ms\\":" << ms << ",\\"out\\":"; gw_print(r); cout << "}}" << endl;
  }}
  return 0;
}}
"""
    src = CPP_PRELUDE + "\n" + code + "\n" + CPP_PRINT + CPP_READ + main
    data = [str(len(tests))]
    for t in tests:
        for (typ, _), v in zip(sig["params"], t["args"]):
            _cpp_serialise(typ, v, data)
    d = Path(tempfile.mkdtemp(prefix="gw-cpp-"))
    try:
        (d / "main.cpp").write_text(src)
        (d / "input.txt").write_text("\n".join(data) + "\n")
        c = subprocess.run(["g++", "-O2", "-std=c++17", "-o", "prog", "main.cpp"], cwd=d, capture_output=True, text=True, timeout=60)
        if c.returncode != 0:
            # Report errors against the learner's code: their code starts after the prelude.
            off = CPP_PRELUDE.count("\n") + 1
            msg = []
            for line in c.stderr.splitlines():
                if line.startswith("main.cpp:"):
                    parts = line.split(":", 3)
                    try:
                        ln = int(parts[1]) - off
                        line = f"line {ln}:" + ":".join(parts[2:]) if ln > 0 else line
                    except (ValueError, IndexError):
                        pass
                msg.append(line)
            return {"compile_error": "\n".join(msg)[-3000:], "results": []}
        limit = problem.get("time_limit_ms", 2000) / 1000 * len(tests) + 3
        try:
            with open(d / "input.txt") as fin:
                p = subprocess.run(["./prog"], cwd=d, stdin=fin, capture_output=True, text=True, timeout=limit,
                                   preexec_fn=_limits if os.name == "posix" else None)
            return _collect(p.stdout, tests, problem.get("compare", "exact"), p.stderr, False)
        except subprocess.TimeoutExpired as e:
            out = e.stdout.decode() if isinstance(e.stdout, bytes) else (e.stdout or "")
            return _collect(out, tests, problem.get("compare", "exact"), "", True)
    finally:
        shutil.rmtree(d, ignore_errors=True)
