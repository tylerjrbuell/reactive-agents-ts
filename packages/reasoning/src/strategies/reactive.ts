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
import type { ToolSchema } from "./kernel/tool-utils.js";
import { runKernel } from "./kernel/kernel-runner.js";
import { reactKernel } from "./kernel/react-kernel.js";
import { buildStrategyResult } from "./kernel/step-utils.js";
import type { KernelInput, KernelMessage } from "./kernel/kernel-state.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import type { TerminatedBy } from "@reactive-agents/core";

// ── Re-exports for backwards compatibility ────────────────────────────────────

export type { CompressResult } from "./kernel/tool-utils.js";
export { evaluateTransform, compressToolResult } from "./kernel/tool-utils.js";
// parseToolRequestWithTransform re-export removed — use parseToolRequest from shared/tool-utils directly
export { truncateForDisplay } from "./kernel/tool-execution.js";

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
  /** Tools identified as relevant/supplementary (LLM-classified) — allowed through the required-tools gate */
  readonly relevantTools?: readonly string[];
  /** Per-tool call budget — gate blocks calls that exceed their limit (e.g. `{ "web-search": 3 }`) */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /** Max redirects when required tools are missing (default: 2) */
  readonly maxRequiredToolRetries?: number;
  /** Dynamic strategy switching configuration */
  readonly strategySwitching?: {
    readonly enabled: boolean;
    readonly maxSwitches?: number;
    readonly fallbackStrategy?: string;
  };
  /** Model ID for entropy sensor scoring */
  readonly modelId?: string;
  /** Task category for per-category entropy scoring adjustments */
  readonly taskCategory?: string;
  /** LLM sampling temperature — forwarded to entropy sensor */
  readonly temperature?: number;
  /** Custom environment context key-value pairs injected into system prompt */
  readonly environmentContext?: Readonly<Record<string, string>>;
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  readonly metaTools?: KernelMetaToolsConfig;
  /** Initial messages to seed the kernel conversation thread (e.g. task as user message). */
  readonly initialMessages?: readonly KernelMessage[];
  /** Intelligent Context Synthesis — from .withReasoning({ synthesis: ... }) */
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
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
      relevantTools: input.relevantTools,
      maxCallsPerTool: input.maxCallsPerTool,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      environmentContext: input.environmentContext,
      metaTools: input.metaTools,
      initialMessages: input.initialMessages,
      synthesisConfig: input.synthesisConfig,
    };

    const state = yield* runKernel(reactKernel, kernelInput, {
      maxIterations: maxIter,
      strategy: "reactive",
      kernelType: "react",
      taskId: input.taskId ?? "reactive",
      kernelPass: "reactive:main",
      taskDescription: input.taskDescription,
      modelId: input.modelId,
      taskCategory: input.taskCategory,
      temperature: kernelInput.temperature,
      strategySwitching: input.strategySwitching
        ? {
            enabled: input.strategySwitching.enabled,
            maxSwitches: input.strategySwitching.maxSwitches,
            fallbackStrategy: input.strategySwitching.fallbackStrategy,
            availableStrategies: ["reactive", "plan-execute-reflect", "reflexion", "tree-of-thought"],
          }
        : undefined,
    });

    // When failed, surface kernel error; else output / last thought
    const output =
      state.status === "failed" && state.error
        ? state.error
        : state.output ??
          [...state.steps].filter((s) => s.type === "thought").pop()?.content ??
          null;

    // Derive terminatedBy from kernel state — map oracle reasons to canonical types
    const rawTerminatedBy = state.meta.terminatedBy as string | undefined;
    const terminatedBy: TerminatedBy =
      rawTerminatedBy === "llm_error"
        ? "llm_error"
        : rawTerminatedBy === "final_answer_tool"
          ? "final_answer_tool"
          : rawTerminatedBy === "end_turn" || rawTerminatedBy === "llm_end_turn"
            ? "end_turn"
            : rawTerminatedBy === "final_answer_regex"
              ? "final_answer"
              : state.status === "done"
                ? "final_answer"
                : "max_iterations";

    return buildStrategyResult({
      strategy: "reactive",
      steps: [...state.steps],
      output,
      status:
        state.status === "done"
          ? "completed"
          : state.status === "failed"
            ? "failed"
            : "partial",
      start,
      totalTokens: state.tokens,
      totalCost: state.cost,
      extraMetadata: {
        terminatedBy,
        llmCalls: state.llmCalls ?? 0,
        ...(state.meta.finalAnswerCapture !== undefined
          ? { finalAnswerCapture: state.meta.finalAnswerCapture }
          : {}),
      },
    });
  });
