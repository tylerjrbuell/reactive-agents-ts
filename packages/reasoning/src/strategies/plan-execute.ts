// File: src/strategies/plan-execute.ts
/**
 * Plan-Execute-Reflect Strategy
 *
 * 1. Generate a plan (ordered list of steps)
 * 2. Execute each step via LLM (+tools if available)
 * 3. After all steps, reflect on execution quality
 * 4. Optionally refine the plan and re-execute (up to maxRefinements)
 */
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import { PromptService } from "@reactive-agents/prompts";
import { EventBus } from "@reactive-agents/core";

interface PlanExecuteInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
}

export const executePlanExecute = (
  input: PlanExecuteInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const toolServiceOpt = yield* Effect.serviceOption(ToolService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOpt = promptServiceOptRaw as PromptServiceOpt;
    const ebOptRaw = yield* Effect.serviceOption(EventBus).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const ebOpt = ebOptRaw as typeof ebOptRaw;
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
        promptServiceOpt,
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
      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: `[PLAN ${refinement + 1}] ${planText}`,
        timestamp: new Date(),
      });

      if (ebOpt._tag === "Some") {
        yield* ebOpt.value.publish({
          _tag: "ReasoningStepCompleted",
          taskId: input.taskId ?? "plan-execute",
          strategy: "plan-execute-reflect",
          step: steps.length,
          totalSteps: maxRefinements + 1,
          thought: `[PLAN ${refinement + 1}] ${planText}`,
        }).pipe(Effect.catchAll(() => Effect.void));
      }

      // Parse plan into individual steps
      const planSteps = parsePlanSteps(planText);

      // ── EXECUTE: Run each plan step ──
      let stepResults: string[] = [];
      for (let i = 0; i < planSteps.length; i++) {
        const stepDescription = planSteps[i];

        // Check for tool requests in the step
        const toolRequest = parseToolFromStep(stepDescription);

        let stepResult: string;

        if (
          toolRequest &&
          toolServiceOpt._tag === "Some"
        ) {
          // Execute tool
          steps.push({
            id: ulid() as StepId,
            type: "action",
            content: JSON.stringify(toolRequest),
            timestamp: new Date(),
            metadata: { toolUsed: toolRequest.tool },
          });

          const toolService = toolServiceOpt.value;
          stepResult = yield* toolService
            .execute({
              toolName: toolRequest.tool,
              arguments: toolRequest.args,
              agentId: "reasoning-agent",
              sessionId: "reasoning-session",
            })
            .pipe(
              Effect.map((r) =>
                typeof r.result === "string"
                  ? r.result
                  : JSON.stringify(r.result),
              ),
              Effect.catchAll((e) =>
                Effect.succeed(`[Tool error: ${e instanceof Error ? e.message : String(e)}]`),
              ),
            );
        } else {
          // Execute step via LLM
          const execDefaultFallback = input.systemPrompt
            ? `${input.systemPrompt}\n\nYou are executing a plan for: ${input.taskDescription}`
            : `You are executing a plan for: ${input.taskDescription}`;

          const execSystemPrompt = yield* compilePromptOrFallback(
            promptServiceOpt,
            "reasoning.plan-execute-execute",
            { task: input.taskDescription },
            execDefaultFallback,
          );
          const execResponse = yield* llm
            .complete({
              messages: [
                {
                  role: "user",
                  content: `Execute this step of the plan:\n\nStep ${i + 1}: ${stepDescription}\n\nContext so far:\n${buildCompactedStepContext(stepResults)}`,
                },
              ],
              systemPrompt: execSystemPrompt,
              maxTokens: 300,
              temperature: 0.5,
            })
            .pipe(
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

          totalTokens += execResponse.usage.totalTokens;
          totalCost += execResponse.usage.estimatedCost;
          stepResult = execResponse.content;
        }

        stepResults.push(`Step ${i + 1}: ${stepResult}`);

        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: `[EXEC ${i + 1}] ${stepResult}`,
          timestamp: new Date(),
        });

        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "ReasoningStepCompleted",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            step: steps.length,
            totalSteps: maxRefinements + 1,
            observation: `[EXEC ${i + 1}] ${stepResult}`,
          }).pipe(Effect.catchAll(() => Effect.void));
        }
      }

      // ── REFLECT: Evaluate execution quality ──
      const reflectDefaultFallback = input.systemPrompt
        ? `${input.systemPrompt}\n\nYou are evaluating plan execution. Determine if the task has been adequately addressed.`
        : "You are evaluating plan execution. Determine if the task has been adequately addressed.";

      const reflectSystemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
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

      steps.push({
        id: ulid() as StepId,
        type: "observation",
        content: `[REFLECT ${refinement + 1}] ${reflectResponse.content}`,
        timestamp: new Date(),
      });

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
            systemPrompt: input.systemPrompt ?? "You are a synthesizer. Combine execution results into a clear, concise final answer.",
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

        steps.push({
          id: ulid() as StepId,
          type: "thought",
          content: `[SYNTHESIS] ${finalOutput}`,
          timestamp: new Date(),
        });

        if (ebOpt._tag === "Some") {
          yield* ebOpt.value.publish({
            _tag: "FinalAnswerProduced",
            taskId: input.taskId ?? "plan-execute",
            strategy: "plan-execute-reflect",
            answer: finalOutput,
            iteration: refinement,
            totalTokens,
          }).pipe(Effect.catchAll(() => Effect.void));
        }
        break;
      }

      refinement++;
    }

    // Build final output from last step results if not already set
    if (!finalOutput) {
      const lastObservations = steps
        .filter((s) => s.type === "observation" && s.content.startsWith("[EXEC"))
        .map((s) => s.content);
      finalOutput = lastObservations.join("\n\n") || String(steps[steps.length - 1]?.content ?? "");
    }

    return {
      strategy: "plan-execute-reflect" as const,
      steps: [...steps],
      output: finalOutput,
      metadata: {
        duration: Date.now() - start,
        cost: totalCost,
        tokensUsed: totalTokens,
        stepsCount: steps.length,
        confidence: finalOutput ? 0.8 : 0.5,
      },
      status: finalOutput ? ("completed" as const) : ("partial" as const),
    };
  });

// ─── Prompt compilation helper ───

type PromptServiceOpt =
  | { _tag: "Some"; value: { compile: (id: string, vars: Record<string, unknown>) => Effect.Effect<{ content: string }, unknown> } }
  | { _tag: "None" };

function compilePromptOrFallback(
  promptServiceOpt: PromptServiceOpt,
  templateId: string,
  variables: Record<string, unknown>,
  fallback: string,
): Effect.Effect<string, never> {
  if (promptServiceOpt._tag === "None") {
    return Effect.succeed(fallback);
  }
  return promptServiceOpt.value
    .compile(templateId, variables)
    .pipe(
      Effect.map((compiled: { content: string }) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
    );
}

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
      steps.push(match[1].trim());
    }
  }
  return steps.length > 0 ? steps : [planText.trim()];
}

function parseToolFromStep(
  step: string,
): { tool: string; args: Record<string, unknown> } | null {
  const match = step.match(/TOOL:\s*([\w-]+)\((.+)\)/is);
  if (!match) return null;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(match[2]);
  } catch {
    args = { input: match[2] };
  }
  return { tool: match[1], args };
}

function isSatisfied(reflection: string): boolean {
  return /^SATISFIED:/i.test(reflection.trim());
}

/**
 * Prevents O(n²) token growth during plan execution.
 * When more than 5 step results exist, collapses older ones to one-liners.
 */
function buildCompactedStepContext(stepResults: string[]): string {
  if (stepResults.length <= 5) return stepResults.join("\n");
  const older = stepResults
    .slice(0, stepResults.length - 5)
    .map((_, i) => `Step ${i + 1}: [completed]`);
  const recent = stepResults.slice(-5);
  return [...older, ...recent].join("\n");
}
