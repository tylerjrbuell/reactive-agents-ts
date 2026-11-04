// File: src/strategies/plan-execute.ts
/**
 * Plan-Execute-Reflect Strategy — Structured Plan Engine
 *
 * Architecture:
 * 1. Generate plan — call extractStructuredOutput with LLMPlanOutputSchema
 * 2. Hydrate plan — hydratePlan(llmOutput, context) → typed Plan with s1, s2, ... IDs
 * 3. Execute steps (sequential for linear mode):
 *    - tool_call → resolve references via resolveStepReferences → executeToolAndObserve (canonical primitive: policy gate + ledger)
 *    - analysis  → executeReActKernel with buildStepExecutionPrompt, NO tools, max 3 iterations
 *    - composite → executeReActKernel with scoped tools from toolHints, max 3 iterations
 * 4. Retry on failure — retry once with error context; if retry fails, LLM patch via buildPatchPrompt
 * 5. Reflect — call LLM with buildReflectionPrompt. SATISFIED → synthesize. Otherwise refine.
 */
import { Effect, Option, Ref } from "effect";
import type { RunLedger } from "../kernel/ledger/run-ledger.js";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { PlanStoreService } from "@reactive-agents/memory";
import {
  LLMPlanOutputSchema,
  hydratePlan,
  computeWaves,
} from "../types/plan.js";
import {
  stepsMissingRationale,
  injectMissingRequiredToolSteps,
  injectQuantityDeficitSteps,
} from "./plan-execute/plan-enforcement.js";
import type { Plan, PlanStep, LLMPlanOutput } from "../types/plan.js";
import {
  evaluateTerminalGate,
  PLAN_EXECUTE_SATISFIED,
} from "../kernel/capabilities/decide/terminal-gate.js";
import { openStrategyContract } from "../kernel/contract/strategy-contract.js";
import { forbiddenToolsFromContract } from "../kernel/capabilities/act/tool-observe.js";
import { extractStructuredOutput } from "../structured-output/pipeline.js";
import {
  buildPlanGenerationPrompt,
  buildReflectionPrompt,
} from "./planning/plan-prompts.js";
import type { ToolSummary, StepResult } from "./planning/plan-prompts.js";
import type { LogEvent } from "@reactive-agents/observability";
import {
  resolveStrategyServices,
  publishReasoningStep,
  makeStrategyEmitLog,
  emitPhaseEnd,
} from "../kernel/utils/service-utils.js";
import type { StrategyServices } from "../kernel/utils/service-utils.js";
import { emitKernelStateSnapshot } from "../kernel/utils/diagnostics.js";
import {
  makeStep,
  type KernelPause,
} from "../kernel/capabilities/sense/step-utils.js";
import {
  finalizeStrategyResult,
  finalizePausedStrategyResult,
  type JudgedReasoningResult,
} from "../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../kernel/envelope/run-envelope.js";
import { isSatisfied } from "../kernel/capabilities/verify/quality-utils.js";
import { resolveProfile } from "../context/profile-resolver.js";
import { enforceQualityGate } from "../kernel/loop/finalize.js";
import { runCritiquePass } from "../kernel/capabilities/verify/critique.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ── WS-6 Phase 3 — output utilities bucket (B) ──────────────────────────────
// Goal text extraction, FINAL ANSWER stripping, action-tool sanitization.
// See ./planning/plan-text.ts for the moved implementations.
import { extractGoalText } from "./planning/plan-text.js";

// ── WS-6 Phase 3 — plan mutation bucket (A) ─────────────────────────────────
// patchPlan helper (swallows LLM extraction failures into
// Effect.succeed(null) so the refinement loop can fall through). See
// ./planning/plan-mutation.ts for the moved implementations.
import { patchPlan } from "./planning/plan-mutation.js";

// ── WS-6 Phase 3 — step executor bucket (C) ─────────────────────────────────
// Single-step dispatch (tool_call / analysis / composite). StepExecResult is
// the shared shape consumed by the outer orchestrator. See
// ./plan-execute/step-executor.ts for the moved implementation.
import { type StepExecutorInput } from "./plan-execute/step-executor.js";
import { applyWaveResults } from "./plan-execute/apply-wave.js";
import { synthesizePlanAnswer } from "./plan-execute/synthesize.js";
import { refinePlan } from "./plan-execute/refine-plan.js";
import { runStepWithRetries } from "./plan-execute/step-run.js";
import { runSingleAnalysisShortCircuit } from "./plan-execute/single-analysis.js";
import { scoreReflectionAndDispatch, type PEREntropyEntry } from "./plan-execute/reflection-entropy.js";
import { deriveTerminalOutcome } from "./plan-execute/terminal-outcome.js";
import {
  joinEnvelopes,
  type CompletionEnvelope,
} from "../kernel/state/completion-envelope.js";
import { PLANNER_PERSONA } from "./planning/shared-personas.js";
import {
  budgetStopReason,
  isBudgetExhausted,
  withSpentBudget,
} from "./budget/remaining-budget.js";
import { resolveRunSpend } from "./budget/run-budget-spend.js";

export interface PlanExecuteInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  /**
   * Opt-in audit gate (mirrors reactive / KernelInput.auditRationale, owner
   * decision 2026-06-04). When off (default), the planner rationale strict-retry
   * is skipped: tool_call-step `rationale.why` feeds ONLY the debrief audit log
   * (step-executor publishes it on ToolCallStarted), it never drives execution —
   * so re-planning the whole plan to recover it is a pure audit tax on models
   * that omit it. Also honored via env `RA_RATIONALE_AUDIT=1`.
   */
  readonly auditRationale?: boolean;
  /** Full tool schemas passed from execution engine for kernel tool awareness */
  readonly availableToolSchemas?: readonly ToolSchema[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
  /** Tool result compression config */
  readonly resultCompression?: ResultCompressionConfig;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  readonly agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  readonly sessionId?: string;
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Classifier-relevant tools — visible/usable but not gate-enforced. Forwarded
   *  to each per-step ReAct kernel so lazy-disclosure pruning keeps planned
   *  MCP/user tools visible (see reflexion / spot-test GitHub-MCP regression). */
  readonly relevantTools?: readonly string[];
  /** Per-tool minimum call counts from the classifier (e.g. { "web-search": 4 }). */
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Model identifier for routing/entropy scoring */
  readonly modelId?: string;
  /** LLM temperature override */
  readonly temperature?: number;
  readonly skillsContext?: import("../kernel/state/kernel-state.js").SkillsContext;
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
  /** HS-cleanup-2: upstream task classification snapshot (currently unused, kept for forward compat). */
  readonly taskClassification?: import("../kernel/capabilities/comprehend/task-classification.js").TaskClassification;
  /**
   * GH #127 — Compose harness pipeline threaded through plan-execute's
   * refinement-loop RI dispatchContext so applied decisions emit bridged
   * Compose tags (`control.strategy-evaluated`, `lifecycle.failure`,
   * `nudge.healing-failure`) under this outer strategy. Without this thread,
   * users who register `.withHarness(h => h.tap('control.strategy-evaluated', …))`
   * see kernel-path emissions (reactive) but plan-execute remains dark.
   * Mirrors the kernel-side wire at
   * `kernel/capabilities/reflect/reactive-observer.ts:306` (HS-112).
   */
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  // FM-I (#195): cross-cutting fields that must reach each per-step kernel.
  /** Budget killswitch limits (budgetLimit/watchdog). */
  readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
  /** Pre-resolved model calibration — drives steering channel selection. */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  /**
   * #40: long-horizon guard profile — threaded to every composite step's
   * sub-kernel (via StepExecutorInput) so the A2 pace bands, and therefore the
   * budget-terminal honest partial, can arm inside plan-execute exactly like
   * reactive / tree-of-thought (7b6e1ad1).
   */
  readonly horizonProfile?: "long";
  readonly checklistGuidance?: import("../kernel/capabilities/reflect/checklist-reminder.js").ChecklistGuidanceOptions;
  /**
   * P0-4 (tool-policy safety gate). Forwarded to every direct tool-dispatch via
   * the canonical `executeToolAndObserve` primitive so a forbidden or
   * non-allowed tool arriving as a planned step is BLOCKED (not executed) — the
   * gate the hand-rolled dispatch path previously lacked. `forbiddenTools`
   * defaults to the declared `taskContract` deny-list (the production `.withContract`
   * signal); both may be passed explicitly by callers/tests.
   */
  readonly allowedTools?: readonly string[];
  readonly forbiddenTools?: readonly string[];
  // Cascade Task 5: `taskContract` (and the HITL rails) are NOT declared here
  // any more — they ride the RunEnvelope. See `envelope.policy.taskContract`.
}

export const executePlanExecute = (
  input: PlanExecuteInput,
): Effect.Effect<
  JudgedReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService | RunEnvelope
> =>
  Effect.gen(function* () {
    const services = yield* resolveStrategyServices;
    const { llm, toolService, eventBus } = services;

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/plan-execute.ts:emitLog");

    // Cascade Task 5: cross-cutting policy + HITL rails come off the ONE
    // run-wide carrier, never off `input`.
    const envelope = yield* RunEnvelope;

    // Optional PlanStore for persistence (available when memory layer is enabled)
    const planStoreOpt = yield* Effect.serviceOption(PlanStoreService).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none<PlanStoreService["Type"]>())),
    );

    const planConfig = input.config.strategies.planExecute;
    const maxRefinements = planConfig.maxRefinements;
    const reflectionDepth = planConfig.reflectionDepth;
    const stepRetries = planConfig.stepRetries ?? 1;
    // W5.5 strategy-tier honesty: the per-step sub-kernel budget derives from
    // the run's own iteration budget spread over the plan (floor 5), computed
    // at the use site once `plan` exists — see the `derivedStepBudget` below.
    // An explicit `stepKernelMaxIterations` still wins (deliberate tuning
    // beats derivation).
    const stepKernelMaxIterations = planConfig.stepKernelMaxIterations;
    const planMode = planConfig.planMode ?? "linear";

    const steps: ReasoningStep[] = [];
    const start = Date.now();

    // C8 — plan-execute mints NO RunLedger on its own (it returns a
    // ReasoningResult, which carries no ledger). Create one sink here, hand it to
    // every direct tool dispatch via the canonical primitive, and surface the
    // accumulated ledger on `result.metadata.runLedger` so tool-usage +
    // deliverable receipts are no longer blind for plan-execute runs.
    const ledgerRef = yield* Ref.make<RunLedger>([]);
    // P0-4 — the deny-list the safety gate enforces: explicit override first,
    // else the declared TaskContract's forbidden tools (the production
    // `.withContract` signal), via the ONE shared derivation (Cascade Task 7)
    // — `executeToolAndObserve` falls back to this same helper when a caller
    // threads no policy at all, so this pre-derivation and that fallback can
    // never drift apart. Threaded into every dispatch via the primitive.
    const forbiddenToolList: readonly string[] =
      input.forbiddenTools ?? forbiddenToolsFromContract(envelope.policy.taskContract);
    // The step-executor input, augmented with the policy + ledger sink the
    // canonical primitive reads. Built once; passed to every executeStep call.
    const stepExecutorInput: StepExecutorInput = {
      ...input,
      forbiddenTools: forbiddenToolList,
      ledgerSink: ledgerRef,
      // Cascade Task 6: the HITL rails are NOT handed down. Kernel-backed
      // branches get them from `runKernel`'s envelope merge; the `tool_call`
      // branch reads the envelope itself (step-executor.ts). Nothing to drop.
      ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
    };
    let totalTokens = 0;
    // Honest call accounting (2026-07-11 probe p9: llmCalls:0 on every
    // plan-execute run) — planner/patch/augment/reflect/synthesis are direct
    // or nominal-1 calls; per-step counts ride StepExecResult.llmCalls
    // (analysis=1, composite=sub-kernel state.llmCalls, tool dispatch=0).
    let llmCallsTotal = 1; // the initial plan generation
    let totalCost = 0;
    // Most recent sub-kernel raw termination reason. Sub-kernels (composite
    // steps) carry `rawTerminatedBy` on their result; aggregating the last
    // one observed lets plan-execute participate in the same
    // `rawTerminatedBy` → ctx.metadata → AgentCompleted.terminationReason
    // chain reactive uses. Direct-dispatch and analysis steps do not produce
    // a raw reason, so this stays `undefined` for pure tool/analysis plans.
    let lastRawTerminatedBy: string | undefined;
    // Durable pause (Phase D) observed on a step's sub-kernel — set once,
    // ends the plan (see the wave-loop bail below).
    let pendingPause: KernelPause | undefined;
    // Cumulative run budget (2026-10): true once strategy-level accounting
    // finds totalTokens/totalCost >= the declared budgetLimits. The kernel's
    // Arbitrator guard only counts spend SINCE ITS OWN KERNEL START, so with
    // several step sub-kernels plus unguarded outer calls (plan/analysis/
    // reflect/synthesis/gate) the strategy must stop launching new work
    // itself; see ./budget/remaining-budget.ts for the shared accounting.
    let budgetStopped = false;
    // #40 / spec §1b: completion envelopes of every CONTRIBUTING step — steps
    // whose output was accepted into the plan (result.success). Joined
    // worst-of at the result boundary (kernel/state/completion-envelope.ts is
    // the single home of the join rule) so a sub-kernel's unverified-ship
    // markers (harnessAuthoredOutput / budgetTerminalPartial) can cap the
    // strategy's own "output present ⇒ completed" authority. Failed attempts
    // that were patched/replaced do not join — their replacement does.
    const contributingEnvelopes: CompletionEnvelope[] = [];

    // W3 FIX-23: per-strategy RI budget. Accumulates across refinement
    // iterations so dispatcher suppression gates (maxFiresPerRun,
    // maxInterventionTokenBudget) actually trip. Prior to W3 this was
    // hardcoded to {0,0} every refinement, making the gates unreachable.
    // Note: plan-execute spawns sub-kernels per step but the strategy
    // itself runs the reflection-iteration outer loop; budget is scoped
    // to that outer loop here. Sub-kernel-level budget tracking is in
    // reactive-observer.ts via KernelState.meta.riBudget.
    const perStrategyRiBudget = {
      interventionsFiredThisRun: 0,
      tokensSpentOnInterventions: 0,
    };

    let refinement = 0;
    let finalOutput: string | null = null;
    // P3/FM#4 grounded-terminal (2026-07-07): an all-analysis plan can narrate
    // SATISFIED with zero required-tool calls and ship status:success — the F1
    // invariant only guarded the react loop. One redirect (feeds the existing
    // augment machinery), then honest abstention instead of fabricated success.
    let groundedRedirects = 0;
    let groundedAbstained = false;
    // B2: the abstention descriptor (reason + still-missing tools) captured at
    // the grounded-abstain site, so it can cross the strategy→engine boundary
    // as `metadata.abstention` (projectAbstention needs BOTH terminatedBy ===
    // "abstained" AND this descriptor to set receipt.abstained).
    let groundedAbstainMissing: readonly string[] = [];

    // Extract plain goal text from taskDescription (may be JSON-wrapped)
    const goal = extractGoalText(input.taskDescription);

    // D9: the run contract, compiled ONCE by the shared strategy primitive (same
    // inputs as the reactive runner). Finalize judges delivery against it; the
    // reflect prompt lists its requirement descriptions for the coverage check.
    const runContract = yield* openStrategyContract({ task: goal, taskId: input.taskId ?? "plan-execute",
      requiredTools: input.requiredTools ?? [], toolSchemas: input.availableToolSchemas, toolService });
    const reflectRequirements = runContract.requirements.map((r) => r.spec.description);

    // Convert tool schemas to ToolSummary for prompts (mark optional params with ?)
    const toolSummaries: ToolSummary[] = (
      input.availableToolSchemas ?? []
    ).map((t) => ({
      name: t.name,
      signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
    }));

    yield* emitLog({ _tag: "phase_started", phase: "plan-execute:plan", timestamp: new Date() });

    // ── PLAN: Generate initial structured plan ──
    // Tier-aware planning prompt (was hardcoded "mid" — frontier/large models
    // got the small-model planner verbosity, local lost its tighter treatment).
    // Derive the real tier from the model id so the planner prompt matches the
    // model's actual capability across all tiers.
    const planTier = resolveProfile(input.modelId ?? "mid").tier;
    const planPrompt = buildPlanGenerationPrompt({
      goal,
      tools: toolSummaries,
      pastPatterns: [],
      modelTier: planTier,
      requiredToolQuantities: input.requiredToolQuantities,
    });

    const planResult = yield* extractStructuredOutput({
      schema: LLMPlanOutputSchema,
      prompt: planPrompt,
      systemPrompt: input.systemPrompt
        ? `${input.systemPrompt}\n${PLANNER_PERSONA}`
        : PLANNER_PERSONA,
      maxRetries: 2,
      // GH #246: commanded temperature wins; unset keeps the 0.5 default.
      temperature: input.temperature ?? 0.5,
      maxTokens: 4096,
      ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
    }).pipe(
      Effect.mapError(
        (err) =>
          new ExecutionError({
            strategy: "plan-execute-reflect",
            message: `Plan generation failed: ${err.message}`,
            step: 0,
            cause: err,
          }),
      ),
    );

    const planTokenEst =
      Math.ceil(planResult.raw.length / 4) +
      Math.ceil(planPrompt.length / 4);
    totalTokens += planTokenEst;

    yield* emitPhaseEnd({ emitLog, phase: "plan-execute:plan", startedAt: start, totalTokens });

    let plan: Plan = hydratePlan(planResult.data, {
      taskId: input.taskId ?? "plan-execute",
      agentId: input.agentId ?? "reasoning-agent",
      goal,
      planMode,
    });

    // ── Rationale enforcement (coax) ──────────────────────────────────────────
    // Every tool_call step must carry a non-empty rationale.why. The base
    // prompt marks rationale MANDATORY but small models sometimes still omit
    // it. One retry with a stronger reminder typically recovers compliance.
    // Opt-in audit gate: rationale.why is audit-only (debrief), not execution —
    // skip the full re-plan retry unless auditing is on. Saves a planner LLM
    // call on models that omit rationale (parallels the reactive rationale gate).
    const auditRationaleOn =
      input.auditRationale === true || envelope.harness.auditRationale;

    let missing = auditRationaleOn ? stepsMissingRationale(plan) : [];
    if (missing.length > 0) {
      const reminderPrompt = `${planPrompt}\n\n[STRICT RETRY] Your previous plan omitted "rationale" on one or more tool_call steps. EVERY tool_call step MUST include a "rationale": { "why": "<≤280 chars, specific to this call>" } object. Plans without rationale on tool_call steps are rejected. Regenerate the entire plan now, including rationale on every tool_call step.`;
      const retryResult = yield* extractStructuredOutput({
        schema: LLMPlanOutputSchema,
        prompt: reminderPrompt,
        systemPrompt: input.systemPrompt
          ? `${input.systemPrompt}\n${PLANNER_PERSONA} Rationale on tool_call steps is mandatory.`
          : "You are a planning agent. Decompose the goal into structured steps. Rationale on tool_call steps is mandatory.",
        maxRetries: 1,
        // GH #246: commanded temperature wins; unset keeps the 0.3 default.
        temperature: input.temperature ?? 0.3,
        maxTokens: 4096,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      }).pipe(
        Effect.map((r) => hydratePlan(r.data, {
          taskId: input.taskId ?? "plan-execute",
          agentId: input.agentId ?? "reasoning-agent",
          goal,
          planMode,
        })),
        Effect.catchAll(() => Effect.succeed(plan)),
      );
      const retryMissing = stepsMissingRationale(retryResult);
      if (retryMissing.length < missing.length) {
        plan = retryResult;
        missing = retryMissing;
      }
      if (missing.length > 0) {
        yield* emitLog({
          _tag: "metric",
          name: "plan_rationale_missing",
          value: missing.length,
          unit: "steps",
          timestamp: new Date(),
        });
      }
    }

    // ── Required tools validation ─────────────────────────────────────────────
    // After plan generation, verify every required tool appears in at least one
    // tool_call step. Inject synthetic steps for any missing tools so they are
    // guaranteed to be called during execution.
    injectMissingRequiredToolSteps(plan, input.requiredTools ?? [], input.taskDescription ?? "");

    // ── Quantity enforcement ──────────────────────────────────────────────────
    // If the classifier specified per-tool minimum call counts, ensure the plan
    // has enough tool_call steps for each. Inject synthetic steps for any deficit.
    injectQuantityDeficitSteps(plan, input.requiredToolQuantities ?? {});

    // Persist plan to store (if available)
    if (Option.isSome(planStoreOpt)) {
      yield* planStoreOpt.value
        .savePlan(plan as unknown as Parameters<typeof planStoreOpt.value.savePlan>[0])
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:283", tag: errorTag(err) })));
    }

    // Track completed step results across refinements to avoid re-execution
    let completedSteps: PlanStep[] = [];

    // ── Single-analysis-step short-circuit (streamline) ──────────────────────
    // One non-decomposable analysis step collapses to a single generation + quality
    // gate (~reactive cost). Rationale + scope decision: plan-execute/single-analysis.ts.
    if (plan.steps.length === 1 && plan.steps[0]!.type === "analysis") {
      return yield* runSingleAnalysisShortCircuit({
        plan,
        goal,
        input,
        llm,
        eventBus,
        emitLog,
        ledgerRef,
        runContract,
        steps,
        start,
        totalTokens,
        totalCost,
        llmCallsTotal,
      });
    }

    // Entropy history for the PER main loop (plan + reflect iterations)
    let perEntropyHistory: readonly PEREntropyEntry[] = [];

    while (refinement <= maxRefinements) {
      yield* emitLog({
        _tag: "iteration",
        iteration: refinement + 1,
        phase: "action",
        summary: `Plan refinement ${refinement + 1} of ${maxRefinements + 1}`,
        timestamp: new Date(),
      });

      // HS-113 / E2: outer-loop snapshot at plan-iteration boundary.
      yield* emitKernelStateSnapshot({
        state: {
          status: "observing" as const,
          steps: steps.map((s) => ({ type: s.type })),
          toolsUsed: new Set(
            plan.steps
              .filter((ps) => ps.status === "completed" && ps.toolName)
              .map((ps) => ps.toolName!),
          ),
          tokens: totalTokens,
          cost: totalCost,
        },
        taskId: input.taskId ?? "plan-execute",
        iteration: refinement + 1,
        outerLoopName: "plan-execute:plan",
        outerIter: refinement + 1,
      });

      yield* emitLog({ _tag: "phase_started", phase: "plan-execute:execute", timestamp: new Date() });

      steps.push(
        makeStep(
          "thought",
          `[PLAN ${refinement + 1}] ${plan.steps.map((s) => `${s.id}: ${s.title} (${s.type})`).join(", ")}`,
        ),
      );

      const planDetail = plan.steps
        .map(
          (s) =>
            `  ${s.id}: ${s.title} (${s.type}${s.toolName ? ` → ${s.toolName}` : ""}${s.status === "completed" ? " ✓ carried forward" : ""})`,
        )
        .join("\n");

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: maxRefinements + 1,
        thought: `[PLAN ${refinement + 1}] Generated ${plan.steps.length} steps:\n${planDetail}`,
        kernelPass: `plan-execute:plan-${refinement + 1}`,
      });

      // ── EXECUTE: Run steps with dependency-aware wave scheduling ──
      // Independent steps run concurrently; dependent steps wait for predecessors.

      const completedIds = new Set(completedSteps.map((s) => s.id));
      const waves = computeWaves(plan.steps, completedIds);

      const waveLabel = waves.length > 1
        ? `${waves.length} waves (${waves.map((w) => w.length).join("+")} steps)`
        : `${plan.steps.length} steps sequential`;

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: plan.steps.length,
        thought: `[SCHEDULE] ${waveLabel}`,
        kernelPass: `plan-execute:schedule`,
      });

      let waveFailed = false;

      for (const wave of waves) {
        if (waveFailed) break;

        // Cumulative run budget (2026-10): the kernel-side Arbitrator guard is
        // per-kernel-invocation, so the strategy consults CUMULATIVE spend
        // here. Once the run limit is crossed, no new step wave launches.
        const spentAtWaveStart = { tokens: totalTokens, cost: totalCost };
        // Issue #234 — the gate consults the SHARED run meter (maxed over the
        // strategy's local figure) so it and the Arbitrator agree on the
        // boundary. The local figure still feeds `withSpentBudget` below.
        const runSpendAtWaveStart = yield* resolveRunSpend(spentAtWaveStart);
        if (isBudgetExhausted(input.budgetLimits, runSpendAtWaveStart)) {
          budgetStopped = true;
          steps.push(
            makeStep(
              "thought",
              `[BUDGET] ${budgetStopReason(input.budgetLimits, runSpendAtWaveStart) ?? "budget exhausted"}: halting new step waves`,
            ),
          );
          break;
        }
        // Every step kernel in this wave gets the REMAINING budget, not a
        // fresh full pool (withSpentBudget: shared helper, see
        // ./budget/remaining-budget.ts for the accounting boundary).
        const waveInput: StepExecutorInput = {
          ...stepExecutorInput,
          budgetLimits: withSpentBudget(input.budgetLimits, spentAtWaveStart),
        };

        // Execute wave steps — concurrently if multiple, sequentially if one
        const waveEffects = wave.map((step) =>
          runStepWithRetries(
            {
              services,
              input,
              plan,
              completedSteps,
              waveInput,
              toolSummaries,
              emitLog,
              steps,
              stepRetries,
              stepKernelMaxIterations,
            },
            step,
          ),
        );

        // Run wave concurrently (max 4 parallel steps)
        const waveResults = yield* Effect.all(waveEffects, { concurrency: wave.length > 1 ? 4 : 1 });

        // Apply results sequentially to maintain state consistency
        // (plan-execute/apply-wave.ts)
        const applied = yield* applyWaveResults(
          { plan, input, llm, eventBus, planStoreOpt, steps, completedSteps, contributingEnvelopes, totalTokens },
          waveResults,
        );
        totalTokens += applied.tokens;
        totalCost += applied.cost;
        llmCallsTotal += applied.llmCalls;
        if (applied.lastRawTerminatedBy !== undefined) lastRawTerminatedBy = applied.lastRawTerminatedBy;
        if (applied.pause !== undefined) pendingPause = applied.pause;
        if (applied.waveFailed) waveFailed = true;
        // A paused step ends the wave loop too — later waves are downstream of
        // the gated call.
        if (pendingPause !== undefined) break;
      }

      // Durable pause (Phase D): return it as the strategy's terminal result.
      // Everything below (reflect, refine, synthesis) assumes the plan RAN; on a
      // pause it has not, and narrating a completion here is exactly the lie the
      // approval gate exists to prevent.
      if (pendingPause !== undefined) {
        const pauseLedger = yield* Ref.get(ledgerRef);
        return yield* finalizePausedStrategyResult({
          strategy: "plan-execute-reflect",
          steps,
          pause: pendingPause,
          start,
          totalTokens,
          totalCost,
          extraMetadata: { llmCalls: llmCallsTotal, runLedger: pauseLedger },
          // Cascade terminal boundary — judgment inputs (Task 4).
          requiredTools: input.requiredTools ?? [],
          runLedger: pauseLedger,
          // plan-execute has only coarse phase loops — no per-iteration repair
          // hook (spec §3.4).
          repairCapabilities: { perIteration: false },
        });
      }

      // Cumulative run budget: the waves all finished but spend crossed the
      // limit during the last wave. Stop BEFORE the reflect pass (and the
      // refine/synthesis/quality-gate calls it can trigger), because each is
      // fresh outer LLM work the declared budget says the run may not launch.
      const preReflectSpend = yield* resolveRunSpend({
        tokens: totalTokens,
        cost: totalCost,
      });
      if (!budgetStopped && isBudgetExhausted(input.budgetLimits, preReflectSpend)) {
        budgetStopped = true;
        steps.push(
          makeStep(
            "thought",
            `[BUDGET] ${budgetStopReason(input.budgetLimits, preReflectSpend) ?? "budget exhausted"}: halting before reflect`,
          ),
        );
      }
      if (budgetStopped) break;

      yield* emitPhaseEnd({ emitLog, phase: "plan-execute:execute", startedAt: start, totalTokens });

      yield* emitLog({ _tag: "phase_started", phase: "plan-execute:reflect", timestamp: new Date() });

      // HS-113 / E2: outer-loop snapshot at reflect-iteration boundary.
      yield* emitKernelStateSnapshot({
        state: {
          status: "evaluating" as const,
          steps: steps.map((s) => ({ type: s.type })),
          toolsUsed: new Set(
            plan.steps
              .filter((ps) => ps.status === "completed" && ps.toolName)
              .map((ps) => ps.toolName!),
          ),
          tokens: totalTokens,
          cost: totalCost,
        },
        taskId: input.taskId ?? "plan-execute",
        iteration: refinement + 1,
        outerLoopName: "plan-execute:reflect",
        outerIter: refinement + 1,
      });

      // ── REFLECT: Evaluate execution quality ──
      const stepResults: StepResult[] = plan.steps.map((s) => ({
        stepId: s.id,
        title: s.title,
        status: s.status,
        result: s.result ?? s.error,
      }));

      const allStepsCompleted = plan.steps.every((s) => s.status === "completed");

      const reflectionPrompt = buildReflectionPrompt(
        goal,
        stepResults,
        reflectRequirements,
      );

      const reflectSystemPrompt = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are evaluating plan execution. Determine if the task has been adequately addressed.`
        : "You are evaluating plan execution. Determine if the task has been adequately addressed.";

      // Migrated to shared critique primitive — strict upgrade vs prior
      // bare stripThinking: thinking-safe extraction now rescues reflections
      // trapped inside <think> blocks (would have silently returned empty).
      const reflectResult = yield* runCritiquePass({
        llm,
        systemPrompt: reflectSystemPrompt,
        promptBody: reflectionPrompt,
        depth: reflectionDepth,
        strategyName: "plan-execute-reflect",
        step: refinement,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      });

      totalTokens += reflectResult.tokens;
      llmCallsTotal += 1; // critique = one direct LLM call
      totalCost += reflectResult.cost;

      const reflectionContent = reflectResult.content;
      // Honest trace when the reflect LLM call failed and degraded to a no-op —
      // the run keeps its executed plan/answer instead of aborting on a blip.
      if (reflectResult.degraded) {
        steps.push(
          makeStep(
            "observation",
            `[REFLECT ${refinement}] skipped — ${reflectResult.degraded.reason}`,
            { frameworkInstrumentation: "critique-marker" },
          ),
        );
      }

      yield* emitPhaseEnd({ emitLog, phase: "plan-execute:reflect", startedAt: start, totalTokens });

      // ── Entropy scoring + reactive controller for PER reflection iterations ──
      // (plan-execute/reflection-entropy.ts)
      const reflectionEntropy = yield* scoreReflectionAndDispatch({
        services,
        input,
        steps,
        plan,
        refinement,
        maxRefinements,
        totalTokens,
        reflectionContent,
        entropyHistory: perEntropyHistory,
        riBudget: perStrategyRiBudget,
      });
      perEntropyHistory = reflectionEntropy.entropyHistory;
      const perRIEarlyStop = reflectionEntropy.earlyStop;
      if (perRIEarlyStop) break;

      // Trust the reflector's verdict — step completion alone does not mean the goal
      // is met (e.g. a combined search may return incomplete data for each entity).
      // Re-execution of completed steps is already prevented by computeWaves skipping
      // them and by the augmentation path generating only NEW supplementary steps.
      let satisfied = isSatisfied(reflectionContent);
      let reflectionForRefine = reflectionContent;
      const grounded = evaluateGroundedSatisfaction({
        satisfied,
        requiredTools: input.requiredTools,
        completedToolNames: new Set(
          plan.steps
            .filter((st) => st.status === "completed" && st.toolName)
            .map((st) => st.toolName as string),
        ),
        redirectsSoFar: groundedRedirects,
      });
      if (grounded.verdict === "redirect") {
        groundedRedirects++;
        satisfied = false;
        reflectionForRefine = `UNSATISFIED: required tools were never executed: ${grounded.missing.join(", ")}. Add tool_call steps that actually invoke them and ground the answer in their results before declaring the goal met.\n${reflectionContent}`;
      } else if (grounded.verdict === "abstain") {
        groundedAbstained = true;
        groundedAbstainMissing = grounded.missing;
        finalOutput = `Unable to verify this answer: the required tools (${grounded.missing.join(", ")}) were never successfully executed, so the analysis below is ungrounded. ${reflectionContent}`;
        break;
      }

      steps.push(
        makeStep(
          "observation",
          `[REFLECT ${refinement + 1}] ${satisfied ? "SATISFIED" : "UNSATISFIED"} — ${reflectionForRefine}`,
        ),
      );

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: maxRefinements + 1,
        thought: `[REFLECT ${refinement + 1}] ${satisfied ? "✓ SATISFIED" : "✗ UNSATISFIED — refining..."} ${reflectionForRefine}`,
        kernelPass: `plan-execute:reflect-${refinement + 1}`,
      });

      if (satisfied) {
        // ── SYNTHESIZE: clean final answer from step results (plan-execute/synthesize.ts) ──
        const synth = yield* synthesizePlanAnswer({
          plan,
          goal,
          input,
          llm,
          eventBus,
          steps,
          refinement,
          totalTokens,
        });
        totalTokens += synth.tokens;
        totalCost += synth.cost;
        llmCallsTotal += 1;
        finalOutput = synth.output;
        break;
      }

      // ── REFINEMENT: Patch failed steps OR augment with supplementary steps ──
      // (plan-execute/refine-plan.ts)
      const refined = yield* refinePlan({
        plan,
        goal,
        reflectionForRefine,
        input,
        llm,
        eventBus,
        steps,
        refinement,
        maxRefinements,
        totalTokens,
        allStepsCompleted,
      });
      totalTokens += refined.tokensAdded;
      llmCallsTotal += refined.llmCallsAdded;

      refinement++;
    }

    // Build final output from last step results if not already set
    if (!finalOutput) {
      const lastObservations = steps
        .filter(
          (s) => s.type === "observation" && s.content.startsWith("[EXEC"),
        )
        .map((s) => s.content);
      finalOutput =
        lastObservations.join("\n\n") ||
        String(steps[steps.length - 1]?.content ?? "");
    }

    if (finalOutput && !groundedAbstained && !budgetStopped) {
      // plan-execute's `finalOutput` already concatenates raw `[EXEC` tool
      // observations, so the gate operates on the draft directly (no separate
      // toolData harvest needed). Shared module upgrades synthesis to use
      // thinking-safe extraction, rescuing answers trapped inside <think>.
      // Grounded abstention skips the gate: its output is a deliberate
      // harness statement, not a draft to re-synthesize.
      const gated = yield* enforceQualityGate({
        llm,
        taskDescription: input.taskDescription,
        output: finalOutput,
        ...(input.taskId ? { traceContext: { taskId: input.taskId } } : {}),
      });
      finalOutput = gated.output;
      totalTokens += gated.tokens;
      totalCost += gated.cost;
    }

    yield* emitLog({
      _tag: "log",
      level: "debug",
      source: "framework",
      message: finalOutput ? `Plan execution completed successfully` : `Plan execution failed to produce output`,
      timestamp: new Date(),
    });

    // #40 / spec §1b: join the contributing sub-kernel envelopes (worst-of —
    // single home: kernel/state/completion-envelope.ts) and let the aggregate
    // CAP plan-execute's own "output present ⇒ completed" authority. Own
    // authority may still downgrade (grounded abstention, missing output);
    // it may never upgrade past the envelope.
    const subKernelEnvelope = joinEnvelopes(contributingEnvelopes);

    // Status / terminatedBy / honesty metadata: pure derivation (see
    // plan-execute/terminal-outcome.ts) — abstention and budget stops are honest
    // non-successes; the joined envelope caps "completed".
    const { status: finalStatus, terminatedBy, honestyMetadata } = deriveTerminalOutcome({
      finalOutput,
      groundedAbstained,
      groundedAbstainMissing,
      budgetStopped,
      subKernelEnvelope,
      lastRawTerminatedBy,
      budgetLimits: input.budgetLimits,
      totalTokens,
      totalCost,
    });

    // ONE ledger value, read twice (verdict + forwarded metadata).
    const finalLedger = yield* Ref.get(ledgerRef);

    return yield* finalizeStrategyResult({
      strategy: "plan-execute-reflect", taskId: input.taskId ?? "plan-execute",
      steps,
      output: finalOutput,
      status: finalStatus,
      start,
      totalTokens,
      totalCost,
      // Cascade terminal boundary — judgment inputs (Task 4). plan-execute has
      // only coarse phase loops, no per-iteration repair hook (spec §3.4).
      requiredTools: input.requiredTools ?? [],
      runLedger: finalLedger, runContract,
      repairCapabilities: { perIteration: false },
      extraMetadata: {
        terminatedBy,
        llmCalls: llmCallsTotal,
        // C8 — the run's canonical tool ledger (tool-invocation + tool-result
        // per direct dispatch), minted by the primitive into `ledgerRef`.
        runLedger: finalLedger,
        // H5/#40, B2: honesty fields (envelope, budget stop, abstention
        // descriptor, rawTerminatedBy) cross the result boundary.
        ...honestyMetadata,
      },
    });
  });


// ─── Grounded-Terminal Gate (P3/FM#4) ───

/**
 * Pure decision for plan-execute's grounded-terminal gate: a SATISFIED
 * reflection is only acceptable when every required tool was actually
 * executed. First violation redirects (feeds the augment machinery one
 * chance to add real tool steps); a repeat violation abstains honestly
 * instead of shipping an ungrounded success.
 *
 * @internal exported for unit testing.
 */
export function evaluateGroundedSatisfaction(args: {
  satisfied: boolean;
  requiredTools: readonly string[] | undefined;
  completedToolNames: ReadonlySet<string>;
  redirectsSoFar: number;
}): { verdict: "accept" | "redirect" | "abstain"; missing: readonly string[] } {
  if (!args.satisfied) return { verdict: "accept", missing: [] };
  // Phase 3: the decision lives in the kernel terminal gate (coverage check,
  // plan-execute semantics: covered = COMPLETED steps, abstain on exhaustion).
  // Grounding is held true — P3 never had an F1 arm; a SATISFIED plan with
  // zero completed tool steps is exactly the missing-coverage case anyway.
  const gate = evaluateTerminalGate({
    terminatedBy: PLAN_EXECUTE_SATISFIED,
    requiredTools: args.requiredTools ?? [],
    coveredTools: args.completedToolNames,
    hasSubstantiveGrounding: true,
    redirectsSpent: { grounding: 0, coverage: args.redirectsSoFar, checker: 0 },
    coverageExhaustionPolicy: "abstain",
    buildGroundingGuidance: () => "",
    buildCoverageGuidance: (missing) => missing.join(", "),
  });
  if (gate.decision === "accept") return { verdict: "accept", missing: [] };
  return { verdict: gate.decision, missing: gate.missing };
}

// ─── Step Execution Helpers ───
//
// `executeStep` (tool_call / analysis / composite branches) and the
// `StepExecResult` shape were extracted to ./plan-execute/step-executor.ts
// in WS-6 Phase 3 bucket C. The helper takes a narrowed input shape
// (`StepExecutorInput`) instead of the full `PlanExecuteInput`. Import at
// top of file makes the move call-site transparent to the outer orchestrator.

// ─── Plan Mutation Helpers ───
//
// `patchPlan` (rewrite failed + pending steps) and `augmentPlan` (append
// supplementary steps to fill goal gaps) were extracted to
// ./planning/plan-mutation.ts in WS-6 Phase 3 bucket A. Both helpers
// take a narrowed input shape (PatchInput/AugmentInput) so they don't
// re-import the full `PlanExecuteInput` type from this module.

// ─── Utility Helpers ───
//
// Output utilities (extractGoalText, stripFinalAnswerPrefix, sanitizeToolOutput,
// ACTION_TOOL_PATTERNS) were extracted to ./planning/plan-text.ts in
// WS-6 Phase 3 bucket B so step-executor and plan-mutation helpers can import
// without circular dependency. Import added at top of file.
