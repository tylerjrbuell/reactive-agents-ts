// File: src/strategies/reactive.ts
//
// Thin wrapper — delegates entirely to runKernel(reactKernel, ...) and maps the
// result to ReasoningResult via buildStrategyResult.
import { Effect } from "effect";
import type { ReasoningResult } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { ToolSchema } from "./shared/tool-utils.js";
import { runKernel } from "./shared/kernel-runner.js";
import { reactKernel } from "./shared/react-kernel.js";
import { buildStrategyResult } from "./shared/step-utils.js";
import type { KernelInput } from "./shared/kernel-state.js";

// ── Re-exports for backwards compatibility ────────────────────────────────────

export type { CompressResult } from "./shared/tool-utils.js";
export { evaluateTransform, compressToolResult } from "./shared/tool-utils.js";
export { parseToolRequest as parseToolRequestWithTransform } from "./shared/tool-utils.js";
export { truncateForDisplay } from "./shared/tool-execution.js";

// ── ReactiveInput ─────────────────────────────────────────────────────────────

interface ReactiveInput {
  readonly taskDescription: string;
  readonly taskType: string;
  readonly memoryContext: string;
  /** Full tool schemas with parameter info — preferred over toolNames */
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Fallback: tool names only (legacy) */
  readonly availableTools: readonly string[];
  readonly config: ReasoningConfig;
  /** Model context profile — controls compaction thresholds, verbosity, tool result sizes. */
  readonly contextProfile?: Partial<ContextProfile>;
  /** Custom system prompt for steering agent behavior */
  readonly systemPrompt?: string;
  /** Task ID for event correlation */
  readonly taskId?: string;
  /** Tool result compression config — controls preview size, scratchpad overflow, and pipe transforms. */
  readonly resultCompression?: ResultCompressionConfig;
  /** Agent ID for tool execution attribution. Falls back to "reasoning-agent". */
  readonly agentId?: string;
  /** Session ID for tool execution attribution. Falls back to "reasoning-session". */
  readonly sessionId?: string;
}

// ── executeReactive ───────────────────────────────────────────────────────────

/**
 * ReAct strategy — delegates to runKernel(reactKernel, ...).
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
    const start = Date.now();

    const maxIter =
      input.contextProfile?.maxIterations ??
      input.config.strategies.reactive.maxIterations;

    // Map memoryContext into priorContext for the kernel
    const priorContext = input.memoryContext?.trim()
      ? `Relevant Memory:\n${input.memoryContext}`
      : undefined;

    // Resolve tool schemas — prefer full schemas, fall back to name-only stubs
    // so the kernel always sees tools in the prompt when any are available.
    const toolSchemas: readonly ToolSchema[] | undefined =
      input.availableToolSchemas && input.availableToolSchemas.length > 0
        ? input.availableToolSchemas
        : input.availableTools.length > 0
          ? input.availableTools.map((name) => ({
              name,
              description: "",
              parameters: [],
            }))
          : undefined;

    const kernelInput: KernelInput = {
      task: input.taskDescription,
      systemPrompt: input.systemPrompt,
      availableToolSchemas: toolSchemas,
      priorContext,
      contextProfile: input.contextProfile,
      resultCompression: input.resultCompression,
      temperature:
        input.contextProfile?.temperature ??
        input.config.strategies.reactive.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
    };

    const state = yield* runKernel(reactKernel, kernelInput, {
      maxIterations: maxIter,
      strategy: "reactive",
      kernelType: "react",
      taskId: input.taskId ?? "reactive",
      kernelPass: "reactive:main",
    });

    // When max iterations reached (no explicit output), fall back to last thought
    const output =
      state.output ??
      [...state.steps].filter((s) => s.type === "thought").pop()?.content ??
      null;

    return buildStrategyResult({
      strategy: "reactive",
      steps: [...state.steps],
      output,
      status: state.status === "done" ? "completed" : "partial",
      start,
      totalTokens: state.tokens,
      totalCost: state.cost,
    });
  });
