// File: src/services/reasoning-service.ts
import { Context, Effect, Layer } from "effect";
import type {
  ReasoningResult,
  ReasoningStrategy,
} from "../types/index.js";
import type { ReasoningConfig } from "../types/config.js";
import { defaultReasoningConfig } from "../types/config.js";
import { StrategyRegistry, type StrategyFn } from "./strategy-registry.js";
import type { ReasoningErrors } from "../errors/errors.js";
import type { ContextProfile } from "../context/context-profile.js";
import { LLMService } from "@reactive-agents/llm-provider";
import { ToolService } from "@reactive-agents/tools";
import type { SynthesisConfig } from "../context/synthesis-types.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { ContextSynthesizerLive } from "../context/context-synthesizer.js";

// ─── Service Tag ───

export class ReasoningService extends Context.Tag("ReasoningService")<
  ReasoningService,
  {
    /**
     * Execute reasoning on a task.
     * If `strategy` is provided, uses that strategy directly.
     * Otherwise uses the configured default strategy.
     */
    readonly execute: (params: {
      readonly taskDescription: string;
      readonly taskType: string;
      readonly memoryContext: string;
      readonly availableTools: readonly string[];
      /** Full tool schemas with parameter info — passed through to strategies */
      readonly availableToolSchemas?: readonly {
        name: string;
        description: string;
        parameters: readonly { name: string; type: string; description: string; required: boolean }[];
      }[];
      /** Full unfiltered tool schemas for completion guard namespace detection */
      readonly allToolSchemas?: readonly {
        name: string;
        description: string;
        parameters: readonly { name: string; type: string; description: string; required: boolean }[];
      }[];
      readonly strategy?: ReasoningStrategy;
      /** Context profile for model-adaptive context engineering */
      readonly contextProfile?: Partial<ContextProfile>;
      /** Custom system prompt for steering agent behavior */
      readonly systemPrompt?: string;
      readonly taskId?: string;
      readonly resultCompression?: { budget?: number; previewItems?: number; autoStore?: boolean; codeTransform?: boolean };
      readonly agentId?: string;
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
      /** Model ID for entropy sensor scoring (e.g. "cogito:14b", "claude-sonnet-4") */
      readonly modelId?: string;
      /** Task category for per-category entropy scoring adjustments */
      readonly taskCategory?: string;
      /** LLM sampling temperature — forwarded to entropy sensor for weight adjustment */
      readonly temperature?: number;
      /** Custom environment context key-value pairs injected into system prompt */
      readonly environmentContext?: Readonly<Record<string, string>>;
      /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
      readonly metaTools?: KernelMetaToolsConfig;
      /** Initial messages to seed the kernel conversation thread (e.g. task as user message). */
      readonly initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
      readonly synthesisConfig?: SynthesisConfig;
    }) => Effect.Effect<ReasoningResult, ReasoningErrors>;

    /** Register a custom strategy function. */
    readonly registerStrategy: (
      name: ReasoningStrategy,
      fn: StrategyFn,
    ) => Effect.Effect<void>;
  }
>() {}

// ─── Live Layer ───
// Requires: StrategyRegistry, LLMService

export const ReasoningServiceLive = (
  config: ReasoningConfig = defaultReasoningConfig,
) =>
  Layer.effect(
    ReasoningService,
    Effect.gen(function* () {
      const registry = yield* StrategyRegistry;
      // Capture LLMService at layer construction time so we can provide
      // it to strategy functions when executing them.
      const llmService = yield* LLMService;
      const llmLayer = Layer.succeed(LLMService, llmService);

      // Capture ToolService optionally — strategies like ReAct need it
      // for tool execution. When not available, strategies degrade gracefully.
      const toolServiceOpt = yield* Effect.serviceOption(ToolService);
      let strategyLayer: Layer.Layer<any, never> = Layer.mergeAll(
        llmLayer,
        ContextSynthesizerLive,
      );
      if (toolServiceOpt._tag === "Some") {
        strategyLayer = Layer.merge(
          strategyLayer,
          Layer.succeed(ToolService, toolServiceOpt.value),
        );
      }

      return {
        execute: (params) =>
          Effect.gen(function* () {
            // ── Determine which strategy to use ──
            // adaptive.enabled takes priority: routes every task through the
            // adaptive classifier which picks the best sub-strategy per task.
            // Explicit params.strategy and config.defaultStrategy are used otherwise.
            const strategyName: ReasoningStrategy = config.adaptive.enabled
              ? "adaptive"
              : (params.strategy ?? config.defaultStrategy);

            // ── Get strategy function from registry ──
            const strategyFn = yield* registry.get(strategyName);

            // ── Execute strategy, providing LLMService + ToolService ──
            const result = yield* strategyFn({
              ...params,
              config,
            }).pipe(Effect.provide(strategyLayer));

            return result;
          }),

        registerStrategy: (name, fn) => registry.register(name, fn),
      };
    }),
  );
