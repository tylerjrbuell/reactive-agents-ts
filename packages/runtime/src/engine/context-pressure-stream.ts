import type { AgentStreamEvent } from "../stream-types.js";

const LEVELS = ["low", "medium", "high", "critical"] as const;
type Level = (typeof LEVELS)[number];

/**
 * Project a core-bus `ContextPressure` event onto the public stream shape.
 * Returns `undefined` for another task or a malformed payload. The core event
 * is only published with a real provider-resolved window, so no window is invented here.
 */
export function toContextPressureStreamEvent(
  busEvent: unknown,
  taskId: string,
): AgentStreamEvent | undefined {
  const e = busEvent as {
    taskId?: unknown;
    tokensUsed?: unknown;
    tokensAvailable?: unknown;
    utilizationPct?: unknown;
    level?: unknown;
    iteration?: unknown;
  };
  if (String(e.taskId ?? "") !== taskId) return undefined;
  if (
    typeof e.tokensUsed !== "number" ||
    typeof e.tokensAvailable !== "number" ||
    typeof e.utilizationPct !== "number" ||
    !LEVELS.includes(e.level as Level)
  ) {
    return undefined;
  }
  return {
    _tag: "ContextPressure",
    tokensUsed: e.tokensUsed,
    tokensAvailable: e.tokensAvailable,
    utilizationPct: e.utilizationPct,
    level: e.level as Level,
    ...(typeof e.iteration === "number" ? { iteration: e.iteration } : {}),
  };
}
