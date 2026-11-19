/**
 * Model page rules (`/models/[provider]/[...model]`, Bench spec section 8):
 * the capability stat grid, the remaining capability rows, and the note on
 * what runs on this model actually used. Rendering lives in the route.
 */
import {
  compareByPrice,
  formatFirstToken,
  formatPerMillion,
  formatTokens,
  formatTokensPerSecond,
  isFreePrice,
  isLocalPrice,
  priceSourceLabel,
  type ModelPrice,
} from "@reactive-agents/ui-core";
import type { RunRow } from "./runs-table.js";

/** `GET /api/models/capability` for one provider/model. */
export interface ModelCapability {
  readonly maxContextTokens: number;
  readonly recommendedNumCtx: number;
  readonly maxOutputTokens: number;
  readonly supportsThinking: boolean;
  readonly supportsVision: boolean;
  readonly supportsPromptCaching: boolean;
  readonly toolCallDialect: string;
  readonly tier: string;
  /** `fallback` when the model is not in the shipped capability table. */
  readonly source: string;
  /** `null` for providers that need no key. */
  readonly keyConfigured: boolean | null;
  /** $/1M rates from the framework PriceBook; absent = price unknown. */
  readonly price?: ModelPrice;
}

/** One price stat for the model page price card. */
export interface PriceItem {
  readonly label: string;
  readonly value: string;
  readonly title?: string;
}

/**
 * The price card's stats: input, output, cache read and long-context tiers in
 * $/1M. Empty when the price is unknown, the model is local, or a hosted model
 * is free (`isFreePrice`); the card says so in words instead of `$0` stats.
 */
export function priceStats(price: ModelPrice | undefined): PriceItem[] {
  if (price === undefined || isLocalPrice(price) || isFreePrice(price)) return [];
  const source = priceSourceLabel(price);
  const items: PriceItem[] = [
    { label: "Input", value: `${formatPerMillion(price.input)} / 1M`, title: `Uncached input tokens. Source: ${source}.` },
    { label: "Output", value: `${formatPerMillion(price.output)} / 1M`, title: `Output tokens, hidden reasoning included. Source: ${source}.` },
  ];
  if (price.cacheRead !== undefined) {
    items.push({ label: "Cache read", value: `${formatPerMillion(price.cacheRead)} / 1M`, title: `Input tokens served from the prompt cache. Source: ${source}.` });
  }
  for (const t of price.tiers ?? []) {
    const inRate = formatPerMillion(t.input ?? price.input);
    const outRate = formatPerMillion(t.output ?? price.output);
    items.push({
      label: `Prompt over ${formatTokens(Math.max(0, t.minPromptTokens - 1))}`,
      value: `${inRate} / ${outRate}`,
      title: `Input / output $/1M when the prompt is at least ${t.minPromptTokens.toLocaleString("en-US")} tokens. Source: ${source}.`,
    });
  }
  return items;
}

/** Model list order on the provider page: the provider's own order, or cheapest first (unknown prices last). */
export type ModelListSort = "default" | "price";

/** `models` in `sort` order; `default` keeps the server's order. Does not mutate. */
export function sortModelList<T extends { readonly price?: ModelPrice }>(models: readonly T[], sort: ModelListSort): T[] {
  return sort === "price" ? [...models].sort((a, b) => compareByPrice(a.price, b.price)) : [...models];
}

/** One labelled capability value (values are machine values: set in mono). */
export interface CapabilityItem {
  readonly label: string;
  readonly value: string;
}

const yesNo = (b: boolean): string => (b ? "yes" : "no");
const count = (n: number): string => n.toLocaleString("en-US");

/** The four headline stats (the mockup's grid): context, max output, tool calls, thinking. */
export function capabilityStats(cap: ModelCapability): CapabilityItem[] {
  return [
    { label: "Context window", value: count(cap.maxContextTokens) },
    { label: "Max output", value: count(cap.maxOutputTokens) },
    { label: "Tool calls", value: cap.toolCallDialect },
    { label: "Thinking", value: yesNo(cap.supportsThinking) },
  ];
}

/** The rest of the capability record, as rows under the grid. */
export function capabilityRows(cap: ModelCapability): CapabilityItem[] {
  return [
    { label: "Working context", value: `${count(cap.recommendedNumCtx)} tokens` },
    { label: "Vision", value: yesNo(cap.supportsVision) },
    { label: "Prompt caching", value: yesNo(cap.supportsPromptCaching) },
    { label: "Tier", value: cap.tier },
  ];
}

/** Runs recorded with exactly this provider and model, newest first. */
export function runsOnModel(rows: readonly RunRow[], provider: string, model: string): RunRow[] {
  return rows
    .filter((r) => r.provider === provider && r.model === model)
    .sort((a, b) => b.startedAt - a.startedAt);
}

/**
 * The capability note: whether the values are measured or fallback defaults,
 * then what recorded runs on this model used (the largest run's total
 * tokens), so a declared number and real use sit side by side (spec G5).
 * `null` when there is nothing to say.
 */
export function capabilityNote(cap: ModelCapability, runs: readonly RunRow[]): string | null {
  const parts: string[] = [];
  if (cap.source === "fallback") {
    parts.push("Not in the shipped capability table: these are conservative defaults, not measured values.");
  }
  const used = runs.reduce((max, r) => Math.max(max, r.tokensUsed), 0);
  if (used > 0) {
    const n = runs.length;
    parts.push(`${n} recorded ${n === 1 ? "run" : "runs"} on this model; the largest used ${formatTokens(used)} tokens in total.`);
  }
  return parts.length > 0 ? parts.join(" ") : null;
}

/** `GET /api/model-throughput` (server `services/model-throughput.ts`). */
export interface ModelThroughput {
  readonly runs: number;
  readonly tokensPerSecond?: { readonly median: number; readonly lowerBound: boolean; readonly calls: number };
  readonly firstTokenMs?: { readonly median: number; readonly calls: number };
}

/** One speed stat with its hover explanation. */
export interface SpeedItem extends CapabilityItem {
  readonly title: string;
}

/**
 * The Model page speed stats: median output tokens/sec and median time to
 * first token over recent runs. A median over lower-bound rates (no call
 * reported its first token) reads `~` and says so; exact and lower-bound rates
 * are never mixed (the server keeps them apart). Empty when nothing was measured.
 */
export function speedStats(t: ModelThroughput | null): SpeedItem[] {
  if (!t) return [];
  const items: SpeedItem[] = [];
  const runs = `${t.runs} recent ${t.runs === 1 ? "run" : "runs"}`;
  if (t.tokensPerSecond) {
    const { median, lowerBound, calls } = t.tokensPerSecond;
    items.push({
      label: "Median speed",
      value: formatTokensPerSecond(median, lowerBound),
      title: `Median output speed over ${calls} model ${calls === 1 ? "call" : "calls"} in ${runs}${
        lowerBound ? ". At least this fast: no call reported when its first token came, so the time includes the wait before output" : ""
      }`,
    });
  }
  if (t.firstTokenMs) {
    const { median, calls } = t.firstTokenMs;
    items.push({
      label: "Median first token",
      value: formatFirstToken(median),
      title: `Median time to first token over ${calls} streamed ${calls === 1 ? "call" : "calls"} in ${runs}`,
    });
  }
  return items;
}
