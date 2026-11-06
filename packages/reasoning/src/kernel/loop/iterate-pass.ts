// File: src/kernel/loop/iterate-pass.ts
/**
 * Per-iteration body of `runKernel()` — lifted from `runner.ts` in WS-6 Phase 4
 * (2026-05-29) so runner.ts can return to "orchestrator only" scope.
 *
 * SCOPE
 * -----
 * One invocation = one pass through the while-loop body that used to live
 * inline in `runKernel()`. The outer while-loop condition + pre-loop setup +
 * post-loop finalization stay in `runner.ts`. This function owns ONLY what
 * happens between the opening `while (...)` brace and its closing `}`.
 *
 * SHAPE
 * -----
 * Operation list + immutable cfg + control-signal (Plan 9 Phase 4).
 *   - The pass is the ordered operation list `KERNEL_TURN_OPERATIONS`
 *     (`./turn-operations.ts`): each named operation declares the state slices
 *     it reads and writes, and `runKernelTurn` runs them in order until one
 *     ends the pass. The order lives in that ONE array (pinned).
 *   - Implementations: the unanchored operations in `turn-operations.ts`
 *     (`SEAM_TURN_OPERATIONS`); the guard and control operations whose bodies
 *     the CI gates content-match in `turn-guard-operations.ts`
 *     (`GUARD_TURN_OPERATIONS`).
 *   - The run ends only through the exit gate (`./exit-gate.ts`): an operation
 *     proposes and returns the gate's disposition; `runKernelTurn` maps it to
 *     the pass signal. No operation returns `"break"` (pinned).
 *   - `IterationConfig`: immutable per-run inputs (kernel, hooks, services,
 *     profile, verifier, etc.).
 *   - `IterationCarrier`: a MUTABLE holder for the spine locals that survive
 *     across iterations (counters, currentInput/Options/Context, switchCount,
 *     triedStrategies, mutableScratchpad) or are read by post-loop code. The
 *     driver copies it into a per-pass `TurnScope` at entry; the operations
 *     mutate the scope, and the driver writes the carrier fields back EXACTLY
 *     ONCE after the turn settles (W4.0 single-writer). There is no per-return
 *     `sync()` to forget: every exit path returns through the one write-back.
 *   - Return `"continue"` | `"break"` — outer while honors the signal.
 *
 * INVARIANTS PRESERVED (do not violate)
 * -------------------------------------
 *   1. Single-owner termination: `terminate(state, ...)` is the only writer
 *      of state.status to "done"/"failed" outside `kernel-state.ts`; the turn
 *      operations reach it only through the exit gate. No new state.status writers.
 *   2. transitionState() discipline: every state mutation routes through
 *      `transitionState(state, patch)`. ESLint enforces.
 *   3. Loop-detector streak rule (`detectLoop` at IC-1): only ACTION steps
 *      reset `maxConsecutiveThoughts`. Observations do NOT. The `detectLoop()`
 *      call stays in the loop-detection operation; resolution moved to
 *      `resolveDetectedLoop`.
 *   4. No LLM re-verify (M3 REWORK precedent): the verifier emit in the stall
 *      step is emit-only — no retry; the post-loop §9.0 gate is the sole
 *      consumer of rejection.
 *   5. Phase-chain ordering (sense → attend → comprehend → recall → reason →
 *      decide → act → verify → reflect → learn) is preserved by the fixed
 *      operation order; extracting a block doesn't change where it runs.
 *
 * HISTORY
 * -------
 *   - WS-6 Phase 2 (2026-05-28): runner.ts 1976 → 1615 via four helper buckets
 *     (tier-guards, deliverable, recovery-steering, state-queries) under
 *     `runner-helpers/`. Phase 2 UpwardReport flagged iteration-block lift as
 *     the highest-leverage remaining reduction.
 *   - WS-6 Phase 4 (2026-05-29): iteration body lifted whole into this file via
 *     a mechanical carrier/sync scaffold (relocation, not decomposition).
 *   - WS-6 CORRECTION 5 (2026-05-29): replaced the scaffold's LOC-theater with
 *     real cohesion — extracted the three F2-named coupling blocks (strategy
 *     switch, stall/deliverable, loop resolution) into named phase-steps with
 *     immutable state threading + explicit counter params. Carrier reduced.
 *   - W4.0 (2026-10-13): single-writer refactor. The 18 manual per-return
 *     `sync()` call sites + the `sync` closure were replaced by a generator
 *     return-protocol: the body is one inner `Effect.gen` returning
 *     `IterationSignal`, and the carrier write-back happens exactly once, after
 *     it settles (unconditional — the inner effect's error channel is `never`).
 *     "Forgot to sync" is now unrepresentable. Behavior byte-identical.
 *   - Plan 9 Phase 4 stage 1 (2026-11-05): the inner body became the ordered
 *     operation list (`turn-operations.ts`); unanchored groups moved there
 *     verbatim, anchored ones stayed here as named operations. Behavior identical.
 *   - Plan 9 Phase 4 stage 2 (2026-11-05): every run-ending operation proposes
 *     to the exit gate (harness ends as harness-authority proposals the gate
 *     accepts as before); the anchored operations moved to
 *     `turn-guard-operations.ts` with the gate scripts. Behavior identical.
 *
 * Spec: wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md §3 line 468 + §5.5a.
 */
import { Effect } from "effect";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ContextProfile } from "../../context/context-profile.js";
import type { StrategyServices } from "../../kernel/utils/service-utils.js";
import type {
  KernelState,
  KernelContext,
  KernelInput,
  KernelRunOptions,
  ThoughtKernel,
  KernelHooks,
} from "../../kernel/state/kernel-state.js";
import type { HorizonProfile } from "./runner-helpers/horizon-profile.js";
import type { Verifier } from "../../kernel/capabilities/verify/verifier.js";
import type { TierGuardConfig } from "./runner-helpers/tier-guards.js";
import {
  SEAM_TURN_OPERATIONS,
  openTurnScope,
  runKernelTurn,
  type TurnOperationImpls,
} from "./turn-operations.js";
import { GUARD_TURN_OPERATIONS } from "./turn-guard-operations.js";

/**
 * Outer-loop control signal returned by `runIterationPass`.
 *
 *   - `"continue"` — the outer while loop should re-evaluate its condition and
 *     run another pass (the original body's fall-through OR an explicit
 *     `continue;` site).
 *   - `"break"` — the outer while loop should exit immediately: the exit gate
 *     accepted (or handed off) an operation's exit proposal.
 */
export type IterationSignal = "continue" | "break";

/**
 * Mutable carrier — every field round-trips through one `runIterationPass`
 * invocation. Fields fall into two groups:
 *   (a) survive across iterations (counters, currentInput/Options/Context,
 *       switch tracking, autoCheckpointed, mutableScratchpad — a Map whose
 *       identity is preserved across iterations)
 *   (b) read by the post-loop finalization in runner.ts (state, currentInput,
 *       currentOptions)
 *
 * Fields are mutated in-place; `runIterationPass` doesn't return a fresh
 * carrier. The write-back happens ONCE per pass — after the turn settles — so
 * every exit path (each `"break"` / `"continue"`) observes the
 * same up-to-date values. Keeps the call site in runner.ts tiny:
 *   `const signal = yield* runIterationPass(carrier, cfg); if (signal === "break") break;`
 */
export interface IterationCarrier {
  state: KernelState;
  currentInput: KernelInput;
  currentOptions: KernelRunOptions;
  currentContext: KernelContext;
  /** Track tool calls per iteration by scanning new action steps since last check. */
  prevActionCount: number;
  /** Cursor for reactive-observer entropy delta (separate from learn cursor). */
  prevStepCount: number;
  /** Per-iter diff cursor for LearningPipeline.write() — observations slice. */
  prevStepCountForLearn: number;
  /** Per-iter diff cursor for LearningPipeline.write() — decisions slice. */
  prevDecisionLogCountForLearn: number;
  /** Total deliverable artifacts seen on the previous iteration (stall detection). */
  prevArtifactCount: number;
  /** Consecutive iterations with no new non-meta tool results. */
  consecutiveStalled: number;
  /** Times the harness redirected the model back to required tools. */
  requiredToolRedirects: number;
  /** Total nudge budget consumed (stall + loop paths combined). */
  requiredToolNudgeCount: number;
  /** Times the harness redirected after a tool path failed. */
  failureRecoveryRedirects: number;
  /** Number of strategy switches completed so far. */
  switchCount: number;
  /** Strategy names tried so far (initial + switches), in order. */
  triedStrategies: string[];
  /** True once auto-checkpoint has fired this run (fires at most once). */
  autoCheckpointed: boolean;
  /** Mirror of state.scratchpad kept across iterations (Map identity stable). */
  mutableScratchpad: Map<string, string>;
}

/**
 * Immutable per-run configuration — every field is set before the while loop
 * starts in runner.ts and never reassigned inside the iteration body.
 */
export interface IterationConfig {
  /** The strategy's ThoughtKernel — invoked once per iteration. */
  kernel: ThoughtKernel;
  /** Hooks bundle — runner.ts builds once from the EventBus. */
  hooks: KernelHooks;
  /** Resolved services bundle (LLM, ToolService, EventBus, RecallService, ...). */
  services: StrategyServices;
  /** Resolved context profile (tier-aware + calibration-aware). */
  profile: ContextProfile;
  /** Tier guard thresholds (tokenDeltaThreshold + oracleNudgeLimit + ...). */
  tierGuards: TierGuardConfig;
  /** Loop detector — max distinct same-tool calls. */
  maxSameTool: number;
  /** Loop detector — max repeated identical thoughts. */
  maxRepeatedThought: number;
  /** Loop detector — max consecutive thoughts without an action between. */
  maxConsecutiveThoughts: number;
  /** Required-tools floor from input (or empty array). */
  requiredTools: readonly string[];
  /** Cap on redirect attempts when required tools weren't called. */
  maxRequiredToolRetries: number;
  /** Cap on harness nudges injected to satisfy required tools. */
  maxRequiredToolNudges: number;
  /** Cap on recovery-steering redirects when a tool path fails. */
  maxFailureRecoveryRedirects: number;
  /** Verifier instance — defaultVerifier unless input overrode. */
  verifier: Verifier;
  /** Original options the kernel was invoked with (used by strategy switching). */
  options: KernelRunOptions;
  /** Original context built pre-loop (used as base when switching strategies). */
  context: KernelContext;
  /** The KernelInput used to seed the kernel (carries harnessPipeline + originals). */
  effectiveInput: KernelInput;
  /** The raw KernelInput parameter (used by dispatcher-early-stop arbitration). */
  input: KernelInput;
  /** Closure-bound log emit — re-created in runner.ts and threaded through. */
  emitLog: (event: LogEvent) => Effect.Effect<void, never>;
  /**
   * A2 — resolved long-horizon guard scaling, or `undefined` when the profile
   * is off. When present, the stall threshold + oracle nudge limit scale with
   * `maxIterations`; when absent every read below keeps its literal.
   */
  horizon?: HorizonProfile;
}

const TURN_OPERATIONS: TurnOperationImpls = { ...SEAM_TURN_OPERATIONS, ...GUARD_TURN_OPERATIONS };

/**
 * Run one iteration of the kernel main loop — the DRIVER.
 *
 * Copies the mutable {@link IterationCarrier} into a per-pass `TurnScope`, runs
 * the operation list (`runKernelTurn` over `KERNEL_TURN_OPERATIONS`), and writes
 * the carrier fields back EXACTLY ONCE after the turn settles (W4.0
 * single-writer; the turn's error channel is `never`).
 *
 * Returns the outer-loop control signal:
 *   - `"break"`    — the exit gate ended the run this iteration; exit loop.
 *   - `"continue"` — re-run the loop body (an explicit short-circuit OR the
 *                    body fall-through at the end of a normal iteration).
 */
export function runIterationPass(
  carrier: IterationCarrier,
  cfg: IterationConfig,
): Effect.Effect<IterationSignal, never, LLMService> {
  return Effect.gen(function* () {
    const t = openTurnScope(carrier);
    const signal = yield* runKernelTurn(t, cfg, TURN_OPERATIONS);

    // ── Single-writer write-back — the ONLY place the pass reaches the carrier ──
    // Runs once per pass, unconditionally after the turn settles (every
    // exit path: both "break" and "continue"). The outer while loop re-reads
    // the carrier on each pass and the post-loop finalization reads
    // carrier.{state,currentInput,currentOptions}, so these must be current.
    // (triedStrategies / mutableScratchpad are reference-stable, mutated in place.)
    carrier.state = t.state;
    carrier.currentInput = t.currentInput;
    carrier.currentOptions = t.currentOptions;
    carrier.currentContext = t.currentContext;
    carrier.prevActionCount = t.prevActionCount;
    carrier.prevStepCount = t.prevStepCount;
    carrier.prevStepCountForLearn = t.prevStepCountForLearn;
    carrier.prevDecisionLogCountForLearn = t.prevDecisionLogCountForLearn;
    carrier.prevArtifactCount = t.prevArtifactCount;
    carrier.consecutiveStalled = t.consecutiveStalled;
    carrier.requiredToolRedirects = t.requiredToolRedirects;
    carrier.requiredToolNudgeCount = t.requiredToolNudgeCount;
    carrier.failureRecoveryRedirects = t.failureRecoveryRedirects;
    carrier.switchCount = t.switchCount;
    carrier.autoCheckpointed = t.autoCheckpointed;

    return signal;
  });
}
