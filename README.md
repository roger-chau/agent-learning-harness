# Groundwork

Deep, hands-on courses that rebuild a subject from first principles. They run on your machine.

Every chapter follows the same five steps: the real problem, the smallest idea, add one block, the whole machine, then reality. Chapters include diagrams, animations you can step through, and simulations you drive. An in-page terminal runs your code, and you only move on once you've passed the exercises and the quiz. Long-running projects grow across a course in milestones and end in a capstone. An **Ask** panel answers questions about the chapter you're reading. It gives hints, never solutions.

The first course is **GPUs from First Principles** (`courses/gpus-from-first-principles/`), aimed at future GPU performance and compiler engineers. The course format is described in [`docs/course-format.md`](docs/course-format.md).

## Run it

You need Python 3.10+. The Ask panel also needs an Anthropic API key. Everything else works without one.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
export ANTHROPIC_API_KEY=sk-ant-...   # only for the Ask panel
groundwork
```

Then open http://127.0.0.1:8765. Use `groundwork --port 9000` for another port, and `groundwork --locked` to enforce gating.

| Environment variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Key for the Ask panel. An `ant auth login` profile also works. |
| `GROUNDWORK_MODEL` | `claude-opus-5-5` | Model for the Ask panel. |
| `GROUNDWORK_EFFORT` | `medium` | Thinking effort for the Ask panel. |
| `GROUNDWORK_DATA` | `data/progress.json` | Where your progress is stored. |
| `GROUNDWORK_UNLOCK` | `1` | Every chapter is unlocked. Set to `0` (or run `groundwork --locked`) so each item unlocks only when the ones before it are complete. |

## How it's built

```
courses/                       static course content
  catalog.json                 all courses, available and planned
  <slug>/course.json           parts → chapters, milestones, checkpoints
  <slug>/chapters/<id>.html    chapter text, SVG diagrams, <div data-gw="…"> components
  <slug>/exercises/<id>.js     exercise prompt, starter code, checks (run in the browser)
  <slug>/quizzes/<id>.json     quiz with answers (graded server-side, never sent to the browser)
learnharness/
  server.py                    FastAPI: content, gating, quiz grading, Ask panel (SSE)
  progress.py                  completion and hard gating
  content.py                   course loading and quiz grading
  agent.py, prompts.py         the Ask panel: Claude Messages API with web search
  static/sim/gpusim.js         the GPU simulator (browser, Web Worker and Node)
  static/sim/worker.js         runs learner code off the main thread, with a timeout
  static/terminal.js           code editor and console
  static/components.js         animations and simulations used by chapters
```

**The GPU simulator.** Kernels are JavaScript with CUDA-style built-ins (`threadIdx`, `blockIdx`, `blockDim`, `gridDim`). The simulator runs every thread, groups threads into warps of 32, and reports:
- memory transactions (32-byte sectors) and coalescing efficiency;
- warp-level branches and divergence, including loop trip-count divergence;
- out-of-bounds accesses;
- an estimated time from a simple bandwidth/issue model.

It runs the threads of a warp one after another and lines up their memory operations and branches by order of execution. For code without divergence, that matches lockstep hardware exactly.

**Gating.** A chapter is complete when its exercises pass and its quiz scores at least 80%. By default everything is open; with `groundwork --locked` (or `GROUNDWORK_UNLOCK=0`) each item unlocks only when everything before it is complete. Planned (unwritten) chapters show as "coming soon".

## Development

```bash
pip install -e ".[dev]"
pytest                          # server, gating, quiz grading
node --test tests/*.test.mjs    # simulator, and every exercise's starter code fails its checks
```

`tests/exercise_harness.cjs` runs an exercise's checks against any solution file, exactly as the browser worker does:

```bash
node tests/exercise_harness.cjs courses/<slug>/exercises/<id>.js my_solution.js
```
