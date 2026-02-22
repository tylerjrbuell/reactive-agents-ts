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
import { PromptService } from "@reactive-agents/prompts";

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
    // PromptService is optional — falls back to hardcoded strings
    const promptServiceOptRaw = yield* Effect.serviceOption(PromptService).pipe(
      Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
    );
    const promptServiceOpt = promptServiceOptRaw as PromptServiceOpt;
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
      // Use PromptService for system prompt if available
      const systemPrompt = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.react-system",
        { task: input.taskDescription },
        `You are a reasoning agent. Task: ${input.taskDescription}`,
      );
      const thoughtContent = yield* compilePromptOrFallback(
        promptServiceOpt,
        "reasoning.react-thought",
        {
          context,
          history: steps.map((s) => `[${s.type}] ${s.content}`).join("\n"),
        },
        buildThoughtPrompt(context, steps),
      );

      const thoughtResponse = yield* llm
        .complete({
          messages: [
            { role: "user", content: thoughtContent },
          ],
          systemPrompt,
          maxTokens: 1500,
          temperature: temp,
        })
        .pipe(
          Effect.mapError(
            (err) =>
              new ExecutionError({
                strategy: "reactive",
                message: `LLM thought failed at iteration ${iteration}: ${
                  err && typeof err === "object" && "message" in err
                    ? (err as { message: string }).message
                    : String(err)
                }`,
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
      // JSON looks truncated or malformed — check if tool has multiple required params
      return toolService
        .getTool(toolRequest.tool)
        .pipe(
          Effect.flatMap((toolDef: ToolDefinition) => {
            const requiredParams = toolDef.parameters.filter(
              (p: { required?: boolean }) => p.required,
            );
            if (requiredParams.length > 1) {
              // Multi-param tool with broken JSON — don't guess, report the problem
              const paramNames = requiredParams.map((p: { name: string }) => p.name).join(", ");
              return Effect.succeed({
                _parseError: true,
                error: `Malformed JSON for tool "${toolRequest.tool}". Expected JSON with keys: ${paramNames}. Got: ${trimmed.slice(0, 100)}...`,
              } as Record<string, unknown>);
            }
            // Single-param: map raw string to first param
            const firstParam = requiredParams[0] ?? toolDef.parameters[0];
            return Effect.succeed(
              firstParam
                ? ({ [firstParam.name]: trimmed } as Record<string, unknown>)
                : ({ input: trimmed } as Record<string, unknown>),
            );
          }),
          Effect.catchAll(() =>
            Effect.succeed({ input: trimmed } as Record<string, unknown>),
          ),
        );
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
      Effect.map((compiled) => compiled.content),
      Effect.catchAll(() => Effect.succeed(fallback)),
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
  return `${context}\n\nPrevious steps:\n${historyStr}\n\nThink step-by-step. If you need a tool, respond with "ACTION: tool_name({"param": "value"})" using valid JSON for the arguments. For tools with multiple parameters, include all required fields in the JSON object. If you have a final answer, respond with "FINAL ANSWER: ...".`;
}

function hasFinalAnswer(thought: string): boolean {
  return /final answer:/i.test(thought);
}

function parseToolRequest(
  thought: string,
): { tool: string; input: string } | null {
  // Match the ACTION prefix and tool name
  const prefixMatch = thought.match(/ACTION:\s*([\w-]+)\(/i);
  if (!prefixMatch) return null;

  const tool = prefixMatch[1];
  const argsStart = (prefixMatch.index ?? 0) + prefixMatch[0].length;
  const rest = thought.slice(argsStart);

  // If args start with '{', use brace-matching to extract the JSON object
  if (rest.trimStart().startsWith("{")) {
    const trimOffset = rest.length - rest.trimStart().length;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = trimOffset; i < rest.length; i++) {
      const ch = rest[i];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth++;
      if (ch === "}") {
        depth--;
        if (depth === 0) {
          return { tool, input: rest.slice(trimOffset, i + 1) };
        }
      }
    }
  }

  // Fallback: greedy regex (captures up to last ')' in thought)
  const match = thought.match(/ACTION:\s*[\w-]+\((.+)\)/is);
  return match ? { tool, input: match[1] } : null;
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
