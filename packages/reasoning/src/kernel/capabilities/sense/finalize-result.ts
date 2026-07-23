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

/** TEST-ONLY escape hatch for fixtures that need a judged result without a mint run. */
export function __unsafeBrandJudgedForTest(r: ReasoningResult): JudgedReasoningResult {
  return r as JudgedReasoningResult;
}
