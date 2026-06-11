// File: src/strategies/plan-execute.ts
/**
 * Plan-Execute-Reflect Strategy — Structured Plan Engine
 *
 * Architecture:
 * 1. Generate plan — call extractStructuredOutput with LLMPlanOutputSchema
 * 2. Hydrate plan — hydratePlan(llmOutput, context) → typed Plan with s1, s2, ... IDs
 * 3. Execute steps (sequential for linear mode):
 *    - tool_call → resolve references via resolveStepReferences → toolService.execute() directly
 *    - analysis  → executeReActKernel with buildStepExecutionPrompt, NO tools, max 3 iterations
 *    - composite → executeReActKernel with scoped tools from toolHints, max 3 iterations
 * 4. Retry on failure — retry once with error context; if retry fails, LLM patch via buildPatchPrompt
 * 5. Reflect — call LLM with buildReflectionPrompt. SATISFIED → synthesize. Otherwise refine.
 */
import { Effect, Cause, Exit, Option } from "effect";
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
import type { Plan, PlanStep, LLMPlanOutput } from "../types/plan.js";
import { extractStructuredOutput } from "../structured-output/pipeline.js";
import {
  buildPlanGenerationPrompt,
  buildReflectionPrompt,
} from "./plan-prompts.js";
import type { ToolSummary, StepResult } from "./plan-prompts.js";
import type { LogEvent } from "@reactive-agents/observability";
import {
  resolveStrategyServices,
  publishReasoningStep,
  makeStrategyEmitLog,
  emitPhaseEnd,
} from "../kernel/utils/service-utils.js";
import type { StrategyServices } from "../kernel/utils/service-utils.js";
import { emitKernelStateSnapshot } from "../kernel/utils/diagnostics.js";
import { makeStep, buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import { isSatisfied } from "../kernel/capabilities/verify/quality-utils.js";
import {
  extractThinkingSafeContent,
  THINKING_SAFE_MIN_TOKENS,
} from "../kernel/utils/stream-parser.js";
import { enforceQualityGate } from "../kernel/loop/finalize.js";
import { runCritiquePass } from "../kernel/capabilities/verify/critique.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { withEnvContext } from "../context/context-engine.js";

// ── WS-6 Phase 3 — output utilities bucket (B) ──────────────────────────────
// Goal text extraction, FINAL ANSWER stripping, action-tool sanitization.
// See ./plan-execute/output-utils.ts for the moved implementations.
import { extractGoalText } from "./plan-execute/output-utils.js";

// ── WS-6 Phase 3 — plan mutation bucket (A) ─────────────────────────────────
// patchPlan + augmentPlan helpers (both swallow LLM extraction failures into
// Effect.succeed(null) so the refinement loop can fall through). See
// ./plan-execute/plan-mutation.ts for the moved implementations.
import {
  patchPlan,
  augmentPlan,
} from "./plan-execute/plan-mutation.js";

// ── WS-6 Phase 3 — step executor bucket (C) ─────────────────────────────────
// Single-step dispatch (tool_call / analysis / composite). StepExecResult is
// the shared shape consumed by the outer orchestrator. See
// ./plan-execute/step-executor.ts for the moved implementation.
import { executeStep } from "./plan-execute/step-executor.js";

interface PlanExecuteInput {
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
}

export const executePlanExecute = (
  input: PlanExecuteInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const services = yield* resolveStrategyServices;
    const { llm, toolService, eventBus } = services;

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/plan-execute.ts:emitLog");

    // Optional PlanStore for persistence (available when memory layer is enabled)
    const planStoreOpt = yield* Effect.serviceOption(PlanStoreService).pipe(
      Effect.catchAll(() => Effect.succeed(Option.none<PlanStoreService["Type"]>())),
    );

    const planConfig = input.config.strategies.planExecute;
    const maxRefinements = planConfig.maxRefinements;
    const reflectionDepth = planConfig.reflectionDepth;
    const stepRetries = planConfig.stepRetries ?? 1;
    const stepKernelMaxIterations = planConfig.stepKernelMaxIterations ?? 3;
    const planMode = planConfig.planMode ?? "linear";

    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;
    // Most recent sub-kernel raw termination reason. Sub-kernels (composite
    // steps) carry `rawTerminatedBy` on their result; aggregating the last
    // one observed lets plan-execute participate in the same
    // `rawTerminatedBy` → ctx.metadata → AgentCompleted.terminationReason
    // chain reactive uses. Direct-dispatch and analysis steps do not produce
    // a raw reason, so this stays `undefined` for pure tool/analysis plans.
    let lastRawTerminatedBy: string | undefined;

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

    // Extract plain goal text from taskDescription (may be JSON-wrapped)
    const goal = extractGoalText(input.taskDescription);

    // Convert tool schemas to ToolSummary for prompts (mark optional params with ?)
    const toolSummaries: ToolSummary[] = (
      input.availableToolSchemas ?? []
    ).map((t) => ({
      name: t.name,
      signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
    }));

    yield* emitLog({ _tag: "phase_started", phase: "plan-execute:plan", timestamp: new Date() });

    // ── PLAN: Generate initial structured plan ──
    const planPrompt = buildPlanGenerationPrompt({
      goal,
      tools: toolSummaries,
      pastPatterns: [],
      modelTier: "mid",
      requiredToolQuantities: input.requiredToolQuantities,
    });

    const planResult = yield* extractStructuredOutput({
      schema: LLMPlanOutputSchema,
      prompt: planPrompt,
      systemPrompt: input.systemPrompt
        ? `${input.systemPrompt}\nYou are a planning agent. Decompose the goal into structured steps.`
        : "You are a planning agent. Decompose the goal into structured steps.",
      maxRetries: 2,
      temperature: 0.5,
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
    const stepsMissingRationale = (p: Plan): readonly PlanStep[] =>
      p.steps.filter((s) => s.type === "tool_call" && (!s.rationale || typeof s.rationale.why !== "string" || s.rationale.why.trim().length === 0));

    // Opt-in audit gate: rationale.why is audit-only (debrief), not execution —
    // skip the full re-plan retry unless auditing is on. Saves a planner LLM
    // call on models that omit rationale (parallels the reactive rationale gate).
    const auditRationaleOn =
      input.auditRationale === true || process.env.RA_RATIONALE_AUDIT === "1";

    let missing = auditRationaleOn ? stepsMissingRationale(plan) : [];
    if (missing.length > 0) {
      const reminderPrompt = `${planPrompt}\n\n[STRICT RETRY] Your previous plan omitted "rationale" on one or more tool_call steps. EVERY tool_call step MUST include a "rationale": { "why": "<≤280 chars, specific to this call>" } object. Plans without rationale on tool_call steps are rejected. Regenerate the entire plan now, including rationale on every tool_call step.`;
      const retryResult = yield* extractStructuredOutput({
        schema: LLMPlanOutputSchema,
        prompt: reminderPrompt,
        systemPrompt: input.systemPrompt
          ? `${input.systemPrompt}\nYou are a planning agent. Decompose the goal into structured steps. Rationale on tool_call steps is mandatory.`
          : "You are a planning agent. Decompose the goal into structured steps. Rationale on tool_call steps is mandatory.",
        maxRetries: 1,
        temperature: 0.3,
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
    const requiredTools = input.requiredTools ?? [];
    if (requiredTools.length > 0) {
      const plannedTools = new Set(
        plan.steps
          .filter((s) => s.type === "tool_call" && s.toolName)
          .map((s) => s.toolName!),
      );

      const missingTools = requiredTools.filter((t) => !plannedTools.has(t));

      if (missingTools.length > 0) {
        const lastStep = plan.steps[plan.steps.length - 1];
        const taskText = input.taskDescription ?? "";

        for (const tool of missingTools) {
          const stepNum = plan.steps.length + 1;
          const stepId = `s${stepNum}`;

          // Build smart default args based on tool type and task context
          let toolArgs: Record<string, unknown> = {};
          let instruction = `Call ${tool} to complete the task. Use the results from previous steps as needed.`;

          if (tool === "file-write" || tool === "file-operations/write") {
            // Extract file path from task description (e.g., "write to ./agent-news.md")
            const pathMatch = taskText.match(/(?:write\s+(?:it\s+)?to|save\s+(?:it\s+)?to|output\s+to)\s+([.\w\-\/]+\.\w+)/i);
            const filePath = pathMatch?.[1] ?? "./output.md";
            toolArgs = {
              path: filePath,
              content: lastStep ? `{{from_step:${lastStep.id}}}` : "",
            };
            instruction = `Write the report/results from the previous step to ${filePath}.`;
          }

          plan.steps.push({
            id: stepId,
            seq: stepNum,
            title: `Execute ${tool}`,
            instruction,
            type: "tool_call",
            toolName: tool,
            toolArgs,
            dependsOn: lastStep ? [lastStep.id] : [],
            status: "pending",
            retries: 0,
            tokensUsed: 0,
          });
        }
      }
    }

    // ── Quantity enforcement ──────────────────────────────────────────────────
    // If the classifier specified per-tool minimum call counts, ensure the plan
    // has enough tool_call steps for each. Inject synthetic steps for any deficit.
    const quantities = input.requiredToolQuantities ?? {};
    for (const [toolName, requiredCount] of Object.entries(quantities)) {
      const existingCount = plan.steps.filter(
        (s) => s.type === "tool_call" && s.toolName === toolName,
      ).length;
      const deficit = requiredCount - existingCount;
      if (deficit > 0) {
        for (let i = 0; i < deficit; i++) {
          const stepNum = plan.steps.length + 1;
          plan.steps.push({
            id: `s${stepNum}`,
            seq: stepNum,
            title: `${toolName} (additional #${existingCount + i + 1})`,
            instruction: `Call ${toolName} to fetch additional data needed for the goal. The classifier determined this tool should be called at least ${requiredCount} times to cover all entities.`,
            type: "tool_call",
            toolName,
            toolArgs: {},
            dependsOn: [],
            status: "pending",
            retries: 0,
            tokensUsed: 0,
          });
        }
      }
    }

    // Persist plan to store (if available)
    if (Option.isSome(planStoreOpt)) {
      yield* planStoreOpt.value
        .savePlan(plan as unknown as Parameters<typeof planStoreOpt.value.savePlan>[0])
        .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:283", tag: errorTag(err) })));
    }

    // Track completed step results across refinements to avoid re-execution
    let completedSteps: PlanStep[] = [];

    // ── Single-analysis-step short-circuit (streamline) ──────────────────────
    // When the planner produces exactly ONE analysis step (and no tool_call
    // steps), the task did not decompose — plan-execute degenerates to "reactive
    // + overhead". Trace evidence (pe-diag 2026-06-05, qwen3.5 long-form): the
    // per-step execution generates the full prose answer (~2422 out) AND the
    // final synthesis pass RE-generates it restructured (~1542 out) — the same
    // answer produced twice, plus a reflect pass that the niche probe showed adds
    // no quality on non-decomposable tasks. Collapse all of that into ONE
    // structured generation so a non-decomposable task degrades gracefully to
    // ~reactive cost. Tool/multi-step plans skip this branch entirely and keep
    // the full plan→execute→reflect→synthesize pipeline (where synthesis
    // legitimately COMBINES distinct step results rather than duplicating one).
    //
    // SCOPE DECISION: this drops reflect+refine for single-analysis plans. The
    // evidence (niche probe t4/t5 — expository "explain/compare" generation, no
    // verifiable right answer) shows reflection adds no quality there. It is NOT
    // validated for single-step tasks with a VERIFIABLE correctness property (a
    // derivation/calculation/proof) where a first pass can be wrong and a critique
    // would catch it — but routing such a task to a one-pass generation is exactly
    // what reactive would do, so this is not a regression vs the cheap default.
    // CONSERVATIVE FALLBACK if a regression ever surfaces: keep ONE reflect+refine
    // pass here (generate → reflect → refine-once) — preserves the safety net while
    // still killing the duplicate generation.
    if (plan.steps.length === 1 && plan.steps[0]!.type === "analysis") {
      const only = plan.steps[0]!;
      steps.push(makeStep("thought", `[PLAN 1] ${only.id}: ${only.title} (analysis)`));
      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: 1,
        thought: `[PLAN 1] ${only.id}: ${only.title} (analysis)`,
        kernelPass: `plan-execute:plan-1`,
      });

      const genResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: `Task: ${goal}\n\n${only.instruction}\n\nWrite the complete, well-structured final answer to the task now. Use clear sections/headings where the task calls for them. Output only the answer — no preamble, no offers, no internal metadata.`,
            },
          ],
          systemPrompt: withEnvContext(
            input.systemPrompt ??
              "You are a precise task executor. Produce the complete, well-structured final answer directly. Never ask questions or offer to do something — just output the finished result.",
          ),
          maxTokens: 4096,
          temperature: 0.5,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Single-analysis-step generation failed: ${err instanceof Error ? err.message : String(err)}`,
                step: 0,
                cause: err,
              }),
          ),
        );

      totalTokens += genResponse.usage.totalTokens;
      totalCost += genResponse.usage.estimatedCost;
      only.status = "completed";
      only.result = extractThinkingSafeContent(genResponse).content;
      completedSteps.push(only);

      let scOutput = only.result;
      steps.push(makeStep("thought", `[SYNTHESIS] ${scOutput}`));

      if (scOutput) {
        const gated = yield* enforceQualityGate({
          llm,
          taskDescription: input.taskDescription,
          output: scOutput,
        });
        scOutput = gated.output;
        totalTokens += gated.tokens;
        totalCost += gated.cost;
      }

      yield* publishReasoningStep(eventBus, {
        _tag: "FinalAnswerProduced",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        answer: scOutput ?? "",
        iteration: 0,
        totalTokens,
        kernelPass: `plan-execute:synthesize`,
      });

      yield* emitLog({
        _tag: "completion",
        success: !!scOutput,
        summary: scOutput
          ? "Plan execution completed (single-analysis-step short-circuit)"
          : "Plan execution failed to produce output",
        timestamp: new Date(),
      });

      return buildStrategyResult({
        strategy: "plan-execute-reflect",
        steps,
        output: scOutput,
        status: scOutput ? "completed" : "partial",
        start,
        totalTokens,
        totalCost,
      });
    }

    // Entropy history for the PER main loop (plan + reflect iterations)
    type PEREntropyEntry = {
      readonly composite: number;
      readonly trajectory: { readonly shape: string; readonly derivative: number; readonly momentum: number };
    };
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

        // Execute wave steps — concurrently if multiple, sequentially if one
        const waveEffects = wave.map((step) => {
          const stepIndex = plan.steps.indexOf(step);

          return Effect.gen(function* () {
            step.status = "in_progress";
            step.startedAt = new Date().toISOString();

            const stepLabel = `${step.id}: ${step.title} (${step.type}${step.toolName ? ` → ${step.toolName}` : ""})`;
            yield* publishReasoningStep(eventBus, {
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "plan-execute",
              strategy: "plan-execute-reflect",
              step: steps.length,
              totalSteps: plan.steps.length,
              action: `[STEP ${stepIndex + 1}/${plan.steps.length}] ${stepLabel}`,
              kernelPass: `plan-execute:step-${stepIndex + 1}:start`,
            });

            let stepSucceeded = false;
            let stepResult = "";
            let lastError: string | undefined;

            for (let attempt = 0; attempt <= stepRetries; attempt++) {
              if (attempt > 0) {
                yield* publishReasoningStep(eventBus, {
                  _tag: "ReasoningStepCompleted",
                  taskId: input.taskId ?? "plan-execute",
                  strategy: "plan-execute-reflect",
                  step: steps.length,
                  totalSteps: plan.steps.length,
                  thought: `[RETRY ${step.id} attempt ${attempt + 1}/${stepRetries + 1}] Previous error: ${lastError}`,
                  kernelPass: `plan-execute:step-${stepIndex + 1}:retry-${attempt}`,
                });
              }

              const exit = yield* Effect.exit(
                executeStep(
                  step,
                  stepIndex,
                  plan,
                  completedSteps,
                  input,
                  toolSummaries,
                  services,
                  stepKernelMaxIterations,
                  attempt > 0 ? lastError : undefined,
                  emitLog,
                ),
              );

              if (Exit.isSuccess(exit)) {
                stepResult = exit.value.output;
                stepSucceeded = true;
                return {
                  step,
                  stepIndex,
                  success: true,
                  output: stepResult,
                  tokens: exit.value.tokens,
                  cost: exit.value.cost,
                  error: undefined,
                  ...(exit.value.fullResult !== undefined
                    ? { fullResult: exit.value.fullResult }
                    : {}),
                  ...(exit.value.rawTerminatedBy !== undefined
                    ? { rawTerminatedBy: exit.value.rawTerminatedBy }
                    : {}),
                };
              }
              const squashed = Cause.squash(exit.cause);
              lastError = squashed instanceof Error ? squashed.message : String(squashed);
            }

            return { step, stepIndex, success: false, output: `[Step failed after ${stepRetries + 1} attempts: ${lastError}]`, tokens: 0, cost: 0, error: lastError };
          });
        });

        // Run wave concurrently (max 4 parallel steps)
        const waveResults = yield* Effect.all(waveEffects, { concurrency: wave.length > 1 ? 4 : 1 });

        // Apply results sequentially to maintain state consistency
        for (const result of waveResults) {
          const { step, stepIndex } = result;
          totalTokens += result.tokens;
          totalCost += result.cost;
          // Track the most recent composite sub-kernel termination reason —
          // surfaced on the strategy result so runtime can propagate it to
          // AgentCompleted.terminationReason. Tool-dispatch and analysis
          // steps omit this field, so it only updates when a real sub-kernel
          // ran. Sequential update mirrors execution order; the final value
          // reflects the last step's kernel.
          const stepRawTerminatedBy = (result as { rawTerminatedBy?: string })
            .rawTerminatedBy;
          if (stepRawTerminatedBy !== undefined) {
            lastRawTerminatedBy = stepRawTerminatedBy;
          }

          if (result.success) {
            step.status = "completed";
            step.result = result.output;
            // Preserve the full uncompressed tool result (tool_call steps only)
            // so synthesis can render every item past the preview cutoff.
            const stepFullResult = (result as { fullResult?: string }).fullResult;
            if (stepFullResult !== undefined) {
              step.fullResult = stepFullResult;
            }
            step.completedAt = new Date().toISOString();
            completedSteps.push(step);

            if (Option.isSome(planStoreOpt)) {
              yield* planStoreOpt.value.updateStepStatus(
                step.id,
                { status: "completed", result: result.output },
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:439", tag: errorTag(err) })));
            }
          } else {
            step.status = "failed";
            step.error = result.output;
            step.completedAt = new Date().toISOString();

            yield* publishReasoningStep(eventBus, {
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "plan-execute",
              strategy: "plan-execute-reflect",
              step: steps.length,
              totalSteps: plan.steps.length,
              observation: `[FAILED ${step.id}] ${result.error}`,
              kernelPass: `plan-execute:step-${stepIndex + 1}:failed`,
            });

            if (Option.isSome(planStoreOpt)) {
              yield* planStoreOpt.value.updateStepStatus(
                step.id,
                { status: "failed", error: result.output },
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:460", tag: errorTag(err) })));
            }

            // Attempt inline patch
            const patchResult = yield* patchPlan(
              plan,
              stepIndex,
              input,
              llm,
              totalTokens,
            ).pipe(Effect.catchAll(() => Effect.succeed(null)));

            if (patchResult) {
              totalTokens += patchResult.tokens;
              const patchedSteps = patchResult.steps;
              plan.steps.splice(
                stepIndex + 1,
                plan.steps.length - stepIndex - 1,
                ...patchedSteps,
              );

              const patchDetail = patchedSteps.map((s) => `${s.id}: ${s.title}`).join(", ");
              yield* publishReasoningStep(eventBus, {
                _tag: "ReasoningStepCompleted",
                taskId: input.taskId ?? "plan-execute",
                strategy: "plan-execute-reflect",
                step: steps.length,
                totalSteps: plan.steps.length,
                thought: `[PATCH] Replaced remaining steps: ${patchDetail}`,
                kernelPass: `plan-execute:step-${stepIndex + 1}:patch`,
              });
              waveFailed = true; // Re-compute waves after patch
            }

            completedSteps.push(step);
          }

          steps.push(
            makeStep(
              result.success ? "observation" : "thought",
              `[EXEC ${step.id}] ${result.success ? "✓" : "✗"} ${result.output}`,
            ),
          );

          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            step: steps.length,
            totalSteps: plan.steps.length,
            observation: `[EXEC ${step.id}] ${result.success ? "✓" : "✗"} ${result.output}`,
            kernelPass: `plan-execute:step-${stepIndex + 1}:done`,
          });

          // Emit an iteration-progress boundary so the Cortex replay scrubber has
          // one checkpoint per plan step (mirrors how react-kernel emits per iteration).
          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningIterationProgress",
            taskId: input.taskId ?? "plan-execute",
            iteration: stepIndex + 1,
            maxIterations: plan.steps.length,
            strategy: "plan-execute-reflect",
            toolsThisStep: step.toolName ? [step.toolName] : [],
          });
        }
      }

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
      totalCost += reflectResult.cost;

      const reflectionContent = reflectResult.content;

      yield* emitPhaseEnd({ emitLog, phase: "plan-execute:reflect", startedAt: start, totalTokens });

      // ── Entropy scoring + reactive controller for PER reflection iterations ──
      // Scores the reflection content as the "thought" of this iteration so the
      // reactive controller can fire interventions (e.g. early-stop, compress).
      let perRIEarlyStop = false;
      if (services.entropySensor._tag === "Some") {
        const syntheticState = {
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          kernelType: "plan-execute",
          steps: steps.map((rs) => ({
            type: rs.type,
            ...(rs.content != null ? { content: rs.content } : {}),
          })),
          toolsUsed: new Set(
            plan.steps
              .filter((ps) => ps.status === "completed" && ps.toolName)
              .map((ps) => ps.toolName!),
          ),
          iteration: refinement,
          tokens: totalTokens,
          status: "observing",
          output: null,
          error: null,
          meta: {} as Record<string, unknown>,
        };

        const scoreResult = yield* services.entropySensor.value
          .score({
            thought: reflectionContent,
            taskDescription: input.taskDescription ?? "",
            strategy: "plan-execute-reflect",
            iteration: refinement,
            maxIterations: maxRefinements,
            modelId: input.modelId ?? "unknown",
            temperature: input.temperature ?? 0,
            kernelState: syntheticState,
          })
          .pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (scoreResult !== null) {
          const entry: PEREntropyEntry = {
            composite: scoreResult.composite,
            trajectory: scoreResult.trajectory,
          };
          perEntropyHistory = [...perEntropyHistory, entry];

          if (services.eventBus._tag === "Some") {
            const richScore = scoreResult as Record<string, unknown>;
            yield* services.eventBus.value.publish({
              _tag: "EntropyScored",
              taskId: input.taskId ?? "plan-execute",
              iteration: refinement,
              composite: scoreResult.composite,
              sources: richScore["sources"],
              trajectory: richScore["trajectory"],
              confidence: richScore["confidence"],
              modelTier: richScore["modelTier"],
              iterationWeight: richScore["iterationWeight"],
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:659", tag: errorTag(err) })));
          }

          if (services.reactiveController._tag === "Some" && perEntropyHistory.length > 0) {
            const latestScore = scoreResult as Record<string, unknown>;
            const sources = latestScore["sources"] as Record<string, number> | undefined;
            const decisions = yield* services.reactiveController.value
              .evaluate({
                entropyHistory: perEntropyHistory,
                iteration: refinement,
                maxIterations: maxRefinements,
                strategy: "plan-execute-reflect",
                calibration: {
                  highEntropyThreshold: 0.8,
                  convergenceThreshold: 0.4,
                  calibrated: false,
                  sampleCount: 0,
                },
                config: { earlyStop: true, contextCompression: true, strategySwitch: false },
                contextPressure: sources?.["contextPressure"] ?? 0,
                behavioralLoopScore: sources?.["behavioral"] ?? 0,
                currentTemperature: input.temperature,
                availableToolNames: input.availableTools.length > 0 ? input.availableTools : undefined,
              })
              .pipe(Effect.catchAll(() => Effect.succeed([])));

            if (decisions.length > 0 && services.dispatcher._tag === "Some") {
              const dispatchContext = {
                iteration: refinement,
                entropyScore: {
                  composite: scoreResult.composite,
                  token: 0,
                  structural: sources?.["structural"] ?? 0,
                  semantic: sources?.["semantic"] ?? 0,
                  behavioral: sources?.["behavioral"] ?? 0,
                  contextPressure: sources?.["contextPressure"] ?? 0,
                },
                recentDecisions: decisions as readonly { readonly decision: string; readonly reason: string }[],
                budget: {
                  interventionsFiredThisRun: perStrategyRiBudget.interventionsFiredThisRun,
                  tokensSpentOnInterventions: perStrategyRiBudget.tokensSpentOnInterventions,
                },
                // GH #127 — bridge applied RI decisions into Compose tags on
                // plan-execute's outer refinement loop. No-op when absent.
                harnessPipeline: input.harnessPipeline,
              };
              const dispatchResult = yield* services.dispatcher.value
                .dispatch(decisions as readonly { readonly decision: string; readonly reason: string }[], {}, dispatchContext)
                .pipe(Effect.catchAll(() => Effect.succeed({ appliedPatches: [], skipped: [], totalCost: { tokens: 0, latencyMs: 0 } })));

              // W3 FIX-23: accumulate per-strategy budget so the next refinement
              // iteration's dispatch sees real counts at the suppression gates.
              perStrategyRiBudget.interventionsFiredThisRun += dispatchResult.appliedPatches.length;
              perStrategyRiBudget.tokensSpentOnInterventions += dispatchResult.totalCost.tokens;

              // HS-107: preserve source decisionType for trace analytics.
              // Prior code passed patch.kind for both fields, conflating
              // decisions (tool-inject) with patches (inject-tool-guidance).
              for (const { decisionType, patch } of dispatchResult.appliedPatches) {
                if (services.eventBus._tag === "Some") {
                  yield* services.eventBus.value.publish({
                    _tag: "InterventionDispatched",
                    taskId: input.taskId ?? "plan-execute",
                    iteration: refinement,
                    decisionType,
                    patchKind: patch.kind,
                    cost: { tokensEstimated: dispatchResult.totalCost.tokens, latencyMsEstimated: dispatchResult.totalCost.latencyMs },
                    telemetry: {},
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:713", tag: errorTag(err) })));
                }
                if (patch.kind === "early-stop") perRIEarlyStop = true;
              }

              for (const skipped of dispatchResult.skipped) {
                if (services.eventBus._tag === "Some") {
                  yield* services.eventBus.value.publish({
                    _tag: "InterventionSuppressed",
                    taskId: input.taskId ?? "plan-execute",
                    iteration: refinement,
                    decisionType: skipped.decisionType,
                    reason: skipped.reason as
                      | "below-entropy-threshold"
                      | "below-iteration-threshold"
                      | "over-budget"
                      | "max-fires-exceeded"
                      | "mode-advisory"
                      | "mode-off"
                      | "no-handler",
                  }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:733", tag: errorTag(err) })));
                }
              }
            }
          }
        }
      }
      if (perRIEarlyStop) break;

      // Trust the reflector's verdict — step completion alone does not mean the goal
      // is met (e.g. a combined search may return incomplete data for each entity).
      // Re-execution of completed steps is already prevented by computeWaves skipping
      // them and by the augmentation path generating only NEW supplementary steps.
      const satisfied = isSatisfied(reflectionContent);

      steps.push(
        makeStep(
          "observation",
          `[REFLECT ${refinement + 1}] ${satisfied ? "SATISFIED" : "UNSATISFIED"} — ${reflectionContent}`,
        ),
      );

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: maxRefinements + 1,
        thought: `[REFLECT ${refinement + 1}] ${satisfied ? "✓ SATISFIED" : "✗ UNSATISFIED — refining..."} ${reflectionContent}`,
        kernelPass: `plan-execute:reflect-${refinement + 1}`,
      });

      if (satisfied) {
        // ── SYNTHESIZE: Produce a clean final answer from step results ──
        // Synthesis is the final render — feed it the FULL tool result
        // (fullResult) rather than the compressed preview (result) so it can
        // emit every item. Intermediate analysis/reflection prompts kept the
        // preview to protect local-tier context; synthesis needs the whole
        // payload, mirroring reactive's in-loop recall of the stored result.
        const synthResultTexts = plan.steps
          .filter((s) => s.result || s.fullResult)
          .map((s, idx) => `Step ${idx + 1}: ${s.fullResult ?? s.result}`);

        const synthLlmResponse = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: `Task: ${goal}\n\nExecution results:\n${synthResultTexts.join("\n")}\n\nSynthesize a clear, complete answer to the original task. Do NOT include internal details like tool names, JSON payloads, recipient numbers, or execution metadata — only user-facing content.`,
              },
            ],
            systemPrompt: withEnvContext(
              input.systemPrompt
                ? `${input.systemPrompt}\n\nYou are a synthesizer. Combine execution results into a clear, concise final answer. Exclude all internal agent metadata.`
                : "You are a synthesizer. Combine execution results into a clear, concise final answer. Exclude all internal agent metadata.",
            ),
            maxTokens: 4096,
            temperature: 0.3,
          })
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                content: synthResultTexts.join("\n\n"),
                usage: { totalTokens: 0, estimatedCost: 0 },
              }),
            ),
          );

        totalTokens += synthLlmResponse.usage.totalTokens;
        totalCost += synthLlmResponse.usage.estimatedCost;
        // Strict upgrade vs bare stripThinking: rescues synthesized answers
        // trapped inside <think> blocks (would have silently returned empty).
        finalOutput = extractThinkingSafeContent(synthLlmResponse).content;

        steps.push(makeStep("thought", `[SYNTHESIS] ${finalOutput}`));

        yield* publishReasoningStep(eventBus, {
          _tag: "FinalAnswerProduced",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          answer: finalOutput,
          iteration: refinement,
          totalTokens,
          kernelPass: `plan-execute:synthesize`,
        });
        break;
      }

      // ── REFINEMENT: Patch failed steps OR augment with supplementary steps ──
      const hasFailures = plan.steps.some((s) => s.status === "failed");
      if (hasFailures) {
        const patchResult = yield* patchPlan(
          plan,
          plan.steps.findIndex((s) => s.status === "failed"),
          input,
          llm,
          totalTokens,
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (patchResult) {
          totalTokens += patchResult.tokens;
          const lastCompletedIdx = plan.steps.reduce(
            (acc, s, idx) => (s.status === "completed" ? idx : acc),
            -1,
          );
          plan.steps.splice(
            lastCompletedIdx + 1,
            plan.steps.length - lastCompletedIdx - 1,
            ...patchResult.steps,
          );

          const patchDetail = patchResult.steps.map((s) => `${s.id}: ${s.title}`).join(", ");
          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            step: steps.length,
            totalSteps: maxRefinements + 1,
            thought: `[REFINE] Patched plan — kept ${lastCompletedIdx + 1} completed steps, replaced with: ${patchDetail}`,
            kernelPass: `plan-execute:refine-${refinement + 1}`,
          });
        }
      } else if (allStepsCompleted) {
        // All steps completed but goal unmet — generate supplementary steps
        const augmentResult = yield* augmentPlan(
          plan,
          goal,
          reflectionContent,
          input,
          llm,
          totalTokens,
        ).pipe(Effect.catchAll(() => Effect.succeed(null)));

        if (augmentResult && augmentResult.steps.length > 0) {
          totalTokens += augmentResult.tokens;
          plan.steps.push(...augmentResult.steps);

          const augDetail = augmentResult.steps.map((s) => `${s.id}: ${s.title}`).join(", ");
          steps.push(
            makeStep("thought", `[AUGMENT] Added ${augmentResult.steps.length} supplementary steps: ${augDetail}`),
          );
          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            step: steps.length,
            totalSteps: maxRefinements + 1,
            thought: `[AUGMENT] Goal unmet with all steps completed — added ${augmentResult.steps.length} supplementary steps: ${augDetail}`,
            kernelPass: `plan-execute:augment-${refinement + 1}`,
          });
        }
      }

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

    if (finalOutput) {
      // plan-execute's `finalOutput` already concatenates raw `[EXEC` tool
      // observations, so the gate operates on the draft directly (no separate
      // toolData harvest needed). Shared module upgrades synthesis to use
      // thinking-safe extraction, rescuing answers trapped inside <think>.
      const gated = yield* enforceQualityGate({
        llm,
        taskDescription: input.taskDescription,
        output: finalOutput,
      });
      finalOutput = gated.output;
      totalTokens += gated.tokens;
      totalCost += gated.cost;
    }

    yield* emitLog({
      _tag: "completion",
      success: !!finalOutput,
      summary: finalOutput ? `Plan execution completed successfully` : `Plan execution failed to produce output`,
      timestamp: new Date(),
    });

    return buildStrategyResult({
      strategy: "plan-execute-reflect",
      steps,
      output: finalOutput,
      status: finalOutput ? "completed" : "partial",
      start,
      totalTokens,
      totalCost,
      ...(lastRawTerminatedBy !== undefined
        ? {
            extraMetadata: {
              // Parallel open-string channel mirroring reactive strategy.
              // Drops through to AgentCompleted.terminationReason via
              // execution-engine ctx.metadata.rawTerminatedBy.
              rawTerminatedBy: lastRawTerminatedBy,
            },
          }
        : {}),
    });
  });


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
// ./plan-execute/plan-mutation.ts in WS-6 Phase 3 bucket A. Both helpers
// take a narrowed input shape (PatchInput/AugmentInput) so they don't
// re-import the full `PlanExecuteInput` type from this module.

// ─── Utility Helpers ───
//
// Output utilities (extractGoalText, stripFinalAnswerPrefix, sanitizeToolOutput,
// ACTION_TOOL_PATTERNS) were extracted to ./plan-execute/output-utils.ts in
// WS-6 Phase 3 bucket B so step-executor and plan-mutation helpers can import
// without circular dependency. Import added at top of file.
