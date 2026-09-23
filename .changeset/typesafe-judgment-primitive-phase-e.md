---
"@reactive-agents/runtime": minor
"reactive-agents": minor
---

New public judgment primitives on the agent facade, and re-exports so their types are reachable through the `reactive-agents` package (not just `@reactive-agents/runtime`):

- **`agent.listModels()`** — lists the configured `JudgmentService` backend's available models (`jev`: live TypeSafe catalog; `llm`: rejects, since it has no catalog endpoint). Throws immediately if `.withJudgment()` was never called, same contract as `agent.judge()`.
- **`agent.judgeRank(candidates, question, opts?)`** — batched Score-based candidate re-ranking: judges every candidate against one shared question in as few `JudgmentService.ask()` calls as possible (`opts.chunkCap`, default 30), instead of the one-round-trip-per-candidate cost of hand-rolling `Promise.all(candidates.map(c => agent.judge(...)))`. Returns candidates sorted best-first; ties keep input order.
- `reactive-agents` (the umbrella facade package) now re-exports `JudgeInput`, `JudgeRankCandidate`, `JudgeRankOptions`, `JudgeRankQuestion`, `JudgeRankResult`, `DEFAULT_JUDGE_RANK_CHUNK_CAP` (from `@reactive-agents/runtime`) and `JudgmentModel`, `JudgmentUnsupported` (from `@reactive-agents/judgment`) — these were already exported from `@reactive-agents/runtime` but were missing from the `reactive-agents` facade, so `import type { JudgeInput } from "reactive-agents"` did not compile.

`judgeRank()` now rejects loudly (instead of hanging) when `opts.chunkCap` is non-positive or non-finite, and rejects duplicate candidate ids up front rather than silently letting the last duplicate overwrite an earlier one.
