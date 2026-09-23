---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

New public judgment primitives on the agent facade, and re-exports so their types are reachable through the `reactive-agents` package (not just `@reactive-agents/runtime`):

- **`agent.listJudgmentModels()`** — lists the configured `JudgmentService` backend's available models (`jev`: live TypeSafe catalog; `llm`: rejects, since it has no catalog endpoint). Throws immediately if `.withJudgment()` was never called, same contract as `agent.judge()`. Named `listJudgmentModels` (not `listModels`) — it's scoped to the judgment backend, not the LLM provider models `.withModel()` selects from.
- **`agent.judgeRank(candidates, question, opts?)`** — batched Score-based candidate re-ranking: judges every candidate against one shared question in as few `JudgmentService.ask()` calls as possible (`opts.chunkCap`, default 30), instead of the one-round-trip-per-candidate cost of hand-rolling `Promise.all(candidates.map(c => agent.judge(...)))`. Returns candidates sorted best-first; ties keep input order.
- **`includeContext`** on `agent.judge()` is now `boolean | JudgeContextConfig`: `true` folds every context layer (recent messages, tool results, and the full reasoning-step trace — thoughts/actions, not just tool observations) with its own default window; an object form (`{ messages?, toolResults?, reasoningSteps? }`) opts into only the named layers, each independently windowable/type-filterable.
- `reactive-agents` (the umbrella facade package) now re-exports `JudgeInput`, `JudgeRankCandidate`, `JudgeRankOptions`, `JudgeRankQuestion`, `JudgeRankResult`, `DEFAULT_JUDGE_RANK_CHUNK_CAP` (from `@reactive-agents/runtime`) and `JudgmentModel`, `JudgmentUnsupported` (from `@reactive-agents/judgment`) — these were already exported from `@reactive-agents/runtime` but were missing from the `reactive-agents` facade, so `import type { JudgeInput } from "reactive-agents"` did not compile.

`judgeRank()` now rejects loudly (instead of hanging) when `opts.chunkCap` is non-positive or non-finite, and rejects duplicate candidate ids up front rather than silently letting the last duplicate overwrite an earlier one.
