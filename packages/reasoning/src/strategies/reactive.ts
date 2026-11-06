// File: src/strategies/reactive.ts
//
// Thin wrapper — one reactKernel pass on the strategy run substrate
// (`run.pass`), whose terminal relays it through the single judged-result mint.
import { Effect } from "effect";
import type { ReasoningResult } from "../types/index.js";
import { ExecutionError, IterationLimitError } from "../errors/errors.js";
import { fenceRecalledMemory } from "./memory-fence.js";
import type { ReasoningConfig } from "../types/config.js";
import { LLMService } from "@reactive-agents/llm-provider";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import type { ContextProfile } from "../context/context-profile.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import { reactKernel } from "../kernel/loop/react-kernel.js";
import { runStrategy } from "./substrate/strategy-run.js";
import { KERNEL_STRATEGY_CANDIDATES } from "../kernel/capabilities/reflect/strategy-ladder.js";
import {
  type JudgedReasoningResult,
} from "../kernel/capabilities/sense/finalize-result.js";
import { RunEnvelope } from "../kernel/envelope/run-envelope.js";
import type { KernelInput, KernelMessage, KernelState, SkillsContext } from "../kernel/state/kernel-state.js";
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
  /** Consumer-intent visibility floor (withTools({ builtins: [...] })). */
  readonly builtinFloorTools?: readonly string[];
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
  /** Opt-in long-horizon guard profile (A2) — forwarded to KernelRunOptions so
   *  the reactive kernel scales its guard constants by maxIterations. Absent →
   *  today's absolute-count guards (byte-identical). */
  readonly horizonProfile?: "long";
  readonly checklistGuidance?: import("../kernel/capabilities/reflect/checklist-reminder.js").ChecklistGuidanceOptions;
  /** Opt-in adaptive harness (G1) — forwarded to KernelRunOptions so runner.ts
   *  compiles + recompiles a HarnessPlan. Absent → off (byte-identical). */
  readonly adaptiveHarness?: boolean;
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
  readonly skillsContext?: SkillsContext;
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
  // Cascade Task 5: the seven cross-cutting fields (approvalPolicy /
  // approvalDecision / interactionResponse / grounding / fabricationGuard /
  // stallPolicy / taskContract) are NOT declared here any more. They ride the
  // RunEnvelope — a strategy cannot drop what it never carries.
}

// ── maxIterations resolution ──────────────────────────────────────────────────

/** Inputs to {@link resolveMaxIterationCap} — the three cap sources reactive sees. */
export interface MaxIterationCapSources {
  /**
   * `config.strategies.reactive.maxIterations` — builder-baked cap. Without
   * {@link MaxIterationCapSources.explicit} this may just be the schema
   * fallback (10), NOT a user decision.
   */
  readonly configCap: number | undefined;
  /** `contextProfile?.maxIterations` — tier-default hint (8 local / 10 mid / 10 large / 12 frontier). */
  readonly tierHint: number | undefined;
  /** True when `configCap` was user-declared via `.withMaxIterations()` / `.withReasoning({ maxIterations })`. */
  readonly explicit: boolean | undefined;
}

/** Result of {@link resolveMaxIterationCap}. */
export interface MaxIterationCapResolution {
  /** The effective per-run iteration cap handed to the kernel. */
  readonly maxIterations: number;
  /** True when the tier hint clamped the effective cap below the config face value. */
  readonly clamped: boolean;
}

/** The profileless fallback — matches `defaultReasoningConfig.strategies.reactive.maxIterations`. */
const MAX_ITERATIONS_FALLBACK = 10;

const positiveOrUndefined = (n: number | undefined): number | undefined =>
  typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;

/**
 * Resolve the effective reactive iteration cap.
 *
 * Precedence (2026-10-23 explicit-cap fix, introspective harness loop —
 * wiki/Research/Harness-Reports/introspective-2026-10-24-02-*):
 *   1. An EXPLICIT user cap (`maxIterationsExplicit: true`) ALWAYS wins — the
 *      tier hint cannot steal it down. Pre-fix, `Math.min(hint, configCap)`
 *      indistinguishably treated the baked schema default 10 as a user cap,
 *      silently truncating explicit 10/12/20 runs to the local-tier 8.
 *   2. When nothing was declared explicit, the old most-restrictive min()
 *      semantics apply unchanged (tier hint clamps the config face value;
 *      preserves the 2026-04-30 fix's spirit for unset paths).
 *   3. Profileless paths keep the fallback default 10.
 *
 * `clamped` reports case 2 actually lowering the cap below the config face
 * value so the caller can surface the steal as a visible structured signal.
 */
export function resolveMaxIterationCap(
  sources: MaxIterationCapSources,
): MaxIterationCapResolution {
  const configCap = positiveOrUndefined(sources.configCap);
  const tierHint = positiveOrUndefined(sources.tierHint);

  // (1) Explicit user cap always wins — no min with the tier hint.
  if (sources.explicit === true && configCap !== undefined) {
    return { maxIterations: configCap, clamped: false };
  }

  // (2)/(3) Non-explicit path — byte-identical min() semantics for unset caps.
  const candidates = [tierHint, configCap].filter((n): n is number => n !== undefined);
  const maxIterations =
    candidates.length > 0 ? Math.min(...candidates) : MAX_ITERATIONS_FALLBACK;
  const faceValue = configCap ?? MAX_ITERATIONS_FALLBACK;
  const clamped =
    tierHint !== undefined && maxIterations === tierHint && tierHint < faceValue;
  return { maxIterations, clamped };
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
  JudgedReasoningResult,
  ExecutionError | IterationLimitError,
  LLMService | RunEnvelope
> =>
  Effect.gen(function* () {
    const start = Date.now();

    // Finding 2 (harness-control-surface final fix wave): resolve the envelope
    // here so its `harness` can reach `resolveExecutableToolCapabilities`
    // below — without it, the capability resolver falls back to a fresh
    // `resolveHarnessConfig()` re-read of the environment, silently ignoring
    // any per-agent `.withHarness({ toolDiscovery: ... })` config.
    const envelope = yield* RunEnvelope;

    const emitLog = makeStrategyEmitLog("reasoning/src/strategies/reactive.ts:emitLog");

    yield* emitLog({ _tag: "phase_started", phase: "reactive:kernel", timestamp: new Date() });

    // maxIterations resolution (2026-10-23 explicit-cap fix — see
    // resolveMaxIterationCap above for the precedence law + evidence trail).
    // Pre-fix: `Math.min(hint, configCap)` silently stole explicit 10/12/20
    // runs down to the local-tier 8; an explicit cap now always wins, the
    // tier hint applies only when nothing was declared explicit, and every
    // clamp that fires is made VISIBLE via the signal below (golden rule 4:
    // no silent behavior).
    const { maxIterations: maxIter, clamped } = resolveMaxIterationCap({
      configCap: input.config.strategies.reactive.maxIterations,
      tierHint: input.contextProfile?.maxIterations,
      explicit: input.config.strategies.reactive.maxIterationsExplicit,
    });
    if (clamped) {
      // The tier hint lowered the effective cap below the config face value.
      // `LogEvent` is a closed union in @reactive-agents/observability, so
      // the structured signal rides the existing `_tag: "log"` shape: stable
      // message name + machine-parseable fields (sources + result).
      yield* emitLog({
        _tag: "log",
        level: "warn",
        source: "framework",
        message: "max_iterations_clamped",
        fields: {
          configMaxIterations: input.config.strategies.reactive.maxIterations,
          tierHint: input.contextProfile?.maxIterations,
          tier: input.contextProfile?.tier ?? "mid",
          effectiveMaxIterations: maxIter,
        },
        timestamp: new Date(),
      });
    }

    // Map memoryContext into priorContext for the kernel, fenced as untrusted
    // data so stored/recalled content cannot act as injected instructions (F3).
    const priorContext = input.memoryContext?.trim()
      ? fenceRecalledMemory(input.memoryContext)
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
      harness: envelope.harness,
    });

    // Cascade Task 6: the seven cross-cutting fields are NOT listed below. They
    // ride the `RunEnvelope`, which `runKernel` merges onto the `KernelInput`
    // at the single universal kernel entry — so reactive is now exactly as
    // covered as every other strategy, by the same mechanism. A strategy cannot
    // drop what it never carries.
    const kernelInput: KernelInput = {
      task: input.taskDescription,
      systemPrompt: input.systemPrompt,
      availableToolSchemas: capabilitySnapshot.availableToolSchemas,
      allToolSchemas: capabilitySnapshot.allToolSchemas,
      priorContext,
      contextProfile: input.contextProfile,
      providerName: input.providerName,
      resultCompression: input.resultCompression,
      // GH temp-threading (Wave-4): `input.temperature` (the runtime's
      // command-first merge `config.temperature ?? config.contextProfile
      // ?.temperature`, reasoning-think.ts) must ride the KernelInput.
      // Before this, the commanded `.withModel({temperature})` was dropped
      // HERE even when the runtime forwarded it, so think.ts:339 always
      // stamped the tier/profile value. Precedence preserved where no
      // command exists: contextProfile above the strategy-config default.
      temperature:
        input.temperature ??
        input.contextProfile?.temperature ??
        input.config.strategies.reactive.temperature,
      agentId: input.agentId,
      sessionId: input.sessionId,
      requiredTools: input.requiredTools,
      requiredToolQuantities: input.requiredToolQuantities,
      relevantTools: input.relevantTools,
      builtinFloorTools: input.builtinFloorTools,
      maxRequiredToolRetries: input.maxRequiredToolRetries,
      environmentContext: input.environmentContext,
      allowedTools: input.allowedTools,
      metaTools: input.metaTools,
      ...(input.checklistGuidance ? { checklistGuidance: input.checklistGuidance } : {}),
      toolElaboration: input.config.strategies.reactive.toolElaboration,
      nextMovesPlanning: input.config.strategies.reactive.nextMovesPlanning,
      briefResolvedSkills: input.briefResolvedSkills,
      skillsContext: input.skillsContext,
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

    // The substrate owns the terminal: it relays this pass's output, status,
    // terminatedBy (+ raw channel), abstention, honesty markers, ledger, signal
    // tally and scratchpad by the one rule every kernel-backed strategy shares,
    // and turns a durable pause into the paused result.
    return yield* runStrategy(
      {
        strategy: "reactive",
        taskId: input.taskId ?? "reactive",
        requiredTools: input.requiredTools ?? [],
        logSite: "reasoning/src/strategies/reactive.ts:emitLog",
      },
      (run) => Effect.gen(function* () {
    const pass = yield* run.pass(reactKernel, kernelInput, {
      maxIterations: maxIter,
      horizonProfile: input.horizonProfile,
      adaptiveHarness: input.adaptiveHarness,
      strategy: "reactive",
      kernelType: "react",
      taskId: input.taskId ?? "reactive",
      kernelPass: "reactive:main",
      taskDescription: input.taskDescription,
      modelId: input.modelId,
      providerName: input.providerName,
      taskCategory: input.taskCategory,
      temperature: kernelInput.temperature,
      strategySwitching: input.strategySwitching
        ? {
            enabled: input.strategySwitching.enabled,
            maxSwitches: input.strategySwitching.maxSwitches,
            fallbackStrategy: input.strategySwitching.fallbackStrategy,
            // W4.5 — the REAL registered kernel candidate set (single source:
            // strategy-ladder). The kernel walks the deterministic ladder over
            // these by default; the evaluator runs only for a custom
            // (multi-candidate) set.
            availableStrategies: KERNEL_STRATEGY_CANDIDATES,
          }
        : undefined,
    });

    yield* emitPhaseEnd({
      emitLog,
      phase: "reactive:kernel",
      startedAt: start,
      status: pass.state.status === "failed" ? "error" : "success",
    });

    // K4 (2026-11-04): no `Reactive strategy terminated: <reason>` debug line.
    // The engine's live logger has no min level, so a `level:"debug"` log
    // printed at default verbosity; the reason already rides the result
    // metadata, the completion line and the `terminal_decision` trace event.

    return { _tag: "KernelTerminal" as const, pass };
      }),
    );
  });
