---
"@reactive-agents/reasoning": patch
---

New opt-in harness mechanism: the budget answer turn (`harness.budgetAnswerTurn: true`, or `RA_BUDGET_ANSWER_TURN=1`). It is off by default. An ablation over 3 model tiers measured +1.9pp, which is within noise. When it is on, a run that holds tool evidence and has only the answer left makes its last think call with no tools, so the model writes the answer from what it gathered. Without it, that last call can go to a tool whose result arrives after the run ends ("The run stopped (max_iterations) before the model wrote a final answer"). The harness never writes the answer. A run with no evidence still fails honestly.

With the answer turn on:
- A reply that passes the checks ends the run `completed`, with `terminatedBy: "final_answer"`. Before this change it ended `partial` / `max_iterations`.
- The answer turn is not taken while the task still asks for an action that has not been done ("file a report using the report tool"), even when the compiled contract lists only the answer.
- A tool call on the no-tools turn is never run.

A soft guard (stall, early stop) that fires on the second-to-last iteration still gets one answer turn with no tools, whether or not the flag is set.

Reflexion kernel passes now draw on the run's configured `maxIterations` instead of a fixed 3: each pass gets an even share of the budget still left (at least 2 iterations). `reflexion.kernelMaxIterations` still overrides it. Plan-execute step kernels use the same shared helper (`strategies/budget/iteration-budget.ts`) with the same budget as before.
