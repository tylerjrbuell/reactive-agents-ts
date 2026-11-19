/**
 * Model page spend (roadmap C13): tokens and dollars on one provider/model over
 * its recent runs, from the stored `LLMRequestCompleted` events (the same rows
 * the Speed section reads). Dollars are the event's `estimatedCost`, priced by
 * the framework when the call completed; Cortex keeps no price table.
 *
 * Honesty rules: calls on another provider/model inside the same runs (a
 * fallback or a routed tier) are not this model's spend and are skipped. A
 * call without a token split counts toward `tokens` only. A call with no known
 * price (`priceSource: "unknown"`, or no numeric `estimatedCost`; ui-core
 * `llmCallCostOf`) makes `costKnown` false (the dollar figure is then a
 * lower bound), never a silent $0. "Per successful run" divides all spend in
 * the window by the runs that completed, so failed runs' spend counts against
 * the successes they paid for.
 */
import type { StoredLlmCall } from "../db/model-throughput-queries.js";
import { llmCallCostOf } from "@reactive-agents/ui-core";

/** One recent run on the model and how it ended (`cortex_runs.status`, `ending`). */
export interface ModelRunOutcome {
  readonly runId: string;
  readonly status: string;
  /** ui-core `turnOutcomeOf` ending, when stored (`succeeded`, `failed`, `abstained`, `partial`, …). */
  readonly ending: string | null;
}

/** Response of `GET /api/model-cost`. */
export interface ModelCost {
  readonly provider: string;
  readonly model: string;
  /** Runs in the window. */
  readonly runs: number;
  /** Runs that completed with a full answer. */
  readonly successfulRuns: number;
  /** Model calls on this provider/model. */
  readonly calls: number;
  /** Total tokens (`tokensUsed`) over those calls. */
  readonly tokens: number;
  /** Input tokens, over calls that reported the split. */
  readonly tokensIn: number;
  /** Output tokens, over calls that reported the split. */
  readonly tokensOut: number;
  /** Input tokens served from the provider's prompt cache (calls that reported it). */
  readonly cachedTokensIn: number;
  /** Calls that reported an input/output split. */
  readonly splitCalls: number;
  /** Spend in USD (framework `estimatedCost`). */
  readonly costUsd: number;
  /** False when a call carried no cost, so `costUsd` is a lower bound. */
  readonly costKnown: boolean;
  /** `costUsd / successfulRuns`; absent with no successful run. */
  readonly costPerSuccessfulRun?: number;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A run that ended with a full answer: `ending` when stored, else the run status. */
export function runSucceeded(r: ModelRunOutcome): boolean {
  if (r.ending) return r.ending === "succeeded";
  return r.status === "completed";
}

/** Fold the window's calls and run outcomes into the model's spend. Pure. */
export function modelCostOf(
  provider: string,
  model: string,
  calls: readonly StoredLlmCall[],
  runs: readonly ModelRunOutcome[],
): ModelCost {
  let n = 0;
  let tokens = 0;
  let tokensIn = 0;
  let tokensOut = 0;
  let cachedTokensIn = 0;
  let splitCalls = 0;
  let costUsd = 0;
  let costKnown = true;
  for (const c of calls) {
    let p: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(c.payload);
      if (typeof parsed !== "object" || parsed === null) continue;
      p = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    if (p["provider"] !== provider || p["model"] !== model) continue;
    n += 1;
    tokens += num(p["tokensUsed"]) ?? 0;
    const tin = num(p["tokensIn"]);
    const tout = num(p["tokensOut"]);
    if (tin !== undefined && tout !== undefined) {
      splitCalls += 1;
      tokensIn += tin;
      tokensOut += tout;
    }
    cachedTokensIn += num(p["cacheReadTokensIn"]) ?? 0;
    const cost = llmCallCostOf(p);
    if (cost === undefined) costKnown = false;
    else costUsd += cost;
  }
  const successfulRuns = runs.filter(runSucceeded).length;
  return {
    provider,
    model,
    runs: runs.length,
    successfulRuns,
    calls: n,
    tokens,
    tokensIn,
    tokensOut,
    cachedTokensIn,
    splitCalls,
    costUsd,
    costKnown,
    ...(successfulRuns > 0 ? { costPerSuccessfulRun: costUsd / successfulRuns } : {}),
  };
}
