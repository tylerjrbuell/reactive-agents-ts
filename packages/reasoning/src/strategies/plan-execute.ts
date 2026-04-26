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
import { ObservableLogger, type LogEvent } from "@reactive-agents/observability";
import { PlanStoreService } from "@reactive-agents/memory";
import {
  LLMPlanOutputSchema,
  hydratePlan,
  resolveStepReferences,
  computeWaves,
} from "../types/plan.js";
import type { Plan, PlanStep, LLMPlanOutput } from "../types/plan.js";
import { extractStructuredOutput } from "../structured-output/pipeline.js";
import {
  buildPlanGenerationPrompt,
  buildPatchPrompt,
  buildStepExecutionPrompt,
  buildReflectionPrompt,
  buildAugmentPrompt,
} from "./plan-prompts.js";
import type { ToolSummary, StepResult } from "./plan-prompts.js";
import { executeReActKernel } from "../kernel/loop/react-kernel.js";
import {
  resolveStrategyServices,
  publishReasoningStep,
} from "../kernel/utils/service-utils.js";
import type { StrategyServices } from "../kernel/utils/service-utils.js";
import { makeStep, buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import { isSatisfied } from "../kernel/capabilities/verify/quality-utils.js";
import { stripThinking } from "../kernel/capabilities/reason/stream-parser.js";
import { extractOutputFormat } from "../kernel/capabilities/comprehend/task-intent.js";
import {
  validateOutputFormat,
  buildSynthesisPrompt,
} from "../kernel/loop/output-synthesis.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

interface PlanExecuteInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
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
  /** Per-tool minimum call counts from the classifier (e.g. { "web-search": 4 }). */
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Model identifier for routing/entropy scoring */
  readonly modelId?: string;
  /** LLM temperature override */
  readonly temperature?: number;
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
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

    const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
      Effect.serviceOption(ObservableLogger).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/plan-execute.ts:101", tag: errorTag(err) })))
            : Effect.void
        )
      );

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

    yield* emitLog({
      _tag: "phase_complete",
      phase: "plan-execute:plan",
      duration: Date.now() - start,
      status: "success",
    });

    yield* emitLog({
      _tag: "metric",
      name: "tokens_used",
      value: totalTokens,
      unit: "tokens",
      timestamp: new Date(),
    });

    let plan: Plan = hydratePlan(planResult.data, {
      taskId: input.taskId ?? "plan-execute",
      agentId: input.agentId ?? "reasoning-agent",
      goal,
      planMode,
    });

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
                return { step, stepIndex, success: true, output: stepResult, tokens: exit.value.tokens, cost: exit.value.cost, error: undefined };
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

          if (result.success) {
            step.status = "completed";
            step.result = result.output;
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

      yield* emitLog({
        _tag: "phase_complete",
        phase: "plan-execute:execute",
        duration: Date.now() - start,
        status: "success",
      });

      yield* emitLog({
        _tag: "metric",
        name: "tokens_used",
        value: totalTokens,
        unit: "tokens",
        timestamp: new Date(),
      });

      yield* emitLog({ _tag: "phase_started", phase: "plan-execute:reflect", timestamp: new Date() });

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

      const reflectResponse = yield* llm
        .complete({
          messages: [{ role: "user", content: reflectionPrompt }],
          systemPrompt: input.systemPrompt
            ? `${input.systemPrompt}\n\nYou are evaluating plan execution. Determine if the task has been adequately addressed.`
            : "You are evaluating plan execution. Determine if the task has been adequately addressed.",
          maxTokens: reflectionDepth === "deep" ? 2500 : 1500,
          temperature: 0.3,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Reflection failed at refinement ${refinement}`,
                step: refinement,
                cause: err,
              }),
          ),
        );

      totalTokens += reflectResponse.usage.totalTokens;
      totalCost += reflectResponse.usage.estimatedCost;

      // Strip <think> blocks from reflection before satisfaction check
      const reflectionContent = stripThinking(reflectResponse.content);

      yield* emitLog({
        _tag: "phase_complete",
        phase: "plan-execute:reflect",
        duration: Date.now() - start,
        status: "success",
      });

      yield* emitLog({
        _tag: "metric",
        name: "tokens_used",
        value: totalTokens,
        unit: "tokens",
        timestamp: new Date(),
      });

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
                budget: { tokensSpentOnInterventions: 0, interventionsFiredThisRun: 0 },
              };
              const dispatchResult = yield* services.dispatcher.value
                .dispatch(decisions as readonly { readonly decision: string; readonly reason: string }[], {}, dispatchContext)
                .pipe(Effect.catchAll(() => Effect.succeed({ appliedPatches: [], skipped: [], totalCost: { tokens: 0, latencyMs: 0 } })));

              for (const patch of dispatchResult.appliedPatches) {
                if (services.eventBus._tag === "Some") {
                  yield* services.eventBus.value.publish({
                    _tag: "InterventionDispatched",
                    taskId: input.taskId ?? "plan-execute",
                    iteration: refinement,
                    decisionType: patch.kind,
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
        const synthResultTexts = plan.steps
          .filter((s) => s.result)
          .map((s, idx) => `Step ${idx + 1}: ${s.result}`);

        const synthLlmResponse = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: `Task: ${goal}\n\nExecution results:\n${synthResultTexts.join("\n")}\n\nSynthesize a clear, complete answer to the original task. Do NOT include internal details like tool names, JSON payloads, recipient numbers, or execution metadata — only user-facing content.`,
              },
            ],
            systemPrompt: input.systemPrompt
              ? `${input.systemPrompt}\n\nYou are a synthesizer. Combine execution results into a clear, concise final answer. Exclude all internal agent metadata.`
              : "You are a synthesizer. Combine execution results into a clear, concise final answer. Exclude all internal agent metadata.",
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
        finalOutput = stripThinking(synthLlmResponse.content);

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
      const gated = yield* enforceOutputQualityGate({
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
    });
  });

// ─── Step Execution Helpers ───

interface StepExecResult {
  output: string;
  tokens: number;
  cost: number;
  success: boolean;
}

function enforceOutputQualityGate(input: {
  llm: LLMService["Type"];
  taskDescription: string;
  output: string;
}): Effect.Effect<
  { output: string; tokens: number; cost: number },
  never,
  never
> {
  const intent = extractOutputFormat(input.taskDescription);
  if (!intent.format) {
    return Effect.succeed({ output: input.output, tokens: 0, cost: 0 });
  }

  const validation = validateOutputFormat(input.output, intent.format);
  if (validation.valid) {
    return Effect.succeed({ output: input.output, tokens: 0, cost: 0 });
  }

  const synthesisPrompt = buildSynthesisPrompt(
    input.output,
    intent.format,
    input.taskDescription,
  );

  return input.llm
    .complete({
      messages: [{ role: "user", content: synthesisPrompt }],
      maxTokens: 1500,
      temperature: 0.2,
    })
    .pipe(
      Effect.map((response) => {
        const candidate = stripThinking(response.content).trim();
        if (!candidate) {
          return {
            output: input.output,
            tokens: response.usage.totalTokens,
            cost: response.usage.estimatedCost,
          };
        }

        const revalidation = validateOutputFormat(candidate, intent.format);
        return {
          output: revalidation.valid ? candidate : input.output,
          tokens: response.usage.totalTokens,
          cost: response.usage.estimatedCost,
        };
      }),
      Effect.catchAll(() =>
        Effect.succeed({ output: input.output, tokens: 0, cost: 0 })
      ),
    );
}

/**
 * Execute a single plan step based on its type:
 * - tool_call: direct tool dispatch via toolService.execute
 * - analysis: ReAct kernel with NO tools
 * - composite: ReAct kernel with scoped tools
 */
function executeStep(
  step: PlanStep,
  stepIndex: number,
  plan: Plan,
  completedSteps: PlanStep[],
  input: PlanExecuteInput,
  toolSummaries: ToolSummary[],
  services: StrategyServices,
  maxKernelIter: number,
  retryErrorContext: string | undefined,
  emitLog: (event: LogEvent) => Effect.Effect<void, never>,
): Effect.Effect<StepExecResult, ExecutionError, LLMService> {
  const { toolService } = services;

  if (step.type === "tool_call" && step.toolName && toolService._tag === "Some") {
    // Direct tool dispatch — no LLM kernel needed
    return Effect.gen(function* () {
      const rawArgs = step.toolArgs ?? {};
      const resolvedArgs = resolveStepReferences(rawArgs, completedSteps);

      // Strip any remaining unresolved {{from_step:sN}} references (self-ref or
      // missing step). Rather than hard-failing the step, replace with empty string
      // and let the tool handle missing/default args. This prevents infinite retry
      // loops when the LLM generates circular step references (e.g. spawn-agent
      // with agentId={{from_step:s2}} where s2 is the current step).
      for (const [key, value] of Object.entries(resolvedArgs)) {
        if (typeof value === "string" && /\{\{from_step:s\d+\}\}/.test(value)) {
          resolvedArgs[key] = value.replace(/\{\{from_step:s\d+(?::summary)?\}\}/g, "");
        }
      }

      const toolStart = Date.now();

      yield* emitLog({
        _tag: "tool_call",
        tool: step.toolName!,
        iteration: stepIndex + 1,
        timestamp: new Date(),
      });

      const toolResult = yield* toolService.value
        .execute({
          toolName: step.toolName!,
          arguments: resolvedArgs,
          agentId: input.agentId ?? "reasoning-agent",
          sessionId: input.sessionId ?? "reasoning-session",
        })
        .pipe(
          Effect.tapError(
            (e) => {
              const toolDurationMs = Date.now() - toolStart;
              return emitLog({
                _tag: "tool_result",
                tool: step.toolName!,
                duration: toolDurationMs,
                status: "error",
                error: String(e),
                timestamp: new Date(),
              });
            }
          ),
          Effect.mapError(
            (e) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Tool ${step.toolName} failed: ${String(e)}`,
                step: stepIndex,
                cause: e,
              }),
          ),
        );
      const toolDurationMs = Date.now() - toolStart;

      yield* emitLog({
        _tag: "tool_result",
        tool: step.toolName!,
        duration: toolDurationMs,
        status: "success",
        timestamp: new Date(),
      });

      // Publish ToolCallCompleted so MetricsCollector tracks tool execution
      yield* publishReasoningStep(services.eventBus, {
        _tag: "ToolCallCompleted",
        taskId: input.taskId ?? "plan-execute",
        toolName: step.toolName!,
        callId: `${plan.id}_${step.id}`,
        durationMs: toolDurationMs,
        success: toolResult.success !== false,
        kernelPass: `plan-execute:step-${stepIndex + 1}`,
      });

      const rawOutput =
        typeof toolResult.result === "string"
          ? toolResult.result
          : JSON.stringify(toolResult.result);

      // Sanitize tool_call output: strip internal metadata (args, recipient, raw JSON)
      // so it doesn't leak into downstream steps or final synthesis.
      // Data-fetching tools keep full output; action tools get a clean confirmation.
      const output = sanitizeToolOutput(step.toolName!, rawOutput, resolvedArgs);

      return {
        output,
        tokens: 0,
        cost: 0,
        success: toolResult.success !== false,
      };
    });
  }

  // Build prior results for analysis/composite step prompts
  const priorResults = completedSteps
    .filter((s) => s.result)
    .map((s) => ({
      stepId: s.id,
      title: s.title,
      result: s.result!,
    }));

  // Scope tools for composite steps
  const scopedTools: ToolSummary[] =
    step.type === "composite" && step.toolHints
      ? toolSummaries.filter((t) => step.toolHints!.includes(t.name))
      : [];

  // Build the step execution prompt
  const stepPrompt = buildStepExecutionPrompt({
    goal: extractGoalText(input.taskDescription),
    step,
    stepIndex,
    totalSteps: plan.steps.length,
    priorResults,
    scopedTools,
  });

  // Add retry error context if retrying
  const taskText = retryErrorContext
    ? `${stepPrompt}\n\nPREVIOUS ATTEMPT FAILED: ${retryErrorContext}\nPlease try a different approach.`
    : stepPrompt;

  // Analysis steps: single LLM call — no tool loop needed
  // Note: maxTokens 4096 to accommodate thinking models where num_predict
  // covers both thinking + content tokens combined.
  if (step.type === "analysis") {
    return services.llm
      .complete({
        messages: [{ role: "user", content: taskText }],
        systemPrompt:
          input.systemPrompt ??
          "You are a precise task executor. Produce the requested content directly. Never ask questions or offer to do something — just output the finished result.",
        maxTokens: 4096,
        temperature: 0.5,
      })
      .pipe(
        Effect.flatMap((response) => {
          const output = stripFinalAnswerPrefix(stripThinking(response.content));
          if (!output.trim()) {
            return Effect.fail(
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Analysis step ${stepIndex + 1} produced empty output (model may have exhausted token budget on thinking)`,
                step: stepIndex,
              }),
            );
          }
          return Effect.succeed({
            output,
            tokens: response.usage.totalTokens,
            cost: response.usage.estimatedCost,
            success: true,
          });
        }),
        Effect.mapError(
          (err) =>
            err instanceof ExecutionError ? err :
            new ExecutionError({
              strategy: "plan-execute-reflect",
              message: `Analysis step ${stepIndex + 1} failed`,
              step: stepIndex,
              cause: err,
            }),
        ),
      );
  }

  // Composite steps: ReAct kernel with scoped tools
  const kernelToolSchemas =
    step.toolHints
      ? (input.availableToolSchemas ?? []).filter((t) =>
          step.toolHints!.includes(t.name),
        )
      : undefined;

  return executeReActKernel({
    task: taskText,
    systemPrompt:
      input.systemPrompt ??
      "You are a precise task executor. Complete the given step.",
    availableToolSchemas: kernelToolSchemas,
    maxIterations: maxKernelIter,
    temperature: 0.5,
    taskId: input.taskId,
    parentStrategy: "plan-execute",
    kernelPass: `plan-execute:step-${stepIndex + 1}`,
    resultCompression: input.resultCompression,
    agentId: input.agentId,
    sessionId: input.sessionId,
    requiredTools: input.requiredTools,
    maxRequiredToolRetries: input.maxRequiredToolRetries,
    modelId: input.modelId,
    exitOnAllToolsCalled: true,
    synthesisConfig: input.synthesisConfig,
  }).pipe(
    Effect.map((kernelResult) => ({
      output: stripFinalAnswerPrefix(kernelResult.output || `[Step ${stepIndex + 1} completed]`),
      tokens: kernelResult.totalTokens,
      cost: kernelResult.totalCost,
      success: true,
    })),
    Effect.mapError(
      (err) =>
        new ExecutionError({
          strategy: "plan-execute-reflect",
          message: `Step ${stepIndex + 1} execution failed`,
          step: stepIndex,
          cause: err,
        }),
    ),
  );
}

/**
 * Attempt to patch remaining plan steps after a failure.
 * Uses extractStructuredOutput with buildPatchPrompt.
 */
function patchPlan(
  plan: Plan,
  failedStepIndex: number,
  input: PlanExecuteInput,
  _llm: unknown,
  _currentTokens: number,
): Effect.Effect<
  { steps: PlanStep[]; tokens: number } | null,
  Error,
  LLMService
> {
  const patchPrompt = buildPatchPrompt(extractGoalText(input.taskDescription), plan.steps);

  return extractStructuredOutput({
    schema: LLMPlanOutputSchema,
    prompt: patchPrompt,
    systemPrompt:
      "You are a planning agent. Rewrite the failed and pending steps to recover.",
    maxRetries: 1,
    temperature: 0.3,
    maxTokens: 4096,
  }).pipe(
    Effect.map((result) => {
      const patchedPlan = hydratePlan(result.data, {
        taskId: plan.taskId,
        agentId: plan.agentId,
        goal: plan.goal,
        planMode: plan.mode,
      });
      // Re-number patch steps starting after the failed step
      const patchedSteps = patchedPlan.steps.map((s, idx) => ({
        ...s,
        id: `s${failedStepIndex + 2 + idx}`,
        seq: failedStepIndex + 2 + idx,
      }));
      const tokenEst =
        Math.ceil(result.raw.length / 4) +
        Math.ceil(patchPrompt.length / 4);
      return { steps: patchedSteps, tokens: tokenEst };
    }),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}

/**
 * Generate supplementary plan steps when all existing steps completed but the
 * reflector determined the goal is unmet. Unlike patchPlan (which rewrites
 * failed steps), this appends NEW steps to fill gaps.
 */
function augmentPlan(
  plan: Plan,
  goal: string,
  reflectionFeedback: string,
  input: PlanExecuteInput,
  _llm: unknown,
  _currentTokens: number,
): Effect.Effect<
  { steps: PlanStep[]; tokens: number } | null,
  Error,
  LLMService
> {
  const toolSummaries: ToolSummary[] = (
    input.availableToolSchemas ?? []
  ).map((t) => ({
    name: t.name,
    signature: `(${t.parameters.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")})`,
  }));

  const completedSteps = plan.steps
    .filter((s) => s.status === "completed")
    .map((s) => ({
      stepId: s.id,
      title: s.title,
      result: s.result,
    }));

  const augmentPrompt = buildAugmentPrompt({
    goal,
    completedSteps,
    reflectionFeedback,
    tools: toolSummaries,
  });

  const nextSeq = plan.steps.length + 1;

  return extractStructuredOutput({
    schema: LLMPlanOutputSchema,
    prompt: augmentPrompt,
    systemPrompt:
      "You are a planning agent. Generate supplementary steps to fill gaps in an incomplete plan.",
    maxRetries: 1,
    temperature: 0.3,
    maxTokens: 4096,
  }).pipe(
    Effect.map((result) => {
      const augmentedPlan = hydratePlan(result.data, {
        taskId: plan.taskId,
        agentId: plan.agentId,
        goal: plan.goal,
        planMode: plan.mode,
      });
      const augmentedSteps = augmentedPlan.steps.map((s, idx) => ({
        ...s,
        id: `s${nextSeq + idx}`,
        seq: nextSeq + idx,
      }));
      const tokenEst =
        Math.ceil(result.raw.length / 4) +
        Math.ceil(augmentPrompt.length / 4);
      return { steps: augmentedSteps, tokens: tokenEst };
    }),
    Effect.catchAll(() => Effect.succeed(null)),
  );
}

// ─── Utility Helpers ───

/**
 * Extract plain goal text from taskDescription which may be JSON-wrapped.
 * The execution engine passes `JSON.stringify(task.input)` which produces
 * `{"question":"actual goal text"}` — unwrap that to get the clean string.
 */
function extractGoalText(taskDescription: string): string {
  try {
    const parsed = JSON.parse(taskDescription);
    if (typeof parsed === "object" && parsed !== null && typeof parsed.question === "string") {
      return parsed.question;
    }
  } catch {
    // Not JSON — use as-is
  }
  return taskDescription;
}

/**
 * Strip "FINAL ANSWER:" prefix from LLM output so it doesn't leak into
 * tool arguments or user-visible messages.
 */
function stripFinalAnswerPrefix(text: string): string {
  return text.replace(/^FINAL ANSWER:\s*/i, "").trim();
}

/**
 * Action-oriented tool name patterns — tools that perform side effects
 * (send, write, post, create, delete, etc.) rather than fetching data.
 * Their raw output (JSON with args like recipient/message) should NOT
 * appear in downstream steps or the final synthesis.
 */
const ACTION_TOOL_PATTERNS = /\b(send|write|post|create|delete|remove|update|set|put|push|publish|notify|deploy|upload)\b/i;

/**
 * Sanitize tool output to prevent internal metadata from leaking into
 * downstream steps or final user-facing synthesis.
 *
 * - Data-fetching tools (list, get, search, read) → keep full output
 * - Action tools (send, write, post, create) → clean confirmation only
 */
function sanitizeToolOutput(
  toolName: string,
  rawOutput: string,
  args: Record<string, unknown>,
): string {
  // shell-execute wraps command output in metadata; prefer the full untruncated
  // command payload so downstream synthesis can parse complete results.
  if (toolName.includes("shell-execute")) {
    const extractText = (value: unknown): string | null => {
      if (typeof value === "string" && value.trim().length > 0) return value;
      return null;
    };

    const parseUnknown = (value: unknown): unknown => {
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    };

    // Some integrations return shell payloads as nested objects or as
    // stringified JSON at one or more levels. Normalize to inspect safely.
    const parsed = parseUnknown(rawOutput);
    const normalized =
      parsed && typeof parsed === "object" && "result" in parsed
        ? parseUnknown((parsed as { result?: unknown }).result)
        : parsed;

    if (normalized && typeof normalized === "object") {
      const payload = normalized as {
        fullOutput?: unknown;
        output?: unknown;
        fullStderr?: unknown;
        stderr?: unknown;
      };

      const output =
        extractText(payload.fullOutput) ??
        extractText(payload.output) ??
        "";
      const stderr =
        extractText(payload.fullStderr) ??
        extractText(payload.stderr) ??
        "";

      if (output.trim().length > 0) return output;
      if (stderr.trim().length > 0) return stderr;
    }
  }

  // If tool name indicates a data-fetching operation, keep full output
  if (!ACTION_TOOL_PATTERNS.test(toolName)) {
    return rawOutput;
  }

  // For action tools, check if the raw output is just echoing back the args
  // (common MCP pattern: return the request payload as confirmation)
  const isJsonEcho = (() => {
    try {
      const parsed = JSON.parse(rawOutput);
      if (typeof parsed !== "object" || parsed === null) return false;
      // If most keys in the output match the input args, it's an echo
      const outputKeys = Object.keys(parsed);
      const argKeys = Object.keys(args);
      const overlap = outputKeys.filter((k) => argKeys.includes(k));
      return overlap.length >= argKeys.length * 0.5;
    } catch {
      return false;
    }
  })();

  if (isJsonEcho) {
    // Replace with clean confirmation — just the tool name and success
    const friendlyName = toolName.split("/").pop() ?? toolName;
    return `✓ ${friendlyName} completed successfully`;
  }

  return rawOutput;
}
