/**
 * shared/kernel-state.ts — Immutable state, ThoughtKernel contract, and KernelHooks.
 *
 * Foundation of the composable kernel architecture. Every reasoning strategy
 * operates on a single `KernelState` value that flows through a `ThoughtKernel`
 * function. The state is immutable — each iteration produces a new state via
 * `transitionState()`. Serialization helpers support persistence and debugging.
 */
import { Effect } from "effect";
import type { ReasoningStep } from "../../types/index.js";
import type { ContextProfile } from "../../context/context-profile.js";
import type { ResultCompressionConfig, ToolCallSpec, FinalAnswerCapture, ToolCallResolver, ToolCallingDriver } from "@reactive-agents/tools";
import type { LLMService } from "@reactive-agents/llm-provider";
import type { SemanticEntry, MemoryId } from "@reactive-agents/memory";
import type { ToolSchema } from "../../kernel/capabilities/attend/tool-formatting.js";
import type { EntropyScoreLike } from "../../kernel/loop/output-assembly.js";
export type { EntropyScoreLike } from "../../kernel/loop/output-assembly.js";
import type { KernelMetaToolsConfig } from "../../types/kernel-meta-tools.js";
import type {
  ToolElaborationInjectionConfig,
  NextMovesPlanningConfig,
} from "../../kernel/capabilities/decide/tool-gating.js";
import type { HarnessPipeline, KernelStateLike } from "@reactive-agents/core";

// ── Cross-package state bridge ───────────────────────────────────────────────
// `KernelStateLike` (core) is a deliberately loose structural type that avoids
// a core→reasoning circular dependency: its `meta` is `Readonly<Record<string,
// unknown>>`, which the concrete `KernelState.meta` interface is not structurally
// assignable to. This single sanctioned cast is the boundary adapter for all
// harness-pipeline ctx fields (phase hooks, tag transforms). Use this instead
// of scattering `as any` at call sites.
export const asKernelStateLike = (s: Readonly<KernelState>): Readonly<KernelStateLike> =>
  s as unknown as Readonly<KernelStateLike>;

// ── Kernel Status ────────────────────────────────────────────────────────────

export type KernelStatus = "thinking" | "acting" | "observing" | "done" | "failed" | "evaluating";

// ── KernelMessage — Provider-agnostic conversation message ───────────────────

/** Provider-agnostic conversation message for the kernel's native FC conversation history. */
export type KernelMessage =
  | { readonly role: "assistant"; readonly content: string; readonly toolCalls?: readonly ToolCallSpec[] }
  | { readonly role: "tool_result"; readonly toolCallId: string; readonly toolName: string; readonly content: string; readonly isError?: boolean; readonly storedKey?: string }
  | { readonly role: "user"; readonly content: string };

// ── PendingGuidance — harness signals for the next think turn ────────────────

/**
 * Typed harness signals collected during act/guard phases.
 * Rendered deterministically in the system prompt Guidance: section by think.ts.
 * All fields are optional so callers only set what applies to the current signal.
 */
export interface PendingGuidance {
  /** Required tool names flagged by a quota-violation escalation (not normal pending state). */
  readonly requiredToolsPending?: readonly string[];
  /** True when loop detection fired and the agent is repeating without progress. */
  readonly loopDetected?: boolean;
  /** Guidance produced by the ICS coordinator (synthesis/strategy signals). */
  readonly icsGuidance?: string;
  /** Guidance from the oracle / quality gate (e.g. readyToAnswer nudge). */
  readonly oracleGuidance?: string;
  /** Recovery hint when tool failures or errors occurred on the previous round. */
  readonly errorRecovery?: string;
  /** Post-act harness reminder (e.g. "you must still call X", "required tools satisfied"). */
  readonly actReminder?: string;
  /** Adapter quality-check hint rendered before accepting a prose final answer. */
  readonly qualityGateHint?: string;
  /** Reserved for Task 17 — evidence grounding redirect when claims lack tool support. */
  readonly evidenceGap?: string;
}

// ── KernelMeta — typed strategy-specific metadata bag ─────────────────────────

/** Entropy sensor metadata accumulated during kernel execution. */
export interface KernelEntropyMeta {
  readonly taskDescription?: string;
  readonly modelId?: string;
  readonly temperature?: number;
  readonly taskCategory?: string;
  readonly lastLogprobs?: readonly { token: string; logprob: number; topLogprobs?: readonly { token: string; logprob: number }[] }[];
  readonly entropyHistory?: readonly EntropyScoreLike[];
  readonly controllerConfig?: {
    readonly earlyStop: boolean;
    readonly contextCompression: boolean;
    readonly strategySwitch: boolean;
  };
  /** Latest entropy snapshot for brief/pulse meta-tools. */
  readonly latest?: { readonly composite: number; readonly shape: string; readonly momentum: number; readonly history?: readonly number[] };
  /** Latest composite score for termination oracle. */
  readonly latestScore?: unknown;
  /** Latest trajectory shape for termination oracle. */
  readonly latestTrajectory?: unknown;
}

/** Reactive controller decision stored on meta for oracle consumption. */
export interface ControllerDecisionLike {
  readonly decision: string;
  readonly reason?: string;
  readonly sections?: readonly string[];
  readonly skillName?: string;
}

/** Typed metadata bag for KernelState. Every field is optional. */
export interface KernelMeta {
  // ── Entropy / reactive intelligence ──
  readonly entropy?: KernelEntropyMeta;
  readonly controllerDecisions?: readonly ControllerDecisionLike[];

  // ── Iteration control ──
  readonly maxIterations?: number;
  readonly requiredTools?: readonly string[];

  // ── HS-115 / Audit G-E — tool nomination (anti-scaffold F4 closure) ──
  /**
   * Tools the comprehend phase nominated as plausibly required from the task
   * text. Seeded once at kernel start by runner.ts via {@link
   * import("../capabilities/comprehend/task-intent.js").nominateRequiredTools}.
   * Consumed by act/guard.ts: when `input.requiredTools` is empty, nominations
   * with confidence ≥ 0.7 act as the effective required-tool floor. Names are
   * always drawn from this run's available tool surface — no phantoms.
   */
  readonly nominatedTools?: readonly import("../capabilities/comprehend/task-intent.js").NominatedTool[];

  // ── Termination tracking ──
  readonly terminatedBy?: string;
  /** Prior terminatedBy value when the post-loop harness-deliverable promotion overrides it. */
  readonly previousTerminatedBy?: string;
  /** Optional structured rationale for the termination (v0.11.x). Surfaced via KernelStateSnapshotEvent.terminationRationale. */
  readonly terminationRationale?: import("@reactive-agents/core").Rationale;
  /**
   * Durable HITL (Phase D): set when the act capability gates a flagged pending
   * tool call in durable detach mode. Serialized into the checkpoint so the
   * paused call survives a crash; consumed by the runner's resume re-entry to
   * either execute (approved) or skip-and-observe (denied) the stored call.
   */
  readonly awaitingApprovalFor?: {
    readonly gateId: string;
    readonly toolName: string;
    readonly args: unknown;
  };
  /**
   * Durable pause (Task 9): set when the act capability intercepts a
   * `request_user_input` tool call. Serialized into the checkpoint so a
   * paused-for-interaction run survives a crash; a later task (10) persists
   * and resumes it, mirroring the {@link awaitingApprovalFor} rail.
   */
  readonly awaitingInteractionFor?: {
    readonly interactionId: string;
    readonly kind: string;
    readonly prompt: string;
    readonly schemaJson: string;
  };
  /**
   * Durable HITL (Phase D): transient one-shot flag set by the runner's resume
   * re-entry while it executes an already-approved call via the act capability.
   * Tells the act gate to skip gating for that single pass (the human already
   * decided). Cleared immediately after. Never serialized in a paused checkpoint.
   */
  readonly approvalBypass?: boolean;
  readonly redirectCount?: number;
  /** Temperature override dispatched by the intervention dispatcher — kernel-runner applies on next iteration. */
  readonly dispatchedTemperature?: number;
  /** Strategy switch requested by the intervention dispatcher — kernel-runner executes the switch. */
  readonly dispatchedStrategySwitch?: { readonly to: string; readonly reason: string };

  // ── Native FC handoff between think → act ──
  readonly pendingNativeToolCalls?: readonly ToolCallSpec[];
  readonly lastThought?: string;
  readonly lastThinking?: string | null;

  // ── Quality / output gates ──
  readonly qualityCheckDone?: boolean;
  readonly evidenceGroundingDone?: boolean;
  readonly gateBlockedTools?: readonly string[];
  readonly outputSynthesized?: boolean;
  /** True once the "required tools satisfied" completion nudge has been emitted for this run. */
  readonly completionNudgeSent?: boolean;
  readonly outputFormatValidated?: boolean;
  readonly outputFormatReason?: string;
  readonly evaluator?: string;
  readonly allVerdicts?: ReadonlyArray<{ evaluator: string; verdict: unknown }>;

  // ── Execution lane ──
  readonly executionLane?: string;
  readonly missingRequiredTools?: readonly string[];

  // ── Recovery ──
  readonly recoveryPending?: boolean;
  readonly recoveryFailedTools?: readonly string[];
  readonly recoveryAlternativeCandidates?: readonly string[];

  // ── StallPolicy compliance tracking (persisted across iterations) ──
  /** Consecutive required-tool nudges the model ignored (no progress on missing set). */
  readonly consecutiveIgnoredNudges?: number;
  /** Missing-required-tool count at the previous nudge (compliance delta). */
  readonly lastMissingRequiredCount?: number;

  // ── Kernel identity / pass ──
  readonly kernelPass?: string;

  // ── Final answer ──
  readonly finalAnswerCapture?: FinalAnswerCapture;

  // ── O3: abstention ──
  /** Present when terminatedBy === "abstained". Surfaced via ReActKernelResult.abstention. */
  readonly abstention?: { readonly reason: string; readonly missing: readonly string[] };

  // ── Resolver dialect telemetry ──
  /** Which resolver dialect tier fired for the most recent tool call (if any). */
  readonly lastDialectObserved?: string;

  // ── Arbitrator escalation (Sprint 3.3 — Sole Termination Authority) ──
  /** Strategy the Arbitrator chose to escalate to via its "escalate" Verdict. */
  readonly escalateTo?: string;
  /** Reason the Arbitrator emitted with the escalate Verdict. */
  readonly escalationReason?: string;

  // ── Sprint 3.4 Scaffold 3 — synthesis-grounding retry counter ──
  /**
   * How many corrective iterations the Arbitrator has triggered for
   * synthesis-grounding failures. Capped at 1 by default; the Arbitrator
   * stops escalating once this exceeds the cap.
   */
  readonly synthesisRetryCount?: number;

  // ── Phase D1 — block-mode evidence-grounding retry counter ──
  /**
   * How many corrective synthesis attempts the terminal verifier gate has
   * triggered for a block-mode `evidence-grounded` reject. Capped at
   * `grounding.maxRetries` (default 1); once exhausted the run DEGRADES to
   * warn (surfaces the answer with `verificationWarning`) — it NEVER
   * hard-fails. Dedicated counter (NOT `synthesisRetryCount`, which the
   * Arbitrator owns) to keep the two retry budgets independent. See
   * runner-helpers/grounding-block.ts.
   */
  readonly groundingBlockRetry?: number;

  // ── Stage 5 W3 — RI dispatcher budget (FIX-23) ──
  /**
   * Per-run intervention budget threaded through dispatch context. Each
   * dispatched patch increments `interventionsFiredThisRun`; the total
   * cost reported by the dispatcher accumulates into
   * `tokensSpentOnInterventions`. Suppression gates at
   * `dispatcher.ts:69-76` (`maxFiresPerRun`, `maxInterventionTokenBudget`)
   * read these values to decide whether to fire or suppress.
   *
   * Prior to W3 these were hardcoded to 0 every iteration, making the
   * gates unreachable. See AUDIT-overhaul-2026.md §11 #23 + M1 mechanism.
   */
  readonly riBudget?: {
    readonly interventionsFiredThisRun: number;
    readonly tokensSpentOnInterventions: number;
  };

  // ── Issue #119 — Curator-as-sole-prompt-author (compression handoff) ────
  /**
   * Advisory compression recommendation set by the reactive-observer's
   * `compress-messages` patch handler. The handler no longer mutates
   * `state.messages` directly (that would create a parallel substrate that
   * competes with the curator). Instead it publishes a recommendation here,
   * and the curator (via `applyMessageWindowWithCompact` in
   * `kernel/capabilities/attend/context-utils.ts`) consumes the recommendation
   * to clamp the effective token budget on the NEXT iteration's prompt.
   *
   * `recommendedAtIteration` lets the curator drop stale recommendations if
   * the patch has stopped firing — the recommendation only applies when
   * `state.iteration - recommendedAtIteration <= 1`.
   *
   * Issue #119 / North Star v5.0 §4.3.
   */
  readonly pendingCompressionRecommendation?: {
    readonly targetTokens: number;
    readonly reason: string;
    readonly recommendedAtIteration: number;
  };

  // ── HS-128 follow-up — Tier-derived ceiling for verbosity baseline ─────
  /**
   * Effective `ContextProfile.maxTokens` for this kernel run. Seeded ONCE at
   * kernel-start by runner.ts from the resolved profile (post-tier-default,
   * post-calibration-overrides, post-capability-clamp). Read by the
   * verbosity-detector caller in `kernel/capabilities/reflect/reactive-observer.ts`
   * so the tier-derived baseline (`profileMaxTokens / 64`) scales correctly
   * across local (32_768) and frontier (128_000+) runs — instead of the helper's
   * local-only fallback (`DEFAULT_PROFILE_MAX_TOKENS = 32_768`).
   *
   * Seed-once / read-anywhere — the runner must NOT re-seed on every iteration.
   * Legacy state without this field falls back to the helper's default, matching
   * the original HS-128 behaviour.
   *
   * HS-128 FOLLOWUP-A — prevents over-aggressive false-positives on frontier-tier
   * runs (threshold would otherwise trip at avg ≥1024 instead of the correct
   * ≥4000 for a 128k context window).
   */
  readonly profileMaxTokens?: number;

  // ── HS-128 — Per-iteration token snapshot (verbosity detector input) ────
  /**
   * Rolling window of `usage.totalTokens` from the last N (≤5) LLM
   * responses, appended by `kernel/capabilities/reason/think.ts` immediately
   * after the streaming response resolves. Consumed by the verbosity-detector
   * in `kernel/capabilities/reflect/verbosity-detector.ts`, which compares the
   * running average against a tier-derived baseline (~maxTokens/64) and
   * publishes a `pendingCompressionRecommendation` with reason
   * `"verbosity-detected"` when avg > 2× baseline.
   *
   * Only real-LLM runs populate this — the think.ts append is guarded by a
   * truthy `usage.totalTokens` check, so test-provider runs with 0-token
   * usage do not poison the rolling window. Detector requires ≥3 samples
   * before evaluating to avoid false-positives on warmup iterations.
   *
   * HS-128 / L4 production signal — qwen3:14b vs cogito:14b 390% verbosity
   * ratio on identical context-profiles task. Goal: ratio ≤ 200%.
   */
  readonly lastIterationTokens?: readonly number[];

  // ── Issue #128 — Arbitrator BudgetSignal limits (North Star v5.0 Pillar 6) ─
  /**
   * Declarative budget limits consulted by the Arbitrator's pre-intent guard.
   * Seeded from `KernelInput.budgetLimits` at kernel-start by runner.ts.
   * The Arbitrator reads this via `arbitrationContextFromState()`, which calls
   * `computeBudgetSignal({ tokensUsed: state.tokens, costUsd: state.cost,
   * limits })` and surfaces the result on ArbitrationContext.budget. When the
   * signal status is "exceeded", arbitrate() returns exit-failure with
   * terminatedBy="budget_exceeded" dominating every intent.kind branch.
   *
   * Structural type — declared here as `unknown`-shaped to avoid a runtime
   * cycle with the arbitrator module; the canonical type is
   * `BudgetLimits` exported from `kernel/capabilities/decide/arbitrator.ts`.
   */
  readonly budgetLimits?: {
    readonly tokenLimit?: number;
    readonly costLimit?: number;
    readonly warningRatio?: number;
  };

  // ── PostCondition spine — derived-once state-grounded success authority ──────
  /**
   * Deterministic post-conditions derived ONCE at kernel-start from the task +
   * requiredTools (no LLM, no fs). Seeded by runner.ts by default; opt-out via
   * `RA_POST_CONDITIONS=0` — absent on opt-out runs so serialization stays
   * byte-identical. Both gates read this SINGLE stored set:
   *   - the Arbitrator's mid-loop steer gate (`applyPostConditionGate`), via
   *     `arbitrationContextFromState` → `ArbitrationContext.postConditions`;
   *   - the terminal hard-stop in `kernel/loop/terminate.ts`, which demotes any
   *     imperative termination (stall/harness-deliverable, loop-graceful,
   *     oracle-forced, …) to `status:"failed"` when a stored condition is unmet
   *     by the ledger — so an exhausted/bypassed stall cannot deliver a false
   *     success.
   *
   * Structural type — declared loosely here to avoid a runtime cycle with the
   * verify capability; the canonical type is `PostCondition[]` from
   * `kernel/capabilities/verify/post-conditions.ts`.
   */
  readonly postConditions?: readonly import("../capabilities/verify/post-conditions.js").PostCondition[];

}

// ── KernelState — Immutable, serializable reasoning state ────────────────────

export interface KernelState {
  // Identity
  readonly taskId: string;
  readonly strategy: string;
  readonly kernelType: string;

  // Accumulation
  readonly steps: readonly ReasoningStep[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly scratchpad: ReadonlyMap<string, string>;

  // Metrics
  readonly iteration: number;
  readonly tokens: number;
  /** Cumulative input (prompt) tokens. May be 0 if no LLM call recorded usage yet. */
  readonly inputTokens: number;
  /** Cumulative output (completion) tokens. */
  readonly outputTokens: number;
  readonly cost: number;

  // Control
  readonly status: KernelStatus;
  readonly output: string | null;
  readonly error: string | null;

  // Termination oracle
  readonly priorThought?: string;
  readonly llmCalls: number;

  // Strategy-specific
  readonly meta: KernelMeta;

  /** Accumulated controller decisions this run, formatted as "decision: reason" strings. */
  readonly controllerDecisionLog: readonly string[];

  /**
   * The LLM conversation thread — what gets sent to the model.
   * Grows with each tool call (assistant turn + tool results appended).
   * Compacted via sliding window when approaching token budget.
   * Separate from steps[] which is the observability record.
   */
  readonly messages: readonly KernelMessage[];

  /**
   * Pending guidance signals from the harness (ICS, oracle, recovery, loop detection).
   * Rendered in the Guidance: section of the system prompt by the think phase.
   * Cleared after each think turn so stale signals don't leak across iterations.
   */
  readonly pendingGuidance?: PendingGuidance;

  /**
   * Count of consecutive iterations with token-delta < 500.
   * Used by the token-delta diminishing-returns guard.
   */
  readonly consecutiveLowDeltaCount?: number;

  /**
   * Stage 1 max_output_tokens recovery: override token limit to 64k for one re-run.
   * Set when the LLM first hits its output token limit. The runner re-executes the
   * same think phase with this value passed as maxTokens to the LLM call.
   */
  readonly maxOutputTokensOverride?: number;

  /**
   * Stage 2 max_output_tokens recovery: count of recovery message injections.
   * Incremented each time a recovery user-turn is injected. Capped at 3.
   * When this reaches 3 and max_tokens fires again, the run fails.
   */
  readonly maxOutputTokensRecoveryCount?: number;

  /**
   * Count of iterations where the pulse oracle returned readyToAnswer=true
   * but the model has not yet called final-answer.
   * Stage 1: inject mandatory steering nudge.
   * Stage 2: after 2 nudges, force-exit with terminatedBy: "oracle_forced".
   */
  readonly readyToAnswerNudgeCount?: number;

  /**
   * Custom environment context (date overrides + caller-supplied key-value
   * fields) threaded onto the system-prompt Environment block. Seeded once from
   * KernelInput.environmentContext by runner.ts; read by the assembly adapter
   * (from-kernel-state.ts) so project() reproduces the caller's custom fields.
   * Was previously only on KernelInput and never copied to state → custom
   * fields dropped under RA_ASSEMBLY (subkernel-env-threading regression).
   */
  readonly environmentContext?: Readonly<Record<string, string>>;

  /**
   * The last meta-tool that was called (brief, pulse, find, recall).
   * Used by the meta-tool dedup guard to detect consecutive identical calls.
   */
  readonly lastMetaToolCall?: string;

  /**
   * Number of consecutive times `lastMetaToolCall` has been called in a row.
   * Resets to 1 when a different meta-tool or non-meta tool is called.
   */
  readonly consecutiveMetaToolCount?: number;
}

// ── KernelInput — Frozen execution input ─────────────────────────────────────

/** Opt-in numeric evidence-grounding. Presence on KernelInput = enabled. */
export interface GroundingConfig {
  /** block: suppress + corrective retry → degrade to warn. warn: advisory only. */
  readonly mode: "block" | "warn";
  /** Numeric match tolerance as a fraction (rounding). Default 0.01 (1%). */
  readonly tolerance?: number;
  /** block mode: corrective retries before degrading to warn. Default 1. */
  readonly maxRetries?: number;
}

/**
 * Stall / no-progress policy — bounds wasted iterations when the model ignores
 * required-tool nudges. A nudge is "ignored" when the set of still-missing
 * required tools did not shrink since the previous nudge (the model made no
 * progress toward the requirement). Tunable via `.withStallPolicy()`; sensible
 * defaults apply when unset.
 */
export interface StallPolicy {
  /**
   * Consecutive IGNORED required-tool nudges tolerated before the harness
   * fast-escalates (delivers accumulated artifacts, else fails) instead of
   * repeating the nudge up to the full `maxRequiredToolNudges` cap. Default 2.
   * A model that ignores the same nudge twice will keep ignoring it — escalate.
   */
  readonly ignoredNudgeTolerance?: number;
  /**
   * When true (default), a repeated nudge ESCALATES its wording (stronger,
   * count-aware directive) instead of repeating verbatim — a verbatim repeat the
   * model already ignored is wasted. When false, the nudge text is stable.
   */
  readonly escalateNudgeContent?: boolean;
}

/** Defaults for {@link StallPolicy} — applied when the field or sub-fields are unset. */
export const DEFAULT_STALL_POLICY: Required<StallPolicy> = {
  ignoredNudgeTolerance: 2,
  escalateNudgeContent: true,
};

export interface KernelInput {
  readonly task: string;
  readonly systemPrompt?: string;
  readonly availableToolSchemas?: readonly ToolSchema[];
  /** Full unfiltered tool schemas — used by completion guard to detect all MCP namespaces */
  readonly allToolSchemas?: readonly ToolSchema[];
  readonly priorContext?: string;
  readonly contextProfile?: Partial<ContextProfile>;
  readonly resultCompression?: ResultCompressionConfig;
  readonly temperature?: number;
  readonly agentId?: string;
  readonly sessionId?: string;
  /** LLM provider name (e.g. "ollama", "anthropic"). Used to derive the default
   *  context profile tier when no explicit contextProfile.tier is provided.
   *  Ollama providers default to "local" tier (maxSameTool=2) instead of "mid" (3). */
  readonly providerName?: string;
  readonly blockedTools?: readonly string[];
  /**
   * Tools that MUST be called before the agent can declare success.
   * If the agent attempts to end without using all required tools,
   * it will be redirected up to `maxRequiredToolRetries` times (default: 2)
   * before failing with a descriptive error.
   */
  readonly requiredTools?: readonly string[];
  /**
   * Minimum number of times each required tool must be called before the task is
   * considered complete. Populated by the tool classifier from its per-tool minCalls
   * field. The repetition guard and final-answer gate use this instead of hardcoded
   * thresholds — e.g. `{ "http-get": 4 }` means the agent must call http-get at
   * least 4 times (once per currency) before final-answer is accepted.
   */
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  /**
   * Tools identified as relevant/supplementary for the task (LLM-classified).
   * These are allowed through the required-tools gate even when required tools
   * are still pending — they provide supplementary research without blocking progress.
   */
  readonly relevantTools?: readonly string[];
  /**
   * Maximum number of times each tool may be called in a single run.
   * Enforced by the gate before any other logic.
   * Example: `{ "web-search": 3, "http-get": 4 }` bounds research loops.
   */
  readonly maxCallsPerTool?: Readonly<Record<string, number>>;
  /**
   * Enforce a strict required-tool dependency chain.
   * When false/omitted, the gate may allow one exploratory non-required tool call
   * while still steering the model back toward missing required tools.
   */
  readonly strictToolDependencyChain?: boolean;
  /**
   * Maximum number of times the kernel will redirect the agent back to
   * "thinking" when required tools haven't been used. Default: 2.
   * After this many redirects, the kernel fails with an error listing
   * the tools that were never called.
   */
  readonly maxRequiredToolRetries?: number;
  /**
   * Maximum number of times the kernel will redirect the agent back to
   * "thinking" when the verifier rejects a candidate final-answer
   * (Sprint 3.5 Stage 2 — verifier-driven retry). Default: 1.
   *
   * On rejection, the kernel injects the verdict's failure reason as a
   * harness signal step so the model gets specific feedback (e.g., "agent
   * shipped output without calling any data tool") rather than retrying
   * blind. Setting to 0 disables retry — the verifier remains a final
   * gate that fails the run on rejection.
   */
  readonly maxVerifierRetries?: number;
  /**
   * Custom verifier — overrides {@link defaultVerifier} for both the in-loop
   * retry gate and the §9.0 terminal gate. Developers can implement domain-
   * specific verification (e.g., schema-validated outputs, JSON-shape checks,
   * regex-based grounding) without touching kernel internals.
   *
   * Pass-through types are exported from `@reactive-agents/reasoning`:
   *   import { type Verifier, defaultVerifier } from "@reactive-agents/reasoning";
   */
  readonly verifier?: import("../capabilities/verify/verifier.js").Verifier;
  /**
   * Opt-in rationale audit. When `true`, the reactive think phase instructs the
   * model to emit a `<rationale>` block before every tool call (captured into the
   * rationaleLog → debrief synthesis). Default off — the block forces extra OUTPUT
   * tokens per tool call and local-tier latency is decode-bound, so it is a pure
   * speed tax on the dominant local cost with no intended quality benefit. The env
   * override `RA_RATIONALE_AUDIT=1` enables it independently of this field (used
   * for cross-tier ablation). When off, the rationaleLog is simply sparse and the
   * debrief gracefully lacks the why.
   */
  readonly auditRationale?: boolean;
  /** Custom environment context key-value pairs injected into the system prompt */
  readonly environmentContext?: Readonly<Record<string, string>>;
  /**
   * Tool execution allowlist. When set, non-META tool calls not in this list
   * are blocked at act.ts with an error observation. META_TOOLS (final-answer,
   * recall, brief, etc.) always bypass this gate. Empty/undefined = no enforcement.
   */
  readonly allowedTools?: readonly string[];
  /**
   * Optional seed messages for the LLM conversation thread.
   * When provided, `state.messages` is initialized from these instead of starting empty.
   * Allows the execution engine to inject prior conversation context (e.g. chat history).
   */
  readonly initialMessages?: readonly KernelMessage[];
  /**
   * Durable resume (v0.12.0 track 1, Phase C — design spec
   * wiki/Architecture/Design-Specs/2026-06-10-durable-execution.md §2.3): a
   * fully-restored KernelState rebuilt from a persisted checkpoint. When present
   * the runner uses it VERBATIM as the base state instead of building a fresh
   * iteration-0 state — preserving iteration / steps / scratchpad / toolsUsed /
   * meta / tokens so the run continues mid-stream. It is already a complete
   * state and is NOT passed through `transitionState`. Completed tools are NOT
   * re-executed — their results live in the restored steps / messages. Wins over
   * `initialMessages` (which only seeds the conversation thread of a fresh state).
   */
  readonly resumeState?: KernelState;
  /**
   * Durable HITL (Phase D): a human's approval decision threaded in on a resumed
   * run by `ReactiveAgent.approveRun`/`denyRun` (via the `ApprovalDecisionRef`
   * FiberRef, read + forwarded in `reasoning-think.ts`). Read by the runner at
   * loop top together with `state.meta.awaitingApprovalFor`: approved → execute
   * the stored call without re-thinking; denied → observe the denial + continue.
   */
  readonly approvalDecision?: {
    readonly gateId: string;
    readonly status: "approved" | "denied";
    readonly reason?: string;
  };
  /**
   * Durable HITL (Phase D): resolved approval-gate policy. The runtime merges the
   * three feeders (per-tool `requiresApproval` flags, builder `tools` list,
   * builder/compose predicate) into this single shape at config assembly. In
   * `mode:"detach"` the act capability pauses the run (terminatedBy
   * `awaiting-approval`) before executing any gated call. Absent / `mode:"block"`
   * → no durable pause (the in-process gate handles approval). See `shouldGate`.
   */
  readonly approvalPolicy?: {
    readonly mode: "detach" | "block";
    readonly tools: ReadonlySet<string>;
    readonly requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
  };
  /**
   * Output-synthesis configuration — consumed by the terminal output assembly
   * phase in `kernel/loop/runner.ts` (output-synthesis.ts), NOT by ICS guidance.
   * Despite the historical name, this configures how the final answer is
   * synthesized from kernel state at termination, not the iteration-level
   * Intelligent Context Synthesis. Surfaced from `.withReasoning({ synthesis: ... })`.
   * Omitted defaults to `{ mode: "auto" }` in the runner.
   */
  readonly synthesisConfig?: import("../../context/synthesis-types.js").SynthesisConfig;
  /** Meta-tool configuration and pre-computed static data for brief/pulse/recall/find. */
  readonly metaTools?: KernelMetaToolsConfig;
  /** Lightweight tool elaboration injection shown in system prompt for better tool selection. */
  readonly toolElaboration?: ToolElaborationInjectionConfig;
  /** Short-term next-moves planner for optional native tool batch execution windows. */
  readonly nextMovesPlanning?: NextMovesPlanningConfig;
  /**
   * Runtime-resolved skills (e.g. SkillResolver) merged into `brief` alongside
   * `metaTools.staticBriefInfo.availableSkills` — resolved wins on name collision.
   */
  readonly briefResolvedSkills?: readonly { readonly name: string; readonly purpose: string }[];
  /**
   * When enabled, runs a lightweight LLM extraction pass on large tool results
   * to distill key facts before compression. The extracted summary is prepended
   * to the compressed preview so the model sees both distilled data and recall hints.
   * - `true`: always extract for results that exceed the compression budget
   * - `false`: never extract (heuristic compression only)
   * - `"auto"`: extract only for local/mid tiers when results exceed budget
   */
  readonly observationSummary?: boolean | "auto";
  /**
   * The model identifier (e.g. "gemma4:e4b", "gpt-4o") for this kernel run.
   * Passed to selectAdapter so calibrated adapters can be looked up by modelId.
   * Falls back to tier-based adapter selection when absent.
   */
  readonly modelId?: string;
  /**
   * Optional pre-resolved model calibration. When present, the ContextManager and
   * adapter selection may use the calibration fields (steeringCompliance,
   * parallelCallCapability, observationHandling, etc.) to tune per-turn behavior.
   * When absent, tier-based defaults apply (and `selectAdapter` may still load
   * a pre-baked calibration by modelId internally).
   */
  readonly calibration?: import("@reactive-agents/llm-provider").ModelCalibration;
  /** Maximum iterations before giving up. Default: 10 */
  readonly maxIterations?: number;
  /**
   * Declarative budget limits consulted by the Arbitrator's pre-intent guard
   * (Issue #128, North Star v5.0 Pillar 6). When `tokenLimit` or `costLimit`
   * is reached, the Arbitrator returns exit-failure with
   * terminatedBy="budget_exceeded" — this dominates every TerminationIntent
   * branch (final-answer, max-iterations, kernel-error, oracle-decision).
   * Seeded into `state.meta.budgetLimits` by the kernel runner.
   *
   * Canonical type is `BudgetLimits` from
   * `kernel/capabilities/decide/arbitrator.ts`.
   */
  readonly budgetLimits?: {
    readonly tokenLimit?: number;
    readonly costLimit?: number;
    readonly warningRatio?: number;
  };
  /** Opt-in evidence-grounding config. Absent ⇒ grounding off (default). */
  readonly grounding?: GroundingConfig;
  /**
   * Fabricated-measurement guard mode. Absent ⇒ `block` (always-on). Polices
   * invented empirical measurements (benchmark timings / % speed-ups) absent
   * from the tool-observation corpus. Set via `.withFabricationGuard()`.
   */
  readonly fabricationGuard?: import("../capabilities/verify/evidence-grounding.js").FabricationGuardMode;
  /**
   * Stall / no-progress policy — bounds wasted iterations on ignored
   * required-tool nudges. Absent ⇒ {@link DEFAULT_STALL_POLICY}. Set via
   * `.withStallPolicy()`.
   */
  readonly stallPolicy?: StallPolicy;
  /** Task ID for EventBus correlation */
  readonly taskId?: string;
  /** Name of the calling strategy (for event tagging) */
  readonly parentStrategy?: string;
  /** Descriptive label for this kernel invocation (e.g. "reflexion:generate", "plan-execute:step-3") */
  readonly kernelPass?: string;
  /** Exit kernel loop when all scoped tools have been called successfully */
  readonly exitOnAllToolsCalled?: boolean;
  /** Pre-built ToolCallResolver instance — injected by the kernel runner when FC is active */
  readonly toolCallResolver?: ToolCallResolver;
  /**
   * Compiled harness pipeline for this run. Wave B kernel chokepoints call
   * `pipeline.transform(tag, defaultValue, ctx)` to apply user-registered transforms.
   * Absent when no `.withHarness()` calls were made on the builder (pass-through).
   */
  readonly harnessPipeline?: HarnessPipeline;
}

// ── Narrow service types ─────────────────────────────────────────────────────

export type MaybeService<T> = { _tag: "Some"; value: T } | { _tag: "None" };

/** Minimal ToolService surface used by kernel calls (execute + getTool) */
export type ToolServiceInstance = {
  readonly execute: (input: {
    toolName: string;
    arguments: Record<string, unknown>;
    agentId: string;
    sessionId: string;
  }) => Effect.Effect<{ result: unknown; success?: boolean }, unknown>;
  readonly getTool: (name: string) => Effect.Effect<{
    parameters: Array<{ name: string; type: string; required?: boolean }>;
  }, unknown>;
  readonly listTools: (filter?: {
    category?: string;
    source?: string;
    riskLevel?: string;
  }) => Effect.Effect<readonly { readonly name: string }[], never>;
};

/** Minimal EventBus surface used by kernel hooks (publish only) */
export type EventBusInstance = {
  readonly publish: (event: unknown) => Effect.Effect<void, unknown>;
};

/**
 * Minimal MemoryService surface used by kernel tool-execution.
 *
 * Only `storeSemantic` is needed — tool-execution populates the semantic memory
 * layer during reasoning so cross-iteration recall works. Other memory methods
 * (bootstrap, flush, snapshot, logEpisode) are used exclusively by the runtime
 * execution engine, not by the kernel itself.
 *
 * FIX-34 / W11 — this surface intentionally accepts a `SemanticEntry` (with
 * branded `MemoryId`) for backward compatibility with existing tool-execution
 * call sites. The `AgentMemory` port in `@reactive-agents/core` defines a
 * narrower `AgentMemoryEntry` input shape; the structural compatibility lets
 * a `SemanticEntry` flow through the port unchanged. Kernel resolves
 * `AgentMemory` (port), not `MemoryService` (heavy implementation), per NS §3.1.
 */
export type MemoryServiceInstance = {
  readonly storeSemantic: (
    entry: SemanticEntry,
  ) => Effect.Effect<MemoryId, unknown>;
};

// ── KernelHooks — Lifecycle hooks for observability wiring ───────────────────

export interface KernelHooks {
  readonly onThought: (
    state: KernelState,
    thought: string,
    prompt?: {
      system: string;
      user: string;
      /** Full FC conversation thread with role labels — present when logModelIO is enabled */
      messages?: readonly { readonly role: string; readonly content: string }[];
      /** Raw LLM response before parsing */
      rawResponse?: string;
    },
  ) => Effect.Effect<void, never>;
  readonly onAction: (
    state: KernelState,
    tool: string,
    input: string,
    opts?: {
      readonly callId?: string;
      readonly rationale?: import("@reactive-agents/core").Rationale;
    },
  ) => Effect.Effect<void, never>;
  readonly onObservation: (state: KernelState, result: string, success: boolean) => Effect.Effect<void, never>;
  readonly onDone: (state: KernelState) => Effect.Effect<void, never>;
  readonly onError: (state: KernelState, error: string) => Effect.Effect<void, never>;
  readonly onIterationProgress: (state: KernelState, toolsThisStep: readonly string[]) => Effect.Effect<void, never>;
  readonly onStrategySwitched: (state: KernelState, from: string, to: string, reason: string) => Effect.Effect<void, never>;
  readonly onStrategySwitchEvaluated: (
    state: KernelState,
    evaluation: { shouldSwitch: boolean; recommendedStrategy: string; reasoning: string }
  ) => Effect.Effect<void, never>;
  /**
   * After ICS completes — publish observability before the next LLM call.
   */
  readonly onContextSynthesized: (
    synthesized: import("../../context/synthesis-types.js").SynthesizedContext,
    taskId: string,
    agentId: string,
  ) => Effect.Effect<void, never>;
}

// ── KernelContext — Injected into every kernel call ──────────────────────────

export interface KernelContext {
  readonly input: KernelInput;
  readonly profile: ContextProfile;
  readonly compression: ResultCompressionConfig;
  readonly toolService: MaybeService<ToolServiceInstance>;
  readonly hooks: KernelHooks;
  /** Driver selected from calibration toolCallDialect ("native-fc" → NativeFCDriver, else TextParseDriver). */
  readonly toolCallingDriver: ToolCallingDriver;
  /** Memory service for semantic storage of successful tool results. None when
   *  the memory layer is not registered. Store calls are forked (non-blocking). */
  readonly memoryService: MaybeService<MemoryServiceInstance>;
}

// ── ThoughtKernel — The core computation type ────────────────────────────────

/**
 * A ThoughtKernel takes immutable state + context, performs one reasoning step
 * (think, act, or observe), and returns the next state. The kernel runner calls
 * this in a loop until `state.status` is "done" or "failed".
 */
export type ThoughtKernel = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;

// ── KernelRunOptions — Configuration for the kernel runner ───────────────────

/** Loop detection configuration for kernel execution. */
export interface LoopDetectionConfig {
  /** Max consecutive calls to the same tool with the same args before aborting (default: 3) */
  readonly maxSameToolCalls?: number;
  /** Max identical thought strings in the last N steps before aborting (default: 3) */
  readonly maxRepeatedThoughts?: number;
  /** Max consecutive thought steps without any tool action before aborting (default: 3) */
  readonly maxConsecutiveThoughts?: number;
}

export interface KernelRunOptions {
  readonly maxIterations: number;
  readonly strategy: string;
  readonly kernelType: string;
  readonly taskId?: string;
  readonly kernelPass?: string;
  readonly meta?: Record<string, unknown>;
  readonly loopDetection?: LoopDetectionConfig;
  /** Dynamic strategy switching configuration */
  readonly strategySwitching?: {
    /** Enable automatic strategy switching when a loop is detected */
    readonly enabled: boolean;
    /** Maximum number of strategy switches allowed (default: 1) */
    readonly maxSwitches?: number;
    /** Skip the LLM evaluator and switch directly to this strategy */
    readonly fallbackStrategy?: string;
    /** Strategies available to switch to */
    readonly availableStrategies?: readonly string[];
  };
  /** Task description for entropy-based intelligence routing */
  readonly taskDescription?: string;
  /** Model identifier for entropy-based intelligence routing */
  readonly modelId?: string;
  /** LLM temperature for entropy-based intelligence routing */
  readonly temperature?: number;
  /** Task category for per-category entropy scoring adjustments */
  readonly taskCategory?: string;
  /** When true, exit the kernel loop as soon as all scoped tools have been called successfully.
   *  Used by plan-execute composite steps to avoid looping after all tool hints are satisfied. */
  readonly exitOnAllToolsCalled?: boolean;
}

// ── Factory functions ────────────────────────────────────────────────────────

/**
 * Create an initial KernelState with empty accumulation and status "thinking".
 *
 * Uses mutable Set/Map internally (they satisfy ReadonlySet/ReadonlyMap).
 */
export function initialKernelState(opts: KernelRunOptions): KernelState {
  // Build entropy meta only when at least one entropy field is provided
  const hasEntropy = opts.taskDescription !== undefined || opts.modelId !== undefined || opts.temperature !== undefined || opts.taskCategory !== undefined;
  const entropyMeta = hasEntropy
    ? {
        ...(opts.taskDescription !== undefined ? { taskDescription: opts.taskDescription } : {}),
        ...(opts.modelId !== undefined ? { modelId: opts.modelId } : {}),
        ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
        ...(opts.taskCategory !== undefined ? { taskCategory: opts.taskCategory } : {}),
      }
    : undefined;

  return {
    taskId: opts.taskId ?? "",
    strategy: opts.strategy,
    kernelType: opts.kernelType,
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 0,
    tokens: 0,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: {
      ...(opts.meta ?? {}),
      maxIterations: opts.maxIterations,
      ...(entropyMeta ? { entropy: entropyMeta } : {}),
    },
    controllerDecisionLog: [],
    messages: [],
    pendingGuidance: undefined,
    consecutiveLowDeltaCount: 0,
    readyToAnswerNudgeCount: 0,
    lastMetaToolCall: undefined,
    consecutiveMetaToolCount: 0,
  };
}

/**
 * Immutable state transition — returns a new KernelState with the given patch applied.
 *
 * Since ReadonlySet and ReadonlyMap are not spreadable, they must be explicitly
 * carried forward unless overridden in the patch.
 *
 * State-machine invariant: status="failed" implies output=null. A failed run
 * has no valid deliverable; whatever was pre-populated (lastThought from a
 * loop_graceful path, harness-assembled artifacts, etc.) is invalidated by
 * the failure. Callers who need to preserve a payload alongside a failure
 * (e.g. arbitrator.applyTermination forwarding verdict.output) MUST pass
 * `output` explicitly in the patch — `undefined` triggers the invariant.
 */
export function transitionState(
  state: KernelState,
  patch: Partial<KernelState>,
): KernelState {
  const transitionToFailed =
    patch.status === "failed" && state.status !== "failed";
  const outputUnspecified = !("output" in patch);
  const next = {
    ...state,
    ...patch,
    toolsUsed: patch.toolsUsed ?? state.toolsUsed,
    scratchpad: patch.scratchpad ?? state.scratchpad,
  };
  if (transitionToFailed && outputUnspecified) {
    return { ...next, output: null };
  }
  return next;
}

// ── Serialization ────────────────────────────────────────────────────────────

/** JSON-safe representation of KernelState (Set → array, Map → object) */
export interface SerializedKernelState
  extends Omit<KernelState, "toolsUsed" | "scratchpad" | "steps" | "messages"> {
  readonly toolsUsed: readonly string[];
  readonly scratchpad: Readonly<Record<string, string>>;
  readonly steps: readonly ReasoningStep[];
  readonly messages: readonly KernelMessage[];
  readonly controllerDecisionLog: readonly string[];
}

/**
 * Convert KernelState to a JSON-serializable form.
 * ReadonlySet → sorted array, ReadonlyMap → plain object.
 */
export function serializeKernelState(state: KernelState): SerializedKernelState {
  return {
    taskId: state.taskId,
    strategy: state.strategy,
    kernelType: state.kernelType,
    steps: state.steps,
    messages: state.messages,
    toolsUsed: [...state.toolsUsed].sort(),
    scratchpad: Object.fromEntries(state.scratchpad),
    iteration: state.iteration,
    tokens: state.tokens,
    inputTokens: state.inputTokens,
    outputTokens: state.outputTokens,
    cost: state.cost,
    status: state.status,
    output: state.output,
    error: state.error,
    llmCalls: state.llmCalls,
    priorThought: state.priorThought,
    meta: state.meta,
    controllerDecisionLog: state.controllerDecisionLog,
    pendingGuidance: state.pendingGuidance,
    consecutiveLowDeltaCount: state.consecutiveLowDeltaCount,
  };
}

/**
 * Reconstruct KernelState from its serialized form.
 * Array → Set, object → Map.
 */
export function deserializeKernelState(raw: SerializedKernelState): KernelState {
  return {
    taskId: raw.taskId,
    strategy: raw.strategy,
    kernelType: raw.kernelType,
    steps: raw.steps,
    messages: raw.messages,
    toolsUsed: new Set(raw.toolsUsed),
    scratchpad: new Map(Object.entries(raw.scratchpad)),
    iteration: raw.iteration,
    tokens: raw.tokens,
    inputTokens: raw.inputTokens,
    outputTokens: raw.outputTokens,
    cost: raw.cost,
    status: raw.status,
    output: raw.output,
    error: raw.error,
    llmCalls: raw.llmCalls,
    priorThought: raw.priorThought,
    meta: raw.meta,
    controllerDecisionLog: (raw.controllerDecisionLog as string[]) ?? [],
    pendingGuidance: raw.pendingGuidance,
    consecutiveLowDeltaCount: raw.consecutiveLowDeltaCount,
  };
}

// ── Noop hooks ───────────────────────────────────────────────────────────────

/** KernelHooks with all no-op implementations — safe default for tests/simple runs. */
export const noopHooks: KernelHooks = {
  onThought: () => Effect.void,
  onAction: () => Effect.void,
  onObservation: () => Effect.void,
  onDone: () => Effect.void,
  onError: () => Effect.void,
  onIterationProgress: () => Effect.void,
  onStrategySwitched: () => Effect.void,
  onStrategySwitchEvaluated: () => Effect.void,
  onContextSynthesized: () => Effect.void,
};

// ─── ReAct Kernel Input / Output ─────────────────────────────────────────────

/** @deprecated Use KernelInput directly. Preserved as alias for existing consumers. */
export type ReActKernelInput = KernelInput;

export interface ReActKernelResult {
  /** Final answer text */
  output: string;
  /** All reasoning steps (thought / action / observation) */
  steps: ReasoningStep[];
  /** Total tokens consumed across all LLM calls */
  totalTokens: number;
  /** Total estimated cost */
  totalCost: number;
  /** Distinct tool names that were called at least once */
  toolsUsed: string[];
  /** Number of iterations completed */
  iterations: number;
  /** How the loop terminated (narrowed to closed enum) */
  terminatedBy: "final_answer" | "final_answer_tool" | "max_iterations" | "end_turn" | "llm_error" | "abstained";
  /**
   * Raw `state.meta.terminatedBy` preserved verbatim as an open string channel.
   *
   * The narrowed `terminatedBy` field above collapses dynamic killswitch reasons
   * (e.g. `"budget-limit:tokens:1/0"`, `"timeout-after:30s"`,
   * `"max-iterations:5"`, `"require-approval-for:denied:TOOL"`,
   * `"watchdog:no-progress-for:Nms"`) into `"max_iterations"`. Downstream
   * propagation (AgentCompleted.terminationReason) needs the raw string;
   * this field carries it alongside the closed-enum form.
   *
   * Omitted when `state.meta.terminatedBy` is undefined — never set to
   * `undefined` explicitly so consumers can distinguish "no reason" from
   * "present but undefined". (HS-killswitch-toggle / 2026-05-24)
   */
  rawTerminatedBy?: string;
  /** Captured final-answer tool payload — present when terminatedBy === "final_answer_tool" */
  finalAnswerCapture?: FinalAnswerCapture;
  /** O3: present when terminatedBy === "abstained" — model's honest decline. */
  abstention?: { readonly reason: string; readonly missing: readonly string[] };
}

// ─── Phase Pipeline Types ─────────────────────────────────────────────────────

/**
 * A single step in the kernel turn pipeline.
 *
 * Pure state transition: takes the current immutable KernelState and a read-only
 * KernelContext, returns an Effect that produces the next KernelState.
 *
 * Composable: custom kernels substitute individual phases via makeKernel({ phases }).
 *
 * Phases receive the full KernelContext (compression, toolService, hooks, etc.).
 */
export type Phase = (
  state: KernelState,
  context: KernelContext,
) => Effect.Effect<KernelState, never, LLMService>;

