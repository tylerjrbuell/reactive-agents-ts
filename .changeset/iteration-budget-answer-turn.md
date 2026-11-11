---
"@reactive-agents/reasoning": patch
---

Runs that hit their iteration budget now end with the model's answer instead of "The run stopped (max_iterations) before the model wrote a final answer." When the run holds tool evidence and only the answer is outstanding, its last think call is an answer turn with no tools, and the model writes the answer from what it gathered. The harness never writes the answer. A run with no evidence still fails honestly. A soft guard (stall, early stop) that fires on the second-to-last iteration also gets that answer turn now, instead of ending the run unanswered.

Reflexion kernel passes now draw on the run's configured `maxIterations` instead of a fixed 3: each pass gets an even share of the budget still left (at least 2 iterations). `reflexion.kernelMaxIterations` still overrides it. Plan-execute step kernels use the same shared helper (`strategies/budget/iteration-budget.ts`) with the same budget as before.
