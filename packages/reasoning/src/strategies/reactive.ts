// File: src/strategies/reactive.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";

interface ReactiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * ReAct loop: Thought -> Action -> Observation, iterating until done.
 * Each iteration calls the LLM once for reasoning.
 */
export const executeReactive = (
  input: ReactiveInput,
): Effect.Effect<
  ReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService
> =>
  Effect.gen(function* () {
    const llm = yield* LLMService;
    const maxIter = input.config.strategies.reactive.maxIterations;
    const temp = input.config.strategies.reactive.temperature;
    const steps: ReasoningStep[] = [];
    const start = Date.now();

    let context = buildInitialContext(input);
    let iteration = 0;
    let totalTokens = 0;
    let totalCost = 0;

    while (iteration < maxIter) {
      // ── THOUGHT ──
      const thoughtResponse = yield* llm
        .complete({
          messages: [
            { role: "user", content: buildThoughtPrompt(context, steps) },
          ],
          systemPrompt: `You are a reasoning agent. Task: ${input.taskDescription}`,
          maxTokens: 300,
          temperature: temp,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reactive",
                message: `LLM thought failed at iteration ${iteration}`,
                step: iteration,
                cause: err,
              }),
          ),
        );

      const thought = thoughtResponse.content;
      totalTokens += thoughtResponse.usage.totalTokens;
      totalCost += thoughtResponse.usage.estimatedCost;

      steps.push({
        id: ulid() as StepId,
        type: "thought",
        content: thought,
        timestamp: new Date(),
      });

      // ── CHECK: does the thought indicate a final answer? ──
      if (hasFinalAnswer(thought)) {
        return buildResult(
          steps,
          thought,
          "completed",
          start,
          totalTokens,
          totalCost,
        );
      }

      // ── ACTION: does the thought request a tool call? ──
      const toolRequest = parseToolRequest(thought);
      if (toolRequest) {
        steps.push({
          id: ulid() as StepId,
          type: "action",
          content: JSON.stringify(toolRequest),
          timestamp: new Date(),
          metadata: { toolUsed: toolRequest.tool },
        });

        // Tool execution is deferred to the caller (ReasoningService) via a
        // placeholder observation. The service orchestrates tool calls through
        // the ToolService from Layer 8. Here, we note the request and continue.
        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: `[Tool call requested: ${toolRequest.tool}(${JSON.stringify(toolRequest.input)})]`,
          timestamp: new Date(),
        });

        // Update context with tool request for next iteration
        context = appendToContext(context, thought);
      }

      iteration++;
    }

    // Max iterations reached — return partial result
    return buildResult(steps, null, "partial", start, totalTokens, totalCost);
  });

// ─── Helpers (private to module) ───

function buildInitialContext(input: ReactiveInput): string {
  return [
    `Task: ${input.taskDescription}`,
    `Task Type: ${input.taskType}`,
    `Relevant Memory:\n${input.memoryContext}`,
    `Available Tools: ${input.availableTools.join(", ")}`,
  ].join("\n\n");
}

function buildThoughtPrompt(
  context: string,
  history: readonly ReasoningStep[],
): string {
  const historyStr = history.map((s) => `[${s.type}] ${s.content}`).join("\n");
  return `${context}\n\nPrevious steps:\n${historyStr}\n\nThink step-by-step. If you need a tool, respond with "ACTION: tool_name(input)". If you have a final answer, respond with "FINAL ANSWER: ...".`;
}

function hasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

function parseToolRequest(
  thought: string,
): { tool: string; input: string } | null {
  const match = thought.match(/ACTION:\s*(\w+)\((.+?)\)/i);
  return match ? { tool: match[1], input: match[2] } : null;
}

function appendToContext(context: string, addition: string): string {
  return `${context}\n\n${addition}`;
}

function buildResult(
  steps: readonly ReasoningStep[],
  output: unknown,
  status: "completed" | "partial",
  startMs: number,
  tokensUsed: number,
  cost: number,
): ReasoningResult {
  return {
    strategy: "reactive",
    steps: [...steps],
    output,
    metadata: {
      duration: Date.now() - startMs,
      cost,
      tokensUsed,
      stepsCount: steps.length,
      confidence: status === "completed" ? 0.8 : 0.4,
    },
    status,
  };
}
