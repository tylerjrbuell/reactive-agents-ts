---
"@reactive-agents/llm-provider": minor
---

xAI's default model is priced, and remote price rows are no longer labelled as your pricing.

- The default xAI model is now `grok-4.7`. It was `grok-4`, which is no longer on xAI's price list, so the default model's calls had no known cost. `grok-4.7` is priced from the bundled snapshot at $2 / $6 per 1M tokens, with 2x rates above 200k prompt tokens. The capability table seeds `xai/grok-4.7` in place of `xai/grok-4`. `grok-4` still works and resolves through the hosted fallback, but it has no price.
- `priceFor` now labels rows from `withDynamicPricing` as `source: "remote"`, with `origin` naming the price list. Before, it labelled them `"user"`. These calls bill as `priceSource: "price-book"`. Rows from `withModelPricing` stay `"user"` and still win over remote rows.
- `openRouterPricingProvider` and `urlPricingProvider` set `origin` on each row they fetch. A custom `PricingProvider` can set `origin` itself or pass its rows through the new `markRemotePricing(rows, origin)`.
- New exports: `PricingRow`, `PricingRowSchema` and `markRemotePricing`. `PricingRegistry` rows are now `PricingRow` (`ModelPricing` plus an optional `origin`). `PriceEntrySource` adds `"remote"`, and `PriceEntry` adds an optional `origin`.
