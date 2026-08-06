// packages/reasoning/src/kernel/capabilities/sense/finalize-result.ts
//
// The ONLY mint of a JudgedReasoningResult (cascade design §4.2).
//
// "Un-bypassable" is a compiler fact, not a grep-gate promise: the brand
// symbol is module-private, so every strategy exit — early returns, catch
// paths, pause paths — must cross this function or fail to typecheck once
// StrategyFn requires JudgedReasoningResult (Task 5).
//
// Judgment was INERT in Task 3 (computed + recorded, enforced:false). Task 8
// makes it BITE — but only for a wither the user opted into:
//
//   fabricationGuard: "block" + a failed grounding verdict
//     ⇒ status → "failed", output → the honest abstention sentinel,
//       error → the failed-check list, verdict.enforced → true.
//   fabricationGuard: "warn"  ⇒ record only, never flip.
//   nothing configured        ⇒ enforced:false, result byte-identical.
//
// The zero-config invariant is the load-bearing property: `envelope.policy`
// fields are read RAW here, never through `resolveFabricationGuardMode` (whose
// default is "block"). An unconfigured run must not acquire a guard by way of
// the mint.
import { Effect } from "effect";
import {
  deliverableToContent,
  sentinelDeliverable,
  type TaskContract,
} from "@reactive-agents/core";
import type { ReasoningResult } from "../../../types/index.js";
import { entriesOfKind, type RunLedger } from "../../ledger/run-ledger.js";
import { RunEnvelope } from "../../envelope/run-envelope.js";
import { compileRunContract } from "../../contract/run-contract.js";
import { isSideEffectLanded, writtenPathSatisfies, type PostCondition } from "../verify/post-conditions.js";
import { buildStrategyResult } from "./step-utils.js";
import { hasSuccessfulRequiredToolCall } from "../../loop/runner-helpers/grounded-terminal.js";

declare const Judged: unique symbol;
export type JudgedReasoningResult = ReasoningResult & { readonly [Judged]: true };

/**
 * What an ENFORCED run ships instead of the model's ungrounded answer.
 *
 * Deliberately NOT a hand-written string: it is the canonical rendering of the
 * `no_substantive_output` sentinel, whose exact text is pinned in
 * `packages/core/tests/contracts/deliverable.test.ts`. Both abstention sentinels
 * used to fall through to "Task complete." — a run that honestly could not
 * ground an answer told the user it had succeeded. Reusing the renderer here
 * means the enforcement path can never re-open that gap.
 */
const ENFORCED_ABSTENTION_OUTPUT: string = deliverableToContent(
  sentinelDeliverable("no_substantive_output"),
);

/**
 * Is a compiled contract condition satisfied by the run LEDGER?
 *
 * Ledger-only and pure, mirroring `verify()`'s DBC (no fs, no LLM) but reading
 * the append-only fact store rather than re-scanning `steps[]`: at the terminal
 * the ledger is the run's evidence of record.
 */
function conditionMetByLedger(
  condition: PostCondition,
  ledger: RunLedger,
  output: string,
): boolean {
  switch (condition.kind) {
    case "ToolCalled":
      return entriesOfKind(ledger, "tool-result").some(
        (e) => e.success === true && e.toolName === condition.tool,
      );
    case "ArtifactProduced":
      return entriesOfKind(ledger, "artifact").some((e) =>
        writtenPathSatisfies(e.path, condition.path),
      );
    case "OutputContains":
      return output.includes(condition.pattern);
    case "SideEffectLanded":
      return isSideEffectLanded([], ledger);
  }
}

/**
 * The required-tool set the grounding verdict judges against.
 *
 * The strategy's own declaration wins. When it carries NONE, the declared
 * `TaskContract`'s `required` tools stand in — the same cascade law the rest of
 * this design rests on: a strategy cannot drop what it never carries.
 * `direct` is the concrete case (`DirectInput` deliberately has no
 * `requiredTools`, so it hard-codes `[]` at the mint); without this fallback a
 * user who declared `.withContract({tools:[{kind:"required",…}]})` AND
 * `.withFabricationGuard("block")` would get enforcement on plan-execute and
 * silence on direct, purely because of an input-interface omission.
 *
 * Zero-config is untouched: with no `.withContract()` this returns exactly what
 * the strategy passed.
 */
function requiredToolsForJudgment(
  declared: readonly string[] | undefined,
  taskContract: TaskContract | undefined,
): readonly string[] {
  if (declared !== undefined && declared.length > 0) return declared;
  return (taskContract?.tools ?? [])
    .filter((t) => t.kind === "required" && typeof t.name === "string" && t.name.length > 0)
    .map((t) => t.name);
}

/**
 * Judge the declared TaskContract against the run's ledger evidence.
 *
 * Only the DETERMINISTIC side is judged — the contract's `postConditions` floor.
 * The `answer` requirement (acceptance `self-critique`) carries no condition and
 * is therefore not judged here; a checker/judge tier owns it.
 *
 * INFORMATIONAL in Task 8: the result lands on `verdict.contractSatisfied` and
 * nothing else. It is deliberately NOT pushed onto `failed`, because `failed`
 * is the enforcement basis under `fabricationGuard: "block"` and the contract
 * wither must not acquire flip authority as a side effect of being recorded.
 */
function judgeContractSatisfied(
  taskContract: TaskContract,
  requiredTools: readonly string[] | undefined,
  ledger: RunLedger | undefined,
  output: unknown,
): boolean {
  // Defensive read: `prompt` is declared `string` and every PRODUCTION producer
  // does supply it — the reachable partial-contract sources are test fixtures
  // that only compile because `packages/reasoning/tsconfig.json` excludes
  // `tests/**` from typecheck. The guard stays anyway: `compileRunContract`
  // regexes the prose, so an absent prompt would throw INSIDE the terminal mint
  // — the one place in the codebase that must never fail a run it is merely
  // judging — and the mint is also reachable from untyped JSON round-trips of a
  // persisted envelope. Cost is one `typeof`; blast radius is a crashed run.
  const prompt = typeof taskContract.prompt === "string" ? taskContract.prompt : "";
  const compiled = compileRunContract(prompt, {
    ...(requiredTools !== undefined && requiredTools.length > 0 ? { requiredTools } : {}),
    taskContract,
  });
  const outputText = typeof output === "string" ? output : "";
  const entries = ledger ?? [];
  return compiled.postConditions.every((c) => conditionMetByLedger(c, entries, outputText));
}

/**
 * The terminal metadata an ENFORCED abstention must carry.
 *
 * The enforced re-mint spreads `...params`, so the pre-enforcement
 * `extraMetadata.terminatedBy` survived it: a run flipped to `status:"failed"`
 * still reported `terminatedBy: "final_answer"`, which
 * `resolveGoalAchieved` (`runtime/src/builder/helpers.ts`) maps to `true` and
 * `local-learning.ts` counts as a non-failure. An honest abstention would have
 * surfaced downstream as an achieved goal.
 *
 * `"abstained"` is the existing legal `TerminatedBy` literal for exactly this
 * terminal ("agent honestly declined — could not ground an answer"), and it is
 * the value `deriveGoalAchieved` maps to `false`. `rawTerminatedBy` — the open
 * string channel — is overridden only when the relayed metadata actually
 * carried one, so nothing is invented on results that never had it.
 *
 * Non-enforced results never reach here: the caller passes `params.extraMetadata`
 * through untouched.
 */
function enforcedTerminalMetadata(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> {
  return {
    ...extra,
    terminatedBy: "abstained",
    ...(extra?.rawTerminatedBy !== undefined ? { rawTerminatedBy: "abstained" } : {}),
  };
}

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

    // RAW read — no `resolveFabricationGuardMode` here. That resolver defaults
    // to "block" (and consults RA_FABRICATION_GUARD), which is correct for the
    // in-loop verifier check but would silently arm the terminal on every
    // zero-config run.
    const guard = envelope.policy.fabricationGuard;

    const requiredTools = requiredToolsForJudgment(
      params.requiredTools,
      envelope.policy.taskContract,
    );

    const failed: string[] = [];
    let groundedOnRequired: boolean | undefined;
    if (requiredTools.length > 0) {
      groundedOnRequired = hasSuccessfulRequiredToolCall(params.steps, requiredTools);
      // `"off"` is an explicit opt-OUT, not "configured". Recording under it
      // was inert while the flip required `=== "block"`, but `failed` IS the
      // enforcement basis now — leaving it would put an opt-out one predicate
      // edit away from enforcing. The union is closed
      // (`FabricationGuardMode = "off" | "warn" | "block"`), so naming the two
      // recording modes keeps this exhaustive by construction.
      if (!groundedOnRequired && (guard === "warn" || guard === "block")) {
        failed.push("grounding-on-required");
      }
    }

    const contractSatisfied =
      envelope.policy.taskContract !== undefined
        ? judgeContractSatisfied(
            envelope.policy.taskContract,
            requiredTools,
            params.runLedger,
            base.output,
          )
        : undefined;

    const repairGaps =
      params.repairCapabilities && !params.repairCapabilities.perIteration
        ? ["per-iteration"]
        : undefined;

    // ── Enforcement (the only behavior change in the cascade) ────────────────
    //
    // Four fences, each one a case a naive `guard === "block" && !grounded`
    // would get wrong:
    //
    //  1. PAUSED runs. A HITL/interaction pause has by construction not yet
    //     called the required tool. Flipping it would turn every approval gate
    //     under `.withFabricationGuard("block")` into a failed run and drop the
    //     resume rails (the fe5dc93b defect class, from the other direction).
    //  2. ALREADY-FAILED runs. The result is already honest; overwriting its
    //     output/error would destroy the real provider cause and buy nothing.
    //  3. `failed` empty. Covers "no wither configured" (nothing is ever pushed
    //     without a guard) AND "no requiredTools declared" (nothing to ground
    //     against) in one condition, so both stay untouched by construction.
    //  4. AUXILIARY passes (`envelope.policy.auxiliaryPass`). A pass whose
    //     grounding evidence lives in a SIBLING pass — the verification THINK
    //     retry (`availableTools: []`, so it cannot call a tool at all) and the
    //     post-think continuation passes — is a fragment of a run, not its
    //     terminal. Judging it as a terminal flips a correct, tool-grounded
    //     answer to the abstention sentinel: the run reports an honest-sounding
    //     "I could not ground an answer" for a run that did (review C1). The
    //     verdict is still computed and recorded (`auxiliaryPass: true` names
    //     WHY it did not bite); only the flip is fenced. Enforcement on genuine
    //     terminal passes is untouched — no strategy can set this flag, only the
    //     two builders that construct a fragment.
    //
    // Fence 1 reads the BUILT result, not `params`. Reading `params.pause` /
    // `params.kernelMeta` alone missed a live route: `adaptive` re-mints its
    // sub-strategy's result and relays the pause descriptors through
    // `extraMetadata` ONLY (adaptive.ts §"Durable pause rails"), passing
    // neither. A paused adaptive run under `.withFabricationGuard("block")`
    // was therefore flipped to `status:"failed"` with the abstention sentinel
    // replacing the pause message — the fe5dc93b defect class this cascade
    // exists to eliminate. `buildStrategyResult` merges `extraMetadata` AND
    // `pauseRailMetadata(pause ?? kernelMeta)` into `metadata`, so one read of
    // the built metadata covers all three routes and cannot be dropped by a
    // future relay path. `params.pause` stays in the disjunction because a
    // `KernelPause` may legitimately carry neither descriptor.
    // `metadata` is statically the closed `ReasoningMetadata` struct; the pause
    // rails ride the runtime object, so read them off a Record view (the same
    // narrowing `adaptive.ts` and `execution-engine.ts` use).
    const baseMetadata = base.metadata as Record<string, unknown>;
    const paused =
      params.pause !== undefined ||
      baseMetadata.awaitingApprovalFor !== undefined ||
      baseMetadata.awaitingInteractionFor !== undefined;
    const auxiliary = envelope.policy.auxiliaryPass === true;
    const enforced =
      guard === "block" &&
      failed.length > 0 &&
      !paused &&
      !auxiliary &&
      base.status !== "failed";

    const verdict = {
      enforced,
      ...(groundedOnRequired !== undefined ? { groundedOnRequired } : {}),
      ...(contractSatisfied !== undefined ? { contractSatisfied } : {}),
      failed,
      ...(auxiliary ? { auxiliaryPass: true } : {}),
      ...(repairGaps ? { repairGaps } : {}),
    };

    // Re-mint through `buildStrategyResult` rather than patching `base`, so the
    // enforced result picks up the SAME derivations every other result gets
    // (output sanitation, the HS-106 output/status coherence guard, the
    // status-derived confidence, the pause-rail forwarding). Patching would
    // have left `confidence: 0.8` on a failed run.
    const finalBase = enforced
      ? buildStrategyResult({
          ...params,
          output: ENFORCED_ABSTENTION_OUTPUT,
          status: "failed",
          error: failed.join("; "),
          extraMetadata: enforcedTerminalMetadata(params.extraMetadata),
        })
      : base;

    const judged: ReasoningResult = {
      ...finalBase,
      metadata: { ...finalBase.metadata, verdict },
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
