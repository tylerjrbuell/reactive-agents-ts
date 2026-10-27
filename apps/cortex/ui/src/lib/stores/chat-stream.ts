import {
  connectRunStream,
  reduceRunState,
  initialRunState,
  foldTurnTrace,
  visibleThoughts,
  initialTurnTrace,
  mergeThoughtText,
  type RunState,
  type TurnTraceState,
  type UiStreamEvent,
} from "@reactive-agents/ui-core";
import type { ChatTurn, ReasoningStep } from "./chat-store.js";

/**
 * Single SSE → ChatTurn reduction shared by the desk Chat store and the run-view
 * Chat tab, so both render tool chips / live preview / cancellation identically.
 */

export { mergeThoughtText };

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
  let trace: TurnTraceState = initialTurnTrace();
  const stepMeta = new Map<number, { maxIterations: number; tools?: readonly string[] }>();
  let sawIteration = false;
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

  /**
   * Fold an event into the shared turn trace (ui-core — the same fold the server
   * persists with) and project it onto the assistant turn: live answer preview,
   * per-iteration thinking, tool calls, progress.
   */
  function foldIntoTurn(event: UiStreamEvent, extra: Partial<ChatTurn> = {}): void {
    trace = foldTurnTrace(trace, event);
    const snapshot = trace;
    apply((turns) =>
      patchTurn(turns, id, (t) => ({
        ...t,
        ...extra,
        liveText: snapshot.pending.length > 0 ? snapshot.pending : undefined,
        toolCalls: [...snapshot.calls],
        reasoningSteps: projectSteps(snapshot),
        ...(sawIteration ? { streamProgress: { iteration: snapshot.iteration, maxIterations: snapshot.maxIterations } } : {}),
      })),
    );
  }

  function projectSteps(snapshot: TurnTraceState): ReasoningStep[] {
    const thoughts = visibleThoughts(snapshot);
    const iterations = new Set<number>([...stepMeta.keys(), ...Object.keys(thoughts).map(Number)]);
    return [...iterations]
      .sort((a, b) => a - b)
      .map((iteration) => {
        const meta = stepMeta.get(iteration);
        const thought = thoughts[iteration];
        return {
          iteration,
          maxIterations: meta?.maxIterations ?? 0,
          ...(meta?.tools && meta.tools.length > 0 ? { toolsCalledThisStep: meta.tools } : {}),
          ...(thought ? { thought } : {}),
        };
      });
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
        foldIntoTurn(event, partial !== undefined ? { liveObject: partial } : {});
        return;
      }
      case "IterationProgress": {
        receivedContent = true;
        stepMeta.set(event.iteration, { maxIterations: event.maxIterations, tools: event.toolsCalledThisStep });
        sawIteration = true;
        foldIntoTurn(event);
        return;
      }
      case "ThoughtEmitted":
      case "ThinkingEmitted":
      case "ToolCallStarted":
      case "ToolCallCompleted": {
        receivedContent = true;
        foldIntoTurn(event);
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
        // Re-project thinking now the final answer is known: thoughts that merely restate it are hidden.
        trace = foldTurnTrace(trace, event);
        const finalSteps = projectSteps(trace);
        apply((turns) =>
          patchTurn(turns, id, (t) => ({
            ...t,
            ...(t.reasoningSteps !== undefined ? { reasoningSteps: finalSteps } : {}),
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
      case "StreamCancelled": {
        apply((turns) => patchTurn(turns, id, (t) => ({ ...t, cancelled: true, streaming: false })));
        return;
      }
      default:
        return;
    }
  }
}
