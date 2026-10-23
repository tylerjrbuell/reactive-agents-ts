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
import { WRITING_TOOL_NAMES } from "../capabilities/verify/post-conditions.js";
import { Effect, FiberRef, Option, Ref } from "effect";
import { ObservableLogger } from "@reactive-agents/observability";
import type { LogEvent } from "@reactive-agents/observability";
import { LLMService, DEFAULT_CAPABILITIES, selectAdapter, loadDialectPriorClaim } from "@reactive-agents/llm-provider";
import { sentinelDeliverable } from "@reactive-agents/core";
import { createToolCallResolver, selectToolCallingDriver, scratchpadStoreRef } from "@reactive-agents/tools";
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
import { RunEnvelope, mergeRunEnvelopeIntoKernelInput } from "../envelope/run-envelope.js";
import { runPhaseHooks, killswitchTerminatedBy } from "./phase-hooks.js";
import { extractOutputFormat, nominateRequiredTools } from "../../kernel/capabilities/comprehend/task-intent.js";
import { defaultVerifier } from "../../kernel/capabilities/verify/verifier.js";
import { deriveConditions } from "../../kernel/capabilities/verify/derive-conditions.js";
import { compileRunContract } from "../../kernel/contract/run-contract.js";
import { assessActionSatisfiability } from "../../kernel/contract/satisfiability.js";
import { recordRequirementsDeclared } from "../../kernel/ledger/emit.js";
import { classifyTask } from "../../kernel/capabilities/comprehend/task-classification.js";
import { judgmentComprehendShadow } from "../../kernel/capabilities/comprehend/judgment-classification.js";
import {
  applyExplicitOverrides,
  compileHarnessPlan,
  type PlanStrategy,
} from "../../kernel/policy/harness-plan.js";
import { emitContractCompiled, emitGuardFired } from "../../kernel/utils/diagnostics.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { terminate } from "./terminate.js";
import { CurrentRunBudget, CurrentRunBudgetLimits } from "../run-budget.js";
import { decideForcedAbstention } from "./runner-helpers/force-abstention.js";

// ── WS-6 Phase 2 — helper bucket imports ──────────────────────────────────────
// Tier-aware guard thresholds, deliverable assembly, recovery steering, and
// state-query helpers all moved to ./runner-helpers/<bucket>.ts. Re-exports
// below keep `kernel/loop/runner.js` as the stable import surface for callers
// (output-quality-gate.test.ts, tier-guard-config.test.ts, strategies/*).
// Task 9 (2026-10-23): the §7.5 input derivation, the resume re-entry blocks,
// the §8/§8.5/§8.7-§8.8 post-loop finalization, the §9.0 terminal verifier
// gate, and the §9 output quality gate moved verbatim to the ./runner-*.ts
// modules imported below — every script-anchored region (deriveConditions,
// compileHarnessPlan + applyExplicitOverrides, decideForcedAbstention,
// terminate routing, the main while-loop) stayed inline in runKernel().
import {
  TIER_GUARD_THRESHOLDS,
  resolveMaxSameTool,
} from "./runner-helpers/tier-guards.js";
import {
  resolveHorizonProfile,
  type HorizonProfile,
} from "./runner-helpers/horizon-profile.js";
import {
  commitDeliverable,
  passthroughOutputDeliverable,
} from "./runner-helpers/deliverable.js";
import { runApprovalResumeReentry, runInteractionResumeReentry } from "./runner-resume-reentry.js";
import { deriveForcedAbstentionInputs } from "./runner-forced-abstention-inputs.js";
import {
  applyRequiredToolsFinalCheck,
  applyNonFinalAnswerDeliverable,
  applyOutputOwnershipCluster,
} from "./runner-post-loop-deliverable.js";
import { runTerminalVerifierGate } from "./runner-terminal-verify-gate.js";
import { runOutputQualityGate } from "./runner-output-quality-gate.js";

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

// ── Durable HITL resume re-entry (Phase D) ────────────────────────────────────
// ApprovalReentry + resolveApprovalReentry now LIVE in ./runner-resume-reentry.ts
// (quality program Task 9); re-exported here so the stable
// `kernel/loop/runner.js` import surface is unchanged (zero consumer edits).
export { resolveApprovalReentry } from "./runner-resume-reentry.js";
export type { ApprovalReentry } from "./runner-resume-reentry.js";

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

    // ── 1b. Cross-cutting cascade merge (2026-07-22) ─────────────────────────
    // The RunEnvelope is the ONE run-wide carrier for the seven cross-cutting
    // wither fields. Merging it HERE — at the single universal kernel entry —
    // is what makes `.withGrounding()` / `.withFabricationGuard()` /
    // `.withStallPolicy()` / `.withContract()` / the three HITL rails reach
    // EVERY strategy, including the five that never threaded them to their
    // sub-kernels (measured 2026-07-22: reactive was the only one that did).
    //
    // SOFT read (`Effect.serviceOption`) by design — the R channel of
    // `runKernel` must stay `LLMService` alone, and repair degrades gracefully:
    // a kernel run with no envelope in context behaves exactly as before. The
    // HARD guarantee lives at the terminal mint (`finalizeStrategyResult`),
    // which cannot be bypassed. Explicit `KernelInput` fields WIN over the
    // envelope, so per-pass overrides remain possible.
    // Design: wiki/Architecture/Design-Specs/2026-07-22-cross-cutting-cascade-design.md
    const envelopeOpt = yield* Effect.serviceOption(RunEnvelope);
    const envelope = Option.getOrUndefined(envelopeOpt);
    const mergedInput: KernelInput = envelope
      ? mergeRunEnvelopeIntoKernelInput(input, envelope)
      : input;

    // ── Resolve provider capabilities ONCE ───────────────────────────────────
    // Both the ToolCallResolver injection (below) and the tool-calling driver
    // selection (step 4) key on `supportsToolCalling` so they cannot diverge.
    // 482c11e4 keyed the driver on calibration (`toolCallDialect`) while the
    // resolver stayed keyed on capability — a capable-but-uncalibrated model then
    // got a NativeFCStrategy resolver AND a text-parse driver, no native tools
    // were sent, and its `<tool_call>` text was never extracted (loop to
    // max-iterations). Capability is the single master signal.
    // See wiki/Architecture/Design-Specs/2026-06-03-tool-calling-driver-redesign.md.
    let effectiveInput = mergedInput;
    let providerSupportsToolCalling = true; // unknown ⇒ assume capable (native + think.ts no-resolver fallback handles it; pre-482c11e4 default)
    {
      const llmOpt = yield* Effect.serviceOption(LLMService);
      if (llmOpt._tag === "Some" && typeof llmOpt.value.capabilities === "function") {
        const caps = yield* llmOpt.value.capabilities().pipe(
          Effect.catchAll(() => Effect.succeed(DEFAULT_CAPABILITIES)),
        );
        providerSupportsToolCalling = caps.supportsToolCalling;
        // Wave 3 rung-2 (frontier model, FC disabled): `REACTIVE_AGENTS_FORCE_TEXT_PARSE=1`
        // forces the text-parse driver so the taught grammar is exercised on a
        // strong model (house env pattern, cf. REACTIVE_AGENTS_TEXT_PARSE).
        // Single reader; unset/invalid = capability decides (unchanged default).
        // The resolver keys on the EFFECTIVE value (never native-resolver +
        // text-parse-driver — the 482c11e4 divergence class).
        if (process.env.REACTIVE_AGENTS_FORCE_TEXT_PARSE === "1") {
          providerSupportsToolCalling = false;
        }
        if (providerSupportsToolCalling && !mergedInput.toolCallResolver) {
          const resolver = createToolCallResolver(caps);
          effectiveInput = { ...mergedInput, toolCallResolver: resolver };
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
    const hooks = buildKernelHooks(eventBus, effectiveInput.agentId);

    // ── 4. Build KernelContext ────────────────────────────────────────────────
    // Select tool-calling driver from the SAME capability signal as the resolver
    // injection above. Capable (or unknown) ⇒ native driver (resolver present,
    // tools attached — the coherent triple). Only a provider that explicitly
    // reports `supportsToolCalling === false` gets the text-parse driver.
    //
    // W3b (plan 3.3): the dialect argument is the EXPLICIT-CLAIM reader
    // `loadDialectPriorClaim` (GH #243 phantom rule). It is never sourced from
    // `effectiveInput.calibration?.toolCallDialect` — that schema field defaults
    // absent→"none" (ModelCalibrationSchema) and re-enters the phantom-claim
    // class #243 removed. Per the spec's Stage-B end state the claim NEVER picks
    // the route (capability is the sole arbiter, design law #1); it rides on the
    // selected driver as source-tagged provenance (spec §3) so a wrong route
    // is visible on the run context, not silent. A registry-provisional tier
    // (`profile.provisionalTier === true`, W2b) is NOT a routing input either:
    // the degraded text-parse route fires only on a strict capability verdict
    // — pinned end-to-end in tests/kernel/loop/tool-routing-triad.test.ts.
    const dialectClaim = effectiveInput.modelId
      ? loadDialectPriorClaim(effectiveInput.modelId)
      : undefined;
    const toolCallingDriver = selectToolCallingDriver(
      dialectClaim?.dialect,
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

    // ── 5c. Task 10 (shadow-only): judgment comprehend classifier ───────────
    // Fires the batched (possibly chunked) Choice+Score+Nouls speculatively
    // via `Effect.forkDaemon` (same fire-and-forget pattern as adaptive.ts's
    // Task 9 `judgmentClassifyShadow` / complexity-router.ts's Task 9b
    // `judgmentComplexityShadow`) so it never blocks or alters
    // `classifyTask()`'s regex-derived verdict or `nominatedTools` above.
    // Absent JudgmentService (no `.withJudgment()` on the builder) is a clean
    // no-op.
    yield* judgmentComprehendShadow(
      () => ({
        task: effectiveInput.task,
        classification: classifyTask(effectiveInput.task),
        nominatedToolNames: new Set(nominatedTools.map((t) => t.name)),
        availableToolNames: (effectiveInput.availableToolSchemas ?? []).map((t) => t.name),
      }),
      eventBus,
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
    // Wave C.1 slice 3 — live ledger tap watermark. Captured HERE, immediately
    // after the resume/fresh decision and BEFORE any of the pre-loop seeding
    // blocks below grow the ledger (e.g. `recordRequirementsDeclared` at the
    // RunContract compile step), so:
    //   - RESUME-SAFETY: a durable-resumed kernel's `resumeState.ledger` was
    //     already published in the prior process — those entries must NOT
    //     re-publish. Capturing the watermark right at the resume/fresh split
    //     (before any THIS-process growth) excludes exactly those, and only those.
    //   - FRESH-RUN COVERAGE: a fresh run's pre-loop ledger growth (declared
    //     requirements) IS new in this process and must reach `seen` — capturing
    //     the watermark any later (e.g. just before the main loop) would silently
    //     skip publishing those entries, breaking the "every entry exactly once"
    //     invariant the ledger-tap test pins.
    let publishedLedgerLen = state.ledger?.length ?? 0;
    // Seed environmentContext onto state so project()/fromKernelState can
    // reproduce the Environment block (incl. caller custom fields). It lives on
    // KernelInput (react-kernel.ts:193) but was never copied to state, so under
    // RA_ASSEMBLY custom caller env fields dropped (subkernel-env-threading regression).
    if (effectiveInput.environmentContext) {
      state = transitionState(state, { environmentContext: effectiveInput.environmentContext });
    }
    if (effectiveInput.skillsContext) {
      state = transitionState(state, { skillsContext: effectiveInput.skillsContext });
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
    // Issue #231 / DEBT D-2026-10-05-P — seed the run-scoped LLM spend meter.
    // The meter is created ONCE per agent run and carried on the ambient
    // `CurrentRunBudget` FiberRef; we store the LIVE reference on state.meta so
    // the pure+sync Arbitrator (`arbitrationContextFromState`) reads the run's
    // true cumulative spend across every kernel pass and direct LLM call,
    // instead of `state.tokens` (reset per kernel by initialKernelState).
    {
      const ambientMeter = yield* FiberRef.get(CurrentRunBudget);
      if (ambientMeter) {
        // Crash-resume: if the deserialized state carried a persisted meter
        // ahead of the fresh ambient one, max the ambient meter up from it
        // before assigning, so budget already spent before the crash is never
        // forgotten. (The persisted meter is plain data after the codec.)
        const persisted = state.meta.runBudgetMeter;
        if (persisted && persisted.tokens > ambientMeter.tokens) {
          ambientMeter.tokens = persisted.tokens;
        }
        if (persisted && persisted.cost > ambientMeter.cost) {
          ambientMeter.cost = persisted.cost;
        }
        state = transitionState(state, {
          meta: { ...state.meta, runBudgetMeter: ambientMeter },
        });
      }
      // Issue #231 follow-up — seed the run-scoped ORIGINAL budget limits
      // alongside the meter. A multi-kernel strategy (plan-execute) hands each
      // step sub-kernel a REDUCED limit via `withSpentBudget`; the Arbitrator
      // must compare run-TOTAL spend against the run limit, not that reduced
      // one, or it halts early by up to the prior spend. Only seeded when both
      // a meter and limits are armed; a persisted value on resume is preserved.
      const ambientRunLimits = yield* FiberRef.get(CurrentRunBudgetLimits);
      if (ambientMeter && ambientRunLimits) {
        state = transitionState(state, {
          meta: { ...state.meta, runBudgetLimits: ambientRunLimits },
        });
      }
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
    // FM-15 layers 4+5: which tools available to THIS run can write a file?
    // Builtins in WRITING_TOOL_NAMES plus any registered tool declaring
    // `produces:"file"`. Without this the compiler guessed the builtin
    // `file-write`, so an agent with only a custom writer carried a
    // permanently unsatisfiable requirement. Omitted (undefined) when we have
    // no schema list at all, which preserves the legacy guess.
    // Shared by BOTH derivations below (deriveConditions -> state.meta.postConditions
    // and compileRunContract -> contract requirements). They are two authorities
    // over one fact and must agree, or the terminal gate demands a tool the
    // contract never required.
    const availableSchemas =
      effectiveInput.allToolSchemas ?? effectiveInput.availableToolSchemas;
    let availableWritingTools: readonly string[] | undefined;
    if (availableSchemas !== undefined) {
      const names = availableSchemas.map((s) => s.name);
      const writers: string[] = [];
      for (const n of names) {
        if (WRITING_TOOL_NAMES.has(n.toLowerCase())) {
          writers.push(n);
          continue;
        }
        if (toolService._tag !== "Some") continue;
        const declared = yield* toolService.value.getTool(n).pipe(
          Effect.map((d) => d.produces),
          Effect.catchAll(() => Effect.succeed(undefined)),
        );
        if (declared === "file") writers.push(n);
      }
      availableWritingTools = writers;
    }

    // Sprint-1 A4 (2026-06-02): unconditional. Derived from
    // effectiveInput.requiredTools + the task text; conservative — empty set
    // falls back to the prose verdict.
    {
      const derived = deriveConditions(
        effectiveInput.task,
        effectiveInput.requiredTools ?? [],
        availableWritingTools,
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
        ...(availableWritingTools !== undefined ? { availableWritingTools } : {}),
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
      //
      // B7: mint the DECLARED requirement lifecycle facts here, at the contract's
      // FIRST node, so the meta-loop's two live readers (assess.ts satisfiedIds /
      // standing-frame outstanding frame) read a REAL lifecycle instead of `[]`.
      // Routed through the ledger-home emitter (single-writer invariant) and
      // threaded via patch.ledger; behavior-neutral (declared status is neither
      // satisfied nor blocked, so no reader's decision changes at declare).
      state = transitionState(state, {
        meta: { ...state.meta, runContract },
        ledger: recordRequirementsDeclared(state.ledger, runContract.requirements, state.iteration),
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

    // ── GH #244 satisfiability preflight — the fast path for impossible tasks ──
    // When the contract carries an `action-required` requirement (the task
    // needs an external action) AND the tool surface resolves zero relevant
    // tools for it AND no other path exists (no declared required tools, no
    // nominated plausible tool), the run is unsatisfiable: abstain HERE at
    // iteration 0 with a named capability reason instead of looping until
    // the zero-evidence stand-down fires at iteration 2. Conservative by
    // construction — assessActionSatisfiability returns null on every unknown
    // (schemas undefined, declared tools, nominations, any relevant tool), so
    // a viable run can never be killed here; the worst miss falls back to the
    // stand-down (status quo). Routes through terminate() (single-owner
    // gateway) like the §7.5 forced-abstention path; the post-condition gate
    // passes "abstained" through, and the post-loop blocks skip it via
    // isAbstained.
    if (state.status !== "failed") {
      const preflight = assessActionSatisfiability({
        contract: state.meta.runContract,
        task: effectiveInput.task,
        availableSchemas,
        requiredTools,
        nominatedNames: nominatedTools.map((t) => t.name),
      });
      if (preflight !== null) {
        yield* emitGuardFired({
          taskId: options.taskId ?? state.taskId,
          iteration: state.iteration,
          guard: "satisfiability-preflight",
          outcome: "terminate",
          reason: preflight.reason,
          metadata: { missing: preflight.missing },
        });
        state = transitionState(state, { error: null });
        state = terminate(state, {
          reason: "abstained",
          deliverable: sentinelDeliverable("no_substantive_output", preflight.reason),
          extraMeta: {
            abstention: { reason: preflight.reason, missing: preflight.missing },
          },
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
      // Matching 'after' hook — the 'before' fire above had none, leaving
      // every bootstrap pairing in a trace permanently orphaned.
      yield* Effect.promise(() => runPhaseHooks(harnessPipeline, 'after', 'bootstrap', 0, state));
    }

    // ── Durable HITL resume re-entry (Phase D) ───────────────────────────────
    // Decomposed verbatim to ./runner-resume-reentry.ts (Task 9).
    state = yield* runApprovalResumeReentry({ state, effectiveInput, currentContext });

    // ── Durable interaction resume re-entry (Task 10) ────────────────────────
    // Decomposed verbatim to ./runner-resume-reentry.ts (Task 9).
    state = yield* runInteractionResumeReentry({ state, effectiveInput });

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
      // Wave C.1 slice 3 — live ledger tap (exactly-once per entry, seq order).
      // `iterationCarrier.state` holds the post-iteration ledger — `sync()`
      // inside runIterationPass writes it back before every return, including
      // "break".
      if (iterationCarrier.state.ledger && iterationCarrier.state.ledger.length > publishedLedgerLen) {
        yield* hooks.onLedgerAppend(
          iterationCarrier.state,
          iterationCarrier.state.ledger.slice(publishedLedgerLen),
        );
        publishedLedgerLen = iterationCarrier.state.ledger.length;
      }
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
    // Input derivation decomposed verbatim to ./runner-forced-abstention-inputs.ts
    // (Task 9); the decideForcedAbstention call + terminate() route below stay
    // here per the control-plane grandfathering (script-anchored site).
    if (state.meta.terminatedBy !== "abstained") {
      const {
        requiredToolUnavailable,
        unavailableRequired,
        iterationsRemainingForAbstain,
        secondUngroundedTerminal,
        ungroundedSynthesisRejections,
        hasDeliverableForAbstain,
      } = deriveForcedAbstentionInputs({ state, currentInput, currentOptions, requiredTools });

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
          deliverable: sentinelDeliverable("no_substantive_output", forced.reason),
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
    // Decomposed verbatim to ./runner-post-loop-deliverable.ts (Task 9):
    // §8 / §8.5 / §8.7+§8.8 each own one pure-or-Effect finalization block.
    state = applyRequiredToolsFinalCheck({
      state, currentInput, currentOptions, requiredTools,
      isAwaitingApproval, isAwaitingInteraction, isAbstained, isBudgetTerminal,
    });

    // ── 8.5. Non-authoritative termination → harness deliverable ───────────
    state = applyNonFinalAnswerDeliverable({ state });

    // ── 8.7. Output ownership consolidation + 8.8. empty-output fallback ───
    state = yield* applyOutputOwnershipCluster({ state });

    // ── 9.0. Sprint 3.5 — Verifier gate before shipping any output ───────────
    // Decomposed verbatim to ./runner-terminal-verify-gate.ts (Task 9); the
    // gate body is byte-identical to the former lines 1308-1702.
    state = yield* runTerminalVerifierGate({
      state, verifier, effectiveInput, taskIntent, currentOptions, emitLog,
      isAwaitingApproval, isAwaitingInteraction, isAbstained, isBudgetTerminal,
    });

    // ── 9. Output quality gate ────────────────────────────────────────────
    // Decomposed verbatim to ./runner-output-quality-gate.ts (Task 9); this
    // call site owns nothing but the delegate.
    state = yield* runOutputQualityGate({
      state, effectiveInput, taskIntent, emitLog,
      isAwaitingApproval, isAwaitingInteraction, isAbstained, isBudgetTerminal,
    });

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
      // `hooks.onError` only publishes to the EventBus (ReasoningFailed) — a
      // programmatic-subscriber channel nothing in the terminal/status-line
      // pipeline listens on. Without this, a run terminating via `llm_error`
      // (bad model name, connection refused, malformed provider response —
      // the real message is already computed in state.error) printed nothing
      // more specific than "Task failed" anywhere a user could see. Live QA,
      // 2026-08-16 (gemma3:12b, rw-4): zero diagnostic text for an instant
      // `llm_error` failure.
      yield* emitLog({ _tag: "error", message: state.error ?? "unknown error", timestamp: new Date() });
      yield* hooks.onError(state, state.error ?? "unknown error");
    }

    // Wave C.1 slice 3 — live ledger tap, once more after loop exit. Covers any
    // terminal-transition entries minted by the post-loop finalization blocks
    // (§7.5–§9) between the last in-loop firing and this point.
    if (state.ledger && state.ledger.length > publishedLedgerLen) {
      yield* hooks.onLedgerAppend(state, state.ledger.slice(publishedLedgerLen));
      publishedLedgerLen = state.ledger.length;
    }

    // ── 11. Return final state ────────────────────────────────────────────────
    return state;
  });
}
