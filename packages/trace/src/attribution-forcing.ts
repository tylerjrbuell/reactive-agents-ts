// packages/trace/src/attribution-forcing.ts
//
// Attribution rule for no-call stalls the harness could have forced (owner
// decision 2026-11-06, wiki/Research/Harness-Reports/2026-11-06-canonical-
// failure-modes.md, "Instrument note"). Rule order and the verdict assembly live
// in attribution.ts; the facts it reads live in attribution-facts.ts.
//
//   harness:forcing-unused      a model rule for a no-call stall matched
//                               (model:ignored-guidance, model:evidence-not-gathered),
//                               the stalled turns offered domain tools on a native-FC
//                               request, and the harness answered with prose instead of
//                               forcing a call: act-or-answer was off, or did not fire
//                               on those turns. Stalls must dominate: the unforced
//                               no-call turns are at least half of the turns that
//                               offered a domain tool, up to the divergence turn. Forcing that fired and still failed
//                               (the forced reply made no call, or the forced call's
//                               tool failed) keeps the model label.

import type { GuardFiredEvent, LLMExchangeEvent } from "./events.js";
import type { CauseEvidence } from "./cause.js";
import { isMeta, strArr, str, ev1, type Facts, type Rule, type Ctx } from "./attribution-facts.js";

/** Guard name on every act-or-answer record (reasoning `ACT_OR_ANSWER_ACTOR`). */
export const ACT_OR_ANSWER_GUARD = "act-or-answer";

/**
 * The run's `actOrAnswer` setting from `run-started.config.mechanisms`
 * (`false` | `true` | `"proactive"`). `undefined` when the trace does not
 * record it (traces from before the mechanism existed, or `config: {}`).
 */
export function actOrAnswerSetting(f: Facts): boolean | "proactive" | undefined {
  const started = f.ev.find((e) => e.kind === "run-started");
  if (started === undefined || started.kind !== "run-started") return undefined;
  const mech = started.config["mechanisms"];
  if (typeof mech !== "object" || mech === null || Array.isArray(mech)) return undefined;
  const v = (mech as Readonly<Record<string, unknown>>)["actOrAnswer"];
  return typeof v === "boolean" || v === "proactive" ? v : undefined;
}

/**
 * A no-call stall: a `think` turn (or an unlabeled one, on older traces) whose
 * request offered at least one domain tool schema (native FC: a text-driver
 * request carries none) and whose reply made no tool call, natively or through
 * the text-parse fallback (no tool ran before the next exchange). A turn cut by
 * `max_tokens` or a failed call is not a stall: forcing would not change it.
 *
 * @param f Run facts.
 * @param cutoff Only turns at or before this `seq` count.
 */
export function noCallStalls(f: Facts, cutoff: number): readonly LLMExchangeEvent[] {
  const offered = new Set(offeredThinkTurns(f, cutoff));
  return f.exchanges.filter((x, i) => {
    if (!offered.has(x)) return false;
    if ((x.response.toolCalls ?? []).length > 0) return false;
    const next = f.exchanges[i + 1]?.seq ?? Number.POSITIVE_INFINITY;
    return !f.toolStarts.some((t) => t.seq > x.seq && t.seq < next && !isMeta(t.toolName));
  });
}

/**
 * `think` turns (or unlabeled ones) at or before `cutoff` whose request offered
 * a domain tool schema and whose reply completed (not cut by `max_tokens`, not a
 * failed call): the turns where the model chose between calling and prose.
 */
export const offeredThinkTurns = (f: Facts, cutoff: number): readonly LLMExchangeEvent[] =>
  f.exchanges.filter((x) => x.seq <= cutoff && (x.purpose === undefined || x.purpose === "think") &&
    x.toolSchemaNames.some((n) => !isMeta(n)) && x.response.stopReason !== "max_tokens" && x.response.error === undefined);

/** act-or-answer records, excluding forced requests the provider failed (not a model reply). */
const forcingFires = (f: Facts): readonly GuardFiredEvent[] =>
  f.ev.filter((e): e is GuardFiredEvent =>
    e.kind === "guard-fired" && e.guard === ACT_OR_ANSWER_GUARD &&
    e.metadata?.["forcedFailed"] !== true && e.metadata?.["retryFailed"] !== true);

/**
 * A forced reply the model failed: it made no call, or a tool it called under
 * forcing failed in the same iteration (the record precedes the tool's run).
 */
const modelFailedUnderForcing = (f: Facts, g: GuardFiredEvent): boolean => {
  const result = str(g.metadata, "result") ?? g.reason;
  if (result === "no-call") return true;
  if (result !== "called") return false;
  const tools = strArr(g.metadata, "tools");
  return f.toolEnds.some((t) => t.iter === g.iter && t.seq > g.seq && tools.includes(t.toolName) && t.ok === false);
};

/**
 * Wrap the no-call-stall model rules: when one of them matches and the harness
 * could have forced the stalled turns but did not, the stall is the harness's.
 * The wrapped model reason still matches, so it lands in `alsoMatched`.
 *
 * @param modelRules The model rules whose failures a forced call addresses.
 * @returns A rule that yields `harness:forcing-unused`, or undefined.
 */
export function forcingUnused(modelRules: readonly Rule[]): Rule {
  return (ctx: Ctx) => {
    const model = modelRules.map((r) => r(ctx)).find((h) => h !== undefined);
    if (model === undefined) return undefined;
    const { f, first } = ctx;
    const cutoff = first?.exchange.seq ?? Number.POSITIVE_INFINITY;
    const stalls = noCallStalls(f, cutoff);
    if (stalls.length === 0) return undefined;
    // A retry record follows the forced reply, so a record may sit past the cutoff turn, before the next one.
    const fireLimit = f.exchanges.find((x) => x.seq > cutoff)?.seq ?? Number.POSITIVE_INFINITY;
    const fires = forcingFires(f).filter((g) => g.seq < fireLimit);
    // Forcing ran and the model still failed: the model label stands.
    if (fires.some((g) => modelFailedUnderForcing(f, g))) return undefined;
    const covered = new Set(fires.map((g) => g.iter));
    const unforced = stalls.filter((x) => !covered.has(x.iter));
    // Dominant: unforced stalls are at least half of the completed turns that offered a domain tool.
    // One stray no-call turn in a run that kept calling is not what failed it.
    const offeredTurns = offeredThinkTurns(f, cutoff).length;
    if (unforced.length === 0 || unforced.length * 2 < offeredTurns) return undefined;
    const setting = actOrAnswerSetting(f);
    const mode = setting === undefined ? "not recorded" : String(setting);
    const offered = unforced[0]!.toolSchemaNames.filter((n) => !isMeta(n)).slice(0, 4).join(",");
    const evidence: CauseEvidence[] = [
      ev1(unforced[0]!, `${unforced.length} of ${offeredTurns} turn(s) that offered domain tools made no call and were not forced (actOrAnswer=${mode}); first offered ${offered}`),
      ...(fires.length > 0 ? [ev1(fires[0]!, `act-or-answer fired on ${covered.size} other iteration(s) and the forced replies did not fail`)] : []),
      ...model.evidence.slice(0, 2),
    ];
    return {
      reason: "harness:forcing-unused",
      ...(model.divergence ? { divergence: model.divergence } : {}),
      ...(model.target ? { target: model.target } : {}),
      evidence,
      needs: setting === undefined ? ["run-started.config.mechanisms.actOrAnswer (whether forcing existed for this run)"] : [],
    };
  };
}
