---
"@reactive-agents/reasoning": patch
---

A run no longer ends with its answer written and the `todo` list half open and unexplained. When the model gives its final answer while `todo` items are still open, the harness holds the answer for one extra turn that names the open items: mark them done, remove them, or finish them. It never checks an item for the model, asks only once per run, and skips the turn when the list is empty or closed, or when no iteration is left. A soft guard (low token delta, stall) that fires during that turn waits for the model's reply instead of handing off the answer it already wrote.
