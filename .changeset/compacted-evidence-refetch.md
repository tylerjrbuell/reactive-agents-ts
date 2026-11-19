---
"@reactive-agents/reasoning": patch
---

Long multi-query runs no longer lose evidence to compaction.

- `recall(key, full: true)` now returns the stored result in full. Before, the recall output was compressed again like any tool result, so it came back as a "compressed preview" and was stored under a new key. A recall read now gets a budget of a quarter of the context window (`toolResultBudget`).
- A repeated call with the same arguments in a different key order (or with only whitespace changes) is now recognized as a duplicate. It returns the earlier result instead of a bare "already called N times" refusal. When that earlier result was compacted, the reply names its stored key: `recall("_tool_result_N", full: true)`.
- The repetition backstop's default now counts iterations, not calls. A parallel-safe tool may batch `maxBatchSize` calls per iteration, so its default cap is `ceil(maxIterations * 0.75) * maxBatchSize` calls. Other tools keep `ceil(maxIterations * 0.75)`. A configured `maxCalls` is still a plain call count. Before, a model that batched 3-4 distinct queries per turn hit the cap after 2-3 turns. `repetitionBackstopCalls` takes an optional third argument, `callsPerIteration`.
