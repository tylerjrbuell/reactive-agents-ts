// packages/llm-provider/src/price-book/overrides.ts
//
// Official-price corrections to the LiteLLM snapshot. When LiteLLM and the
// provider's official price page disagree, the official price wins: add the
// full row here, keyed "<provider>:<bare model id>", with the page and the date
// it was read. An override replaces the snapshot row whole.
//
// 2026-11-19: EMPTY. The token-cost accuracy audit
// (wiki/Research/Audit-Reports-2026-11-19/token-cost-accuracy.md) read the
// official Anthropic, OpenAI, Google, xAI and Groq pages the same day and every
// row it cross-checked matched LiteLLM (incl. Opus 5.5, Sonnet 5/5.5 cache
// reads, gpt-5.4 / gpt-6-sol, gemini-2.5-pro tiers, gemini-2.5-flash, grok-4.7,
// groq gpt-oss-120b, gpt-4o). Nothing to correct yet.

import type { PriceRates } from "./schema.js";

/** One official correction, with the page it came from. */
export interface PriceOverride {
  readonly rates: PriceRates;
  /** Official price page URL. */
  readonly page: string;
  /** Date the page was read, `YYYY-MM-DD`. */
  readonly asOf: string;
}

/** Official corrections, keyed "<provider>:<bare model id>". */
export const PRICE_OVERRIDES: Readonly<Record<string, PriceOverride>> = {};
