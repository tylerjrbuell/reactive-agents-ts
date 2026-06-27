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
      /** LLM provider name (e.g. "ollama", "anthropic") — used to auto-derive default
       *  context profile tier when no explicit contextProfile.tier is set. */
      readonly providerName?: string;
      /** Custom system prompt for steering agent behavior */
      readonly systemPrompt?: string;
      readonly taskId?: string;
      readonly resultCompression?: { budget?: number; previewItems?: number; autoStore?: boolean; codeTransform?: boolean };
      readonly agentId?: string;
      readonly sessionId?: string;
      /** Tools that MUST be called before the agent can declare success */
      readonly requiredTools?: readonly string[];
      /** Minimum call counts per required tool — from tool classifier */
      readonly requiredToolQuantities?: Readonly<Record<string, number>>;
      /** Tools identified as relevant/supplementary (LLM-classified) — allowed through the required-tools gate */
      readonly relevantTools?: readonly string[];
      /** Per-tool call budget enforced by the gate */
      readonly maxCallsPerTool?: Readonly<Record<string, number>>;
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
      /** Runtime-resolved skills merged into `brief` alongside static catalog. */
      readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
      /** Initial messages to seed the kernel conversation thread (e.g. task as user message). */
      readonly initialMessages?: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
      /** Durable resume (v0.12.0 Phase C): fully-restored KernelState from a checkpoint;
       *  spread through to the strategy's `resumeState`. */
      readonly resumeState?: import("../kernel/state/kernel-state.js").KernelState;
      /** Durable HITL (Phase D): resolved approval-gate policy; spread through to the kernel. */
      readonly approvalPolicy?: import("../kernel/state/kernel-state.js").KernelInput["approvalPolicy"];
      /** Durable HITL (Phase D): human's approve/deny decision on a resumed run; spread through to the kernel. */
      readonly approvalDecision?: import("../kernel/state/kernel-state.js").KernelInput["approvalDecision"];
      readonly synthesisConfig?: SynthesisConfig;
      /** LLM-based observation extraction: true=always, false=never, "auto"=local/mid tiers only */
      readonly observationSummary?: boolean | "auto";
      /** Opt-in rationale auditing — emit a per-tool-call rationale block for debrief logging. Default off (pure decode/token cost, no quality benefit per ablation). */
      readonly auditRationale?: boolean;
      /** Pre-resolved model calibration — drives steering channel and context tuning in the kernel. */
      readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
      /**
       * Custom verifier injected at the terminal §9.0 gate. When set, replaces
       * `defaultVerifier` for both in-loop retry and final-answer verification.
       * Pass `noopVerifier` to bypass the gate entirely (lean harness mode).
       */
      readonly verifier?: import("../kernel/capabilities/verify/verifier.js").Verifier;
      readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
      /**
       * HS-cleanup-2 (2026-05-23): single canonical pre-execution task
       * classification. Engine computes this once per agent run via
       * `classifyTask(taskDescription)`; strategies READ from this snapshot
       * instead of re-classifying the same task string. Backward-compatible:
       * when absent, strategies fall back to classifying locally.
       */
      readonly taskClassification?: import("../kernel/capabilities/comprehend/task-classification.js").TaskClassification;
      /**
       * Budget limits (HS-128 / Audit G-A / North Star Pillar 6).
       * Propagated through StrategyFn → KernelInput → state.meta.budgetLimits.
       * Arbitrator pre-guard fires `exit-failure terminatedBy='budget_exceeded'`
       * when computed BudgetSignal crosses any declared limit.
       */
      readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
      /** Opt-in numeric evidence-grounding (.withGrounding) — spread to the strategy → KernelInput.grounding. */
      readonly grounding?: import("../kernel/state/kernel-state.js").GroundingConfig;
      /** Fabrication-guard mode (.withFabricationGuard) — spread to the strategy → KernelInput.fabricationGuard. */
      readonly fabricationGuard?: import("../kernel/capabilities/verify/evidence-grounding.js").FabricationGuardMode;
      /** Stall/no-progress policy (.withStallPolicy) — spread to the strategy → KernelInput.stallPolicy. */
      readonly stallPolicy?: import("../kernel/state/kernel-state.js").StallPolicy;
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
      let strategyLayer: Layer.Layer<any, never> = llmLayer;
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
