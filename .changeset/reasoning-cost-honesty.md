---
"@reactive-agents/reasoning": patch
---

An LLM call whose model has no known price is no longer counted as free. When the provider usage carries no `estimatedCost`, the `LLMRequestCompleted` event the reasoning layer publishes now omits `estimatedCost` and sets `priceSource: "unknown"`. A priced call also carries its `priceSource` (for example `"price-book"` or `"provider-reported"`).

The run spend meter (`RunBudgetMeter`) gains a `costComplete` flag. It turns `false` when any call in the run had an unknown price and stays `false` for the rest of the run. In that case `cost` is a lower bound (the sum of the known prices), not the full spend. Spend values (`TokenSpend` / `RunBudgetSpend`) carry the same optional `costComplete`. Structured-output results omit `usage.estimatedCost` when any attempt's price was unknown.

Kernel cost totals can no longer become `NaN` when a provider reports usage without a cost.
