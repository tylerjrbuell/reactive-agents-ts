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
  /** Full unfiltered tool schemas — used by completion guard to detect all namespaces */
  readonly allToolSchemas?: readonly ToolSchema[];
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
  /** Tools that MUST be called before the agent can declare success */
  readonly requiredTools?: readonly string[];
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Dynamic strategy switching configuration */
  readonly strategySwitching?: {
    readonly enabled: boolean;
    readonly maxSwitches?: number;
    readonly fallbackStrategy?: string;
  };
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
      allToolSchemas: input.allToolSchemas,
      priorContext,
      contextProfile: input.contextProfile,
      resultCompression: input.resultCompression,
      temperature:
        input.contextProfile?.temperature ??
        input.config.strategies.reactive.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
      requiredTools: input.requiredTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
    };

    const state = yield* runKernel(reactKernel, kernelInput, {
      maxIterations: maxIter,
      strategy: "reactive",
      kernelType: "react",
      taskId: input.taskId ?? "reactive",
      kernelPass: "reactive:main",
      strategySwitching: input.strategySwitching
        ? {
            enabled: input.strategySwitching.enabled,
            maxSwitches: input.strategySwitching.maxSwitches,
            fallbackStrategy: input.strategySwitching.fallbackStrategy,
            availableStrategies: ["reactive", "plan-execute-reflect", "reflexion", "tree-of-thought"],
          }
        : undefined,
    });

    // When max iterations reached (no explicit output), fall back to last thought
    const output =
      state.output ??
      [...state.steps].filter((s) => s.type === "thought").pop()?.content ??
      null;

    // Derive terminatedBy from kernel state
    const terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" =
      state.meta.terminatedBy === "final_answer_tool"
        ? "final_answer_tool"
        : state.meta.terminatedBy === "end_turn"
          ? "end_turn"
          : state.status === "done"
            ? "final_answer"
            : "max_iterations";

    return buildStrategyResult({
      strategy: "reactive",
      steps: [...state.steps],
      output,
      status: state.status === "done" ? "completed" : "partial",
      start,
      totalTokens: state.tokens,
      totalCost: state.cost,
      extraMetadata: {
        terminatedBy,
        ...(state.meta.finalAnswerCapture !== undefined
          ? { finalAnswerCapture: state.meta.finalAnswerCapture }
          : {}),
      },
    });
  });
