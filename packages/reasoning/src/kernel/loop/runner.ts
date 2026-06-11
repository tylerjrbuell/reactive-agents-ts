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
import { Effect } from "effect";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService, DEFAULT_CAPABILITIES, selectAdapter } from "@reactive-agents/llm-provider";
import { modelSynthesisDeliverable, harnessSynthesisDeliverable } from "@reactive-agents/core";
import { createToolCallResolver, selectToolCallingDriver } from "@reactive-agents/tools";
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
  type KernelRunOptions,
  type ThoughtKernel,
} from "../../kernel/state/kernel-state.js";
import { runPhaseHooks, killswitchTerminatedBy } from "./phase-hooks.js";
import {
  extractThinkingSafeContent,
  THINKING_SAFE_MIN_TOKENS,
} from "../../kernel/utils/stream-parser.js";
import { buildSuccessfulToolCallCounts } from "../../kernel/capabilities/verify/requirement-state.js";
import { extractOutputFormat, nominateRequiredTools, type TaskIntent } from "../../kernel/capabilities/comprehend/task-intent.js";
import { defaultVerifier, resolveResultSeverity, verifyAndEmit } from "../../kernel/capabilities/verify/verifier.js";
import { deriveConditions } from "../../kernel/capabilities/verify/derive-conditions.js";
import { emitGuardFired, emitKernelStateSnapshot } from "../../kernel/utils/diagnostics.js";
import {
  validateOutputFormat,
  validateContentCompleteness,
  buildFinalAnswerCandidate,
  finalizeOutput,
  buildSynthesisPrompt,
  type FinalizedOutput,
} from "./output-synthesis.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ── WS-6 Phase 2 — helper bucket imports ──────────────────────────────────────
// Tier-aware guard thresholds, deliverable assembly, recovery steering, and
// state-query helpers all moved to ./runner-helpers/<bucket>.ts. Re-exports
// below keep `kernel/loop/runner.js` as the stable import surface for callers
// (output-quality-gate.test.ts, tier-guard-config.test.ts, strategies/*).
import {
  TIER_GUARD_THRESHOLDS,
  resolveMaxSameTool,
} from "./runner-helpers/tier-guards.js";
import { missingRequiredToolsForInput } from "./runner-helpers/state-queries.js";
import {
  assembleDeliverable,
  commitDeliverable,
  passthroughOutputDeliverable,
  deliverableTerminationReason,
  countDeliverableCandidates,
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
    // Seed messages from input.initialMessages if provided (e.g. chat history injection)
    let state = effectiveInput.initialMessages?.length
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

    // Mutable scratchpad mirror — synced from state.scratchpad (ReadonlyMap) after each kernel step.
    const mutableScratchpad = new Map<string, string>(state.scratchpad);

    // ── 7. Main loop ─────────────────────────────────────────────────────────
    // Tier-aware guards + loop-detection thresholds. These are immutable per
    // run and flow into the iteration body via `iterationConfig` below.
    const loopCfg = options.loopDetection;
    const tierGuards = TIER_GUARD_THRESHOLDS[profile.tier] ?? TIER_GUARD_THRESHOLDS["mid"];
    const maxSameTool = resolveMaxSameTool(
      loopCfg?.maxSameToolCalls ?? tierGuards.maxSameToolDefault,
      effectiveInput.requiredToolQuantities,
    );
    const maxRepeatedThought = loopCfg?.maxRepeatedThoughts ?? 3;
    const maxConsecutiveThoughts = loopCfg?.maxConsecutiveThoughts ?? 3;

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
    const maxRequiredToolNudges = maxRequiredToolRetries + 2;

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

    // Fire 'complete' phase hooks once after loop exits normally.
    yield* Effect.promise(() =>
      runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'complete', state.iteration, state)
    );

    // ── 8. Post-loop required tools check ───────────────────────────────────
    // Final safety net: if the loop exited without failure but required quotas
    // are still missing, fail with a deterministic missing_required_tool error.
    // This applies uniformly across all non-failed exits.
    if (state.status !== "failed" && requiredTools.length > 0) {
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

    if (state.status === "done" && state.output) {
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
      const verdict = yield* verifyAndEmit({
        verifier,
        context: {
          action: "final-answer",
          content: state.output,
          actionSuccess: true,
          task: effectiveInput.task,
          priorSteps: state.steps,
          requiredTools: effectiveInput.requiredTools,
          relevantTools: effectiveInput.relevantTools,
          toolsUsed: state.toolsUsed,
          availableUserTools,
          terminal: true,
          grounding: effectiveInput.grounding,
          scratchpad: state.scratchpad,
        },
        taskId: currentOptions.taskId ?? state.taskId,
        iteration: state.iteration,
      });
      if (!verdict.verified) {
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
        if (verdictSeverity === "escalate") {
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
      }
    }

    // ── 9. Output quality gate ────────────────────────────────────────────
    // Route all successful outputs through the canonical finalization pipeline.
    // Validates format, optionally synthesizes when LLM is available.
    // Harness-assembled output (raw tool artifacts) always attempts synthesis.
    if (state.status === "done" && state.output) {
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
          const synthesized = yield* llmOpt.value.complete({
            messages: [{ role: "user", content: synthesisPrompt }],
            maxTokens: THINKING_SAFE_MIN_TOKENS,
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
