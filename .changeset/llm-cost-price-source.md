---
"@reactive-agents/core": patch
"@reactive-agents/observability": patch
"@reactive-agents/observe": patch
---

`LLMRequestCompleted` can now say when a call's cost is unknown. A new optional `priceSource` field (`"provider-reported" | "price-book" | "user" | "unknown"`, exported as the `PriceSource` type) records where the cost came from. **Contract change:** `estimatedCost` is now optional. Absent means the price is unknown, not zero, so readers that sum it must handle `undefined` (and should mark the total as partial) instead of assuming a number. Producers that still always set a number keep compiling.

Core adds `sumCosts(costs)` / `addCost(total, cost)` (with `EMPTY_COST_SUM` and the `CostSum` type): they return `{ usd, complete }`, where `complete: false` means at least one call had an unknown price and `usd` is a lower bound.

Observability readers now treat an unknown price honestly. The metrics collector no longer records an unpriced call as $1 on `llm.cost_usd`; it skips the cost and counts the call on a new `llm.cost_unpriced_calls` counter. Telemetry records carry an optional `costComplete` flag, and the telemetry aggregate reports `partialCostRuns`. The OpenInference tracer (`@reactive-agents/observe`) omits `llm.estimated_cost_usd` when the price is unknown instead of emitting 0, and adds an `llm.price_source` span attribute.
