// File: src/strategies/reactive.ts
//
// Thin wrapper — delegates entirely to runKernel(reactKernel, ...) and maps the
// result to ReasoningResult via buildStrategyResult.
import { Effect } from "effect";
import type { ReasoningResult } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ObservableLogger, type LogEvent } from "@reactive-agents/observability";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import { runKernel } from "../kernel/loop/runner.js";
import { reactKernel } from "../kernel/loop/react-kernel.js";
import { buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import type { KernelInput, KernelMessage } from "../kernel/state/kernel-state.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import type { TerminatedBy } from "@reactive-agents/core";
import { resolveExecutableToolCapabilities } from "../kernel/capabilities/act/tool-capabilities.js";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

// ── Re-exports for backwards compatibility ────────────────────────────────────

export type { CompressResult } from "../kernel/capabilities/attend/tool-formatting.js";
export { compressToolResult } from "../kernel/capabilities/attend/tool-formatting.js";
export { evaluateTransform } from "../kernel/capabilities/act/tool-parsing.js";
// parseToolRequestWithTransform re-export removed — use parseToolRequest from kernel/tool-utils directly
export { truncateForDisplay } from "../kernel/capabilities/act/tool-execution.js";

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
  /** LLM provider name (e.g. "ollama", "anthropic") — used to auto-derive default
   *  context profile tier when no explicit contextProfile.tier is set. */
  readonly providerName?: string;
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
  /** Minimum call counts per required tool — from tool classifier */
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
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
  /** Runtime-resolved skills merged into `brief` (SkillResolver, etc.). */
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  /** Initial messages to seed the kernel conversation thread (e.g. task as user message). */
  readonly initialMessages?: readonly KernelMessage[];
  /** Intelligent Context Synthesis — from .withReasoning({ synthesis: ... }) */
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
  /** LLM-based observation extraction: true=always, false=never, "auto"=local/mid tiers only */
  readonly observationSummary?: boolean | "auto";
  /** Pre-resolved model calibration — drives steering channel selection in ContextManager. */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
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

    const emitLog = (event: LogEvent): Effect.Effect<void, never> =>
      Effect.serviceOption(ObservableLogger).pipe(
        Effect.flatMap((opt) =>
          opt._tag === "Some"
            ? opt.value.emit(event).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/strategies/reactive.ts:119", tag: errorTag(err) })))
            : Effect.void
        )
      );

    yield* emitLog({ _tag: "phase_started", phase: "reactive:kernel", timestamp: new Date() });

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

    const capabilitySnapshot = yield* resolveExecutableToolCapabilities({
      availableToolSchemas: toolSchemas,
      allToolSchemas: input.allToolSchemas,
      metaTools: input.metaTools,
    });

    const kernelInput: KernelInput = {
      task: input.taskDescription,
      systemPrompt: input.systemPrompt,
      availableToolSchemas: capabilitySnapshot.availableToolSchemas,
      allToolSchemas: capabilitySnapshot.allToolSchemas,
      priorContext,
      contextProfile: input.contextProfile,
      providerName: input.providerName,
      resultCompression: input.resultCompression,
      temperature:
        input.contextProfile?.temperature ??
        input.config.strategies.reactive.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
      requiredTools: input.requiredTools,
      requiredToolQuantities: input.requiredToolQuantities,
      relevantTools: input.relevantTools,
      maxCallsPerTool: input.maxCallsPerTool,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      environmentContext: input.environmentContext,
      metaTools: input.metaTools,
      toolElaboration: input.config.strategies.reactive.toolElaboration,
      nextMovesPlanning: input.config.strategies.reactive.nextMovesPlanning,
      briefResolvedSkills: input.briefResolvedSkills,
      initialMessages: input.initialMessages,
      synthesisConfig: input.synthesisConfig,
      observationSummary: input.observationSummary,
      modelId: input.modelId,
      calibration: input.calibration,
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

    // Output ownership rule (Sprint 3.4):
    //   - state.output IS the answer when set
    //   - On a successful run, fall back to the last thought (model produced
    //     content even if it didn't reach state.output)
    //   - On a FAILED run, output stays null. The diagnostic lives in
    //     state.error and the public result surfaces it as result.error.
    //     Do NOT use state.error as output, do NOT use lastThought as output:
    //     models often parrot harness guidance in their thoughts (especially
    //     cogito-class) so the last thought is unreliable on failure.
    const output =
      state.output ??
      (state.status === "failed"
        ? null
        : [...state.steps].filter((s) => s.type === "thought").pop()?.content ??
          null);

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

    yield* emitLog({
      _tag: "phase_complete",
      phase: "reactive:kernel",
      duration: Date.now() - start,
      status: state.status === "failed" ? "error" : "success",
    });

    yield* emitLog({
      _tag: "completion",
      success: state.status === "done",
      summary: `Reactive strategy terminated: ${terminatedBy}`,
      timestamp: new Date(),
    });

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
        ...(state.meta.lastDialectObserved !== undefined
          ? { lastDialectObserved: state.meta.lastDialectObserved }
          : {}),
      },
    });
  });
