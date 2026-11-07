/**
 * Act-or-answer counts read off a strategy result.
 *
 * The kernel relays its per-run tally on `result.metadata.extensions.actOrAnswer`
 * (reasoning `act-or-answer-tally.ts`, `ActOrAnswerTally`). This maps it to the
 * five optional fields shared by `RunObservation` (local calibration learning,
 * `deriveActOrAnswer`) and `RunReport` (community telemetry). Absent or malformed
 * tally yields `{}`, so both records omit the fields.
 */
import type { ActOrAnswerTally } from "@reactive-agents/reasoning";
import type { RunObservation } from "@reactive-agents/reactive-intelligence";

/** The act-or-answer fields of `RunObservation` (same names on `RunReport`). */
export type ActOrAnswerCounts = Pick<
  RunObservation,
  "noCallStallTurns" | "unforcedToolWorkTurns" | "forcedCalls" | "forcedCallsCalled" | "forcedCallsSucceeded"
>;

const TALLY_KEYS = ["noCallStalls", "unforcedToolWorkTurns", "forced", "forcedCalled", "forcedCallSucceeded"] as const;

function isTally(v: unknown): v is ActOrAnswerTally {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return TALLY_KEYS.every((k) => typeof r[k] === "number" && Number.isFinite(r[k]));
}

/**
 * Spread-ready act-or-answer counts from a strategy result's metadata; `{}` when
 * the kernel relayed no (or a malformed) `extensions.actOrAnswer`. Pure.
 */
export function readActOrAnswerCounts(
  metadata: { readonly extensions?: Readonly<Record<string, unknown>> } | undefined,
): ActOrAnswerCounts {
  const t = metadata?.extensions?.["actOrAnswer"];
  if (!isTally(t)) return {};
  return {
    noCallStallTurns: t.noCallStalls,
    unforcedToolWorkTurns: t.unforcedToolWorkTurns,
    forcedCalls: t.forced,
    forcedCallsCalled: t.forcedCalled,
    forcedCallsSucceeded: t.forcedCallSucceeded,
  };
}
