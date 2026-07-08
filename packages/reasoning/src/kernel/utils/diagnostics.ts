// File: src/kernel/utils/diagnostics.ts
//
// Diagnostic event emission helpers (Sprint 3.6 — harness diagnostic system).
//
// These helpers publish typed AgentEvents on the EventBus that the
// @reactive-agents/trace package's bridge layer maps 1:1 into TraceEvents.
// Trace events flow to:
//   - JSONL files via TraceRecorderService (read by `rax diagnose`)
//   - Cortex UI via cortex-reporter
//
// Each helper:
//   - Resolves EventBus via Effect.serviceOption (no-op when unavailable)
//   - Uses emitErrorSwallowed for publish failures (never breaks the loop)
//   - Captures truncation at boundaries to keep payloads bounded
//
// Pattern matches the existing `emitLog` and `publishReasoningStep` helpers
// already used throughout the kernel.

import { Effect } from "effect";
import { EventBus, emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { Rationale } from "@reactive-agents/core";
import {
  truncateExchangeText,
  EXCHANGE_SYSTEM_PROMPT_MAX,
  EXCHANGE_MESSAGE_MAX,
} from "@reactive-agents/llm-provider";

// ── KernelStateLike ─────────────────────────────────────────────────────────
// Narrow structural surface accepted by `emitKernelStateSnapshot` — only the
// fields the helper actually reads. Defined here (not in kernel-state.ts) so
// strategies and outer-loop callers (e.g. plan-execute.ts:669-688 syntheticState)
// can construct snapshot-emit-compatible shapes without casting through
// `KernelState`. The concrete `KernelState` type is structurally assignable to
// this interface, so the existing call sites in `kernel/loop/runner.ts` keep
// type-checking unchanged. (HS-113 step 3.)
export interface KernelStateLike {
  readonly status:
    | "thinking"
    | "acting"
    | "observing"
    | "done"
    | "failed"
    | "evaluating"
    | "paused";
  readonly steps: ReadonlyArray<{ readonly type: string }>;
  readonly toolsUsed: ReadonlySet<string> | ReadonlyArray<string>;
  readonly scratchpad?: ReadonlyMap<string, string>;
  readonly messages?: ReadonlyArray<unknown>;
  readonly tokens?: number;
  readonly cost?: number;
  readonly llmCalls?: number;
  readonly output?: string | null;
  readonly meta?: {
    readonly terminatedBy?: string;
    readonly terminationRationale?: Rationale;
  };
  readonly pendingGuidance?: unknown;
}

// ── Truncation budgets ───────────────────────────────────────────────────────
// Soft caps to keep trace payloads small. Truncation is signalled with a
// `truncated: true` field so consumers know the data isn't full-fidelity.

const PREVIEW_MAX = 240;
const RESPONSE_MAX = 8_000;
// Exchange-payload caps + truncation are shared with the exact-replay layer
// (llm-provider/src/exchange-projection.ts) — replay hashes live requests
// through the SAME projection, so these must never fork.
const SYSTEM_PROMPT_MAX = EXCHANGE_SYSTEM_PROMPT_MAX;
const MESSAGE_MAX = EXCHANGE_MESSAGE_MAX;
const truncate = truncateExchangeText;

function preview(text: string | null | undefined, max = PREVIEW_MAX): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

// ── KernelStateSnapshot ──────────────────────────────────────────────────────

export function emitKernelStateSnapshot(args: {
  readonly state: KernelStateLike;
  readonly taskId: string;
  readonly iteration: number;
  /** Optional outer-loop identifier (HS-113 / E2) e.g. "plan-execute:plan". */
  readonly outerLoopName?: string;
  /** Optional outer-loop iteration counter, paired with outerLoopName. */
  readonly outerIter?: number;
}): Effect.Effect<void, never> {
  const { state, taskId, iteration, outerLoopName, outerIter } = args;
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    // Build stepsByType count
    const stepsByType: Record<string, number> = {};
    for (const s of state.steps) {
      stepsByType[s.type] = (stepsByType[s.type] ?? 0) + 1;
    }

    const terminationRationale = state.meta?.terminationRationale;
    yield* busOpt.value
      .publish({
        _tag: "KernelStateSnapshotEmitted",
        taskId,
        iteration,
        status: state.status,
        toolsUsed: [...state.toolsUsed],
        scratchpadKeys: state.scratchpad ? [...state.scratchpad.keys()] : [],
        stepsCount: state.steps.length,
        stepsByType,
        outputPreview: state.output ? preview(state.output) : null,
        outputLen: state.output?.length ?? 0,
        messagesCount: state.messages?.length ?? 0,
        tokens: state.tokens ?? 0,
        cost: state.cost ?? 0,
        llmCalls: state.llmCalls ?? 0,
        terminatedBy: state.meta?.terminatedBy as string | undefined,
        pendingGuidance: state.pendingGuidance as Record<string, unknown> | undefined,
        timestamp: Date.now(),
        ...(terminationRationale ? { terminationRationale } : {}),
        ...(outerLoopName !== undefined ? { outerLoopName } : {}),
        ...(outerIter !== undefined ? { outerIter } : {}),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitKernelStateSnapshot",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── Rationale-bearing events (v0.11.x) ──────────────────────────────────────

export function emitAssumptionRecorded(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly assumption: string;
  readonly rationale: Rationale;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    yield* busOpt.value
      .publish({
        _tag: "AssumptionRecordedEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        timestamp: Date.now(),
        assumption: args.assumption,
        rationale: args.rationale,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitAssumptionRecorded",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

export function emitCuratorDecision(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly action: "kept" | "dropped" | "compressed" | "marked-untrusted";
  readonly targetRef: string;
  readonly rationale: Rationale;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    yield* busOpt.value
      .publish({
        _tag: "CuratorDecisionEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        timestamp: Date.now(),
        action: args.action,
        targetRef: args.targetRef,
        rationale: args.rationale,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitCuratorDecision",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

export function emitAlternativesConsidered(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly chosen: string;
  readonly alternatives: readonly { readonly option: string; readonly rejectedBecause: string }[];
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    yield* busOpt.value
      .publish({
        _tag: "AlternativesConsideredEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        timestamp: Date.now(),
        chosen: args.chosen,
        alternatives: args.alternatives,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitAlternativesConsidered",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── ToolSurfaceResolved ──────────────────────────────────────────────────────

/**
 * Overhaul Phase 2 (2026-07-07): per-iteration tool-surface resolution with a
 * per-tool reason map — the rw-9 "why is this tool invisible" diagnosis as one
 * trace line instead of a debug tap.
 */
export function emitToolSurfaceResolved(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly visible: readonly string[];
  readonly callable: readonly string[];
  readonly reasons: readonly { readonly tool: string; readonly reason: string }[];
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    yield* busOpt.value
      .publish({
        _tag: "ToolSurfaceResolvedEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        timestamp: Date.now(),
        visible: args.visible,
        callable: args.callable,
        reasons: args.reasons,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitToolSurfaceResolved",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── ContractCompiled ─────────────────────────────────────────────────────────

/**
 * Meta-loop Phase 4a (2026-07-08): the RunContract compiled at run start — the
 * goal-compiler node of the meta-loop DAG. Mirrors emitToolSurfaceResolved: one
 * trace line so the contract → assessment → action chain is replayable from a
 * single trace via `rax diagnose replay`.
 */
export function emitContractCompiled(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly requirements: readonly { readonly id: string; readonly kind: string }[];
  readonly deliverables: readonly { readonly id: string; readonly kind: string }[];
  readonly horizon: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;
    yield* busOpt.value
      .publish({
        _tag: "ContractCompiledEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        timestamp: Date.now(),
        requirements: args.requirements,
        deliverables: args.deliverables,
        horizon: args.horizon,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitContractCompiled",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── VerifierVerdict ──────────────────────────────────────────────────────────

export function emitVerifierVerdict(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly action: string;
  readonly terminal: boolean;
  readonly verified: boolean;
  readonly summary: string;
  readonly checks: readonly {
    readonly name: string;
    readonly passed: boolean;
    readonly reason?: string;
  }[];
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    yield* busOpt.value
      .publish({
        _tag: "VerifierVerdictEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        action: args.action,
        terminal: args.terminal,
        verified: args.verified,
        summary: args.summary,
        checks: args.checks,
        timestamp: Date.now(),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitVerifierVerdict",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── GuardFired ───────────────────────────────────────────────────────────────

export function emitGuardFired(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly guard: string;
  readonly outcome: "pass" | "redirect" | "terminate" | "block" | "warn";
  readonly reason: string;
  readonly metadata?: Record<string, unknown>;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    yield* busOpt.value
      .publish({
        _tag: "GuardFiredEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        guard: args.guard,
        outcome: args.outcome,
        reason: args.reason,
        metadata: args.metadata,
        timestamp: Date.now(),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitGuardFired",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── LLMExchange ──────────────────────────────────────────────────────────────

export function emitLLMExchange(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly provider: string;
  readonly model: string;
  readonly requestKind: "complete" | "stream" | "completeStructured";
  readonly systemPrompt?: string;
  readonly messages: readonly { readonly role: "system" | "user" | "assistant" | "tool"; readonly content: string }[];
  readonly toolSchemaNames?: readonly string[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly response: {
    readonly content: string;
    readonly toolCalls?: readonly { readonly name: string; readonly arguments?: unknown }[];
    readonly stopReason?: string;
    readonly tokensIn?: number;
    readonly tokensOut?: number;
    /** Anthropic prompt-caching: tokens that wrote new cache entries (Lever 1). */
    readonly cacheCreationTokensIn?: number;
    /** Anthropic prompt-caching: tokens served from cache hits. */
    readonly cacheReadTokensIn?: number;
    readonly costUsd?: number;
    readonly durationMs?: number;
  };
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    const sys = truncate(args.systemPrompt, SYSTEM_PROMPT_MAX);
    const msgs = args.messages.map((m) => {
      const t = truncate(m.content, MESSAGE_MAX);
      return { role: m.role, content: t.text ?? "", ...(t.truncated ? { truncated: true } : {}) };
    });
    const respTrunc = truncate(args.response.content, RESPONSE_MAX);

    yield* busOpt.value
      .publish({
        _tag: "LLMExchangeEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        provider: args.provider,
        model: args.model,
        requestKind: args.requestKind,
        systemPrompt: sys.text,
        ...(sys.truncated ? { systemPromptTruncated: true } : {}),
        messages: msgs,
        toolSchemaNames: args.toolSchemaNames ?? [],
        temperature: args.temperature,
        maxTokens: args.maxTokens,
        response: {
          content: respTrunc.text ?? "",
          ...(respTrunc.truncated ? { truncated: true } : {}),
          toolCalls: args.response.toolCalls,
          stopReason: args.response.stopReason,
          tokensIn: args.response.tokensIn,
          tokensOut: args.response.tokensOut,
          ...(typeof args.response.cacheCreationTokensIn === "number"
            ? { cacheCreationTokensIn: args.response.cacheCreationTokensIn }
            : {}),
          ...(typeof args.response.cacheReadTokensIn === "number"
            ? { cacheReadTokensIn: args.response.cacheReadTokensIn }
            : {}),
          costUsd: args.response.costUsd,
          durationMs: args.response.durationMs,
        },
        timestamp: Date.now(),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitLLMExchange",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── ContextPressure (uniform chokepoint emission) ──────────────────────────
//
// Emitted from the observable-llm chokepoint after every correlated LLM call so
// Cortex's context-window gauge updates in realtime for EVERY strategy path —
// including plan-execute/reflexion sub-kernel calls that run with no per-strategy
// EventBus hooks. The denominator is the EXACT provider-resolved context window
// (resolvedParams.contextWindow — honors user numCtx overrides), the numerator is
// the prompt (input) tokens of that call. Same Effect.serviceOption(EventBus)
// no-op-when-absent pattern as emitLLMExchange — keeps the Layer R = never.

export function emitContextPressure(args: {
  readonly taskId: string;
  readonly tokensUsed: number;
  readonly contextWindow: number;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    const used = args.tokensUsed;
    const window = args.contextWindow;
    if (used <= 0 || window <= 0) return;

    const tokensAvailable = Math.max(0, window - used);
    const utilizationPct = Math.min(100, Math.max(0, (used / window) * 100));
    const level: "low" | "medium" | "high" | "critical" =
      utilizationPct >= 90
        ? "critical"
        : utilizationPct >= 75
          ? "high"
          : utilizationPct >= 45
            ? "medium"
            : "low";

    yield* busOpt.value
      .publish({
        _tag: "ContextPressure",
        taskId: args.taskId,
        utilizationPct,
        tokensUsed: used,
        tokensAvailable,
        level,
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitContextPressure",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── BudgetSignalCollected (Issue #128 — North Star v5.0 Pillar 6) ───────────
//
// Marker emit for the Arbitrator's BudgetSignal input. Surfaces tokensUsed /
// costUsd / declared limits / status each time the Arbitrator computes the
// signal, so trace consumers can see budget warnings before exceedance and
// confirm budget_exceeded fires for the right reason.

export function emitBudgetSignalCollected(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly tokenLimit?: number;
  readonly costLimit?: number;
  readonly status: "ok" | "warning" | "exceeded";
  readonly reason?: string;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    yield* busOpt.value
      .publish({
        _tag: "BudgetSignalCollectedEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        tokensUsed: args.tokensUsed,
        costUsd: args.costUsd,
        ...(args.tokenLimit !== undefined ? { tokenLimit: args.tokenLimit } : {}),
        ...(args.costLimit !== undefined ? { costLimit: args.costLimit } : {}),
        status: args.status,
        ...(args.reason !== undefined ? { reason: args.reason } : {}),
        timestamp: Date.now(),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitBudgetSignalCollected",
            tag: errorTag(err),
          }),
        ),
      );
  });
}

// ── HarnessSignalInjected ────────────────────────────────────────────────────

export function emitHarnessSignalInjected(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly signalKind:
    | "redirect"
    | "nudge"
    | "block"
    | "completion-gap"
    | "rule-violation"
    | "dispatcher-status"
    | "loop-graceful"
    | "other";
  readonly origin: string;
  readonly content: string;
  readonly metadata?: Record<string, unknown>;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    yield* busOpt.value
      .publish({
        _tag: "HarnessSignalInjectedEmitted",
        taskId: args.taskId,
        iteration: args.iteration,
        signalKind: args.signalKind,
        origin: args.origin,
        contentPreview: preview(args.content),
        contentLen: args.content.length,
        metadata: args.metadata,
        timestamp: Date.now(),
      })
      .pipe(
        Effect.catchAll((err) =>
          emitErrorSwallowed({
            site: "reasoning/src/kernel/utils/diagnostics.ts:emitHarnessSignalInjected",
            tag: errorTag(err),
          }),
        ),
      );
  });
}
