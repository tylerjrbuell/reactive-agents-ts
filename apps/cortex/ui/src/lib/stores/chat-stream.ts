import {
  connectRunStream,
  reduceRunState,
  initialRunState,
  type RunState,
  type UiStreamEvent,
} from "@reactive-agents/ui-core";
import type { ChatTurn, ReasoningStep } from "./chat-store.js";

/**
 * Single SSE → ChatTurn reduction shared by the desk Chat store and the run-view
 * Chat tab, so both render tool chips / live preview / cancellation identically.
 */

/** Merge a re-emitted thought into the accumulated one without duplicating it. */
export function mergeThoughtText(previous: string | undefined, incoming: string): string {
  const prev = (previous ?? "").trim();
  const next = incoming.trim();

  if (!prev) return next;
  if (!next) return prev;
  if (next.startsWith(prev) || prev === next) return next;
  if (prev.endsWith(next)) return prev;

  return `${prev}\n${next}`;
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
  let rs: RunState = initialRunState();
  // `connectRunStream` synthesizes a StreamError for BOTH a pre-stream connection
  // failure and a genuine mid-stream drop; `receivedContent` tells them apart.
  let receivedContent = false;
  let preStreamFailure: string | undefined;
  let streamError: string | undefined;

  for await (const event of connectRunStream({ endpoint: opts.endpoint, body: opts.body, signal: opts.signal })) {
    if (opts.structuredOutput) rs = reduceRunState(rs, event, { objectMode: true });
    reduceEvent(event);
  }

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
      liveTokens: undefined,
      liveCost: undefined,
      ...(costUsd > 0 ? { costUsd } : {}),
      ...(steps > 0 ? { steps } : {}),
      ...(toolsUsed.length > 0 ? { toolsUsed } : {}),
    })),
  );
  return { tokensUsed, costUsd, steps, toolsUsed, ...(streamError !== undefined ? { streamError } : {}) };

  function reduceEvent(event: UiStreamEvent): void {
    switch (event._tag) {
      case "TextDelta": {
        receivedContent = true;
        const obj = rs.object;
        const partial =
          obj !== undefined && obj !== null && typeof obj === "object" && Object.keys(obj as Record<string, unknown>).length > 0
            ? (obj as Record<string, unknown>)
            : undefined;
        // All deltas land in liveText — the visible answer preview. The final
        // iteration's deltas are the final answer; earlier iterations' text gets
        // folded into its step when superseded.
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            liveText: appendThoughtDelta(t.liveText, event.text),
            ...(partial !== undefined ? { liveObject: partial } : {}),
          })),
        );
        return;
      }
      case "IterationProgress": {
        receivedContent = true;
        const iter = event.iteration;
        const max = event.maxIterations;
        const tools = event.toolsCalledThisStep;
        const step: ReasoningStep = {
          iteration: iter,
          maxIterations: max,
          ...(tools && tools.length > 0 ? { toolsCalledThisStep: tools } : {}),
        };
        apply((turns) =>
          patchTurn(turns, id, (t) => {
            const existing = t.reasoningSteps ?? [];
            const idx = existing.findIndex((r) => r.iteration === iter);
            let nextSteps =
              idx >= 0
                ? existing.map((r, i) =>
                    i === idx
                      ? { ...step, ...(r.thought && r.thought.trim().length > 0 ? { thought: r.thought } : {}) }
                      : r,
                  )
                : [...existing, step];

            // New iteration started: the previous iteration's liveText was
            // reasoning, not the final answer — fold it into that step.
            const prevIter = t.streamProgress?.iteration;
            let liveText = t.liveText;
            if (prevIter != null && iter > prevIter && liveText && liveText.trim().length > 0) {
              const folded = liveText;
              const pIdx = nextSteps.findIndex((r) => r.iteration === prevIter);
              nextSteps =
                pIdx >= 0
                  ? nextSteps.map((r, i) => (i === pIdx ? { ...r, thought: mergeThoughtText(r.thought, folded) } : r))
                  : [{ iteration: prevIter, maxIterations: max, thought: folded }, ...nextSteps];
              liveText = undefined;
            }

            return {
              ...t,
              streamProgress: { iteration: iter, maxIterations: max },
              reasoningSteps: nextSteps,
              liveText,
            };
          }),
        );
        return;
      }
      case "ThoughtEmitted": {
        receivedContent = true;
        const iter = event.iteration;
        const thought = event.content;
        apply((turns) =>
          patchTurn(turns, id, (t) => {
            const existing = t.reasoningSteps ?? [];
            const idx = existing.findIndex((r) => r.iteration === iter);
            if (idx >= 0) {
              const prev = existing[idx]!;
              const next: ReasoningStep = { ...prev, thought: mergeThoughtText(prev.thought, thought) };
              return { ...t, reasoningSteps: existing.map((r, i) => (i === idx ? next : r)) };
            }
            return { ...t, reasoningSteps: [...existing, { iteration: iter, maxIterations: 0, thought }] };
          }),
        );
        return;
      }
      case "StreamCompleted": {
        receivedContent = true;
        tokensUsed = (event.metadata?.tokensUsed as number) ?? 0;
        costUsd =
          (event.metadata?.cost as number | undefined) ??
          (event.metadata?.estimatedCost as number | undefined) ??
          0;
        steps =
          (event.metadata?.iterations as number | undefined) ??
          (event.metadata?.stepsCount as number | undefined) ??
          0;
        if (event.toolSummary && event.toolSummary.length > 0) {
          toolsUsed = event.toolSummary.map((t) => t.name);
        }
        // StreamCompleted.output is authoritative final output after verification/retries.
        const output: string | undefined = event.output;
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            // Prefer authoritative output; fall back to the live preview text
            content: output?.trim() ? output : (t.liveText ?? t.content),
            liveText: undefined,
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
      case "ToolCallStarted": {
        receivedContent = true;
        const ev = event as { callId?: string; id?: string; name?: string; toolName?: string };
        const callId = ev.callId ?? ev.id ?? `call-${Date.now()}`;
        const name = ev.name ?? ev.toolName ?? "tool";
        apply((turns) =>
          patchTurn(turns, id, (t) => {
            const existing = t.toolCalls ?? [];
            if (existing.some((c) => c.id === callId)) return t;
            return { ...t, toolCalls: [...existing, { id: callId, name, status: "running" }] };
          }),
        );
        return;
      }
      case "ToolCallCompleted": {
        receivedContent = true;
        const ev = event as { callId?: string; id?: string; name?: string; toolName?: string; error?: unknown; result?: { error?: unknown } };
        const callId = ev.callId ?? ev.id;
        const failed = ev.error != null || ev.result?.error != null;
        apply((turns) =>
          patchTurn(turns, id, (t) => {
            const existing = t.toolCalls ?? [];
            const next = existing.map((c) =>
              c.id === callId ? { ...c, status: (failed ? "failed" : "done") as "failed" | "done" } : c,
            );
            // If we never saw a Started event, append a completed entry.
            if (callId && !existing.some((c) => c.id === callId)) {
              next.push({ id: callId, name: ev.name ?? ev.toolName ?? "tool", status: failed ? "failed" : "done" });
            }
            return { ...t, toolCalls: next };
          }),
        );
        return;
      }
      case "StreamCancelled": {
        apply((turns) => patchTurn(turns, id, (t) => ({ ...t, cancelled: true, streaming: false })));
        return;
      }
      default:
        return;
    }
  }
}
