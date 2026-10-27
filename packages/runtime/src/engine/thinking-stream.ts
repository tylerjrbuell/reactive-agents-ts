import type { AgentStreamEvent } from "../stream-types.js";

/**
 * Project a core-bus `ThinkingEmitted` event onto the public stream shape.
 * Returns `undefined` when the event belongs to another task or has no content.
 */
export function toThinkingStreamEvent(
  busEvent: unknown,
  taskId: string,
): AgentStreamEvent | undefined {
  const e = busEvent as {
    taskId?: unknown;
    content?: unknown;
    iteration?: unknown;
    truncated?: unknown;
  };
  if (String(e.taskId ?? "") !== taskId) return undefined;
  if (typeof e.content !== "string" || e.content.length === 0) return undefined;
  return {
    _tag: "ThinkingEmitted",
    content: e.content,
    iteration: typeof e.iteration === "number" ? e.iteration : 0,
    ...(typeof e.truncated === "boolean" ? { truncated: e.truncated } : {}),
  };
}
