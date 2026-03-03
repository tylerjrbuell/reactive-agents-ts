// File: src/strategies/plan-execute.ts
/**
 * Plan-Execute-Reflect Strategy
 *
 * 1. Generate a plan (ordered list of steps)
 * 2. Execute each step via the ReAct kernel (full tool-aware loop)
 * 3. After all steps, reflect on execution quality
 * 4. Optionally refine the plan and re-execute (up to maxRefinements)
 */
import { Effect } from "effect";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { executeReActKernel } from "./shared/react-kernel.js";
import {
  resolveStrategyServices,
  compilePromptOrFallback,
  publishReasoningStep,
} from "./shared/service-utils.js";
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
    const { llm, promptService, eventBus } = services;

    const { maxRefinements, reflectionDepth } =
      input.config.strategies.planExecute;
    const steps: ReasoningStep[] = [];
    const start = Date.now();
    let totalTokens = 0;
    let totalCost = 0;

    let refinement = 0;
    let finalOutput: string | null = null;

    while (refinement <= maxRefinements) {
      // ── PLAN: Generate structured plan ──
      const planPrompt =
        refinement === 0
          ? buildPlanPrompt(input)
          : buildRefinePlanPrompt(input, steps);

      const planDefaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are a planning agent. Break tasks into clear, sequential steps. Task: ${input.taskDescription}`
        : `You are a planning agent. Break tasks into clear, sequential steps. Task: ${input.taskDescription}`;

      const planSystemPrompt = yield* compilePromptOrFallback(
        promptService,
        "reasoning.plan-execute-plan",
        { task: input.taskDescription },
        planDefaultFallback,
      );

      const planResponse = yield* llm
        .complete({
          messages: [{ role: "user", content: planPrompt }],
          systemPrompt: planSystemPrompt,
          maxTokens: 500,
          temperature: 0.5,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Planning failed at refinement ${refinement}`,
                step: refinement,
                cause: err,
              }),
          ),
        );

      totalTokens += planResponse.usage.totalTokens;
      totalCost += planResponse.usage.estimatedCost;

      const planText = planResponse.content;
      steps.push(makeStep("thought", `[PLAN ${refinement + 1}] ${planText}`));

      yield* publishReasoningStep(eventBus, {
        _tag: "ReasoningStepCompleted",
        taskId: input.taskId ?? "plan-execute",
        strategy: "plan-execute-reflect",
        step: steps.length,
        totalSteps: maxRefinements + 1,
        thought: `[PLAN ${refinement + 1}] ${planText}`,
      });

      // Parse plan into individual steps
      const planSteps = parsePlanSteps(planText);

      // ── EXECUTE: Run each plan step via ReAct kernel ──
      const stepResults: string[] = [];
      for (let i = 0; i < planSteps.length; i++) {
        const stepDescription = planSteps[i]!;

        // Build context from prior step results (capped at last 3)
        const stepContext =
          stepResults.length > 0
            ? `\n\nPrevious steps:\n${stepResults.slice(-3).join("\n")}`
            : "";

        const execResult = yield* executeReActKernel({
          task: `Execute this step of the plan:\n\nStep: ${stepDescription}\n\nMain task: ${input.taskDescription}${stepContext}`,
          systemPrompt:
            input.systemPrompt ??
            "You are a precise task executor. Complete the given step using available tools if needed.",
          availableToolSchemas: input.availableToolSchemas,
          maxIterations: input.config.strategies.planExecute?.stepKernelMaxIterations ?? 2,
          temperature: 0.5,
          taskId: input.taskId,
          parentStrategy: "plan-execute",
          resultCompression: input.resultCompression,
          agentId: input.agentId,
          sessionId: input.sessionId,
        }).pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "plan-execute-reflect",
                message: `Step ${i + 1} execution failed`,
                step: i,
                cause: err,
              }),
          ),
        );

        const stepResult = execResult.output || `[Step ${i + 1} completed]`;
        totalTokens += execResult.totalTokens;
        totalCost += execResult.totalCost;
        stepResults.push(`Step ${i + 1}: ${stepResult}`);

        steps.push(makeStep("observation", `[EXEC ${i + 1}] ${stepResult}`));

        yield* publishReasoningStep(eventBus, {
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: maxRefinements + 1,
          observation: `[EXEC ${i + 1}] ${stepResult}`,
        });
      }

      // ── REFLECT: Evaluate execution quality ──
      const reflectDefaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are evaluating plan execution. Determine if the task has been adequately addressed.`
        : "You are evaluating plan execution. Determine if the task has been adequately addressed.";

      const reflectSystemPrompt = yield* compilePromptOrFallback(
        promptService,
        "reasoning.plan-execute-reflect",
        {},
        reflectDefaultFallback,
      );
      const reflectResponse = yield* llm
        .complete({
          messages: [
            {
              role: "user",
              content: buildReflectPrompt(
                input.taskDescription,
                planSteps,
                stepResults,
                reflectionDepth,
              ),
            },
          ],
          systemPrompt: reflectSystemPrompt,
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
        const synthLlmResponse = yield* llm
          .complete({
            messages: [
              {
                role: "user",
                content: `Task: ${input.taskDescription}\n\nExecution results:\n${stepResults.join("\n")}\n\nSynthesize a clear, complete answer to the original task based on the results above.`,
              },
            ],
            systemPrompt:
              input.systemPrompt ??
              "You are a synthesizer. Combine execution results into a clear, concise final answer.",
            maxTokens: 500,
            temperature: 0.3,
          })
          .pipe(
            Effect.catchAll(() =>
              Effect.succeed({
                content: stepResults.join("\n\n"),
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
        });
        break;
      }

      refinement++;
    }

    // Build final output from last step results if not already set
    if (!finalOutput) {
      const lastObservations = steps
        .filter((s) => s.type === "observation" && s.content.startsWith("[EXEC"))
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

// ─── Private Helpers ───

function buildPlanPrompt(input: PlanExecuteInput): string {
  const toolsSection =
    input.availableTools.length > 0
      ? `\nAvailable tools: ${input.availableTools.join(", ")}\nYou may include tool calls as steps using format: TOOL: tool_name({"param": "value"})`
      : "";

  return `Create a step-by-step plan to accomplish the following task.

Task: ${input.taskDescription}
Task Type: ${input.taskType}
${input.memoryContext ? `Context:\n${input.memoryContext}` : ""}${toolsSection}

Output a numbered list of clear, actionable steps. Each step should be specific and self-contained.`;
}

function buildRefinePlanPrompt(
  input: PlanExecuteInput,
  previousSteps: readonly ReasoningStep[],
): string {
  // Keep last 8 steps — enough context for the refiner without unbounded growth
  const recentSteps = previousSteps.slice(-8);
  const history = recentSteps
    .map((s) => `[${s.type}] ${s.content}`)
    .join("\n");

  return `The previous plan execution had issues. Create an improved plan.

Task: ${input.taskDescription}

Previous execution history:
${history}

Create an improved numbered plan that addresses the shortcomings identified in reflection.`;
}

function buildReflectPrompt(
  taskDescription: string,
  planSteps: string[],
  stepResults: string[],
  depth: "shallow" | "deep",
): string {
  const depthInstructions =
    depth === "deep"
      ? "\n- Evaluate logical consistency across steps\n- Check for missing edge cases\n- Assess overall completeness"
      : "";

  return `Task: ${taskDescription}

Plan steps:
${planSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}

Execution results:
${stepResults.join("\n")}

Evaluate:
- Were all steps executed successfully?
- Does the combined output adequately address the task?${depthInstructions}

If the execution is satisfactory, start with "SATISFIED:".
Otherwise, describe what needs improvement.`;
}

function parsePlanSteps(planText: string): string[] {
  const lines = planText.split("\n");
  const steps: string[] = [];
  for (const line of lines) {
    const match = line.match(/^\s*\d+[\.\)]\s+(.+)/);
    if (match) {
      steps.push(match[1]!.trim());
    }
  }
  return steps.length > 0 ? steps : [planText.trim()];
}
