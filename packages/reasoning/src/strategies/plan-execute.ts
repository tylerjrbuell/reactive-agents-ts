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
  resolveStepReferences,
} from "../types/plan.js";
import type { Plan, PlanStep, LLMPlanOutput } from "../types/plan.js";
import { extractStructuredOutput } from "../structured-output/pipeline.js";
import {
  buildPlanGenerationPrompt,
  buildPatchPrompt,
  buildStepExecutionPrompt,
  buildReflectionPrompt,
} from "./shared/plan-prompts.js";
import type { ToolSummary, StepResult } from "./shared/plan-prompts.js";
import { executeReActKernel } from "./shared/react-kernel.js";
import {
  resolveStrategyServices,
  publishReasoningStep,
} from "./shared/service-utils.js";
import type { StrategyServices } from "./shared/service-utils.js";
import { makeStep, buildStrategyResult } from "./shared/step-utils.js";
import { isSatisfied } from "./shared/quality-utils.js";
import type { ToolSchema } from "./shared/tool-utils.js";
import type { ResultCompressionConfig } from "@reactive-agents/tools";

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

    while (refinement <= maxRefinements) {
      // ── PLAN: Generate structured plan via extractStructuredOutput ──
      const planPrompt = buildPlanGenerationPrompt({
        goal,
        tools: toolSummaries,
        pastPatterns: [],
        modelTier: "mid",
      });

      const planResult = yield* extractStructuredOutput({
        schema: LLMPlanOutputSchema,
        prompt: planPrompt,
        systemPrompt: input.systemPrompt
          ? `${input.systemPrompt}\nYou are a planning agent. Decompose the goal into structured steps.`
          : "You are a planning agent. Decompose the goal into structured steps.",
        maxRetries: 2,
        temperature: 0.5,
        maxTokens: 2000,
      }).pipe(
        Effect.mapError(
          (err) =>
            new ExecutionError({
              strategy: "plan-execute-reflect",
              message: `Plan generation failed at refinement ${refinement}: ${err.message}`,
              step: refinement,
              cause: err,
            }),
        ),
      );

      // Track tokens from plan generation (estimated from raw response length)
      const planTokenEst =
        Math.ceil(planResult.raw.length / 4) +
        Math.ceil(planPrompt.length / 4);
      totalTokens += planTokenEst;

      const plan: Plan = hydratePlan(planResult.data, {
        taskId: input.taskId ?? "plan-execute",
        agentId: input.agentId ?? "reasoning-agent",
        goal,
        planMode,
      });

      // Persist plan to store (if available)
      // Cast needed: reasoning Plan uses `readonly string[]` for toolHints/dependsOn
      if (Option.isSome(planStoreOpt)) {
        yield* planStoreOpt.value
          .savePlan(plan as unknown as Parameters<typeof planStoreOpt.value.savePlan>[0])
          .pipe(Effect.catchAll(() => Effect.void));
      }

      steps.push(
        makeStep(
          "thought",
          `[PLAN ${refinement + 1}] ${plan.steps.map((s) => `${s.id}: ${s.title} (${s.type})`).join(", ")}`,
        ),
      );

      const planDetail = plan.steps
        .map(
          (s) =>
            `  ${s.id}: ${s.title} (${s.type}${s.toolName ? ` → ${s.toolName}` : ""})`,
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

      // ── EXECUTE: Run each plan step sequentially (linear mode) ──
      const completedSteps: PlanStep[] = [];

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i]!;
        step.status = "in_progress";
        step.startedAt = new Date().toISOString();

        // Publish step start
        const stepLabel = `${step.id}: ${step.title} (${step.type}${step.toolName ? ` → ${step.toolName}` : ""})`;
        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: plan.steps.length,
          action: `[STEP ${i + 1}/${plan.steps.length}] ${stepLabel}`,
          kernelPass: `plan-execute:step-${i + 1}:start`,
        });

        let stepSucceeded = false;
        let stepResult: string = "";
        let lastError: string | undefined;

        // Retry loop (up to stepRetries attempts) using Effect.exit to catch all errors
        for (let attempt = 0; attempt <= stepRetries; attempt++) {
          if (attempt > 0) {
            // Publish retry attempt
            yield* publishReasoningStep(eventBus, {
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "plan-execute",
              strategy: "plan-execute-reflect",
              step: steps.length,
              totalSteps: plan.steps.length,
              thought: `[RETRY ${step.id} attempt ${attempt + 1}/${stepRetries + 1}] Previous error: ${lastError}`,
              kernelPass: `plan-execute:step-${i + 1}:retry-${attempt}`,
            });
          }

          const exit = yield* Effect.exit(
            executeStep(
              step,
              i,
              plan,
              completedSteps,
              input,
              toolSummaries,
              services,
              stepKernelMaxIterations,
              attempt > 0 ? lastError : undefined,
            ),
          );

          if (Exit.isSuccess(exit)) {
            stepResult = exit.value.output;
            totalTokens += exit.value.tokens;
            totalCost += exit.value.cost;
            stepSucceeded = true;
            break;
          } else {
            // Extract error message from Cause (handles both Fail and Die)
            const squashed = Cause.squash(exit.cause);
            lastError =
              squashed instanceof Error ? squashed.message : String(squashed);
          }
        }

        // Final fallback after all retries exhausted
        if (!stepSucceeded) {
          stepResult = `[Step failed after ${stepRetries + 1} attempts: ${lastError}]`;
        }

        if (stepSucceeded) {
          step.status = "completed";
          step.result = stepResult;
          step.completedAt = new Date().toISOString();
          completedSteps.push(step);

          // Persist step completion
          if (Option.isSome(planStoreOpt)) {
            yield* planStoreOpt.value.updateStepStatus(
              step.id,
              { status: "completed", result: stepResult },
            ).pipe(Effect.catchAll(() => Effect.void));
          }
        } else {
          step.status = "failed";
          step.error = stepResult;
          step.completedAt = new Date().toISOString();

          // Publish failure event
          yield* publishReasoningStep(eventBus, {
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            step: steps.length,
            totalSteps: plan.steps.length,
            observation: `[FAILED ${step.id}] ${lastError}`,
            kernelPass: `plan-execute:step-${i + 1}:failed`,
          });

          // Persist step failure
          if (Option.isSome(planStoreOpt)) {
            yield* planStoreOpt.value.updateStepStatus(
              step.id,
              { status: "failed", error: stepResult },
            ).pipe(Effect.catchAll(() => Effect.void));
          }

          // Attempt patch if step failed
          const patchResult = yield* patchPlan(
            plan,
            i,
            input,
            llm,
            totalTokens,
          ).pipe(Effect.catchAll(() => Effect.succeed(null)));

          if (patchResult) {
            totalTokens += patchResult.tokens;
            // Replace remaining steps with patched steps
            const patchedSteps = patchResult.steps;
            plan.steps.splice(
              i + 1,
              plan.steps.length - i - 1,
              ...patchedSteps,
            );

            // Publish patch event
            const patchDetail = patchedSteps.map((s) => `${s.id}: ${s.title}`).join(", ");
            yield* publishReasoningStep(eventBus, {
              _tag: "ReasoningStepCompleted",
              taskId: input.taskId ?? "plan-execute",
              strategy: "plan-execute-reflect",
              step: steps.length,
              totalSteps: plan.steps.length,
              thought: `[PATCH] Replaced remaining steps: ${patchDetail}`,
              kernelPass: `plan-execute:step-${i + 1}:patch`,
            });
          }

          completedSteps.push(step);
        }

        steps.push(
          makeStep(
            stepSucceeded ? "observation" : "thought",
            `[EXEC ${step.id}] ${stepSucceeded ? "✓" : "✗"} ${stepResult}`,
          ),
        );

        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: plan.steps.length,
          observation: `[EXEC ${step.id}] ${stepSucceeded ? "✓" : "✗"} ${stepResult}`,
          kernelPass: `plan-execute:step-${i + 1}:done`,
        });
      }

      // ── REFLECT: Evaluate execution quality ──
      const stepResults: StepResult[] = plan.steps.map((s) => ({
        stepId: s.id,
        title: s.title,
        status: s.status,
        result: s.result ?? s.error,
      }));

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
          maxTokens: reflectionDepth === "deep" ? 500 : 300,
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

      const satisfied = isSatisfied(reflectResponse.content);

      steps.push(
        makeStep(
          "observation",
          `[REFLECT ${refinement + 1}] ${satisfied ? "SATISFIED" : "UNSATISFIED"} — ${reflectResponse.content}`,
        ),
      );

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: maxRefinements + 1,
        thought: `[REFLECT ${refinement + 1}] ${satisfied ? "✓ SATISFIED" : "✗ UNSATISFIED — refining..."} ${reflectResponse.content}`,
        kernelPass: `plan-execute:reflect-${refinement + 1}`,
      });

      // Check if reflection is satisfied
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
                content: `Task: ${goal}\n\nExecution results:\n${synthResultTexts.join("\n")}\n\nSynthesize a clear, complete answer to the original task based on the results above.`,
              },
            ],
            systemPrompt: input.systemPrompt
              ? `${input.systemPrompt}\n\nYou are a synthesizer. Combine execution results into a clear, concise final answer.`
              : "You are a synthesizer. Combine execution results into a clear, concise final answer.",
            maxTokens: 500,
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
        finalOutput = synthLlmResponse.content;

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
  retryErrorContext?: string,
): Effect.Effect<StepExecResult, ExecutionError, LLMService> {
  const { toolService } = services;

  if (step.type === "tool_call" && step.toolName && toolService._tag === "Some") {
    // Direct tool dispatch — no LLM kernel needed
    return Effect.gen(function* () {
      const rawArgs = step.toolArgs ?? {};
      const resolvedArgs = resolveStepReferences(rawArgs, completedSteps);

      const toolResult = yield* toolService.value
        .execute({
          toolName: step.toolName!,
          arguments: resolvedArgs,
          agentId: input.agentId ?? "reasoning-agent",
          sessionId: input.sessionId ?? "reasoning-session",
        })
        .pipe(
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

      const output =
        typeof toolResult.result === "string"
          ? toolResult.result
          : JSON.stringify(toolResult.result);

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
  if (step.type === "analysis") {
    return services.llm
      .complete({
        messages: [{ role: "user", content: taskText }],
        systemPrompt:
          input.systemPrompt ??
          "You are a precise task executor. Complete the given step. Respond directly with your answer.",
        maxTokens: 1000,
        temperature: 0.5,
      })
      .pipe(
        Effect.map((response) => ({
          output: stripFinalAnswerPrefix(response.content),
          tokens: response.usage.totalTokens,
          cost: response.usage.estimatedCost,
          success: true,
        })),
        Effect.mapError(
          (err) =>
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
    maxTokens: 1500,
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
