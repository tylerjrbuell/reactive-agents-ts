/**
 * Pure rules for the run inspector's Events tab (`RawEventLog.svelte`): the
 * event-type chips and the one-line preview of each event.
 *
 * B8 (spec section 3.3): the chips were labelled with the last word of the
 * type, so `ToolCallStarted` and `LLMRequestStarted` both read "Started" and
 * two `*Emitted` types both read "Emitted 4". A chip now carries the whole
 * type in sentence case, so every label is unique.
 */

/** A run event as the log holds it. */
export interface LogEvent {
  readonly type: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

/** One type chip: the event type, its label and its count. */
export interface EventTypeChip {
  readonly type: string;
  readonly label: string;
  readonly count: number;
}

/**
 * `ToolCallStarted` → `Tool call started`, `LLMRequestCompleted` →
 * `LLM request completed`: the whole type in sentence case, acronyms kept.
 */
export function eventTypeLabel(type: string): string {
  const words = type
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean);
  return words
    .map((w, i) => {
      if (w.length > 1 && w === w.toUpperCase()) return w;
      return i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase();
    })
    .join(" ");
}

/** The `limit` most frequent event types (ties by name), each with a unique label. */
export function eventTypeChips(events: readonly LogEvent[], limit = 6): readonly EventTypeChip[] {
  const counts = new Map<string, number>();
  for (const e of events) counts.set(e.type, (counts.get(e.type) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([type, count]) => ({ type, label: eventTypeLabel(type), count }));
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
const oneLine = (s: string, n: number): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function tokensOf(p: Readonly<Record<string, unknown>>): number | undefined {
  const raw = p.tokensUsed;
  if (typeof raw === "number") return raw;
  if (raw && typeof raw === "object") return num((raw as { total?: unknown }).total);
  return undefined;
}

/** Keys that are bookkeeping in nearly every event; the generic preview skips them. */
const NOISE = new Set(["_tag", "taskId", "agentId", "runId", "rootRunId", "parentRunId", "timestamp", "ts", "depth"]);

/**
 * A readable one-line summary of an event, never raw JSON for the common
 * types; other types list their first few scalar fields (`key value`).
 */
export function eventPreview(e: LogEvent): string {
  const p = e.payload;
  switch (e.type) {
    case "AgentStarted":
      return [str(p.provider), str(p.model)].filter(Boolean).join(" / ") + (str(p.task) ? ` · ${oneLine(str(p.task)!, 70)}` : "");
    case "LLMRequestCompleted":
      return [tokensOf(p) !== undefined ? `${tokensOf(p)} tok` : undefined, num(p.durationMs) !== undefined ? `${num(p.durationMs)} ms` : undefined, str(p.model)]
        .filter(Boolean)
        .join(" · ");
    case "ToolCallStarted":
      return str(p.toolName) ?? "";
    case "ToolCallCompleted":
      return `${str(p.toolName) ?? "tool"} ${p.success === false ? "failed" : "ok"}${num(p.durationMs) !== undefined ? ` · ${num(p.durationMs)} ms` : ""}`;
    case "EntropyScored": {
      const shape = p.trajectory && typeof p.trajectory === "object" ? str((p.trajectory as { shape?: unknown }).shape) : undefined;
      const c = num(p.composite);
      return `η ${c !== undefined ? c.toFixed(3) : "?"}${shape ? ` · ${shape}` : ""}`;
    }
    case "ReasoningIterationProgress": {
      const tools = Array.isArray(p.toolsThisStep) ? p.toolsThisStep.filter((t): t is string => typeof t === "string") : [];
      const max = num(p.maxIterations);
      return `Loop ${num(p.iteration) ?? "?"}${max ? ` of ${max}` : ""}${tools.length ? ` · ${tools.join(", ")}` : ""}`;
    }
    case "FinalAnswerProduced":
      return oneLine(str(p.answer) ?? "", 90);
    case "ReactiveDecision":
      return [str(p.decision), str(p.reason)].filter(Boolean).join(" · ");
    case "AgentCompleted":
      return `${p.success === false ? "failed" : "succeeded"}${num(p.totalTokens) !== undefined ? ` · ${num(p.totalTokens)} tok` : ""}${num(p.durationMs) !== undefined ? ` · ${num(p.durationMs)} ms` : ""}`;
    case "TaskFailed":
      return oneLine(str(p.error) ?? str(p.reason) ?? "", 90);
    default: {
      const parts: string[] = [];
      for (const [k, v] of Object.entries(p)) {
        if (NOISE.has(k)) continue;
        if (typeof v === "string" && v.trim()) parts.push(`${k} ${oneLine(v, 40)}`);
        else if (typeof v === "number") parts.push(`${k} ${Number.isInteger(v) ? v : Math.round(v * 100) / 100}`);
        else if (typeof v === "boolean") parts.push(`${k} ${String(v)}`);
        if (parts.length === 3) break;
      }
      return parts.join(" · ");
    }
  }
}
