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
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import { reactKernel, deriveTerminatedBy } from "../kernel/loop/react-kernel.js";
import { runPass } from "../kernel/loop/run-pass.js";
import { buildStrategyResult } from "../kernel/capabilities/sense/step-utils.js";
import type { KernelInput, KernelMessage, KernelState } from "../kernel/state/kernel-state.js";
import type { Verifier } from "../kernel/capabilities/verify/verifier.js";
import { noopVerifier } from "../kernel/capabilities/verify/noop-verifier.js";
import type { KernelMetaToolsConfig } from "../types/kernel-meta-tools.js";
import { resolveExecutableToolCapabilities } from "../kernel/capabilities/act/tool-capabilities.js";
import { makeStrategyEmitLog, emitPhaseEnd } from "../kernel/utils/service-utils.js";

// ── Re-exports for backwards compatibility ────────────────────────────────────

export type { CompressResult } from "../kernel/capabilities/attend/tool-formatting.js";
export { compressToolResult } from "../kernel/capabilities/attend/tool-formatting.js";
export { evaluateTransform } from "../kernel/utils/tool-parsing.js";
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
  /** Tool execution allowlist — blocked non-META calls return error observation in act.ts. */
  readonly allowedTools?: readonly string[];
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  readonly metaTools?: KernelMetaToolsConfig;
  /** Runtime-resolved skills merged into `brief` (SkillResolver, etc.). */
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  /** Initial messages to seed the kernel conversation thread (e.g. task as user message). */
  readonly initialMessages?: readonly KernelMessage[];
  /** Durable resume (v0.12.0 Phase C): fully-restored KernelState from a checkpoint.
   *  When present, the runner uses it as base state instead of building fresh —
   *  forwarded into `kernelInput.resumeState`. */
  readonly resumeState?: KernelState;
  /** Intelligent Context Synthesis — from .withReasoning({ synthesis: ... }) */
  readonly synthesisConfig?: import("../context/synthesis-types.js").SynthesisConfig;
  /** LLM-based observation extraction: true=always, false=never, "auto"=local/mid tiers only */
  readonly observationSummary?: boolean | "auto";
  /** Opt-in rationale auditing — per-tool-call rationale block for debrief. Default off. */
  readonly auditRationale?: boolean;
  /** Pre-resolved model calibration — drives steering channel selection in ContextManager. */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  /**
   * Optional Verifier override — when set, replaces `defaultVerifier` at the
   * terminal verification gate inside the kernel runner. Primary use is M3
   * ablation instrumentation (`noopVerifier`); production agents should leave
   * this undefined to use the default checks.
   */
  readonly verifier?: Verifier;
  readonly harnessPipeline?: import("@reactive-agents/core").HarnessPipeline;
  /** HS-cleanup-2: upstream task classification snapshot (currently unused, kept for forward compat). */
  readonly taskClassification?: import("../kernel/capabilities/comprehend/task-classification.js").TaskClassification;
  /** Budget limits (HS-128 / Audit G-A). Threaded to KernelInput.budgetLimits. */
  readonly budgetLimits?: import("../kernel/capabilities/decide/arbitrator.js").BudgetLimits;
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

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/reactive.ts:emitLog");

    yield* emitLog({ _tag: "phase_started", phase: "reactive:kernel", timestamp: new Date() });

    // maxIterations honors most-restrictive cap. Three sources flow in:
    //   1. `input.config.strategies.reactive.maxIterations` — set by the
    //      builder's `withMaxIterations()` (the user's explicit cap).
    //   2. `input.contextProfile?.maxIterations` — tier-default hint
    //      (8 local / 10 mid / 10 large / 12 frontier).
    //   3. `defaultReasoningConfig.strategies.reactive.maxIterations = 10`
    //      — the fallback baked into the schema.
    // Prior to 2026-04-30 the contextProfile took precedence unconditionally,
    // which meant `withMaxIterations(3)` was silently ignored on a frontier
    // model that had a tier default of 12. Take the minimum of whatever
    // sources are present so the user's explicit cap is always honored.
    const candidates = [
      input.contextProfile?.maxIterations,
      input.config.strategies.reactive.maxIterations,
    ].filter((n): n is number => typeof n === "number" && n > 0);
    const maxIter = candidates.length > 0 ? Math.min(...candidates) : 10;

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
      allowedTools: input.allowedTools,
      metaTools: input.metaTools,
      toolElaboration: input.config.strategies.reactive.toolElaboration,
      nextMovesPlanning: input.config.strategies.reactive.nextMovesPlanning,
      briefResolvedSkills: input.briefResolvedSkills,
      initialMessages: input.initialMessages,
      resumeState: input.resumeState,
      synthesisConfig: input.synthesisConfig,
      observationSummary: input.observationSummary,
      auditRationale: input.auditRationale,
      modelId: input.modelId,
      calibration: input.calibration,
      // M3 ablation hook: `REACTIVE_AGENTS_NOOP_VERIFIER=1` short-circuits the
      // terminal §9.0 verifier gate by substituting `noopVerifier` when no
      // explicit verifier was passed on the strategy input. The benchmark
      // harness sets this around `agent.run()` for the `ra-full-noop-verifier`
      // variant; production callers see `undefined → defaultVerifier` in
      // kernel/loop/runner.ts:568. Never set this in production.
      verifier:
        input.verifier ??
        (process.env.REACTIVE_AGENTS_NOOP_VERIFIER === "1" ? noopVerifier : undefined),
      harnessPipeline: input.harnessPipeline,
      budgetLimits: input.budgetLimits,
    };

    const pass = yield* runPass(reactKernel, kernelInput, {
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

    // Raw state retained for meta-field access (terminatedBy, finalAnswerCapture,
    // etc.) — runPass owns the conventional output/tokens/cost/steps derivation.
    const state = pass.state;
    const output = pass.output;

    // Derive terminatedBy + the raw open-string channel from kernel state via the
    // canonical helper (react-kernel.ts) — single source of truth for the narrowing
    // whitelist. DEFECT 3 (2026-05-31): the inline duplicate here used to map every
    // `done` reason to `final_answer` (a lie → goalAchieved true on harness give-ups);
    // calling the helper keeps the truthful whitelist in ONE place (DRY = the fix
    // can't drift back). The helper omits rawTerminatedBy when absent.
    const { terminatedBy, rawTerminatedBy } = deriveTerminatedBy(state);

    yield* emitPhaseEnd({
      emitLog,
      phase: "reactive:kernel",
      startedAt: start,
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
      steps: pass.steps,
      output,
      status:
        state.status === "done"
          ? "completed"
          : state.status === "failed"
            ? "failed"
            : "partial",
      start,
      totalTokens: pass.tokens,
      totalInputTokens: pass.inputTokens,
      totalOutputTokens: pass.outputTokens,
      totalCost: pass.cost,
      extraMetadata: {
        terminatedBy,
        // Parallel open-string channel preserving raw kernel meta.
        // Carries dynamic killswitch reasons (e.g.
        // "budget-limit:tokens:1/0") that don't fit the closed
        // TerminatedBy 5-value enum on `terminatedBy` above.
        // Drops through to AgentCompleted.terminationReason via
        // engine ctx.metadata.rawTerminatedBy.
        ...(rawTerminatedBy !== undefined ? { rawTerminatedBy } : {}),
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
