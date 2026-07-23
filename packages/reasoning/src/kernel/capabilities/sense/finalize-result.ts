// packages/reasoning/src/kernel/capabilities/sense/finalize-result.ts
//
// The ONLY mint of a JudgedReasoningResult (cascade design §4.2).
//
// "Un-bypassable" is a compiler fact, not a grep-gate promise: the brand
// symbol is module-private, so every strategy exit — early returns, catch
// paths, pause paths — must cross this function or fail to typecheck once
// StrategyFn requires JudgedReasoningResult (Task 5).
//
// Judgment here is INERT in Task 3 (computed + recorded, enforced:false).
// Task 8 adds enforcement for opt-in withers.
import { Effect } from "effect";
import type { ReasoningResult } from "../../../types/index.js";
import type { RunLedger } from "../../ledger/run-ledger.js";
import { RunEnvelope } from "../../envelope/run-envelope.js";
import { buildStrategyResult } from "./step-utils.js";
import { hasSuccessfulRequiredToolCall } from "../../loop/runner-helpers/grounded-terminal.js";

declare const Judged: unique symbol;
export type JudgedReasoningResult = ReasoningResult & { readonly [Judged]: true };

export interface FinalizeExtras {
  /** Required tools for the grounding verdict (strategy already holds these). */
  readonly requiredTools?: readonly string[];
  /** Run ledger for contract-vs-evidence judgment (universal since Wave C.1). */
  readonly runLedger?: RunLedger;
  /** Repair capabilities this strategy actually has. Absent ⇒ full per-iteration repair. */
  readonly repairCapabilities?: { readonly perIteration: boolean };
}

type BuildParams = Parameters<typeof buildStrategyResult>[0];

export function finalizeStrategyResult(
  params: BuildParams & FinalizeExtras,
): Effect.Effect<JudgedReasoningResult, never, RunEnvelope> {
  return Effect.gen(function* () {
    const envelope = yield* RunEnvelope;
    const base = buildStrategyResult(params);

    const failed: string[] = [];
    let groundedOnRequired: boolean | undefined;
    if (params.requiredTools && params.requiredTools.length > 0) {
      groundedOnRequired = hasSuccessfulRequiredToolCall(params.steps, params.requiredTools);
      if (!groundedOnRequired && envelope.policy.fabricationGuard !== undefined) {
        failed.push("grounding-on-required");
      }
    }

    const repairGaps =
      params.repairCapabilities && !params.repairCapabilities.perIteration
        ? ["per-iteration"]
        : undefined;

    const verdict = {
      enforced: false, // Task 8 flips this for opt-in withers
      ...(groundedOnRequired !== undefined ? { groundedOnRequired } : {}),
      failed,
      ...(repairGaps ? { repairGaps } : {}),
    };

    const judged: ReasoningResult = {
      ...base,
      metadata: { ...base.metadata, verdict },
    };
    // The single sanctioned brand cast in the codebase (module-private symbol).
    return judged as JudgedReasoningResult;
  });
}

/**
 * Terminal mint for a strategy whose kernel pass PAUSED (approval gate or
 * `request_user_input`).
 *
 * Every multi-pass strategy needs the identical shape here — the pause sentinel
 * as output, the descriptor forwarded, `terminatedBy` naming the pause — so it
 * lives in one place rather than being re-derived (and re-forgotten) per
 * strategy. Callers pass whatever they have accumulated so far; the run stops
 * here and resumes from the durable checkpoint, not from this result.
 *
 * Cascade Task 4: this used to be `pausedStrategyResult` in `step-utils.ts`,
 * returning a plain `ReasoningResult` straight out of `buildStrategyResult`.
 * Wrapping it ONCE here — rather than expanding the pause shape at each of its
 * five call sites — keeps the pause terminal a single derivation site AND
 * routes it through the mint, so a paused exit is judged like any other.
 */
export function finalizePausedStrategyResult(
  params: {
    readonly strategy: BuildParams["strategy"];
    readonly steps: BuildParams["steps"];
    readonly pause: NonNullable<BuildParams["pause"]>;
    /** Date.now() captured at strategy start */
    readonly start: number;
    readonly totalTokens: number;
    readonly totalInputTokens?: number;
    readonly totalOutputTokens?: number;
    readonly totalCost: number;
    /** Strategy-specific metadata to keep alongside the pause rails. */
    readonly extraMetadata?: Record<string, unknown>;
  } & FinalizeExtras,
): Effect.Effect<JudgedReasoningResult, never, RunEnvelope> {
  return finalizeStrategyResult({
    strategy: params.strategy,
    steps: params.steps,
    // The kernel's pause sentinel (`Run paused — awaiting human approval.`),
    // non-empty on every pause, so the output/status coherence guard in
    // buildStrategyResult cannot downgrade this to "failed".
    output: params.pause.output,
    // A pause is a clean terminal, exactly as the reactive path reports it
    // (kernel `status: "done"`, nothing shipped unverified).
    status: "completed",
    start: params.start,
    ...(params.totalInputTokens !== undefined
      ? { totalInputTokens: params.totalInputTokens }
      : {}),
    ...(params.totalOutputTokens !== undefined
      ? { totalOutputTokens: params.totalOutputTokens }
      : {}),
    totalTokens: params.totalTokens,
    totalCost: params.totalCost,
    pause: params.pause,
    ...(params.requiredTools !== undefined ? { requiredTools: params.requiredTools } : {}),
    ...(params.runLedger !== undefined ? { runLedger: params.runLedger } : {}),
    ...(params.repairCapabilities !== undefined
      ? { repairCapabilities: params.repairCapabilities }
      : {}),
    extraMetadata: {
      ...params.extraMetadata,
      // The pause reason rides the raw open-string channel; the closed enum
      // stays `end_turn` so `goalAchieved` is honestly unknown rather than
      // claiming a final answer for a run that has not finished.
      terminatedBy: "end_turn" as const,
      rawTerminatedBy: params.pause.reason,
    },
  });
}

// NOTE: there is deliberately no test-only brand escape hatch here. An earlier
// draft exported `__unsafeBrandJudgedForTest`; it ended up with zero call sites
// (fixtures that need a judged result call the mint, which is cheap and pure),
// so all it offered was a supported way to forge one — the exact bypass the
// brand exists to prevent. If a fixture ever seems to need it, call
// `finalizeStrategyResult` under `provideTestEnvelope` instead.
