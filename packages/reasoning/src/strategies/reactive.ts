// File: src/strategies/reactive.ts
import { Effect } from "effect";
import { ulid } from "ulid";
import type { ReasoningResult, ReasoningStep } from "../types/index.js";
import type { StepId } from "../types/step.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import type { ToolDefinition, ToolOutput } from "@reactive-agents/tools";

interface ReactiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
}

/**
 * ReAct loop: Thought -> Action -> Observation, iterating until done.
 *
 * When ToolService is available in context, ACTION calls are executed
 * against real registered tools and results are fed back as observations.
 * Without ToolService, tool calls are noted as unavailable.
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
    // ToolService is optional — reasoning works with or without tools
    const toolServiceOptRaw = yield* Effect.serviceOption(ToolService);
    const toolServiceOpt = toolServiceOptRaw as
      | { _tag: "Some"; value: ToolServiceInstance }
      | { _tag: "None" };
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

        // Execute tool via ToolService (real result) or note as unavailable
        const observationContent = yield* runToolObservation(
          toolServiceOpt,
          toolRequest,
          input,
        );

        steps.push({
          id: ulid() as StepId,
          type: "observation",
          content: observationContent,
          timestamp: new Date(),
        });

        // Feed real observation back into context for next iteration
        context = appendToContext(
          context,
          `${thought}\nObservation: ${observationContent}`,
        );
      } else {
        context = appendToContext(context, thought);
      }

      iteration++;
    }

    // Max iterations reached — return partial result
    return buildResult(steps, null, "partial", start, totalTokens, totalCost);
  });

// ─── Local type alias for the ToolService interface ───

type ToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<ToolOutput, unknown>;
  readonly getTool: (name: string) => Effect.Effect<ToolDefinition, unknown>;
};

// ─── Tool execution (called from inside Effect.gen, no extra requirements) ───

function runToolObservation(
  toolServiceOpt: { _tag: "Some"; value: ToolServiceInstance } | { _tag: "None" },
  toolRequest: { tool: string; input: string },
  _input: ReactiveInput,
): Effect.Effect<string, never> {
  if (toolServiceOpt._tag === "None") {
    return Effect.succeed(
      `[Tool "${toolRequest.tool}" requested but ToolService is not available — add .withTools() to agent builder]`,
    );
  }

  const toolService = toolServiceOpt.value;

  return Effect.gen(function* () {
    // Parse args: try JSON first, fall back to first-param string mapping
    const args = yield* resolveToolArgs(toolService, toolRequest);

    const result = yield* toolService
      .execute({
        toolName: toolRequest.tool,
        arguments: args,
        agentId: "reasoning-agent",
        sessionId: "reasoning-session",
      })
      .pipe(
        Effect.map((r: ToolOutput) =>
          typeof r.result === "string" ? r.result : JSON.stringify(r.result),
        ),
        Effect.catchAll((e) => {
          const msg =
            e instanceof Error
              ? e.message
              : typeof e === "object" && e !== null && "message" in e
                ? String((e as { message: unknown }).message)
                : String(e);
          return Effect.succeed(`[Tool error: ${msg}]`);
        }),
      );

    return result;
  }).pipe(
    Effect.catchAll((e) =>
      Effect.succeed(`[Unexpected error executing tool: ${String(e)}]`),
    ),
  );
}

function resolveToolArgs(
  toolService: ToolServiceInstance,
  toolRequest: { tool: string; input: string },
): Effect.Effect<Record<string, unknown>, never> {
  const trimmed = toolRequest.input.trim();

  // Try JSON object/array parsing
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return Effect.succeed(parsed as Record<string, unknown>);
      }
    } catch {
      // Fall through to parameter mapping
    }
  }

  // Map raw string to first required parameter of the tool definition
  return toolService
    .getTool(toolRequest.tool)
    .pipe(
      Effect.map((toolDef: ToolDefinition) => {
        const firstParam =
          toolDef.parameters.find((p: { required?: boolean }) => p.required) ?? toolDef.parameters[0];
        if (firstParam) {
          return { [firstParam.name]: trimmed } as Record<string, unknown>;
        }
        return { input: trimmed } as Record<string, unknown>;
      }),
      Effect.catchAll(() =>
        Effect.succeed({ input: trimmed } as Record<string, unknown>),
      ),
    );
}

// ─── Helpers (private to module) ───

function buildInitialContext(input: ReactiveInput): string {
  const toolsSection =
    input.availableTools.length > 0
      ? `Available Tools: ${input.availableTools.join(", ")}\nTo use a tool: ACTION: tool_name({"param": "value"}) — use JSON for tool arguments.`
      : "No tools available for this task.";
  return [
    `Task: ${input.taskDescription}`,
    `Task Type: ${input.taskType}`,
    `Relevant Memory:\n${input.memoryContext}`,
    toolsSection,
  ].join("\n\n");
}

function buildThoughtPrompt(
  context: string,
  history: readonly ReasoningStep[],
): string {
  const historyStr = history.map((s) => `[${s.type}] ${s.content}`).join("\n");
  return `${context}\n\nPrevious steps:\n${historyStr}\n\nThink step-by-step. If you need a tool, respond with "ACTION: tool_name({"param": "value"})". If you have a final answer, respond with "FINAL ANSWER: ...".`;
}

function hasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

function parseToolRequest(
  thought: string,
): { tool: string; input: string } | null {
  // Greedy match to handle JSON in the argument (which may contain parentheses)
  const match = thought.match(/ACTION:\s*([\w-]+)\((.+)\)/is);
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
