---
"@reactive-agents/reasoning": patch
---

New harness mechanism: the budget answer turn (`harness.budgetAnswerTurn`). It is on by default; turn it off with `harness: { budgetAnswerTurn: false }` or `RA_BUDGET_ANSWER_TURN=0` (the default change itself is described with the recall changes). A run that holds tool evidence and has only the answer left makes its last think call with no tools, so the model writes the answer from what it gathered. Without it, that last call can go to a tool whose result arrives after the run ends ("The run stopped (max_iterations) before the model wrote a final answer"). The harness never writes the answer. A run with no evidence still fails honestly. An ablation over 3 model tiers measured +1.9pp, which is within noise.

With the answer turn on:
- A reply that passes the checks ends the run `completed`, with `terminatedBy: "final_answer"`. Before this change it ended `partial` / `max_iterations`.
- The answer turn is not taken while the task still asks for an action that has not been done ("file a report using the report tool"), even when the compiled contract lists only the answer.
- A tool call on the no-tools turn is never run.
- A soft guard (stall, early stop) that fires on the second-to-last iteration also gets one answer turn with no tools. With it off, that guard gets no extra turn: the run ends as the gate decides (handoff of the draft, or an honest failure).
- A run that spent its cap on the answer turn and is resumed with `resumeRun` gets its tools back on the first resumed call, and its own answer turn under the raised cap. The resumed run also starts its low-delta streak at 0, so the stopped run's stalled passes no longer end the resume on its first pass.

When the last call is the answer turn it carries no tools, so a run stopped at its cap leaves no tool call pending for `resumeRun` to run. A run whose last call kept its tools (the answer turn off, or not taken) still resumes its pending call.

Reflexion kernel passes now draw on the run's configured `maxIterations` instead of a fixed 3: each pass gets an even share of the budget still left (at least 2 iterations). `reflexion.kernelMaxIterations` still overrides it. Plan-execute step kernels use the same shared helper (`strategies/budget/iteration-budget.ts`) with the same budget as before.
