# Groundwork

A tutor that runs on your machine. It finds what you don't know and teaches it from first principles.

Name a topic and the tutor maps it into small concepts linked by their prerequisites. It asks probe questions to find where your understanding stops, then walks down to the lowest missing idea and builds back up, one block at a time. Each concept you're assessed on is scheduled for spaced review.

It's a small agent harness around the Claude Messages API (`claude-opus-5-5`, adaptive thinking, streaming). The agent loop, the tools and the learner model are all plain Python you can read and change.

## Run it

You need Python 3.10+ and an Anthropic API key.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e .
export ANTHROPIC_API_KEY=sk-ant-...
groundwork
```

Then open http://127.0.0.1:8000.

Options: `groundwork --port 9000`, `groundwork --host 0.0.0.0`.

| Environment variable | Default | Meaning |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | API key. An `ant auth login` profile also works. |
| `GROUNDWORK_MODEL` | `claude-opus-5-5` | Model for the tutor. |
| `GROUNDWORK_EFFORT` | `medium` | Thinking effort: `low`, `medium`, `high`, `xhigh`, `max`. Higher is slower and more thorough. |
| `GROUNDWORK_DATA` | `data/learner.json` | Where your learner model is stored. |

## How it works

```
browser ──SSE──▶ server.py ──▶ agent.run_turn ──stream──▶ Claude
                                   │   ▲
                         tool_use  ▼   │ tool_result
                                tools.py ──▶ store.py (learner.json)
```

- **`learnharness/agent.py`**: the agent loop. It streams each step, runs the custom tools, feeds results back, and resumes `pause_turn`. Refusals and truncated tool calls are handled without corrupting history. Server-side fallbacks (`fallbacks: "default"`) re-run a classifier-declined request on Anthropic's recommended fallback model.
- **`learnharness/tools.py`**: the tutor's tools. All inputs are validated before they run.
  - `get_learner_state` reads the goal, every concept with its mastery, misconceptions and focus.
  - `map_concepts` adds concepts and prerequisite edges. Edges that would create a cycle are dropped.
  - `record_assessment` records evidence (`gap` / `shaky` / `solid` / `mastered`) and reschedules review.
  - `set_focus` marks the block being taught.
  - `get_prerequisite_chain` lists everything under a concept, foundations first.
  - `get_due_reviews` lists concepts that are due.
  - Anthropic's server-side `web_search` provides cited sources.
- **`learnharness/prompts.py`**: the teaching method. Diagnose before teaching, find the lowest missing block, teach one idea per turn with worked examples, make the learner do the thinking, and change mastery only on evidence.
- **`learnharness/scheduler.py`**: an SM-2-style spaced-review scheduler.
- **`learnharness/store.py`**: the learner model. It's one human-readable JSON file holding topics, the concept graph, the conversation and sources.
- **`learnharness/static/`**: the web UI in plain HTML, CSS and JS with no build step. It renders Markdown and KaTeX math (vendored, so it works offline) and draws a live SVG knowledge map with foundations at the bottom. Dark theme by default; a light theme is available.

## Development

```bash
pip install -e ".[dev]"
pytest
```

The tests replace Claude with a scripted fake streaming client, so they run without an API key.
