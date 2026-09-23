---
"@reactive-agents/runtime": minor
"reactive-agents": minor
"@reactive-agents/reasoning": minor
---

`agent.judge()` gains an opt-in `includeContext` auto-context merge:
`agent.judge({ questions, includeContext: true })` folds the agent's own
recent message history and tool observations into `state` automatically,
instead of requiring the caller to hand-assemble it. `messageWindow` and
`includeToolResults` tune what gets folded in; an explicit `state` field
always wins on key collision. Zero cost and byte-identical behavior when
`includeContext` is omitted.

`state` is now only optional when `includeContext: true` supplies it — a
discriminated-union type change on `agent.judge()`'s options. Every existing
call site that already passes `state` (including `state: null`) is
unaffected; `agent.judge({ questions })` with neither `state` nor
`includeContext` was previously a silent-`undefined` type hole and is now a
compile-time error.

Two new shadow-only judgment sites in the reasoning kernel: a
completion/termination Noul alongside the Verifier's existing terminal
checks, and a grounding/fabrication Noul alongside the deterministic
content-containment check `assembleDeliverable` already runs. Both are
observation-only — they emit `JudgmentShadow` events for later agreement
analysis and never alter what the heuristic actually decides. Degrades
cleanly (no-op) when `.withJudgment()` was never called.

`@reactive-agents/reasoning` also exports `compressToolResult` and
`CompressResult` (previously internal) from its package root, used by
`agent.judge({ includeContext })`'s tool-observation folding.
