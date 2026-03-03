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
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
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

    // Convert tool schemas to ToolSummary for prompts
    const toolSummaries: ToolSummary[] = (
      input.availableToolSchemas ?? []
    ).map((t) => ({
      name: t.name,
      signature: `(${t.parameters.map((p) => p.name).join(", ")})`,
    }));

    while (refinement <= maxRefinements) {
      // ── PLAN: Generate structured plan via extractStructuredOutput ──
      const planPrompt = buildPlanGenerationPrompt({
        goal: input.taskDescription,
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
        goal: input.taskDescription,
        planMode,
      });

      steps.push(
        makeStep(
          "thought",
          `[PLAN ${refinement + 1}] ${plan.steps.map((s) => `${s.id}: ${s.title} (${s.type})`).join(", ")}`,
        ),
      );

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: maxRefinements + 1,
        thought: `[PLAN ${refinement + 1}] Generated ${plan.steps.length} steps`,
        kernelPass: `plan-execute:plan-${refinement + 1}`,
      });

      // ── EXECUTE: Run each plan step sequentially (linear mode) ──
      const completedSteps: PlanStep[] = [];

      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i]!;
        step.status = "in_progress";
        step.startedAt = new Date().toISOString();

        let stepSucceeded = false;
        let stepResult: string = "";
        let lastError: string | undefined;

        // Retry loop (up to stepRetries attempts)
        for (let attempt = 0; attempt <= stepRetries; attempt++) {
          try {
            const result = yield* executeStep(
              step,
              i,
              plan,
              completedSteps,
              input,
              toolSummaries,
              services,
              stepKernelMaxIterations,
              attempt > 0 ? lastError : undefined,
            );

            stepResult = result.output;
            totalTokens += result.tokens;
            totalCost += result.cost;
            stepSucceeded = true;
            break;
          } catch (e) {
            lastError = e instanceof Error ? e.message : String(e);
          }
        }

        // If retries failed, try to execute step via effect error handling
        if (!stepSucceeded) {
          const result = yield* executeStep(
            step,
            i,
            plan,
            completedSteps,
            input,
            toolSummaries,
            services,
            stepKernelMaxIterations,
            lastError,
          ).pipe(
            Effect.catchAll((err) => {
              const errorMsg =
                err instanceof Error ? err.message : String(err);
              return Effect.succeed({
                output: `[Step failed: ${errorMsg}]`,
                tokens: 0,
                cost: 0,
                success: false,
              });
            }),
          );

          stepResult = result.output;
          totalTokens += result.tokens;
          totalCost += result.cost;
          stepSucceeded = result.success !== false;
        }

        if (stepSucceeded) {
          step.status = "completed";
          step.result = stepResult;
          step.completedAt = new Date().toISOString();
          completedSteps.push(step);
        } else {
          step.status = "failed";
          step.error = stepResult;
          step.completedAt = new Date().toISOString();

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
          }

          completedSteps.push(step);
        }

        steps.push(
          makeStep(
            "observation",
            `[EXEC ${i + 1}] ${stepResult}`,
          ),
        );

        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: maxRefinements + 1,
          observation: `[EXEC ${i + 1}] ${stepResult}`,
          kernelPass: `plan-execute:step-${i + 1}`,
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
        input.taskDescription,
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

      steps.push(
        makeStep(
          "observation",
          `[REFLECT ${refinement + 1}] ${reflectResponse.content}`,
        ),
      );

      // Check if reflection is satisfied
      if (isSatisfied(reflectResponse.content)) {
        // ── SYNTHESIZE: Produce a clean final answer from step results ──
        const synthResultTexts = plan.steps
          .filter((s) => s.result)
          .map((s, idx) => `Step ${idx + 1}: ${s.result}`);

        const synthLlmResponse = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: `Task: ${input.taskDescription}\n\nExecution results:\n${synthResultTexts.join("\n")}\n\nSynthesize a clear, complete answer to the original task based on the results above.`,
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

  // For analysis or composite steps, or tool_call without toolService — use ReAct kernel

  // Build prior results for the step execution prompt
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
    goal: input.taskDescription,
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

  // For analysis: no tools. For composite: scoped tools only.
  const kernelToolSchemas =
    step.type === "composite" && step.toolHints
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
      output: kernelResult.output || `[Step ${stepIndex + 1} completed]`,
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
  const patchPrompt = buildPatchPrompt(input.taskDescription, plan.steps);

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
