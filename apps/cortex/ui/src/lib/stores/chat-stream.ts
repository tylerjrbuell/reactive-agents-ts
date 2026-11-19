import {
  connectRunStream,
  reduceRunState,
  initialRunState,
  foldTurnTrace,
  visibleThoughts,
  visibleIterations,
  initialTurnTrace,
  mergeThoughtText,
  estimateTokens,
  contextLevel,
  splitTokens,
  foldModelWait,
  initialModelWait,
  liveTokensPerSecond,
  foldStrategyRun,
  runNotesOf,
  endStrategyRun,
  initialStrategyRun,
  strategyStepFromWire,
  type StrategyRunState,
  type ChecklistSnapshotWire,
  type ModelWaitState,
  type RunState,
  type TurnTraceState,
  type UiStreamEvent,
} from "@reactive-agents/ui-core";
import type { ChatContext, ChatTurn, LiveTokenSplit, ReasoningStep } from "./chat-store.js";
import { projectSubAgents } from "../sub-agent-view.js";
import { effectiveBound } from "../plan-budget.js";
import { CORTEX_SERVER_URL } from "../constants.js";
import { cancelledEnding, completionEnding, failedBeforeStream } from "../turn-ending.js";
import { liveApprovalAfter, type LiveApproval } from "../chat-live-approval.js";
import { liveInteractionAfter, type LiveInteraction } from "../chat-live-interaction.js";

/**
 * Single SSE → ChatTurn reduction shared by the desk Chat store and the run-view
 * Chat tab, so both render tool chips / live preview / cancellation identically.
 */

export { mergeThoughtText };

/**
 * Read a numeric terminal-metadata field. The wire metadata is loosely typed, so a
 * key is trusted only when its value is a finite number; anything else (missing,
 * null, a string, NaN) is `undefined` and the caller falls back.
 */
export function metaNumber(meta: Readonly<Record<string, unknown>> | undefined, key: string): number | undefined {
  const value = meta?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** Append a streaming text delta verbatim (no trimming — deltas are partial tokens). */
export function appendThoughtDelta(previous: string | undefined, delta: string): string {
  return `${previous ?? ""}${delta}`;
}

type TurnsUpdater = (f: (turns: ChatTurn[]) => ChatTurn[]) => void;


export interface StreamTurnOptions {
  readonly endpoint: string;
  /** POST body for a new turn; omit to only attach to a turn already running on the server (`attach`). */
  readonly body?: Record<string, unknown>;
  /**
   * Re-attach target (`GET endpoint/:runId?cursor=`): after a dropped connection the turn, which
   * keeps running server-side, is followed again from the last event seen (SSE `id:`).
   */
  readonly attach?: { readonly runId: string; readonly cursor?: number };
  readonly signal: AbortSignal;
  /** Id of the (already-inserted, `streaming: true`) assistant turn the events fold into. */
  readonly assistantTurnId: number;
  /**
   * Derive the partial structured-object preview. Off by default: the reducer
   * retains + copies every event and re-parses cumulative text per delta, which
   * is O(n²) on a long full-density tool stream — only worth it with an outputSchema.
   */
  readonly structuredOutput?: boolean;
  /** Apply a pure turns transformation to the host's state (store `update` / `$state` assign). */
  readonly apply: TurnsUpdater;
  /** Called with each NEW live checklist snapshot (stale ones are dropped by the fold), so the host can keep conversation-level state such as the to-do list. */
  readonly onChecklist?: (snapshot: ChecklistSnapshotWire) => void;
  /** Clock for the live output-speed estimate; `Date.now` by default (tests pass a fake). */
  readonly now?: () => number;
}

export interface StreamTurnOutcome {
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly steps: number;
  readonly toolsUsed: readonly string[];
  /** Pre-stream connection failure (nothing ever rendered): host should drop the optimistic turns. */
  readonly preStreamFailure?: string;
  /** Mid-stream error after content already rendered: keep partial content, surface the message. */
  readonly streamError?: string;
}

const patchTurn = (turns: ChatTurn[], id: number, fn: (t: ChatTurn) => ChatTurn): ChatTurn[] =>
  turns.map((t) => (t.id === id ? fn(t) : t));

/**
 * End the streaming assistant turn `id` as failed before any content arrived
 * (request refused, network down): the user's message above it stays, the turn
 * shows the cause and offers Retry (B1).
 */
export function failTurn(turns: ChatTurn[], id: number, cause: unknown): ChatTurn[] {
  return patchTurn(turns, id, (t) => ({
    ...t,
    streaming: false,
    streamProgress: undefined,
    awaitingModelSince: undefined,
    liveText: undefined,
    runFailed: failedBeforeStream(cause),
  }));
}

/**
 * How long a Stop / Pause waits for the server. The server answers once the aborted turn has
 * released the session, bounded at 8s (`STOP_SETTLE_MS`); this stays just above it.
 */
const STOP_TIMEOUT_MS = 10_000;

/** What the server answers to a chat Stop: `settled` = the turn released the session (an edit is accepted now). */
export type StopAnswer = { readonly ok: true; readonly stopped: boolean; readonly settled: boolean } | { readonly ok: false };

/** Ask the server to stop the session's streamed turn; never throws (`{ ok: false }` when it did not answer in time). */
export async function requestTurnStopAnswer(sessionId: string): Promise<StopAnswer> {
  try {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/chat/stop`, {
      method: "POST",
      signal: AbortSignal.timeout(STOP_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { stopped?: boolean; settled?: boolean };
    // A body without `settled` (an older server) counts as settled; only an explicit `false` is "still winding down".
    return { ok: true, stopped: body.stopped === true, settled: body.settled !== false };
  } catch {
    return { ok: false };
  }
}

/**
 * Ask the server to stop the session's streamed turn, so it is stored as stopped
 * by the user. Never throws; `false` when the server had no turn or did not answer.
 */
export async function requestTurnStop(sessionId: string): Promise<boolean> {
  const answer = await requestTurnStopAnswer(sessionId);
  return answer.ok && answer.stopped;
}

/** What the server answers to a chat Pause: whether a turn ended and whether the run was saved so it can continue (`settled`: the turn released the session). */
export type PauseAnswer = { readonly ok: true; readonly stopped: boolean; readonly persisted: boolean; readonly settled: boolean } | { readonly ok: false };

/**
 * Pause the session's running turn: the framework ends the durable run at its next step
 * with a saved place to continue from, and the server ends the streamed turn (the stream
 * closes on its own). Never throws. `persisted: false` means the run was not durable (it
 * was stopped, with nothing to continue from).
 */
export async function requestTurnPause(sessionId: string): Promise<PauseAnswer> {
  try {
    const res = await fetch(`${CORTEX_SERVER_URL}/api/chat/sessions/${encodeURIComponent(sessionId)}/chat/pause`, {
      method: "POST",
      signal: AbortSignal.timeout(STOP_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false };
    const body = (await res.json()) as { stopped?: boolean; persisted?: boolean; settled?: boolean };
    return { ok: true, stopped: body.stopped === true, persisted: body.persisted === true, settled: body.settled !== false };
  } catch {
    return { ok: false };
  }
}

/**
 * Consume one chat SSE stream, folding every event into the assistant turn via
 * `apply`, then finalize the turn. Never throws for stream-level failures — they
 * come back on the outcome; only unexpected exceptions propagate.
 */
export async function streamAssistantTurn(opts: StreamTurnOptions): Promise<StreamTurnOutcome> {
  const { assistantTurnId: id, apply } = opts;
  let toolsUsed: string[] = [];
  let tokensUsed = 0;
  let costUsd = 0;
  let steps = 0;
  let streamInputTokens: number | undefined;
  let streamOutputTokens: number | undefined;
  let rs: RunState = initialRunState();
  let trace: TurnTraceState = initialTurnTrace();
  const stepMeta = new Map<number, { maxIterations: number; tools?: readonly string[] }>();
  let sawIteration = false;
  let completed = false;
  // Context-window reading state for the streaming turn.
  let basePromptTokens = 0;
  let windowTokens = 0;
  let hasContext = false;
  // Prompt tokens of the most recent call in this turn (the basis for the live
  // context growth estimate) and characters streamed since that call reported.
  let contextPromptTokens = 0;
  let inFlightText = "";
  // When the in-flight call's first text delta arrived (live tokens/sec estimate); reset when it reports.
  let inFlightStartedAt: number | undefined;
  const clock = opts.now ?? Date.now;
  let liveCostUsd = 0;
  // rAF-coalesced apply state (TU-9).
  let hasPendingApply = false;
  let pendingExtra: Partial<ChatTurn> = {};
  let flushScheduled = false;
  // `connectRunStream` synthesizes a StreamError for BOTH a pre-stream connection
  // failure and a genuine mid-stream drop; `receivedContent` tells them apart.
  let receivedContent = false;
  let preStreamFailure: string | undefined;
  let streamError: string | undefined;
  // B11: whether the turn waits on the model (request out, no token back), from the send.
  let modelWait: ModelWaitState = initialModelWait(Date.now());
  // A live approval wait (no durable runs): the turn shows Approve / Deny until the run moves on.
  let liveApproval: LiveApproval | undefined;
  // A live question (`request_user_input`, no durable runs): the turn shows its reply controls.
  let liveInteraction: LiveInteraction | undefined;
  // The strategy's live phases (reflexion rounds, ToT levels, plan steps ...), drawn by `StrategyCard`.
  let strategyRun: StrategyRunState = initialStrategyRun;

  for await (const event of connectRunStream({
    endpoint: opts.endpoint,
    ...(opts.body !== undefined ? { body: opts.body } : {}),
    ...(opts.attach !== undefined ? { attach: opts.attach } : {}),
    signal: opts.signal,
  })) {
    if (opts.structuredOutput) rs = reduceRunState(rs, event, { objectMode: true });
    trackModelWait(event);
    trackLiveApproval(event);
    trackLiveInteraction(event);
    trackStrategy(event);
    reduceEvent(event);
  }
  // Flush any coalesced text deltas before persistence / return.
  flushPending();

  if (preStreamFailure !== undefined) {
    return { tokensUsed, costUsd, steps, toolsUsed, preStreamFailure };
  }

  apply((turns) =>
    patchTurn(turns, id, (t) => ({
      ...t,
      streaming: false,
      streamProgress: undefined,
      awaitingModelSince: undefined,
      // reasoningSteps intentionally kept for post-stream inspection
      // Safety net: stream ended without StreamCompleted output
      content: t.content || (t.liveText ?? ""),
      liveText: undefined,
      tokensUsed,
      liveTokens: completed ? undefined : t.liveTokens,
      liveUsage: completed ? undefined : t.liveUsage,
      liveCost: completed ? undefined : t.liveCost,
      liveRate: undefined,
      ...(streamInputTokens !== undefined ? { tokensIn: streamInputTokens } : {}),
      ...(streamOutputTokens !== undefined ? { tokensOut: streamOutputTokens } : {}),
      ...(trace.usage ? { usage: trace.usage } : {}),
      ...(costUsd > 0 ? { costUsd } : {}),
      ...(steps > 0 ? { steps } : {}),
      ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
    })),
  );
  return { tokensUsed, costUsd, steps, toolsUsed, ...(streamError !== undefined ? { streamError } : {}) };

  /**
   * Fold an event into the model-wait state (ui-core `foldModelWait`); when it
   * starts or ends a wait, stamp the turn so it can show "Waiting for the model"
   * with the elapsed time instead of "Thinking".
   */
  function trackModelWait(event: UiStreamEvent): void {
    const next = foldModelWait(modelWait, event, Date.now());
    const changed = next.waiting !== modelWait.waiting || next.since !== modelWait.since;
    modelWait = next;
    if (!changed) return;
    flushPending();
    const since = next.waiting ? next.since : undefined;
    apply((turns) => patchTurn(turns, id, (t) => ({ ...t, awaitingModelSince: since })));
  }

  /**
   * Fold the strategy's live phases (`StepEvent`, ui-core strategy-phases.ts) into the turn's
   * `strategyRun`; the turn ending settles every phase.
   */
  function trackStrategy(event: UiStreamEvent): void {
    if (event._tag === "StepEvent") {
      const step = strategyStepFromWire(event.step);
      if (!step) return;
      strategyRun = foldStrategyRun(strategyRun, step);
    } else if (event._tag === "StreamCompleted" || event._tag === "StreamError" || event._tag === "StreamCancelled") {
      if (strategyRun.current === undefined) return;
      strategyRun = endStrategyRun(strategyRun);
    } else {
      return;
    }
    const next = strategyRun;
    flushPending();
    apply((turns) => patchTurn(turns, id, (t) => ({ ...t, strategyRun: next })));
  }

  /** Set or clear the turn's live approval wait (chat-live-approval.ts). */
  function trackLiveApproval(event: UiStreamEvent): void {
    const next = liveApprovalAfter(liveApproval, event);
    if (next === liveApproval) return;
    liveApproval = next;
    flushPending();
    apply((turns) => patchTurn(turns, id, (t) => ({ ...t, liveApproval: next })));
  }

  /** Set or clear the turn's live question (chat-live-interaction.ts). */
  function trackLiveInteraction(event: UiStreamEvent): void {
    const next = liveInteractionAfter(liveInteraction, event);
    if (next === liveInteraction) return;
    liveInteraction = next;
    flushPending();
    apply((turns) => patchTurn(turns, id, (t) => ({ ...t, liveInteraction: next })));
  }

  /**
   * Fold an event into the shared turn trace (ui-core — the same fold the server
   * persists with) and project it onto the assistant turn: live answer preview,
   * per-iteration thinking, tool calls, progress.
   */
  function foldIntoTurn(event: UiStreamEvent, extra: Partial<ChatTurn> = {}): void {
    const prevChecklist = trace.checklist;
    trace = foldTurnTrace(trace, event);
    const snapshot = trace;
    if (snapshot.checklist !== undefined && snapshot.checklist !== prevChecklist) opts.onChecklist?.(snapshot.checklist);
    applyTurnPatch(extra, snapshot);
  }

  function applyTurnPatch(extra: Partial<ChatTurn>, snapshot: TurnTraceState = trace): void {
    apply((turns) =>
      patchTurn(turns, id, (t) => ({
        ...t,
        ...extra,
        liveText: snapshot.pending.length > 0 ? snapshot.pending : undefined,
        toolCalls: [...snapshot.calls],
        reasoningSteps: projectSteps(snapshot),
        ...(snapshot.checklist !== undefined ? { checklist: snapshot.checklist } : {}),
        ...(snapshot.exitGate !== undefined ? { exitGate: snapshot.exitGate } : {}),
        ...(Object.keys(snapshot.subAgents).length > 0 ? { subAgents: projectSubAgents(snapshot.subAgents) } : {}),
        ...(snapshot.strategy !== undefined ? { strategy: snapshot.strategy } : {}),
        ...(sawIteration ? { streamProgress: { iteration: snapshot.iteration, maxIterations: snapshot.maxIterations } } : {}),
      })),
    );
  }

  function scheduleApply(extra: Partial<ChatTurn>): void {
    pendingExtra = { ...pendingExtra, ...extra };
    hasPendingApply = true;
    if (flushScheduled) return;
    flushScheduled = true;
    const run = (): void => {
      flushScheduled = false;
      flushPending();
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(run);
    else run();
  }

  function flushPending(): void {
    if (!hasPendingApply) return;
    hasPendingApply = false;
    const extra = pendingExtra;
    pendingExtra = {};
    applyTurnPatch(extra, trace);
  }

  function projectSteps(snapshot: TurnTraceState): ReasoningStep[] {
    const thoughts = visibleThoughts(snapshot);
    const split = new Map(visibleIterations(snapshot).map((v) => [v.iteration, v]));
    const iterations = new Set<number>([...stepMeta.keys(), ...Object.keys(thoughts).map(Number)]);
    return [...iterations]
      .sort((a, b) => a - b)
      .map((iteration) => {
        const meta = stepMeta.get(iteration);
        const thought = thoughts[iteration];
        const text = split.get(iteration);
        return {
          iteration,
          maxIterations: meta?.maxIterations ?? 0,
          ...(meta?.tools && meta.tools.length > 0 ? { toolsCalledThisStep: meta.tools } : {}),
          ...(thought ? { thought } : {}),
          ...(text?.narration ? { narration: text.narration } : {}),
          ...(text?.thinking ? { thinking: text.thinking } : {}),
        };
      });
  }

  /**
   * The streaming turn's live split: provider-reported halves for every call
   * that has already reported, plus a chars/4 estimate for the call still
   * streaming. Marks each estimated half individually so the UI never presents
   * a derived number as measured.
   */
  function computeLiveUsage(): LiveTokenSplit {
    const usage = trace.usage;
    const calls = usage?.calls ?? [];
    const streamed = estimateTokens(inFlightText);
    const inputReported = calls.length > 0 && calls.every((c) => c.tokensIn !== undefined);
    const outputReported = calls.length > 0 && calls.every((c) => c.tokensOut !== undefined);
    // Fill an unreported half from the reported total (marked estimated) so a
    // provider that only reports a total still drives a sensible live split.
    const reported = splitTokens(
      inputReported ? usage?.tokensIn : undefined,
      outputReported ? usage?.tokensOut : undefined,
      usage?.tokensTotal ?? 0,
    );
    const tokensIn = calls.length > 0 ? reported.tokensIn : basePromptTokens;
    const tokensOut = (calls.length > 0 ? reported.tokensOut : 0) + streamed;
    return {
      tokensIn,
      tokensOut,
      estimatedIn: calls.length === 0 ? basePromptTokens > 0 : !inputReported,
      estimatedOut: streamed > 0 || (calls.length === 0 ? true : !outputReported),
    };
  }

  /** The live context reading, marked estimated because it includes in-flight output. */
  function contextFor(used: number): ChatContext {
    const pct = Math.round((used / windowTokens) * 100);
    return {
      tokensUsed: used,
      windowTokens,
      utilizationPct: pct,
      level: contextLevel(pct),
      estimated: true,
    };
  }

  function livePatch(liveUsage: LiveTokenSplit): Pick<ChatTurn, "liveUsage" | "liveTokens"> {
    return { liveUsage, liveTokens: liveUsage.tokensIn + liveUsage.tokensOut };
  }

  function reduceEvent(event: UiStreamEvent): void {
    switch (event._tag) {
      case "TextDelta": {
        receivedContent = true;
        const obj = rs.object;
        const partial =
          obj !== undefined && obj !== null && typeof obj === "object" && Object.keys(obj as Record<string, unknown>).length > 0
            ? (obj as Record<string, unknown>)
            : undefined;
        // Cumulative text for the call in flight: estimate once over the whole
        // buffer so per-delta rounding never compounds (three 1-char deltas are
        // 1 token, not 3). Script-aware estimator keeps the pre-report number honest.
        inFlightText += event.text;
        const at = clock();
        inFlightStartedAt ??= at;
        trace = foldTurnTrace(trace, event);
        const liveUsage = computeLiveUsage();
        const liveRate = liveTokensPerSecond(estimateTokens(inFlightText), at - inFlightStartedAt);
        // Coalesce the store write into one per animation frame (TU-9).
        scheduleApply({
          ...livePatch(liveUsage),
          ...(liveRate !== undefined ? { liveRate } : {}),
          ...(hasContext && windowTokens > 0 ? { context: contextFor(contextPromptTokens + estimateTokens(inFlightText)) } : {}),
          ...(partial !== undefined ? { liveObject: partial } : {}),
        });
        return;
      }
      case "IterationProgress": {
        receivedContent = true;
        // The stream's bound is the configured one (a plan-sized raise is not carried on the stream): never read "11 / 10".
        stepMeta.set(event.iteration, { maxIterations: effectiveBound(event.maxIterations, event.iteration), tools: event.toolsCalledThisStep });
        sawIteration = true;
        flushPending();
        foldIntoTurn(event);
        return;
      }
      case "ContextPressure": {
        flushPending();
        const { tokensUsed, tokensAvailable, utilizationPct, level } = event;
        basePromptTokens = tokensUsed;
        contextPromptTokens = tokensUsed;
        windowTokens = tokensUsed + tokensAvailable;
        hasContext = true;
        // Publish an input estimate immediately so the counters appear before
        // the first text delta rather than waiting for a reported call.
        const liveUsage = (trace.usage?.calls.length ?? 0) === 0 ? computeLiveUsage() : undefined;
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            ...(liveUsage ? livePatch(liveUsage) : {}),
            context: { tokensUsed, windowTokens, utilizationPct, level },
          })),
        );
        return;
      }
      case "TokenUsage": {
        receivedContent = true;
        flushPending();
        trace = foldTurnTrace(trace, event);
        const usage = trace.usage;
        if (!usage) return;
        liveCostUsd += event.costUsd ?? 0;
        // The call that just reported consumed every delta streamed so far;
        // the next delta belongs to the next call.
        inFlightText = "";
        inFlightStartedAt = undefined;
        contextPromptTokens = typeof event.tokensIn === "number" ? event.tokensIn : contextPromptTokens;
        const liveUsage = computeLiveUsage();
        const newUsed = (typeof event.tokensIn === "number" ? event.tokensIn : basePromptTokens) + (event.tokensOut ?? 0);
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            usage,
            // The call reported: its measured speed is in `usage` now, not the estimate.
            liveRate: undefined,
            ...livePatch(liveUsage),
            ...(liveCostUsd > 0 ? { liveCost: liveCostUsd } : {}),
            ...(hasContext && windowTokens > 0 ? { context: contextFor(newUsed) } : {}),
          })),
        );
        return;
      }
      case "SubAgentActivity":
      case "ChecklistUpdated":
      case "ThoughtEmitted":
      case "ThinkingEmitted":
      case "ToolCallStarted":
      case "ToolCallCompleted": {
        receivedContent = true;
        flushPending();
        foldIntoTurn(event);
        return;
      }
      case "StreamCompleted": {
        receivedContent = true;
        flushPending();
        completed = true;
        const reported = trace.usage;
        const inputReported = reported !== undefined && reported.calls.every((c) => c.tokensIn !== undefined);
        const outputReported = reported !== undefined && reported.calls.every((c) => c.tokensOut !== undefined);
        const meta = event.metadata;
        tokensUsed = metaNumber(meta, "tokensUsed") ?? reported?.tokensTotal ?? 0;
        costUsd = metaNumber(meta, "cost") ?? metaNumber(meta, "estimatedCost") ?? 0;
        // Prefer the terminal metadata split; fall back to the per-call fold only
        // when that fold accounts for the whole terminal total (a missing final
        // call must not produce halves that do not sum to the total).
        const usageMatchesTotal = reported !== undefined && reported.tokensTotal === tokensUsed;
        streamInputTokens = metaNumber(meta, "inputTokens") ?? (usageMatchesTotal && inputReported ? reported.tokensIn : undefined);
        streamOutputTokens = metaNumber(meta, "outputTokens") ?? (usageMatchesTotal && outputReported ? reported.tokensOut : undefined);
        // "Steps" is the step count; `iterations` is now the kernel turn count (a different, smaller number).
        steps = metaNumber(meta, "stepsCount") ?? metaNumber(meta, "iterations") ?? 0;
        if (event.toolSummary && event.toolSummary.length > 0) {
          toolsUsed = event.toolSummary.map((t) => t.name);
        }
        // StreamCompleted.output is authoritative final output after verification/retries.
        const output: string | undefined = event.output;
        // Re-project thinking now the final answer is known: thoughts that merely restate it are hidden.
        trace = foldTurnTrace(trace, event);
        const finalSteps = projectSteps(trace);
        // Failed / partial / abstained runs and file-only answers: `output` is the whole
        // answer (often ""), the live text was narration (turn-ending.ts).
        const ended = completionEnding(event);
        const runNotes = runNotesOf(event);
        const outputIsFinal = ended.runFailed !== undefined || (ended.deliverables?.some((d) => d.produced) ?? false);
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            ...(t.reasoningSteps !== undefined ? { reasoningSteps: finalSteps } : {}),
            // Prefer authoritative output; fall back to the live preview text
            content: output?.trim() || outputIsFinal ? (output ?? "") : (t.liveText ?? t.content),
            liveText: undefined,
            ...(trace.strategy !== undefined ? { strategy: trace.strategy } : {}),
            // Live turn: `ts` is the send time, so it ends at ts + the run's reported duration.
            ...(trace.durationMs !== undefined ? { durationMs: trace.durationMs, finishedAt: t.ts + trace.durationMs } : {}),
            ...(Object.keys(trace.subAgents).length > 0 ? { subAgents: projectSubAgents(trace.subAgents) } : {}),
            ...(trace.structured !== undefined ? { structured: trace.structured } : {}),
            ...(ended.runFailed ? { runFailed: ended.runFailed } : {}),
            ...(ended.deliverables ? { deliverables: ended.deliverables } : {}),
            ...(runNotes ? { runNotes } : {}),
          })),
        );
        return;
      }
      case "StreamError": {
        console.error("[Chat Stream] Stream error:", event.cause);
        if (!receivedContent) preStreamFailure = event.cause ?? "Request failed";
        else streamError = event.cause ?? "Stream error";
        return;
      }
      case "StreamCancelled": {
        flushPending();
        // The ending (who stopped it, and the cause) matches what the server stores, so the
        // turn reads the same live and after a reload (B2). Only a user Stop reads as stopped.
        const runFailed = cancelledEnding(event.reason);
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            ...(runFailed.interruptedBy === "user" ? { cancelled: true } : {}),
            runFailed,
            incomplete: true,
            streaming: false,
          })),
        );
        return;
      }
      case "StructuredOutputReported": {
        // How the typed answer was obtained: kept on the turn beside the object (`StreamCompleted` brings it).
        flushPending();
        trace = foldTurnTrace(trace, event);
        const structured = trace.structured;
        if (structured !== undefined) apply((turns) => patchTurn(turns, id, (t) => ({ ...t, structured })));
        return;
      }
      default:
        return;
    }
  }
}
