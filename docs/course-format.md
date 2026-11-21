# Course format

Every Groundwork course follows the same shape.

## Structure

- **Course** → **Parts** → **Chapters**.
- **A few long-term projects, not one per chapter or Part.** Each course has two to four non-trivial projects. Each project runs across several Parts as a sequence of **milestones**, so the same codebase grows as new ideas arrive. A milestone has hidden correctness tests and, where it applies, a performance target.
- **Every course closes with one capstone project** near the end, followed only by a short "reality" Part. The capstone reuses the earlier projects' code where it can, and is portfolio-grade: you build it, measure it, and write it up.
- **Chapters gate on exercises and a quiz; projects gate on milestones.** A chapter is complete when its exercises pass and its quiz scores at least 80%. Completing it unlocks the next chapter. A project milestone unlocks the Part that depends on it.
- **Every Part has one real-world scenario**: an open-ended engineering brief with realistic context and constraints. Success is a measured outcome reachable by more than one approach ("2× fewer cycles", "fit a 90 µs frame budget"), plus a design write-up (≥150 words) on what was measured, the alternatives weighed, and the trade-offs. The Ask panel can review the write-up like a senior engineer in a design review.
- **Every Part ends with a checkpoint quiz**: cumulative questions across the Part, required before the next Part opens.

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
- **Quiz (hard gate)**: 5–8 questions (multiple choice, multi-select, numeric). It's graded on the server so the answers never reach the browser, and each question shows an explanation after you submit. You can retake it as often as you like.
- **Ask panel**: a Q&A agent that knows the current chapter. It answers questions and gives hints, never solutions.
- **Companion links**: pointers to outside material (books, games) where they deepen a section.

## Exercise types

- **Predict**: answer a numeric or multiple-choice question before the animation reveals the answer.
- **Code**: write code in the terminal. It's checked against hidden tests.
- **Perf**: code that must also hit a measured target (e.g. memory transactions, simulated cycles, % of roofline).
- **Diagnose**: given a broken or slow artifact, find and fix the cause.
