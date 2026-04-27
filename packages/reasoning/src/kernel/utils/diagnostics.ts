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
import type { KernelState } from "../state/kernel-state.js";

// ── Truncation budgets ───────────────────────────────────────────────────────
// Soft caps to keep trace payloads small. Truncation is signalled with a
// `truncated: true` field so consumers know the data isn't full-fidelity.

const PREVIEW_MAX = 240;
const SYSTEM_PROMPT_MAX = 4_000;
const MESSAGE_MAX = 2_000;
const RESPONSE_MAX = 8_000;

function preview(text: string | null | undefined, max = PREVIEW_MAX): string {
  if (!text) return "";
  return text.length > max ? text.slice(0, max) : text;
}

function truncate(
  text: string | undefined,
  max: number,
): { text: string | undefined; truncated: boolean } {
  if (text === undefined) return { text: undefined, truncated: false };
  if (text.length <= max) return { text, truncated: false };
  return { text: text.slice(0, max), truncated: true };
}

// ── KernelStateSnapshot ──────────────────────────────────────────────────────

export function emitKernelStateSnapshot(args: {
  readonly state: KernelState;
  readonly taskId: string;
  readonly iteration: number;
}): Effect.Effect<void, never> {
  const { state, taskId, iteration } = args;
  return Effect.gen(function* () {
    const busOpt = yield* Effect.serviceOption(EventBus);
    if (busOpt._tag !== "Some") return;

    // Build stepsByType count
    const stepsByType: Record<string, number> = {};
    for (const s of state.steps) {
      stepsByType[s.type] = (stepsByType[s.type] ?? 0) + 1;
    }

    yield* busOpt.value
      .publish({
        _tag: "KernelStateSnapshotEmitted",
        taskId,
        iteration,
        status: state.status,
        toolsUsed: [...state.toolsUsed],
        scratchpadKeys: [...state.scratchpad.keys()],
        stepsCount: state.steps.length,
        stepsByType,
        outputPreview: state.output ? preview(state.output) : null,
        outputLen: state.output?.length ?? 0,
        messagesCount: state.messages.length,
        tokens: state.tokens,
        cost: state.cost,
        llmCalls: state.llmCalls ?? 0,
        terminatedBy: state.meta.terminatedBy as string | undefined,
        pendingGuidance: state.pendingGuidance as Record<string, unknown> | undefined,
        timestamp: Date.now(),
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
