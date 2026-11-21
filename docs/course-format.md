# Course format

Every Groundwork course follows the same shape.

## Structure

- **Course** → **Parts** → **Chapters**.
- **A few long-term projects, not one per chapter or Part.** Each course has two to four non-trivial projects. Each project runs across several Parts as a sequence of **milestones**, so the same codebase grows as new ideas arrive. A milestone has hidden correctness tests and, where it applies, a performance target.
- **Every course closes with one capstone project** near the end, followed only by a short "reality" Part. The capstone reuses the earlier projects' code where it can, and is portfolio-grade: you build it, measure it, and write it up.
- **Chapters gate on exercises; projects gate on milestones.** Small exercises unlock the next chapter. A project milestone unlocks the Part that depends on it.

## Chapter template

Each chapter walks the same five blocks:

| | Block | Purpose |
|---|---|---|
| 01 | **The real problem** | Why this idea exists. What breaks without it. |
| 02 | **The smallest idea** | One true statement, defined precisely. |
| 03 | **Add one block** | Build it up with worked examples using real numbers. |
| 04 | **The whole machine** | How it interacts with what came before. |
| 05 | **Reality** | Where it breaks, the trade-offs, what real hardware does. |

Each chapter includes:

- **Diagrams**: static SVG for every key idea.
- **Animations**: step-through visualisations you control (play, step, scrub).
- **Simulations**: interactive models you drive with parameters.
- **Terminal**: an in-page editor and console to run code.
- **Exercises (hard gate)**: the next chapter unlocks only when this chapter's exercises pass.
- **Ask panel**: a Q&A agent that knows the current chapter. It answers questions and gives hints, never solutions.
- **Companion links**: pointers to outside material (books, games) where they deepen a section.

## Exercise types

- **Predict**: answer a numeric or multiple-choice question before the animation reveals the answer.
- **Code**: write code in the terminal. It's checked against hidden tests.
- **Perf**: code that must also hit a measured target (e.g. memory transactions, simulated cycles, % of roofline).
- **Diagnose**: given a broken or slow artifact, find and fix the cause.
