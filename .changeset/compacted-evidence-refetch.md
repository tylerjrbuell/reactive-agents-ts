---
"@reactive-agents/reasoning": patch
---

Long multi-query runs no longer lose evidence to compaction.

- `recall(key, full: true)` now returns the stored result in full. Before, the recall output was compressed again like any tool result, so it came back as a "compressed preview" and was stored under a new key. A recall read now gets a budget of a quarter of the context window (`toolResultBudget`).
- An exact repeat of a call that already succeeded is now a cached replay, not a failure. This includes a repeat with the arguments in a different key order or with only whitespace changes. Before, these repeats got a bare "You have already called ... N times" refusal and were recorded as failed calls. Now the reply is the earlier result, marked "Already fetched at step N; this is that result." When that result was compacted, the reply carries its full stored copy (bounded by the context window; past that bound it names the `recall` key). The call is recorded as a success, and the `duplicate_guard` event fires as `redirect` instead of `block`.
- The repetition backstop's default now counts iterations, not calls. A parallel-safe tool may batch `maxBatchSize` calls per iteration, so its default cap is `ceil(maxIterations * 0.75) * maxBatchSize` calls. Other tools keep `ceil(maxIterations * 0.75)`. A configured `maxCalls` is still a plain call count. Before, a model that batched 3-4 distinct queries per turn hit the cap after 2-3 turns. `repetitionBackstopCalls` takes an optional third argument, `callsPerIteration`.
