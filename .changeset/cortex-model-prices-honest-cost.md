---
"@reactive-agents/cortex": minor
"@reactive-agents/ui-core": minor
---

**Breaking (types):** ui-core `TokenUsage.costUsd` is now optional (absent = price unknown). Migration: sum with `addCallCost` / `foldRunCost` and show partial totals with `formatCostTotal`.

Cortex shows model prices and never counts an unpriced call as free.

- `GET /api/models/:provider` rows and `GET /api/models/capability` carry `price` (`input`, `output`, `cacheRead`, `tiers` in $/1M, `source`, `asOf`, and `origin` for a `source: "remote"` price) from the framework PriceBook; absent means the price is unknown. Ollama models are `source: "local"`, $0. A remote price list reads "remote price list (origin)".
- Model dropdowns (chat `/model` menu, builder **Model** section) show `$in / $out per 1M`, `free (local)` or `price unknown`. The model page has a **Price** section beside **Spend**, and a provider's model list can be sorted by lowest price.
- Run costs (server `cortex_runs`, Runs list and total, run vitals, trace rows, compare, Beacon nodes) add only priced calls. A call with `priceSource: "unknown"` or no `estimatedCost` marks the total partial, shown as a lower bound (`≥ $0.012`) or `price unknown`. The run's stored total is the framework's `RunCostFinalized` (published once per run after the background debrief call, so the debrief's spend is included) with its `costComplete`; until it arrives the total is the provisional sum of the calls seen so far. `AgentCompleted.totalCostUsd` (pre-debrief) is no longer read; its `costComplete: false` still marks the run partial. Rebuilding a run stored before `RunCostFinalized` keeps the old rule. New column `cortex_runs.cost_complete`; `RunSummary.costComplete` is `false` when partial.
- Desk and gateway runs keep forwarding the agent's events until `result.totalCost()` settles, so `RunCostFinalized` is no longer lost when the debrief outlives `run()`. Lifecycle webhooks can subscribe to `RunCostFinalized`.
- ui-core adds `llmCallCostOf`, `addCallCost`, `foldRunCost`, `finalRunCostOf`, `formatCostTotal`, `partialCostNote`, `EMPTY_COST_TOTAL`, `CostTotal`, and model price helpers `formatModelPrice`, `formatPerMillion`, `priceSourceLabel`, `compareByPrice`, `isLocalPrice`, `ModelPrice`.
- ui-core `TokenUsage.costUsd` is now optional and `TokenUsage.priceSource` is added (mirrors the runtime stream). `summarizeUsage` adds only priced calls (an unknown price used to make the turn's `costUsd` `NaN`), `CallUsage.costUsd` is absent for an unpriced call, and `TurnUsage.costComplete` is `false` when any call had no known price.
- Chat turns store a partial cost as a lower bound when the run reports `costComplete: false` (streamed and non-streamed turns, and `ChatReply.costComplete` on direct replies) or a streamed call had no known price.
- ui-core `ModelPriceSource` adds `"remote"` and `ModelPrice.origin`.
- A hosted model billed $0 for input and output (e.g. Gemma 4 on Gemini, free tier with no paid price) reads `free` instead of `$0 / $0 per 1M` in the chat `/model` menu, the builder model dropdown and the provider model list, and the model page Price section says so in words. Sort by price puts local models first, then free hosted models; unknown prices stay last. ui-core adds `isFreePrice` and `modelPriceDetail` (tooltip text for a price label). The Runs toolbar's partial-cost note is a Cortex tooltip instead of a native `title`.
