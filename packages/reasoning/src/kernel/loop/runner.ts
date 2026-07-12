/**
 * shared/kernel-runner.ts — Universal execution loop for all reasoning strategies.
 *
 * Replaces the duplicated while-loops in reactive.ts and react-kernel.ts with a
 * single `runKernel()` function. Every strategy defines a `ThoughtKernel` (one step
 * of reasoning) and hands it to `runKernel()` which handles:
 *
 *   1. Service resolution (LLM, ToolService, EventBus via Effect.serviceOption)
 *   2. Profile merging (input.contextProfile over CONTEXT_PROFILES["mid"])
 *   3. KernelHooks construction from EventBus
 *   4. Immutable KernelContext assembly (frozen for entire execution)
 *   5. Main loop: call kernel repeatedly until done/failed/maxIterations
 *   6. Terminal hooks: onDone / onError
 */
import { Effect, Ref } from "effect";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService, DEFAULT_CAPABILITIES, selectAdapter } from "@reactive-agents/llm-provider";
import { modelSynthesisDeliverable, harnessSynthesisDeliverable, sentinelDeliverable } from "@reactive-agents/core";
import { createToolCallResolver, selectToolCallingDriver, REQUEST_USER_INPUT_TOOL_NAME, scratchpadStoreRef } from "@reactive-agents/tools";
import { CONTEXT_PROFILES, applyCapabilityMaxTokens } from "../../context/context-profile.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { resolveStrategyServices } from "../../kernel/utils/service-utils.js";
import { buildKernelHooks } from "../../kernel/state/kernel-hooks.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelMessage,
  type KernelRunOptions,
  type ThoughtKernel,
} from "../../kernel/state/kernel-state.js";
import { runPhaseHooks, killswitchTerminatedBy } from "./phase-hooks.js";
import { gatewayComplete } from "../llm-gateway.js";
import { extractThinkingSafeContent } from "../../kernel/utils/stream-parser.js";
import { buildSuccessfulToolCallCounts } from "../../kernel/capabilities/verify/requirement-state.js";
import { extractOutputFormat, nominateRequiredTools, type TaskIntent } from "../../kernel/capabilities/comprehend/task-intent.js";
import { defaultVerifier, resolveResultSeverity, verifyAndEmit } from "../../kernel/capabilities/verify/verifier.js";
import { authorityOf } from "../../kernel/capabilities/decide/authority.js";
import { deriveConditions } from "../../kernel/capabilities/verify/derive-conditions.js";
import { compileRunContract } from "../../kernel/contract/run-contract.js";
import { classifyTask } from "../../kernel/capabilities/comprehend/task-classification.js";
import {
  applyExplicitOverrides,
  compileHarnessPlan,
  type PlanStrategy,
} from "../../kernel/policy/harness-plan.js";
import { emitContractCompiled, emitGuardFired, emitKernelStateSnapshot } from "../../kernel/utils/diagnostics.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildFinalAnswerCandidate,
  finalizeOutput,
  buildSynthesisPrompt,
  type FinalizedOutput,
} from "./output-synthesis.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { terminate } from "./terminate.js";
import { decideForcedAbstention } from "./runner-helpers/force-abstention.js";
import {
  TERMINAL_ANSWER_REASONS,
  hasSuccessfulSubstantiveToolCall,
} from "./runner-helpers/grounded-terminal.js";

// ── WS-6 Phase 2 — helper bucket imports ──────────────────────────────────────
// Tier-aware guard thresholds, deliverable assembly, recovery steering, and
// state-query helpers all moved to ./runner-helpers/<bucket>.ts. Re-exports
// below keep `kernel/loop/runner.js` as the stable import surface for callers
// (output-quality-gate.test.ts, tier-guard-config.test.ts, strategies/*).
import {
  TIER_GUARD_THRESHOLDS,
  resolveMaxSameTool,
} from "./runner-helpers/tier-guards.js";
import {
  resolveHorizonProfile,
  type HorizonProfile,
} from "./runner-helpers/horizon-profile.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import { decideGroundingBlockOutcome } from "./runner-helpers/grounding-block.js";
import {
  assembleDeliverable,
  commitDeliverable,
  passthroughOutputDeliverable,
  deliverableTerminationReason,
  countDeliverableCandidates,
  countArtifacts,
  buildEffectiveToolsUsed,
} from "./runner-helpers/deliverable.js";

// WS-6 Phase 4 (2026-05-29) — per-iteration body lifted to iterate-pass.ts.
// The outer while loop stays here; the body invokes runIterationPass() once
// per pass and honors the control signal it returns.
import {
  runIterationPass,
  type IterationCarrier,
  type IterationConfig,
} from "./iterate-pass.js";
import { handleActing } from "../capabilities/act/act.js";
import { makeStep } from "../capabilities/sense/step-utils.js";

// Re-export the public helper surface so external imports of
// `kernel/loop/runner.js` remain unchanged.
export { assembleDeliverable, commitDeliverable } from "./runner-helpers/deliverable.js";
// P1 mission 2A: the Deliverable TYPE is now the canonical 4-source contract
// owned by @reactive-agents/core. Re-exported here so external callers that
// import it from `kernel/loop/runner.js` keep working.
export type { Deliverable } from "@reactive-agents/core";
export {
  TIER_GUARD_THRESHOLDS,
  shouldExitOnLowDelta,
  shouldForceOracleExit,
  resolveMaxSameTool,
} from "./runner-helpers/tier-guards.js";
export type { TierGuardConfig } from "./runner-helpers/tier-guards.js";

// ── Durable HITL resume re-entry (Phase D) ────────────────────────────────────

/** How a resumed run re-enters at a pending approval gate. */
export interface ApprovalReentry {
  readonly action: "execute" | "observe" | "none";
  readonly call?: { readonly name: string; readonly arguments: unknown };
  readonly observation?: string;
}

/**
 * Map a stored approval gate + the human's decision to a re-entry action. Pure:
 * approved → execute the EXACT stored call (no LLM re-think, so the executed call
 * is the one the human saw — spec §7 determinism); denied → observe the denial so
 * the next think reacts; gateId mismatch → no-op (fall through to normal think).
 */
export function resolveApprovalReentry(
  gate: { readonly gateId: string; readonly toolName: string; readonly args: unknown },
  decision: { readonly gateId: string; readonly status: "approved" | "denied"; readonly reason?: string } | undefined,
): ApprovalReentry {
  if (!decision || decision.gateId !== gate.gateId) return { action: "none" };
  if (decision.status === "approved") {
    return { action: "execute", call: { name: gate.toolName, arguments: gate.args } };
  }
  return {
    action: "observe",
    observation: `Action ${gate.toolName} was denied by a human${
      decision.reason ? `: ${decision.reason}` : ""
    }.`,
  };
}

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Execute a ThoughtKernel in a loop until it reaches "done", "failed", or
 * exhausts `maxIterations`.
 *
 * This is the **universal execution loop** — every reasoning strategy delegates
 * to this function instead of implementing its own while-loop.
 */
export function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // ── 1. Resolve services ──────────────────────────────────────────────────
    const services = yield* resolveStrategyServices;
    const { toolService, eventBus, memoryService } = services;

    // ── Resolve provider capabilities ONCE ───────────────────────────────────
    // Both the ToolCallResolver injection (below) and the tool-calling driver
    // selection (step 4) key on `supportsToolCalling` so they cannot diverge.
    // 482c11e4 keyed the driver on calibration (`toolCallDialect`) while the
    // resolver stayed keyed on capability — a capable-but-uncalibrated model then
    // got a NativeFCStrategy resolver AND a text-parse driver, no native tools
    // were sent, and its `<tool_call>` text was never extracted (loop to
    // max-iterations). Capability is the single master signal.
    // See wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md.
    let effectiveInput = input;
    let providerSupportsToolCalling = true; // unknown ⇒ assume capable (native + think.ts no-resolver fallback handles it; pre-482c11e4 default)
    {
      const llmOpt = yield* Effect.serviceOption(LLMService);
      if (llmOpt._tag === "Some" && typeof llmOpt.value.capabilities === "function") {
        const caps = yield* llmOpt.value.capabilities().pipe(
          Effect.catchAll(() => Effect.succeed(DEFAULT_CAPABILITIES)),
        );
        providerSupportsToolCalling = caps.supportsToolCalling;
        if (caps.supportsToolCalling && !input.toolCallResolver) {
          const resolver = createToolCallResolver(caps);
          effectiveInput = { ...input, toolCallResolver: resolver };
        }
      }
    }

    // ── 2. Build profile ─────────────────────────────────────────────────────
    // Ollama providers default to "local" tier (maxSameTool=2) unless an
    // explicit contextProfile.tier has been set by the caller.
    const defaultTier =
      effectiveInput.providerName === "ollama" && !effectiveInput.contextProfile?.tier
        ? "local"
        : "mid";
    const baseProfile: ContextProfile = effectiveInput.contextProfile
      ? ({ ...CONTEXT_PROFILES[defaultTier], ...effectiveInput.contextProfile } as ContextProfile)
      : CONTEXT_PROFILES[defaultTier];

    // ── Calibration-aware profile overrides ──────────────────────────────────
    // selectAdapter may return profileOverrides sourced from a ModelCalibration
    // (e.g., optimalToolResultChars). Apply these once up-front so every phase
    // sees calibrated values via KernelContext.profile.
    const { profileOverrides } = selectAdapter(
      { supportsToolCalling: true },
      baseProfile.tier,
      effectiveInput.modelId,
    );
    const mergedProfile: ContextProfile = profileOverrides
      ? ({ ...baseProfile, ...profileOverrides } as ContextProfile)
      : baseProfile;
    // S1.4 — derive the effective context window from the model Capability
    // unless the caller explicitly set contextProfile.maxTokens (their value
    // wins). Without this, local tier stays at the 32K placeholder while
    // Ollama silently truncates at the model's real num_ctx (cogito:14b=8192).
    const profile: ContextProfile = applyCapabilityMaxTokens(
      mergedProfile,
      effectiveInput.providerName,
      effectiveInput.modelId,
      effectiveInput.contextProfile?.maxTokens,
    );

    // ── 3. Build hooks ───────────────────────────────────────────────────────
    const hooks = buildKernelHooks(eventBus);

    // ── 4. Build KernelContext ────────────────────────────────────────────────
    // Select tool-calling driver from the SAME capability signal as the resolver
    // injection above. Capable (or unknown) ⇒ native driver (resolver present,
    // tools attached — the coherent triple). Only a provider that explicitly
    // reports `supportsToolCalling === false` gets the text-parse driver.
    const toolCallingDriver = selectToolCallingDriver(
      effectiveInput.calibration?.toolCallDialect,
      providerSupportsToolCalling,
    );

    const context: KernelContext = {
      input: effectiveInput,
      profile,
      compression: effectiveInput.resultCompression ?? {
        budget: profile.toolResultMaxChars ?? 800,
        previewItems: profile.toolResultPreviewItems ?? 5,
        autoStore: true,
        codeTransform: true,
      },
      toolService,
      hooks,
      toolCallingDriver,
      memoryService,
    };

    // ── 5. Extract task intent for output quality gate ─────────────────────
    const taskIntent = extractOutputFormat(effectiveInput.task);

    // ── 5b. Nominate plausibly-required tools (HS-115 / Audit G-E) ─────────
    // Pure keyword-cue match against this run's available tool surface. Names
    // are always real (no phantoms). The runner seeds meta.nominatedTools;
    // act/guard.ts consumes it as a required-tool floor when input.requiredTools
    // is empty. Same-commit emit+consumer per North Star §9 (anti-scaffold F4/F5).
    const nominatedTools = nominateRequiredTools(
      effectiveInput.task,
      effectiveInput.availableToolSchemas ?? [],
    );

    // ── 6. Create initial state ──────────────────────────────────────────────
    const baseState = initialKernelState(options);
    // P6a todo rail (2026-07-07): the todo meta-tool persists its list in the
    // shared scratchpad under `_todo:<taskId>`; that Ref outlives runs in the
    // same process, so a fresh (non-resume) run must clear its own key or it
    // inherits a prior run's checklist.
    if (!effectiveInput.resumeState) {
      yield* Ref.update(scratchpadStoreRef, (m) => {
        m.delete(`_todo:${effectiveInput.taskId ?? "default"}`);
        return m;
      });
    }
    // Durable resume (Phase C): a fully-restored checkpoint state wins over the
    // fresh seed. It is already a complete KernelState (iteration/steps/scratchpad/
    // toolsUsed/meta/tokens preserved) so it is used VERBATIM — NOT passed through
    // transitionState. Otherwise seed messages from input.initialMessages if
    // provided (e.g. chat history injection) onto the fresh base state.
    let state = effectiveInput.resumeState
      ? effectiveInput.resumeState
      : effectiveInput.initialMessages?.length
        ? transitionState(baseState, { messages: effectiveInput.initialMessages })
        : baseState;
    // Seed environmentContext onto state so project()/fromKernelState can
    // reproduce the Environment block (incl. caller custom fields). It lives on
    // KernelInput (react-kernel.ts:193) but was never copied to state, so under
    // RA_ASSEMBLY custom caller env fields dropped (subkernel-env-threading regression).
    if (effectiveInput.environmentContext) {
      state = transitionState(state, { environmentContext: effectiveInput.environmentContext });
    }
    // HS-115 — seed nominated tools BEFORE other meta-merging blocks so
    // subsequent meta updates compose cleanly. Skipped when no nominations
    // were produced to avoid spurious meta churn.
    if (nominatedTools.length > 0) {
      state = transitionState(state, {
        meta: { ...state.meta, nominatedTools },
      });
    }
    // Issue #128 — seed declarative budget limits onto state.meta so the
    // Arbitrator's pre-intent guard can derive a BudgetSignal each iteration
    // via arbitrationContextFromState(). No-op when no limits declared.
    if (effectiveInput.budgetLimits) {
      state = transitionState(state, {
        meta: { ...state.meta, budgetLimits: effectiveInput.budgetLimits },
      });
    }
    // HS-128 FOLLOWUP-A — seed the resolved profile.maxTokens onto state.meta
    // once at kernel-start so the verbosity-detector caller in
    // kernel/capabilities/reflect/reactive-observer.ts derives the correct
    // tier-scaled baseline (profileMaxTokens/64) instead of the helper's
    // local-only fallback (32_768). Seed-once / read-anywhere — the runner
    // never re-seeds this field on later iterations.
    if (profile.maxTokens !== undefined) {
      state = transitionState(state, {
        meta: { ...state.meta, profileMaxTokens: profile.maxTokens },
      });
    }
    // PostCondition spine — derive the run's state-grounded success conditions
    // ONCE here (deterministic, NO LLM, NO fs) and store on state.meta so BOTH
    // gates read the SAME set: the Arbitrator's mid-loop steer gate (via
    // arbitrationContextFromState) and the terminal hard-stop in terminate().
    // Sprint-1 A4 (2026-06-02): unconditional. Derived from
    // effectiveInput.requiredTools + the task text; conservative — empty set
    // falls back to the prose verdict.
    {
      const derived = deriveConditions(
        effectiveInput.task,
        effectiveInput.requiredTools ?? [],
      );
      if (derived.length > 0) {
        state = transitionState(state, {
          meta: { ...state.meta, postConditions: derived },
        });
      }
    }

    // The horizon profile the A2 guard bundle resolves from. Defaults to the
    // wither-set `options.horizonProfile` (byte-identical); the adaptive-harness
    // plan below may set it from `contract.horizon` when `.withAdaptiveHarness()`
    // is on (an explicit `.withLongHorizon()` still wins — see the override).
    let effectiveHorizonProfile: "long" | undefined = options.horizonProfile;

    // RunContract (meta-loop Phase 4a) — compile the run's goal ONCE here, at the
    // FIRST node of the meta-loop DAG, from task inputs only (task prose +
    // required tools + comprehend classification; no loop state). Deterministic
    // FLOOR — no LLM. Emitted as one replayable `contract-compiled` trace event.
    // B1 wires the compile + emission (observability, behavior-neutral); B2/4b
    // wire the consumers (terminal gate check 2.5, receipts, projector).
    {
      const runContract = compileRunContract(effectiveInput.task, {
        requiredTools: effectiveInput.requiredTools ?? [],
        // C2 ruling: RunContract absorbs the declared TaskContract — its
        // required/forbidden tools + outputShape become requirements +
        // constraints. Threaded from the runtime layer (KernelInput.taskContract);
        // absent on strategies/callers that do not populate it.
        ...(effectiveInput.taskContract !== undefined
          ? { taskContract: effectiveInput.taskContract }
          : {}),
      });
      // B2: store the compiled contract on state.meta so the CONSUMERS reach it
      // (terminal gate check 2.5, receipt deliverables). Frozen + JSON-plain, so
      // it rides the meta bag through kernel-codec for durable resume.
      state = transitionState(state, {
        meta: { ...state.meta, runContract },
      });
      yield* emitContractCompiled({
        taskId: state.taskId,
        iteration: state.iteration,
        requirements: runContract.requirements.map((r) => ({ id: r.id, kind: r.kind })),
        deliverables: runContract.deliverables.map((d) => ({ id: d.id, kind: d.kind })),
        horizon: runContract.horizon,
      });

      // HarnessPlan (meta-loop Phase 6 / task G1) — the policy compiler. Only when
      // `.withAdaptiveHarness()` is on; OFF (default) → no plan, and
      // `effectiveHorizonProfile` below stays `options.horizonProfile`, so the
      // whole guard-resolution path is byte-identical to today.
      //
      // The plan is compiled from what the run KNOWS about itself (the resolved
      // capability tier + calibration, the contract's horizon, the task
      // classification), then explicit withers OVERRIDE the compiled defaults
      // (`.withLongHorizon()` → horizonProfile; `.withStrategy()` → strategy;
      // `.withBudget()`/maxIterations). The plan's `horizonProfile` then drives
      // the A2 guard bundle below (subsuming A2's flag), and is mirrored onto
      // `state.meta.horizonProfile` for the live consumers (RI observer).
      if (options.adaptiveHarness) {
        const compiled = compileHarnessPlan({
          capability: { tier: profile.tier },
          ...(effectiveInput.calibration ? { calibration: effectiveInput.calibration } : {}),
          horizon: runContract.horizon,
          classification: classifyTask(effectiveInput.task),
        });
        const harnessPlan = applyExplicitOverrides(compiled, {
          ...(options.horizonProfile ? { horizonProfile: options.horizonProfile } : {}),
          ...(options.strategy ? { strategy: options.strategy as PlanStrategy } : {}),
          maxIterations: options.maxIterations,
        });
        effectiveHorizonProfile = harnessPlan.guard.horizonProfile;
        state = transitionState(state, {
          meta: {
            ...state.meta,
            harnessPlan,
            ...(harnessPlan.guard.horizonProfile
              ? { horizonProfile: harnessPlan.guard.horizonProfile }
              : {}),
          },
        });
      }
    }

    // Mutable scratchpad mirror — synced from state.scratchpad (ReadonlyMap) after each kernel step.
    const mutableScratchpad = new Map<string, string>(state.scratchpad);

    // ── 7. Main loop ─────────────────────────────────────────────────────────
    // Tier-aware guards + loop-detection thresholds. These are immutable per
    // run and flow into the iteration body via `iterationConfig` below.
    const loopCfg = options.loopDetection;
    const tierGuards = TIER_GUARD_THRESHOLDS[profile.tier] ?? TIER_GUARD_THRESHOLDS["mid"];
    // A2 — opt-in long-horizon guard scaling. `undefined` unless
    // options.horizonProfile === "long"; every consumer below falls back to its
    // existing literal when absent, so a run without the profile is
    // byte-identical to today.
    const horizon: HorizonProfile | undefined = resolveHorizonProfile({
      horizonProfile: effectiveHorizonProfile,
      maxIterations: options.maxIterations,
    });
    const maxSameTool = resolveMaxSameTool(
      loopCfg?.maxSameToolCalls ?? tierGuards.maxSameToolDefault,
      effectiveInput.requiredToolQuantities,
    );
    const maxRepeatedThought = loopCfg?.maxRepeatedThoughts ?? 3;
    // Explicit loopDetection config wins over the profile; profile wins over the
    // absolute default 3.
    const maxConsecutiveThoughts =
      loopCfg?.maxConsecutiveThoughts ?? horizon?.maxConsecutiveThoughts ?? 3;

    // Required tools floor + retry/nudge budgets. The carrier counters
    // `requiredToolRedirects` and `requiredToolNudgeCount` mirror the
    // pre-Phase-4 in-loop bookkeeping (1:1 with the original variables).
    const requiredTools = effectiveInput.requiredTools ?? [];
    const maxRequiredToolRetries = effectiveInput.maxRequiredToolRetries ?? 2;

    // M3 REWORK (2026-05-12): retry loop removed per ablation verdict (0pp
    // accuracy delta across 3 models). The verifier still fires as a terminal
    // pass/fail gate at §9.0 below. Developer-injectable via KernelInput.verifier.
    const verifier = effectiveInput.verifier ?? defaultVerifier;

    // Unified nudge budget — caps the total number of "missing required tool"
    // nudges injected by stall detection and loop detection paths combined.
    // Without this, the stall and loop paths can compound nudges indefinitely
    // when the model refuses to (or cannot) satisfy the required tool quota.
    const maxRequiredToolNudges =
      maxRequiredToolRetries + (horizon?.requiredToolNudgeBonus ?? 2);

    // Required-tools availability guard (pre-loop)
    // If required tools are declared but not available in this run's tool schemas,
    // fail immediately instead of allowing synthesis/fallback to fabricate completion.
    if (requiredTools.length > 0) {
      const visibleTools = (effectiveInput.availableToolSchemas ?? []).map((t) => t.name);
      const allKnownTools = (effectiveInput.allToolSchemas ?? effectiveInput.availableToolSchemas ?? []).map((t) => t.name);
      const knownToolSet = new Set(allKnownTools);
      const unavailableRequired = requiredTools.filter((t) => !knownToolSet.has(t));
      if (allKnownTools.length > 0 && unavailableRequired.length > 0) {
        state = transitionState(state, {
          status: "failed",
          error:
            `Task incomplete — missing_required_tool: required tool(s) unavailable: ${unavailableRequired.join(", ")}.\n` +
            `required=[${requiredTools.join(", ")}]\n` +
            `available=[${allKnownTools.join(", ")}]\n` +
            `visible=[${visibleTools.join(", ")}]`,
        });
      }
    }

    // Strategy switching state — currentOptions tracks the active strategy
    // name for the current pass; currentInput carries any handoff priorContext;
    // currentContext is rebuilt when input changes on switch. All three
    // round-trip through the carrier so the outer while loop and post-loop
    // finalization see the latest values after a mid-iteration switch.
    let currentOptions = options;
    let currentInput: KernelInput = effectiveInput;
    let currentContext: KernelContext = context;

    // Failure recovery redirects — when a tool path fails and alternatives exist,
    // force at least a small number of alternate attempts before harness delivery.
    const maxFailureRecoveryRedirects = Math.max(2, maxRequiredToolRetries);

    const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
      Effect.serviceOption(ObservableLogger).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/kernel/loop/runner.ts:580", tag: errorTag(err) })))
            : Effect.void
        )
      );

    // Fire 'bootstrap' phase hooks once before the loop starts.
    {
      const harnessPipeline = effectiveInput.harnessPipeline;
      const bootstrapAbort = yield* Effect.promise(() =>
        runPhaseHooks(harnessPipeline, 'before', 'bootstrap', 0, state)
      );
      if (bootstrapAbort) {
        // P1 mission 2B: killswitch abort carries a DYNAMIC terminatedBy (not a
        // TerminateReason). Set status + terminatedBy via transitionState (NO
        // output key), then — only on the "done" branch — route the output
        // through the single writer commitDeliverable. The "failed" branch
        // drops the key so the invariant nulls the output.
        const aborted = bootstrapAbort.abort === 'terminate';
        state = transitionState(state, {
          status: aborted ? 'failed' : 'done',
          meta: {
            ...state.meta,
            terminatedBy: killswitchTerminatedBy(bootstrapAbort),
          },
        });
        if (!aborted) {
          state = commitDeliverable(state, passthroughOutputDeliverable(state.output));
        }
      }
    }

    // ── Durable HITL resume re-entry (Phase D) ───────────────────────────────
    // When resuming a checkpoint that paused at an approval gate, apply the
    // human's stored decision HERE — before the loop — so the gated step is
    // resolved without re-calling the LLM (spec §7 determinism). Approved:
    // execute the exact stored call once via the act capability, with
    // `approvalBypass` set so the gate does not re-pause it. Denied: inject the
    // denial as an LLM-visible message so the next think reacts. No-op on a
    // normal run (both fields undefined → zero cost).
    //
    // The paused checkpoint is a clean terminal state (act.ts terminate on
    // pause: status:"done", terminatedBy:"awaiting-approval", a sentinel
    // output). We MUST reset those terminal fields on resume — exactly as the
    // interaction re-entry directly below does — so the main loop re-runs and
    // synthesizes a real answer instead of returning the pause sentinel. The
    // "execute" branch happened to work without this reset (handleActing sets
    // status back to "acting"/"thinking" as a side effect), but the "observe"
    // (deny) branch does NOT run a tool: without the reset, status stayed
    // "done", the main loop was skipped, and denyRun returned "Run paused —
    // awaiting human approval." as the final answer. Reset unconditionally so
    // both branches re-enter the loop.
    if (state.meta.awaitingApprovalFor && effectiveInput.approvalDecision) {
      const gate = state.meta.awaitingApprovalFor;
      const reentry = resolveApprovalReentry(gate, effectiveInput.approvalDecision);
      if (reentry.action !== "none") {
        state = transitionState(state, {
          status: "thinking",
          output: null,
          meta: {
            ...state.meta,
            awaitingApprovalFor: undefined,
            terminatedBy: undefined,
          },
        });
      }
      if (reentry.action === "execute" && reentry.call) {
        state = transitionState(state, {
          meta: {
            ...state.meta,
            approvalBypass: true,
            pendingNativeToolCalls: [
              {
                id: crypto.randomUUID(),
                name: reentry.call.name,
                arguments: (reentry.call.arguments ?? {}) as Record<string, unknown>,
              },
            ],
          },
        });
        state = yield* handleActing(state, currentContext);
        state = transitionState(state, {
          meta: { ...state.meta, approvalBypass: undefined },
        });
      } else if (reentry.action === "observe" && reentry.observation) {
        // Inject the denial as an LLM-VISIBLE message pair (synthetic assistant
        // tool-call + tool_result), not only a step: prompt assembly
        // (fromKernelState) builds the EventLog from state.messages, NOT steps,
        // so a bare observation step is invisible to the next think and the
        // model would never learn its action was denied. Mirrors the
        // interaction re-entry's tool_result injection. The act gate paused
        // BEFORE assembleConversation ran, so state.messages has no record of
        // the gated call — synthesize the assistant-call + tool_result pair here
        // (keyed on the stored gateId) so the denial renders as that call's
        // result. Keep the observation step too, for the systems-observed
        // record (entropy/metrics/debrief).
        const observation = reentry.observation;
        const assistantCall: KernelMessage = {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: gate.gateId,
              name: gate.toolName,
              arguments: (gate.args ?? {}) as Record<string, unknown>,
            },
          ],
        };
        const toolResult: KernelMessage = {
          role: "tool_result",
          toolCallId: gate.gateId,
          toolName: gate.toolName,
          content: observation,
        };
        state = transitionState(state, {
          messages: [...state.messages, assistantCall, toolResult],
          steps: [...state.steps, makeStep("observation", observation)],
        });
      }
    }

    // ── Durable interaction resume re-entry (Task 10) ────────────────────────
    // Mirrors the approval re-entry directly above for the request_user_input
    // rail. When resuming a checkpoint that paused for user interaction, inject
    // the human's stored response HERE — before the loop — as an observation the
    // next think reacts to, then clear `meta.awaitingInteractionFor`. Unlike
    // approvals there is NO execute/skip branch: an interaction response is
    // ALWAYS injected as the pending call's result. The paused checkpoint carries
    // `status:"done"` + a sentinel output (act.ts terminate on pause), so we also
    // reset the terminal fields — status back to "thinking", output/terminatedBy
    // cleared — so the main loop re-runs and synthesizes a fresh answer from the
    // injected response instead of returning the pause sentinel. No-op on a
    // normal run (both fields undefined → zero cost).
    if (state.meta.awaitingInteractionFor && effectiveInput.interactionResponse) {
      const pending = state.meta.awaitingInteractionFor;
      const response = effectiveInput.interactionResponse;
      if (response.interactionId === pending.interactionId) {
        // The act gate paused BEFORE assembleConversation ran, so state.messages
        // has no record of the request_user_input call. Synthesize the
        // assistant-call + tool_result pair here so the prompt-assembly path
        // (fromKernelState builds the EventLog from state.messages, NOT steps)
        // renders the human's answer as the pending call's result. A plain
        // observation step alone would be invisible to the LLM prompt.
        const observation = `The user responded: ${response.valueJson}`;
        const assistantCall: KernelMessage = {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: pending.interactionId,
              name: REQUEST_USER_INPUT_TOOL_NAME,
              arguments: { kind: pending.kind, prompt: pending.prompt },
            },
          ],
        };
        const toolResult: KernelMessage = {
          role: "tool_result",
          toolCallId: pending.interactionId,
          toolName: REQUEST_USER_INPUT_TOOL_NAME,
          content: observation,
        };
        state = transitionState(state, {
          status: "thinking",
          output: null,
          messages: [...state.messages, assistantCall, toolResult],
          steps: [...state.steps, makeStep("observation", observation)],
          meta: {
            ...state.meta,
            awaitingInteractionFor: undefined,
            terminatedBy: undefined,
          },
        });
      }
    }

    // ── 7. Main loop ─────────────────────────────────────────────────────────
    // WS-6 Phase 4 (2026-05-29): the per-iteration body that used to live
    // inline here moved to `iterate-pass.ts`. The outer while-loop owns
    // termination + iteration-budget gating; runIterationPass() owns
    // everything between the opening `while (...)` brace and its closing `}`.
    // See iterate-pass.ts JSDoc for the carrier/cfg shape + invariants
    // preserved across the lift (single-owner termination, loop-detector
    // streak rule, no LLM re-verify, phase-chain ordering).
    const iterationCarrier: IterationCarrier = {
      state,
      currentInput,
      currentOptions,
      currentContext,
      prevActionCount: 0,
      prevStepCount: 0,
      // Learn capability — per-iter diff cursors for LearningPipeline.write().
      // Tracked separately from prevStepCount so the learn write can pass
      // ONLY the new steps/decisions appended during the current iter
      // (mission-brief decisions a + b). Coupling to prevStepCount would
      // break if the action-count delta logic ever resets that cursor.
      prevStepCountForLearn: 0,
      prevDecisionLogCountForLearn: 0,
      prevArtifactCount: 0,
      consecutiveStalled: 0,
      requiredToolRedirects: 0,
      requiredToolNudgeCount: 0,
      failureRecoveryRedirects: 0,
      switchCount: 0,
      triedStrategies: [options.strategy ?? "reactive"],
      autoCheckpointed: false,
      mutableScratchpad,
    };
    const iterationConfig: IterationConfig = {
      kernel,
      hooks,
      services,
      profile,
      tierGuards,
      maxSameTool,
      maxRepeatedThought,
      maxConsecutiveThoughts,
      requiredTools,
      maxRequiredToolRetries,
      maxRequiredToolNudges,
      maxFailureRecoveryRedirects,
      verifier,
      options,
      context,
      effectiveInput,
      input,
      emitLog,
      horizon,
    };

    while (
      iterationCarrier.state.status !== "done" &&
      iterationCarrier.state.status !== "failed" &&
      iterationCarrier.state.iteration < iterationCarrier.currentOptions.maxIterations &&
      (iterationCarrier.state.llmCalls ?? 0) < iterationCarrier.currentOptions.maxIterations
    ) {
      const signal = yield* runIterationPass(iterationCarrier, iterationConfig);
      if (signal === "break") break;
    }

    // Sync mutable iteration locals back from the carrier for the post-loop
    // finalization blocks (§8 required-tools / §8.5 non-final-answer fallback /
    // §9.0 verifier / §9 quality gate). These mirror the original `state`,
    // `currentInput`, `currentOptions` identifiers the post-loop body already
    // reads — keeping reassignment local here avoids touching post-loop code.
    state = iterationCarrier.state;
    currentInput = iterationCarrier.currentInput;
    currentOptions = iterationCarrier.currentOptions;

    // ── §7.5 Harness-forced abstention (O3 Task 6) ───────────────────────────
    // When the model did NOT abstain but grounding is structurally impossible,
    // force an `abstained` terminal here — BEFORE finalization blocks — instead
    // of grinding to `max_iterations` or letting fabrication through.
    //
    // Guard: skip entirely when the state is already abstained (model-initiated
    // abstention via the abstain meta-tool, or a prior in-loop legitimacy-gate
    // abstention). Overwriting would replace the model's specific {reason, missing}
    // with the generic harness-forced message — the earned signal must be preserved.
    // (O3 I2 fix: guard against forced re-terminate clobbering model abstention.)
    //
    // Input derivation (conservative fallbacks documented inline):
    //   requiredToolUnavailable: a declared required tool absent from the registered
    //     schema set. False when allKnownTools is empty (no schema provided = unknown).
    //   missingRequiredTools: unsatisfied required-tool names (empty array fallback).
    //   ungroundedSynthesisRejections: synthesisRetryCount + groundingBlockRetry
    //     (same counters Task 5's legitimacy gate reads). Fallback: 0.
    //   iterationsRemaining: maxIterations − state.iteration clamped ≥ 0.
    //     Special case: when a required tool is structurally unavailable AND the
    //     pre-loop guard fired (iteration=0, status=failed), treat as 0 —
    //     no iterations can fix a missing tool. Deviation documented in Task 6 report.
    //   hasDeliverable: countDeliverableCandidates(state) > 0 — never overrides a genuine deliverable.
    //
    // Route through terminate() (the single-owner gateway) so terminatedBy +
    // output are set via the canonical path. The post-condition gate in terminate()
    // passes "abstained" through (added in Task 6) — an abstained run cannot
    // honestly meet post-conditions when grounding was structurally impossible.
    if (state.meta.terminatedBy !== "abstained") {
      const allKnownToolsForAbstain = (
        currentInput.allToolSchemas ?? currentInput.availableToolSchemas ?? []
      ).map((t) => t.name);
      const knownToolSetForAbstain = new Set(allKnownToolsForAbstain);
      const unavailableRequired = requiredTools.filter((t) => !knownToolSetForAbstain.has(t));
      const requiredToolUnavailable =
        allKnownToolsForAbstain.length > 0 && unavailableRequired.length > 0;
      // Conservative: structurally-unavailable tool at iteration=0 → treat as
      // exhausted (the pre-loop guard fired; no iterations could have helped).
      const iterationsRemainingForAbstain =
        requiredToolUnavailable && state.iteration === 0
          ? 0
          : Math.max(0, currentOptions.maxIterations - state.iteration);
      // F1 — grounded-terminal invariant (2026-07-02): when the Arbitrator's
      // grounded-terminal gate already spent its ONE grounding redirect
      // (meta.groundingRedirectCount ≥ 1), the loop exited via a terminal
      // final answer (TERMINAL_ANSWER_REASONS), and STILL no substantive tool
      // call has succeeded — this is the SECOND ungrounded terminal attempt.
      // Count the redirect + this attempt toward the ≥2 ungrounded-synthesis
      // threshold (which the redirect made reachable) so the accepted-but-
      // ungrounded terminal converts to an honest `abstained` here. Grounded
      // runs (any successful call) and non-answer terminals contribute 0 —
      // pre-F1 arithmetic byte-identical.
      const groundingRedirects = state.meta.groundingRedirectCount ?? 0;
      const secondUngroundedTerminal =
        groundingRedirects > 0 &&
        TERMINAL_ANSWER_REASONS.has(String(state.meta.terminatedBy ?? "")) &&
        !hasSuccessfulSubstantiveToolCall(state.steps);
      const ungroundedSynthesisRejections =
        (state.meta.synthesisRetryCount ?? 0) +
        (state.meta.groundingBlockRetry ?? 0) +
        (secondUngroundedTerminal ? groundingRedirects + 1 : 0);
      // Deliverable-truth (Wave C / C2, audit 01-F1 item 7): a REAL file
      // artifact (tool-declared ledger entry) is now an authoritative "we have a
      // deliverable" signal, so abstention never forces over one — even a
      // code-execute / shell write the old any-success heuristic would have
      // recognized only via its observation. Evidence candidates remain the
      // fallback so non-artifact tasks (research answers, no file) stay sane:
      // the union is a superset of the prior signal, so no run that was
      // previously protected loses protection (behavior pinned).
      const hasDeliverableForAbstain =
        countArtifacts(state) > 0 || countDeliverableCandidates(state) > 0;

      const forced = decideForcedAbstention({
        requiredToolUnavailable,
        missingRequiredTools: unavailableRequired,
        ungroundedSynthesisRejections,
        iterationsRemaining: iterationsRemainingForAbstain,
        hasDeliverable: hasDeliverableForAbstain,
        // Name the tools whose grounding never landed (all required tools —
        // zero substantive successes is the trigger condition above).
        ...(secondUngroundedTerminal && requiredTools.length > 0
          ? { ungroundedRequiredTools: requiredTools }
          : {}),
      });

      if (forced !== null) {
        // A forced abstention is an honest decline, not a failure. Clear any
        // stale error string the pre-loop required-tools guard may have set
        // (status:"failed" + error:"missing_required_tool:...") so callers
        // reading result.error don't see an incoherent failed-error on a
        // status:"done"/terminatedBy:"abstained" result.
        state = transitionState(state, { error: null });
        state = terminate(state, {
          reason: "abstained",
          deliverable: sentinelDeliverable("no_substantive_output"),
          extraMeta: {
            abstention: { reason: forced.reason, missing: forced.missing },
          },
        });
      }
    }

    // Durable HITL (Phase D): a run paused for human approval is a clean terminal
    // state (status:"done", terminatedBy:"awaiting-approval", a sentinel output,
    // and meta.awaitingApprovalFor carrying the gated call). The post-loop
    // finalization blocks below (required-tools failure, harness-deliverable
    // promotion, §9.0 verifier, quality gate, output synthesis) all assume the
    // run was trying to ANSWER and would mangle the pause — e.g. the gated tool
    // looks "required but uncalled" and the run is failed. Skip them entirely when
    // paused; resume executes the approved call and runs finalization then.
    const isAwaitingApproval = state.meta.terminatedBy === "awaiting-approval";
    // Durable pause (Task 9): a run paused for `request_user_input` is the
    // identical clean terminal state, mirroring `awaiting-approval` — same
    // skip-finalization treatment, carrying `meta.awaitingInteractionFor`
    // instead of `meta.awaitingApprovalFor`.
    const isAwaitingInteraction = state.meta.terminatedBy === "awaiting-interaction";
    // O3 Task 6: abstained runs are a clean non-failure terminal (status:"done",
    // terminatedBy:"abstained"). The post-loop finalization blocks (required-tools
    // failure, verifier, quality gate, output synthesis) must be skipped — the
    // run honestly declined and there is nothing to verify or synthesize.
    const isAbstained = state.meta.terminatedBy === "abstained";
    // E3 (meta-loop Phase 5a): a `budget_terminal` run already ran its forced
    // generous synthesis at the terminal budget band and shipped an HONEST —
    // partial when requirements remain — answer. The post-loop finalization
    // blocks (required-tools failure, §9.0 verifier, output-quality synthesis)
    // must be skipped: re-verifying could null the partial answer (the exact
    // discard audit 05-#1 fixes) and re-synthesizing would double the spend.
    // Mirrors the isAbstained skip. `budget_terminal` is only produced under the
    // long-horizon profile → off the profile this is always false → byte-identical.
    const isBudgetTerminal = state.meta.terminatedBy === "budget_terminal";

    // Fire 'complete' phase hooks once after loop exits normally.
    yield* Effect.promise(() =>
      runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'complete', state.iteration, state)
    );

    // ── 8. Post-loop required tools check ───────────────────────────────────
    // Final safety net: if the loop exited without failure but required quotas
    // are still missing, fail with a deterministic missing_required_tool error.
    // This applies uniformly across all non-failed exits.
    if (
      state.status !== "failed" &&
      requiredTools.length > 0 &&
      !isAwaitingApproval &&
      !isAwaitingInteraction &&
      !isAbstained &&
      !isBudgetTerminal
    ) {
      const effectiveToolsUsed = buildEffectiveToolsUsed(state);
      const missingTools = missingRequiredToolsForInput(state.steps, currentInput);
      if (missingTools.length > 0) {
        const visibleTools = (currentInput.availableToolSchemas ?? []).map((t) => t.name);
        const allKnownTools = (currentInput.allToolSchemas ?? currentInput.availableToolSchemas ?? []).map((t) => t.name);
        const calledTools = [...effectiveToolsUsed];
        const terminatedBy = String(
          state.meta.terminatedBy ??
            (state.iteration >= currentOptions.maxIterations ? "max_iterations" : "unknown"),
        );
        // Render quantities so the user sees N/M satisfaction rather than a bare
        // tool name. Without this, a quota of 2 with 1 successful call looks
        // identical to "tool never called" in the error output.
        const successCounts = buildSuccessfulToolCallCounts(state.steps);
        const quantities = currentInput.requiredToolQuantities ?? {};
        const renderRequirement = (name: string) => {
          const need = quantities[name] ?? 1;
          const have = successCounts[name] ?? 0;
          return need > 1 ? `${name}×${need} (${have}/${need} satisfied)` : name;
        };
        // Invariant: status=failed implies output=null. Earlier paths
        // (loop_graceful, harness_deliverable) may have populated state.output
        // with a lastThought or assembled artifacts; once required-tool
        // satisfaction fails the run, those become invalid deliverables and
        // must be discarded — otherwise they leak as the user-visible answer
        // even though the run is structurally a failure.
        state = transitionState(state, {
          status: "failed",
          output: null,
          error:
            `Task incomplete — missing_required_tool: required tool(s) not called: ${missingTools.map(renderRequirement).join(", ")}.\n` +
            `required=[${requiredTools.map(renderRequirement).join(", ")}]\n` +
            `called=[${calledTools.join(", ")}]\n` +
            `available=[${allKnownTools.join(", ")}]\n` +
            `visible=[${visibleTools.join(", ")}]\n` +
            `terminatedBy=${terminatedBy}`,
        });
      }
    }

    // ── 8.5. Non-authoritative termination → harness deliverable ───────────
    // When the model stopped without explicitly calling `final-answer` (e.g. an
    // `end_turn` text after a failed tool call, or a dispatcher-forced early
    // stop) and there are substantive tool artifacts, swap state.output for the
    // assembled deliverable so the quality gate has real data to synthesize
    // from. Without this, whatever the model emitted in its last turn — often
    // an apology, a hallucination, or the raw text of the last observation —
    // leaks through as the final answer.
    //
    // Scoped narrowly to explicit "model ended turn without final-answer"
    // markers so strategies that deliver their own output without setting
    // `terminatedBy` keep control of the output.
    const nonFinalAnswerTerminations = new Set([
      "end_turn",
      "llm_end_turn",
      "dispatcher-early-stop",
      "low_delta_guard",
    ]);
    if (
      state.status === "done" &&
      typeof state.meta.terminatedBy === "string" &&
      nonFinalAnswerTerminations.has(state.meta.terminatedBy)
    ) {
      const artifactCount = countDeliverableCandidates(state);
      if (artifactCount > 0) {
        const previousTerminatedBy = state.meta.terminatedBy;
        const deliverable = assembleDeliverable(state);
        // Single-writer: commitDeliverable owns state.output; we hand it the
        // terminatedBy promotion to stamp alongside (Sprint-1 P1 mission 2A).
        state = commitDeliverable(state, deliverable, {
          terminatedBy: deliverableTerminationReason(deliverable),
          previousTerminatedBy,
        });
      }
    }

    // ── 8.7. Output ownership consolidation ──────────────────────────────────
    // The kernel must own the final output. Strategy adapters (reactive.ts,
    // plan-execute.ts, etc.) historically had their own fallback chains
    // (state.output ?? lastThought ?? null) that ran AFTER runKernel returned
    // — bypassing the verifier gate below. Pull those fallbacks here so:
    //   1. state.output reflects exactly what the user will receive
    //   2. the verifier sees the actual deliverable before it ships
    //   3. strategy adapters can return state.output directly with no synthesis
    //
    // Only fills from lastThought when status=done. Failed runs were already
    // forced to output=null by the transitionState invariant.
    if (state.status === "done" && !state.output) {
      const lastThought = [...state.steps]
        .filter((s) => s.type === "thought")
        .pop();
      if (lastThought?.content && lastThought.content.trim().length > 0) {
        // Sprint-1 B2 / P1 mission 2A: typed DeliverableProvenance channel.
        // Construct a model_synthesis Deliverable and route it through the
        // single writer commitDeliverable (no extraMeta — this path does not
        // own terminatedBy, so the existing reason is preserved). Raw-string
        // mutations of state.output are the anti-pattern this collapses.
        const deliverable = modelSynthesisDeliverable({
          type: "thought",
          content: lastThought.content,
          iteration: state.iteration,
        });
        state = commitDeliverable(state, deliverable);
      }
    }

    // ── 8.8. Output-ownership invariant — never ship empty output when work
    // was done. §8.5's harness-deliverable assembly keys off a NARROW
    // terminatedBy whitelist (end_turn/dispatcher-early-stop/...). But the
    // arbitrator's early-stop stamps terminatedBy="controller_early_stop:<reason>"
    // (arbitrator.ts) and other done-terminations fall outside the set too, so a
    // `done` run could reach the verifier with state.output empty despite
    // substantive tool artifacts — the 2026-06-29 cross-tier sweep saw gpt-4o-mini
    // (22418 tok) and sonnet ship output="" with status=done on exactly this path.
    // This general fallback assembles a deliverable from the accumulated work
    // whenever a done run has empty output but deliverable candidates exist —
    // immune to terminatedBy string drift, and additive (fires ONLY on empty
    // output, so it can never override a path that already produced output).
    if (
      state.status === "done" &&
      !state.output &&
      countDeliverableCandidates(state) > 0
    ) {
      state = commitDeliverable(state, assembleDeliverable(state));
    }

    // ── 9.0. Sprint 3.5 — Verifier gate before shipping any output ───────────
    // Per North Star §3 (Verify capability) — the harness MUST verify the
    // final output satisfies the task before declaring success. Without this,
    // the model can ship parroted system guidance ("Your next step: call X")
    // as its answer because the output is in state.output and status is "done".
    //
    // The defaultVerifier with terminal=true runs:
    //   - required-tools-satisfied (catches "no tool was called" parrots)
    //   - scaffold-leak (catches framework-internal scaffolding echoed as the answer)
    //
    // On verifier rejection: transition to status="failed" with the verdict
    // in state.error. The reactive.ts strategy adapter (Sprint 3.4 stage 2)
    // already ensures state.error doesn't leak as state.output; user sees
    // null output + structured error.
    if (process.env.DEBUG_VERIFIER === "1") {
      // WS-5 Phase 3: migrated from console.error to Effect.logDebug. The
      // [VERIFIER-PRE] trace is a debug-only diagnostic for the verifier-pre
      // snapshot path; routing through Effect.logDebug threads it into the
      // structured observability sink instead of stdout. Env-gate preserved
      // (opt-in semantics — high-frequency message).
      yield* Effect.logDebug(
        `[VERIFIER-PRE] status=${state.status} hasOutput=${!!state.output} terminatedBy=${state.meta.terminatedBy} outLen=${(state.output ?? "").length} stepsCount=${state.steps.length}`,
      );
    }

    // ── Terminal snapshot (pre-verifier) ─────────────────────────────────────
    // Records the exact state the verifier gate inspects. With both an iter-end
    // snapshot AND this terminal one, a trace narrative becomes complete:
    // iter-start → iter-end → terminal → verifier-verdict. Without this, you
    // can't tell whether the verifier rejected the kernel's true final state
    // or some intermediate state.
    yield* emitKernelStateSnapshot({
      state,
      taskId: currentOptions.taskId ?? state.taskId,
      iteration: state.iteration,
    });

    if (
      state.status === "done" &&
      state.output &&
      !isAwaitingApproval &&
      !isAwaitingInteraction &&
      !isAbstained &&
      !isBudgetTerminal
    ) {
      // availableUserTools — pass through the user-registered tool list
      // so the verifier can run classifier-independent "agent-took-action"
      // checks (rejects parrots / hallucinated answers / meta-tool dumps
      // when the user wired data tools but the agent never invoked them).
      const availableUserTools = (effectiveInput.availableToolSchemas ?? []).map(
        (t) => t.name,
      );
      // WS-3 Phase 5a — verify+emit colocated at the verify capability
      // boundary. `verdict` is still consumed below (severity branching,
      // softFail surfacing, escalation tagging).
      //
      // `buildTerminalVerifyContext(content)` keeps the verifier context
      // literal in one place so the Phase-D1 block-mode corrective re-verify
      // (below) inspects the same priorSteps/grounding/scratchpad as the first
      // pass — only the candidate `content` changes between attempts.
      const buildTerminalVerifyContext = (content: string) => ({
        action: "final-answer" as const,
        content,
        actionSuccess: true,
        task: effectiveInput.task,
        priorSteps: state.steps,
        requiredTools: effectiveInput.requiredTools,
        relevantTools: effectiveInput.relevantTools,
        toolsUsed: state.toolsUsed,
        availableUserTools,
        terminal: true,
        grounding: effectiveInput.grounding,
        fabricationGuard: effectiveInput.fabricationGuard,
        scratchpad: state.scratchpad,
        // H5 (2026-07-08 sweep, audit 02-#4, trace 01KWZ811 seq 1920-1926):
        // without terminatedBy, the authoritative terminal verify cannot see
        // harness authorship — the stall path's own verdict correctly failed
        // output-is-model-authored (escalate), then THIS context re-verified
        // the same harness-assembled output as "9 checks passed" two seqs
        // later with no new model turn, and the run shipped success. The
        // verifier's check 3a keys on terminatedBy=harness_deliverable.
        terminatedBy: state.meta.terminatedBy,
      });
      let verdict = yield* verifyAndEmit({
        verifier,
        context: buildTerminalVerifyContext(state.output),
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
      });

      // ── Phase D1 — block-mode evidence-grounding: cap-then-degrade ─────────
      // When grounding is enabled in `block` mode and the terminal verdict
      // carries an `evidence-grounded` reject, attempt up to
      // `grounding.maxRetries` (default 1) CORRECTIVE synthesis passes that
      // inject the ungrounded figures as guidance. If a corrective pass
      // grounds → accept. If the budget is exhausted → DEGRADE to warn: the
      // answer ships with `verificationWarning`, status stays non-failed.
      // This NEVER hard-fails the run and NEVER loops past the cap — both are
      // enforced by the pure `decideGroundingBlockOutcome` decision. `warn`
      // mode is untouched (it rides the softFail surface path below).
      let groundingDegradeWarning: string | undefined;
      // Bounded by the pure decision: the loop can only iterate while the
      // decision returns `retry`, which is impossible past `maxRetries`.
      while (state.status === "done" && state.output) {
        const outcome = decideGroundingBlockOutcome(
          verdict,
          state.meta.groundingBlockRetry ?? 0,
          effectiveInput.grounding,
        );
        if (outcome.kind === "pass") break;
        if (outcome.kind === "degrade") {
          groundingDegradeWarning = outcome.warning;
          break;
        }
        // outcome.kind === "retry": one corrective synthesis attempt.
        state = transitionState(state, {
          meta: {
            ...state.meta,
            groundingBlockRetry: (state.meta.groundingBlockRetry ?? 0) + 1,
          } as KernelState["meta"],
        });
        const llmOpt = yield* Effect.serviceOption(LLMService);
        if (llmOpt._tag !== "Some") {
          // No LLM to re-synthesize with — cannot correct. Degrade now rather
          // than spin: surface the answer with the grounding warning.
          groundingDegradeWarning = outcome.guidance;
          break;
        }
        // H3 (2026-07-08, audit 05-E2): grounding-corrected re-synthesis IS the
        // deliverable when it succeeds — terse (2048) truncated it.
        const corrected = yield* gatewayComplete(llmOpt.value, { purpose: "synthesize", budgetClass: "generous" }, {
            messages: [
              {
                role: "user",
                content:
                  `${buildSynthesisPrompt(state.output ?? "", taskIntent.format ?? "prose", effectiveInput.task, taskIntent)}\n\n${outcome.guidance}`,
              },
            ],
            temperature: 0.2,
          })
          .pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));
        const correctedContent = extractThinkingSafeContent(corrected).content;
        if (!correctedContent || correctedContent.trim().length === 0) {
          // Synthesis produced nothing usable — keep the original answer and
          // re-decide; the bumped counter guarantees the next pass degrades.
          continue;
        }
        // Single-writer: route the corrected answer through commitDeliverable.
        // harness_synthesis provenance — the harness ran an LLM synthesis pass
        // to produce this corrected prose (S11: not model_synthesis).
        state = commitDeliverable(
          state,
          harnessSynthesisDeliverable([], undefined, correctedContent),
        );
        verdict = yield* verifyAndEmit({
          verifier,
          context: buildTerminalVerifyContext(correctedContent),
          taskId: currentOptions.taskId ?? state.taskId,
          iteration: state.iteration,
        });
      }

      if (groundingDegradeWarning !== undefined) {
        // DEGRADE-to-warn: surface the answer WITH a warning; do NOT nullify,
        // do NOT fail. Mirrors the softFail warn-surface contract.
        state = transitionState(state, {
          meta: {
            ...state.meta,
            verifierRejected: false,
            verificationWarning: groundingDegradeWarning,
          } as KernelState["meta"],
        });
      } else if (!verdict.verified) {
        // GH #121 / I5 Loop Controller wire — resolve severity with the
        // back-compat default so external Verifier implementations that
        // predate I5 still get a sensible classification.
        const verdictSeverity = resolveResultSeverity(verdict);
        yield* emitLog({
          _tag: "warning",
          message: `[verifier] terminal output rejected (severity=${verdictSeverity}): ${verdict.summary}`,
          timestamp: new Date(),
        });
        //   - escalate : structural failure (harness fallback, shallow give-up).
        //                Suppress + tag for downstream strategy switch /
        //                human-in-loop. Persist `verifierEscalation` so the
        //                consumer (today: post-loop failure path; tomorrow:
        //                strategy-switch controller) can branch on it.
        //   - reject   : recoverable hard failure (parrot, missing required
        //                action). Suppress entirely. Identical to legacy
        //                non-softFail path.
        //   - warn     : advisory (grounding miss). Surface with metadata;
        //                do NOT nullify output. Identical to legacy
        //                softFail path.
        // H5 refinement (2026-07-08, audit 02-#4): when the ONLY failed check
        // is harness authorship (output-is-model-authored on a
        // harness_deliverable terminal), the run legitimately delivered
        // partial artifacts after budget/nudge exhaustion — killing it would
        // erase real progress. The defect being fixed is the LIE, not the
        // delivery: pre-fix, a context missing terminatedBy re-verified the
        // same output as "9 checks passed" (trace 01KWZ811 seq 1920→1923).
        // Ship it HONESTLY LABELED instead: verified stays false in the
        // verdict record, a verification warning + harnessAuthoredOutput
        // surface to receipts/telemetry, and no clean-success flip occurs.
        const onlyHarnessAuthorshipFailed =
          state.meta.terminatedBy === "harness_deliverable" &&
          verdict.checks.every((c) => c.passed || c.name === "output-is-model-authored");
        if (onlyHarnessAuthorshipFailed) {
          // `harnessAuthoredOutput` is now a DECLARED meta field with a real
          // consumer: `resolveCompletionStatus` degrades this run to `partial`,
          // so the caller sees `success:false` beside the preserved answer. It
          // used to be an untyped stowaway that nothing read, and the run
          // reported a clean success (H5 / wiring audit 2026-07-09).
          state = transitionState(state, {
            meta: {
              ...state.meta,
              verifierRejected: false,
              verificationWarning: verdict.summary,
              verifierVerdict: verdict.summary,
              harnessAuthoredOutput: true,
            },
          });
        } else if (verdictSeverity === "escalate") {
          state = transitionState(state, {
            status: "failed",
            error: `Verifier escalated output: ${verdict.summary}`,
            meta: {
              ...state.meta,
              verifierRejected: true,
              verifierVerdict: verdict.summary,
              verifierEscalation: true,
            } as KernelState["meta"],
          });
        } else if (verdict.softFail) {
          // Advisory failure: grounding check missed compressed observation.
          // Surface output with warning metadata; do NOT nullify.
          state = transitionState(state, {
            meta: {
              ...state.meta,
              verifierRejected: false,
              verificationWarning: verdict.summary,
            } as KernelState["meta"],
          });
        } else {
          // Hard failure: parrot or harness-authored output. Suppress entirely.
          state = transitionState(state, {
            status: "failed",
            error: `Verifier rejected output: ${verdict.summary}`,
            meta: {
              ...state.meta,
              verifierRejected: true,
              verifierVerdict: verdict.summary,
            } as KernelState["meta"],
          });
        }

        // Spec §5b (W-Q / task #54) — when the ALWAYS-ON fabricated-measurement
        // guard is the (or a) failing check, record it as a receipt-visible
        // intervention on a dedicated step. Deterministic: the guard rejects
        // ONLY perf measurements no tool observation produced (evidence-driven).
        // The verdict summary already lands on `receipt.verifierVerdict`; this
        // additionally names the guard in `interventions[]` so the debugging
        // spine shows WHICH control actor fired. Stamped after the branch chain
        // so it rides whichever meta transition applied (reject/escalate/warn).
        const fabCheck = verdict.checks.find(
          (c) => c.name === "output-not-fabricated-measurement" && !c.passed,
        );
        if (fabCheck !== undefined) {
          state = transitionState(state, {
            steps: [
              ...state.steps,
              makeStep(
                "harness_signal",
                `⚠️ fabrication guard: ${fabCheck.reason ?? "fabricated measurement rejected"}`,
                {
                  intervention: {
                    actor: "fabrication-guard",
                    authorityClass: authorityOf("fabrication-guard"),
                    evidence: (fabCheck.reason ?? "fabricated measurement with no tool evidence").slice(0, 200),
                    whatChanged: "fabrication-guard: terminal output rejected (fabricated measurement)",
                    iter: state.iteration,
                  },
                },
              ),
            ],
          });
        }
      }
    }

    // ── 9. Output quality gate ────────────────────────────────────────────
    // Route all successful outputs through the canonical finalization pipeline.
    // Validates format, optionally synthesizes when LLM is available.
    // Harness-assembled output (raw tool artifacts) always attempts synthesis.
    if (
      state.status === "done" &&
      state.output &&
      !isAwaitingApproval &&
      !isAwaitingInteraction &&
      !isAbstained &&
      !isBudgetTerminal
    ) {
      // `harness_synthesis` (introduced when assembleDeliverable picks a
      // substantive model thought) is treated as a MODEL output here — the
      // text was authored by the LLM, not concatenated from raw tool JSON.
      // Routing it as "harness" would force a second LLM re-synthesis that
      // can degrade clean prose into hallucinated structured output (e.g.,
      // local small models compressing/reformatting valid answers).
      const terminationSource = (state.meta.terminatedBy === "oracle_forced" ? "oracle"
        : state.meta.terminatedBy === "harness_deliverable" || state.meta.terminatedBy === "low_delta_guard" ? "harness"
        : "model") as "model" | "harness" | "oracle" | "fallback";
      const candidate = buildFinalAnswerCandidate(
        state.output,
        terminationSource,
        taskIntent,
      );
      const finalized = yield* finalizeOutput(candidate, taskIntent, effectiveInput.task);

      // Determine if synthesis is needed:
      // 1. Explicit format requested but validation failed
      // 2. Harness/oracle source — raw tool artifacts need professional formatting
      const needsSynthesis = !finalized.formatValidated &&
        (taskIntent.format || terminationSource === "harness" || terminationSource === "oracle");

      if (needsSynthesis) {
        const llmOpt = yield* Effect.serviceOption(LLMService);
        if (llmOpt._tag === "Some") {
          const synthesisFormat = taskIntent.format ?? "prose";
          const synthesisPrompt = buildSynthesisPrompt(state.output, synthesisFormat, effectiveInput.task, taskIntent);
          // H3 (2026-07-08, audit 05-E2): format/quality re-synthesis replaces
          // state.output wholesale — the deliverable render, not a side call.
          const synthesized = yield* gatewayComplete(llmOpt.value, { purpose: "synthesize", budgetClass: "generous" }, {
            messages: [{ role: "user", content: synthesisPrompt }],
            temperature: 0.2,
          }).pipe(Effect.catchAll(() => Effect.succeed({ content: "" })));

          // Strip <think> blocks before the synthesized output is gated on
          // format/completeness OR written into state.output. Without this,
          // thinking-model preambles leak verbatim into the user-facing
          // final answer.
          const safeSynth = extractThinkingSafeContent(synthesized);
          const synthContent = safeSynth.content;

          if (synthContent && synthContent.length > 0) {
            const formatOk = taskIntent.format
              ? validateOutputFormat(synthContent, taskIntent.format).valid
              : true;
            const contentOk = validateContentCompleteness(synthContent, taskIntent).complete;

            if (formatOk && contentOk) {
              // Drift S11: synthContent is prose the HARNESS produced by running
              // the LLM synthesis call above — NOT a model-authored trailing
              // thought. Tag it `harness_synthesis` WITH `synthesized` so the
              // provenance is truthful; `deliverableToContent` returns
              // synthContent unchanged (synthesized wins over the empty
              // `assembled`), so the output string is byte-identical to the old
              // model_synthesis write. No `synthesisCall` ref: `complete()`
              // exposes no callId here, and the contract forbids fabricating one.
              // extraMeta carries ONLY the output-quality flags; terminatedBy is
              // already set and preserved (commitDeliverable merges, never clobbers).
              state = commitDeliverable(
                state,
                harnessSynthesisDeliverable([], undefined, synthContent),
                { outputSynthesized: true, outputFormatValidated: true },
              );
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesized output to match requested format: ${synthesisFormat}`, timestamp: new Date() });
            } else if (terminationSource === "harness" || terminationSource === "oracle") {
              // Drift S11 (imperfect-but-better-than-raw branch): same provenance
              // truth as the formatOk&&contentOk branch — harness-orchestrated
              // synthesis → harness_synthesis WITH synthesized. Output string and
              // terminatedBy unchanged from the prior model_synthesis write.
              state = commitDeliverable(
                state,
                harnessSynthesisDeliverable([], undefined, synthContent),
                { outputSynthesized: true, outputFormatValidated: formatOk, outputFormatReason: !formatOk ? "Format mismatch after synthesis" : !contentOk ? "Content incomplete after synthesis" : undefined },
              );
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesis imperfect but using over raw artifacts (format=${formatOk}, content=${contentOk})`, timestamp: new Date() });
            } else {
              state = transitionState(state, {
                meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
              });
              yield* emitLog({ _tag: "warning", message: `[output-gate] Synthesis attempted but validation still failed (format=${formatOk}, content=${contentOk})`, timestamp: new Date() });
            }
          } else {
            state = transitionState(state, {
              meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
            });
          }
        } else {
          state = transitionState(state, {
            meta: { ...state.meta, outputFormatValidated: false, outputFormatReason: finalized.validationReason },
          });
        }
      } else if (taskIntent.format) {
        // Format was requested and validated successfully
        state = transitionState(state, {
          meta: { ...state.meta, outputFormatValidated: true },
        });
      }
    }

    // Observe the already-decided terminal decision (emit-only; no control flow).
    yield* emitGuardFired({
      taskId: currentOptions.taskId ?? state.taskId,
      iteration: state.iteration,
      guard: "terminal_decision",
      outcome: "terminate",
      reason: typeof state.meta.terminatedBy === "string" ? state.meta.terminatedBy : (state.status === "failed" ? "failed" : "done"),
      metadata: { terminatedBy: state.meta.terminatedBy ?? null, status: state.status },
    });

    // ── 10. Terminal hooks ────────────────────────────────────────────────────
    if (state.status === "done") {
      yield* hooks.onDone(state);
    } else if (state.status === "failed") {
      yield* hooks.onError(state, state.error ?? "unknown error");
    }

    // ── 11. Return final state ────────────────────────────────────────────────
    return state;
  });
}
