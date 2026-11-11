/**
 * The tool calls a run has started and not yet finished, from its ingested
 * events: `ToolCallStarted` (with the arguments core puts on it, post-heal) not
 * yet matched by a `ToolCallCompleted` of the same call id. The run view shows
 * them so a long-running call says what it was called with before it completes.
 * Pure.
 */

/** One ingested event, as the run store holds it. */
export interface ToolEventLike {
  readonly ts: number;
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** A call still running. */
export interface LiveToolCall {
  readonly callId: string;
  readonly toolName: string;
  /** Present when the started event carried arguments. */
  readonly args?: unknown;
  /** When the call started (event time, ms). */
  readonly startedAt: number;
}

/** Calls started and not completed, oldest first. Calls without a call id are skipped (they cannot be matched). */
export function liveToolCalls(events: readonly ToolEventLike[]): readonly LiveToolCall[] {
  const open = new Map<string, LiveToolCall>();
  for (const e of events) {
    const callId = typeof e.payload.callId === "string" && e.payload.callId !== "" ? e.payload.callId : undefined;
    if (callId === undefined) continue;
    if (e.type === "ToolCallStarted") {
      const toolName = typeof e.payload.toolName === "string" ? e.payload.toolName : "tool";
      open.set(callId, {
        callId,
        toolName,
        ...(e.payload.args !== undefined ? { args: e.payload.args } : {}),
        startedAt: e.ts,
      });
    } else if (e.type === "ToolCallCompleted") {
      open.delete(callId);
    }
  }
  return [...open.values()];
}
