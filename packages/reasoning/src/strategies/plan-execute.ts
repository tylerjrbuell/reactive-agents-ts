// File: src/strategies/plan-execute.ts
/**
 * Plan-Execute-Reflect Strategy — Structured Plan Engine
 *
 * Architecture:
 * 1. Generate plan — call extractStructuredOutput with LLMPlanOutputSchema
 * 2. Hydrate plan — hydratePlan(llmOutput, context) → typed Plan with s1, s2, ... IDs
 * 3. Execute steps (dependency-aware waves):
 *    - tool_call → resolve references via resolveStepReferences → executeToolAndObserve (canonical primitive: policy gate + ledger)
 *    - analysis  → one direct model call (`run.call`) with buildStepExecutionPrompt, NO tools
 *    - composite → one ReAct pass (`run.pass`) with scoped tools from toolHints
 * 4. Retry on failure — retry once with error context; if retry fails, LLM patch via buildPatchPrompt
 * 5. Reflect — call LLM with buildReflectionPrompt (skipped when every step completed and the
 *    deterministic delivery verdict already verified the contract). SATISFIED → synthesize. Otherwise refine.
 *
 * The strategy run substrate (`runStrategy`) owns the trajectory: steps, spend,
 * the one run ledger, every composite pass's envelope, the pause terminal and
 * the result mint. This body is plan-execute's control flow only.
 */
import { Effect, Option } from "effect";
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
  repairGeneratedPlan,
} from "./plan-execute/plan-enforcement.js";
import type { Plan, PlanStep } from "../types/plan.js";
import { proposeStrategyExit, type StrategyExitResult } from "../kernel/loop/strategy-exit-gate.js";
import { unfinishedBlock } from "../kernel/loop/handoff-synthesis.js";
import { judgeStrategyDelivery } from "../kernel/capabilities/verify/strategy-delivery.js";
import { makePlanChecklist } from "./planning/plan-checklist.js";
import { openStrategyContract } from "../kernel/contract/strategy-contract.js";
import { forbiddenToolsFromContract } from "../kernel/capabilities/act/tool-observe.js";
import { extractStructuredOutput } from "../structured-output/pipeline.js";
import { buildPlanGenerationPrompt } from "./planning/plan-prompts.js";
import type { ToolSummary } from "./planning/plan-prompts.js";
import {
  resolveStrategyServices,
  publishReasoningStep,
  emitPhaseEnd,
} from "../kernel/utils/service-utils.js";
import { emitKernelStateSnapshot } from "../kernel/utils/diagnostics.js";
import { makeStep } from "../kernel/capabilities/sense/step-utils.js";
import type { JudgedReasoningResult } from "../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../kernel/envelope/run-envelope.js";
import { isSatisfied } from "../kernel/capabilities/verify/quality-utils.js";
import { resolveProfile } from "../context/profile-resolver.js";
import { enforceQualityGate } from "../kernel/loop/finalize.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ── WS-6 Phase 3 — output utilities bucket (B) ──────────────────────────────
// Goal text extraction, FINAL ANSWER stripping, action-tool sanitization.
// See ./planning/plan-text.ts for the moved implementations.
import { extractGoalText } from "./planning/plan-text.js";

// ── WS-6 Phase 3 — step executor bucket (C) ─────────────────────────────────
// Single-step dispatch (tool_call / analysis / composite). See
// ./plan-execute/step-executor.ts for the moved implementation.
import { type StepExecutorInput } from "./plan-execute/step-executor.js";
import { applyWaveResults, MAX_INLINE_PATCHES, runnableSteps } from "./plan-execute/apply-wave.js";
import { synthesizePlanAnswer } from "./plan-execute/synthesize.js";
import { refinePlan } from "./plan-execute/refine-plan.js";
import { runStepWithRetries } from "./plan-execute/step-run.js";
import { runSingleAnalysisShortCircuit } from "./plan-execute/single-analysis.js";
import { scoreReflectionAndDispatch, type PEREntropyEntry } from "./plan-execute/reflection-entropy.js";
import { reflectOnPlan } from "./plan-execute/reflect.js";
import { planTerminalOutcome } from "./plan-execute/terminal-outcome.js";
import { PLANNER_PERSONA } from "./planning/shared-personas.js";
import {
  budgetStopReason,
  isBudgetExhausted,
  withSpentBudget,
} from "./budget/remaining-budget.js";
import { runStrategy, StrategyPaused } from "./substrate/strategy-run.js";

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

/**
 * Run the plan-execute-reflect strategy on the strategy run substrate: plan,
 * execute the plan in dependency waves, reflect, refine or synthesize. Ends in
 * the substrate's judged result (or its paused result at an approval gate).
 */
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

    // Cascade Task 5: cross-cutting policy + HITL rails come off the ONE
    // run-wide carrier, never off `input`.
    const envelope = yield* RunEnvelope;

    // Optional PlanStore for persistence (available when memory layer is enabled)
    const planStoreOpt = yield* Effect.serviceOption(PlanStoreService).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none<PlanStoreService["Type"]>())), // substrate-ok: service lookup, no run.pass inside
    );

    const planConfig = input.config.strategies.planExecute;
    const maxRefinements = planConfig.maxRefinements;
    const reflectionDepth = planConfig.reflectionDepth;
    const stepRetries = planConfig.stepRetries ?? 1;
    // W5.5 strategy-tier honesty: the per-step sub-kernel budget derives from
    // the run's own iteration budget spread over the plan (floor 5), computed
    // at the use site once `plan` exists (plan-execute/step-run.ts). An
    // explicit `stepKernelMaxIterations` still wins (deliberate tuning beats
    // derivation).
    const stepKernelMaxIterations = planConfig.stepKernelMaxIterations;
    const planMode = planConfig.planMode ?? "linear";
    const taskId = input.taskId ?? "plan-execute";

    // The substrate owns the trajectory: one run ledger (direct tool dispatch,
    // the plan checklist and every composite pass write into it), spend and
    // call accounting, the worst-of envelope cap over composite passes, the
    // pause terminal and the claim rule. plan-execute has only coarse phase
    // loops — no per-iteration repair hook (spec §3.4).
    return yield* runStrategy(
      {
        strategy: "plan-execute-reflect",
        taskId,
        requiredTools: input.requiredTools ?? [],
        repairCapabilities: { perIteration: false },
        logSite: "reasoning/src/strategies/plan-execute.ts:emitLog",
      },
      (run) => Effect.gen(function* () {
    const emitLog = run.emitLog;
    const start = run.start;

    // P0-4 — the deny-list the safety gate enforces: explicit override first,
    // else the declared TaskContract's forbidden tools (the production
    // `.withContract` signal), via the ONE shared derivation (Cascade Task 7)
    // — `executeToolAndObserve` falls back to this same helper when a caller
    // threads no policy at all, so this pre-derivation and that fallback can
    // never drift apart. Threaded into every dispatch via the primitive.
    const forbiddenToolList: readonly string[] =
      input.forbiddenTools ?? forbiddenToolsFromContract(envelope.policy.taskContract);
    // The step-executor input, augmented with the policy + the run ledger sink
    // the canonical primitive reads. Built once; passed to every executeStep call.
    const stepExecutorInput: StepExecutorInput = {
      ...input,
      forbiddenTools: forbiddenToolList,
      // C8 — direct tool dispatch mints its tool-invocation + tool-result
      // entries into the run's ONE ledger.
      ledgerSink: run.ledgerSink,
      // Cascade Task 6: the HITL rails are NOT handed down. Kernel-backed
      // branches get them from `runKernel`'s envelope merge; the `tool_call`
      // branch reads the envelope itself (step-executor.ts). Nothing to drop.
      ...(input.allowedTools !== undefined ? { allowedTools: input.allowedTools } : {}),
    };
    // Cumulative run budget (2026-10): true once strategy-level accounting
    // finds the run's spend >= the declared budgetLimits. The kernel's
    // Arbitrator guard only counts spend SINCE ITS OWN KERNEL START, so with
    // several step sub-kernels plus unguarded outer calls (plan/analysis/
    // reflect/synthesis/gate) the strategy must stop launching new work
    // itself; see ./budget/remaining-budget.ts for the shared accounting.
    let budgetStopped = false;
    const planChecklist = yield* makePlanChecklist({ ledger: run.ledgerSink, eventBus, taskId,
      ...(input.agentId ? { agentId: input.agentId } : {}), site: "reasoning/src/strategies/plan-execute.ts:plan-checklist" });

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
    // D9: the delivery gate's one repair has been spent; a refused exit to hand off.
    let deliveryDenied = false;
    let deliveryHandoff: Extract<StrategyExitResult, { _tag: "handoff" | "accept-with-failure" }> | undefined;
    // B2: the still-missing tools captured at the grounded-abstain site, so the
    // abstention descriptor crosses the strategy→engine boundary (the substrate
    // mints `terminatedBy: "abstained"` + `metadata.abstention` from it).
    let groundedAbstainMissing: readonly string[] = [];

    // Extract plain goal text from taskDescription (may be JSON-wrapped)
    const goal = extractGoalText(input.taskDescription);

    // D9: the run contract, compiled ONCE by the shared strategy primitive (same
    // inputs as the reactive runner). Finalize judges delivery against it; the
    // reflect prompt lists its requirement descriptions for the coverage check.
    const runContract = yield* openStrategyContract({ task: goal, taskId,
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

    // The structured-output pipeline reports no usage: the planner's spend is
    // estimated from its prompt + raw output (one nominal LLM call).
    run.account({
      tokens: Math.ceil(planResult.raw.length / 4) + Math.ceil(planPrompt.length / 4),
      llmCalls: 1,
    });

    yield* emitPhaseEnd({ emitLog, phase: "plan-execute:plan", startedAt: start, totalTokens: run.spend().tokens });

    let plan: Plan = hydratePlan(planResult.data, {
      taskId,
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
        // Same estimate as the planner call (no usage from the pipeline).
        Effect.tap((r) => Effect.sync(() => run.account({
          tokens: Math.ceil(r.raw.length / 4) + Math.ceil(reminderPrompt.length / 4),
          llmCalls: 1,
        }))),
        Effect.map((r) => hydratePlan(r.data, {
          taskId,
          agentId: input.agentId ?? "reasoning-agent",
          goal,
          planMode,
        })),
        Effect.catchAll(() => Effect.succeed(plan)), // substrate-ok: planner retry is a direct structured call, no run.pass inside
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

    // ── Deterministic plan repair (plan-execute/plan-enforcement.ts) ──────────
    // Fan-out producers split per file, every required tool gets a step,
    // quantities are padded, an underspecified tool_call runs as a composite.
    yield* repairGeneratedPlan(plan, input, taskId);

    // Persist plan to store (if available)
    if (Option.isSome(planStoreOpt)) {
      yield* planStoreOpt.value
        .savePlan(plan as unknown as Parameters<typeof planStoreOpt.value.savePlan>[0])
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:283", tag: errorTag(err) }))); // substrate-ok: plan-store write, no run.pass inside
    }

    // Track completed step results across refinements to avoid re-execution
    let completedSteps: PlanStep[] = [];

    // ── Single-analysis-step short-circuit (streamline) ──────────────────────
    // One non-decomposable analysis step collapses to a single generation + quality
    // gate (~reactive cost). Rationale + scope decision: plan-execute/single-analysis.ts.
    if (plan.steps.length === 1 && plan.steps[0]!.type === "analysis") {
      return yield* runSingleAnalysisShortCircuit({ plan, goal, input, llm, eventBus, emitLog, runContract, run });
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
          steps: run.steps().map((s) => ({ type: s.type })),
          toolsUsed: new Set(
            plan.steps
              .filter((ps) => ps.status === "completed" && ps.toolName)
              .map((ps) => ps.toolName!),
          ),
          tokens: run.spend().tokens,
          cost: run.spend().cost,
        },
        taskId,
        iteration: refinement + 1,
        outerLoopName: "plan-execute:plan",
        outerIter: refinement + 1,
      });

      yield* emitLog({ _tag: "phase_started", phase: "plan-execute:execute", timestamp: new Date() });

      run.record(
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
        taskId,
        strategy: "plan-execute-reflect",
        step: run.steps().length,
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
        taskId,
        strategy: "plan-execute-reflect",
        step: run.steps().length,
        totalSteps: plan.steps.length,
        thought: `[SCHEDULE] ${waveLabel}`,
        kernelPass: `plan-execute:schedule`,
      });

      let inlinePatches = 0;
      for (let w = 0; w < waves.length; w++) {
        const wave = runnableSteps(waves[w]!, plan);
        // Cumulative run budget (2026-10): the kernel-side Arbitrator guard is
        // per-kernel-invocation, so the strategy consults CUMULATIVE spend
        // here. Once the run limit is crossed, no new step wave launches.
        const spentAtWaveStart = { tokens: run.spend().tokens, cost: run.spend().cost };
        // Issue #234 — the gate consults the SHARED run meter (maxed over the
        // strategy's local figure) so it and the Arbitrator agree on the
        // boundary. The local figure still feeds `withSpentBudget` below.
        const runSpendAtWaveStart = yield* run.runSpend();
        if (isBudgetExhausted(input.budgetLimits, runSpendAtWaveStart)) {
          budgetStopped = true;
          run.record(
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

        // D9 P7: the plan is the checklist — rows added/advanced live, no `todo` call.
        yield* planChecklist.sync(plan.steps, { active: wave.map((s) => s.id), iteration: refinement });
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
              steps: run.steps(),
              stepRetries,
              stepKernelMaxIterations,
              run,
            },
            step,
          ),
        );

        // Run wave concurrently (max 4 parallel steps). Composite passes defer
        // their pause, so every sibling finishes and is recorded first.
        const waveResults = yield* Effect.all(waveEffects, { concurrency: wave.length > 1 ? 4 : 1 });

        // Apply results sequentially to maintain state consistency
        // (plan-execute/apply-wave.ts)
        const applied = yield* applyWaveResults(
          {
            plan, input, llm, eventBus, planStoreOpt, completedSteps,
            steps: run.steps(), record: run.record, totalTokens: run.spend().tokens,
          },
          waveResults,
        );
        run.account({ tokens: applied.tokens, llmCalls: applied.llmCalls });
        // A patch rewrote the remaining steps: run them now, not after a reflect on an unrun plan.
        if (applied.waveFailed && ++inlinePatches > MAX_INLINE_PATCHES) break;
        if (applied.waveFailed) waves.splice(w + 1, waves.length, ...computeWaves(plan.steps, new Set(completedSteps.map((s) => s.id))));
        yield* planChecklist.sync(plan.steps, { iteration: refinement });
        // Durable pause (Phase D): a paused step ends the run here with the
        // paused result. Everything below (later waves, reflect, refine,
        // synthesis) assumes the plan RAN; narrating a completion around an
        // unapproved call is exactly the lie the approval gate exists to
        // prevent. A composite pass's pause is the substrate's (checkpoint);
        // a direct tool_call step's gate pause is ended here.
        yield* run.checkpoint();
        if (applied.pause !== undefined) {
          return yield* Effect.fail(new StrategyPaused({ pause: applied.pause }));
        }
      }

      // Cumulative run budget: the waves all finished but spend crossed the
      // limit during the last wave. Stop BEFORE the reflect pass (and the
      // refine/synthesis/quality-gate calls it can trigger), because each is
      // fresh outer LLM work the declared budget says the run may not launch.
      const preReflectSpend = yield* run.runSpend();
      if (!budgetStopped && isBudgetExhausted(input.budgetLimits, preReflectSpend)) {
        budgetStopped = true;
        run.record(
          makeStep(
            "thought",
            `[BUDGET] ${budgetStopReason(input.budgetLimits, preReflectSpend) ?? "budget exhausted"}: halting before reflect`,
          ),
        );
      }
      if (budgetStopped) break;

      yield* emitPhaseEnd({ emitLog, phase: "plan-execute:execute", startedAt: start, totalTokens: run.spend().tokens });

      yield* emitLog({ _tag: "phase_started", phase: "plan-execute:reflect", timestamp: new Date() });

      // HS-113 / E2: outer-loop snapshot at reflect-iteration boundary.
      yield* emitKernelStateSnapshot({
        state: {
          status: "evaluating" as const,
          steps: run.steps().map((s) => ({ type: s.type })),
          toolsUsed: new Set(
            plan.steps
              .filter((ps) => ps.status === "completed" && ps.toolName)
              .map((ps) => ps.toolName!),
          ),
          tokens: run.spend().tokens,
          cost: run.spend().cost,
        },
        taskId,
        iteration: refinement + 1,
        outerLoopName: "plan-execute:reflect",
        outerIter: refinement + 1,
      });

      // ── REFLECT: evaluate execution quality, or skip when the deterministic
      // delivery verdict already decided (plan-execute/reflect.ts) ──
      const allStepsCompleted = plan.steps.every((s) => s.status === "completed");
      const reflected = yield* reflectOnPlan({
        run, llm, input, goal, plan, runContract, requirements: reflectRequirements, refinement, depth: reflectionDepth,
      });
      const reflectionContent = reflected.content;
      const reflectSkipped = reflected.skipped;

      yield* emitPhaseEnd({ emitLog, phase: "plan-execute:reflect", startedAt: start, totalTokens: run.spend().tokens });

      // ── Entropy scoring + reactive controller for PER reflection iterations ──
      // (plan-execute/reflection-entropy.ts). A skipped reflect produced no model
      // thought to score.
      if (!reflectSkipped) {
        const reflectionEntropy = yield* scoreReflectionAndDispatch({
          services,
          input,
          steps: run.steps(),
          plan,
          refinement,
          maxRefinements,
          totalTokens: run.spend().tokens,
          reflectionContent,
          entropyHistory: perEntropyHistory,
          riBudget: perStrategyRiBudget,
        });
        perEntropyHistory = reflectionEntropy.entropyHistory;
        if (reflectionEntropy.earlyStop) break;
      }

      // Trust the reflector's verdict — step completion alone does not mean the goal
      // is met (e.g. a combined search may return incomplete data for each entity).
      // Re-execution of completed steps is already prevented by computeWaves skipping
      // them and by the augmentation path generating only NEW supplementary steps.
      let satisfied = isSatisfied(reflectionContent);
      let reflectionForRefine = reflectionContent;
      let repairGuidance: string | undefined;
      // D9: a SATISFIED claim goes through the shared strategy exit gate (required-tool
      // grounding, then delivery of the contract's files): one repair, then handoff.
      const exit = !satisfied ? undefined : yield* proposeStrategyExit({
        strategy: "plan-execute", contract: runContract, taskId, iteration: refinement,
        evidence: { steps: run.steps(), ledger: yield* run.ledger() },
        deniedBefore: deliveryDenied, roomForOneMore: refinement < maxRefinements,
        hasMaterial: plan.steps.some((st) => st.status === "completed" && !!st.result),
        toolGrounding: { requiredTools: input.requiredTools, redirectsSoFar: groundedRedirects,
          completedToolNames: new Set(plan.steps.filter((st) => st.status === "completed" && st.toolName).map((st) => st.toolName as string)) },
      });
      if (exit?._tag === "redirect") {
        groundedRedirects++;
        satisfied = false;
        reflectionForRefine = `UNSATISFIED: required tools were never executed: ${exit.missing.join(", ")}. Add tool_call steps that actually invoke them and ground the answer in their results before declaring the goal met.\n${reflectionContent}`;
      } else if (exit?._tag === "abstain") {
        groundedAbstained = true;
        groundedAbstainMissing = exit.missing;
        finalOutput = `Unable to verify this answer: the required tools (${exit.missing.join(", ")}) were never successfully executed, so the analysis below is ungrounded. ${reflectionContent}`;
        break;
      } else if (exit?._tag === "repair") {
        deliveryDenied = true;
        satisfied = false;
        repairGuidance = exit.guidance;
        reflectionForRefine = `UNSATISFIED: ${exit.guidance}\n${reflectionContent}`;
      } else if (exit?._tag === "handoff" || exit?._tag === "accept-with-failure") {
        deliveryHandoff = exit;
      }

      run.record(
        makeStep(
          "observation",
          `[REFLECT ${refinement + 1}] ${satisfied ? "SATISFIED" : "UNSATISFIED"} — ${reflectionForRefine}`,
        ),
      );

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId,
        strategy: "plan-execute-reflect",
        step: run.steps().length,
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
          record: run.record,
          refinement,
          totalTokens: run.spend().tokens,
        });
        run.account({ tokens: synth.tokens, cost: synth.cost, llmCalls: 1 });
        finalOutput = synth.output;
        break;
      }

      // ── REFINEMENT: Patch failed steps OR augment with supplementary steps ──
      // (plan-execute/refine-plan.ts)
      const refined = yield* refinePlan({
        plan,
        goal,
        reflectionForRefine,
        ...(repairGuidance ? { repairGuidance } : {}),
        input,
        llm,
        eventBus,
        steps: run.steps(),
        record: run.record,
        refinement,
        maxRefinements,
        totalTokens: run.spend().tokens,
        allStepsCompleted,
      });
      run.account({ tokens: refined.tokensAdded, llmCalls: refined.llmCallsAdded });

      refinement++;
    }

    // Build final output from last step results if not already set
    if (!finalOutput) {
      const steps = run.steps();
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
      run.account({ tokens: gated.tokens, cost: gated.cost });
    }
    // D9 handoff: the harness, not the model, names what is still missing (after the
    // quality gate so a rewrite cannot drop it).
    if (deliveryHandoff && finalOutput) finalOutput = `${finalOutput}\n\n${unfinishedBlock(deliveryHandoff.outstanding)}`;

    yield* emitLog({
      _tag: "log",
      level: "debug",
      source: "framework",
      message: finalOutput ? `Plan execution completed successfully` : `Plan execution failed to produce output`,
      timestamp: new Date(),
    });

    // D9: judge delivery ONCE at the terminal; the verdict lifts an UNMARKED
    // step partial (the substrate's cap under verdict) and is the decision
    // finalize mints (no second judge).
    const delivery = judgeStrategyDelivery(runContract, {
      steps: run.steps(), ledger: yield* run.ledger(), ...(finalOutput ? { output: finalOutput } : {}),
    });
    const deliveryDecision = deliveryHandoff?.decision ?? delivery.decision;

    // The substrate caps output presence ⇒ `completed` under the worst-of
    // composite envelope (#40 / spec §1b) and the delivery verdict, claims
    // `final_answer` iff completed, and relays the last composite pass's raw
    // terminator. A failed step makes it `partial` (the verdict may lift it);
    // abstention / budget stop override (plan-execute/terminal-outcome.ts).
    const outcome = planTerminalOutcome({
      groundedAbstained,
      groundedAbstainMissing,
      budgetStopped,
      budgetLimits: input.budgetLimits,
      spend: run.spend(),
    });
    return {
      _tag: "Result" as const,
      output: finalOutput,
      status: finalOutput && !plan.steps.some((s) => s.status === "failed") ? ("completed" as const) : ("partial" as const),
      verdict: { accepted: deliveryDecision.accepted, met: delivery.met },
      ...(outcome !== undefined ? { outcome } : {}),
      delivery: { runContract, decision: deliveryDecision },
    };
      }),
    );
  });


// Helpers live beside this orchestrator: step execution in ./plan-execute/step-executor.ts,
// plan mutation (patch/augment) in ./planning/plan-mutation.ts, output utilities in
// ./planning/plan-text.ts, the grounded-terminal + delivery gate in
// kernel/loop/strategy-exit-gate.ts (D9), the shared plan checklist in ./planning/plan-checklist.ts,
// and the trajectory (spend, ledger, envelopes, pause, result mint) in ./substrate/strategy-run.ts.
