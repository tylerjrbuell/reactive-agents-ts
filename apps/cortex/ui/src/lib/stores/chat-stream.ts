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
  type ChecklistSnapshotWire,
  type RunState,
  type TurnTraceState,
  type UiStreamEvent,
} from "@reactive-agents/ui-core";
import type { ChatContext, ChatTurn, LiveTokenSplit, ReasoningStep } from "./chat-store.js";
import { projectSubAgents } from "../sub-agent-view.js";
import { completionEnding } from "../turn-ending.js";

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
  readonly body: Record<string, unknown>;
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

  for await (const event of connectRunStream({ endpoint: opts.endpoint, body: opts.body, signal: opts.signal })) {
    if (opts.structuredOutput) rs = reduceRunState(rs, event, { objectMode: true });
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
      // reasoningSteps intentionally kept for post-stream inspection
      // Safety net: stream ended without StreamCompleted output
      content: t.content || (t.liveText ?? ""),
      liveText: undefined,
      tokensUsed,
      liveTokens: completed ? undefined : t.liveTokens,
      liveUsage: completed ? undefined : t.liveUsage,
      liveCost: completed ? undefined : t.liveCost,
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
        trace = foldTurnTrace(trace, event);
        const liveUsage = computeLiveUsage();
        // Coalesce the store write into one per animation frame (TU-9).
        scheduleApply({
          ...livePatch(liveUsage),
          ...(hasContext && windowTokens > 0 ? { context: contextFor(contextPromptTokens + estimateTokens(inFlightText)) } : {}),
          ...(partial !== undefined ? { liveObject: partial } : {}),
        });
        return;
      }
      case "IterationProgress": {
        receivedContent = true;
        stepMeta.set(event.iteration, { maxIterations: event.maxIterations, tools: event.toolsCalledThisStep });
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
        contextPromptTokens = typeof event.tokensIn === "number" ? event.tokensIn : contextPromptTokens;
        const liveUsage = computeLiveUsage();
        const newUsed = (typeof event.tokensIn === "number" ? event.tokensIn : basePromptTokens) + (event.tokensOut ?? 0);
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            usage,
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
        steps = metaNumber(meta, "iterations") ?? metaNumber(meta, "stepsCount") ?? 0;
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
            ...(ended.runFailed ? { runFailed: ended.runFailed } : {}),
            ...(ended.deliverables ? { deliverables: ended.deliverables } : {}),
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
        apply((turns) => patchTurn(turns, id, (t) => ({ ...t, cancelled: true, incomplete: true, streaming: false })));
        return;
      }
      default:
        return;
    }
  }
}
