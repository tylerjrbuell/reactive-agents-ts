// apps/cortex/ui/src/lib/stores/timeline-filter.ts
import type { TraceEvent } from "@reactive-agents/trace";
import type { ConvMessage } from "./trace-store.js";

export type TimelineCategory = "reasoning" | "llm" | "tool" | "control" | "aux";
export const ALL_CATEGORIES: readonly TimelineCategory[] = ["reasoning", "llm", "tool", "control", "aux"];
/** Default-visible set: everything except aux/internal noise. */
export const DEFAULT_VISIBLE = new Set<TimelineCategory>(["reasoning", "llm", "tool", "control"]);

export interface TimelineRow {
  readonly id: string;
  readonly seq: number;
  readonly ts: number;
  readonly iteration: number;        // 0 = before first ReasoningIterationProgress
  readonly category: TimelineCategory;
  readonly kind: string;             // trace kind, or reasoning-thought/-action/-observation/-final
  readonly title: string;            // collapsed one-liner
  readonly trace?: TraceEvent;       // present for non-reasoning rows
  readonly reasoning?: {
    readonly thought?: string;
    readonly action?: string;
    readonly observation?: string;
    readonly rawResponse?: string;
    readonly messages?: readonly ConvMessage[];
    readonly entropy?: number;
  };
}

const CONTROL_KINDS = new Set([
  "strategy-switched", "verifier-verdict", "guard-fired", "reactive-decision",
  "decision-evaluated", "intervention-dispatched", "intervention-suppressed",
  "curator-decision", "alternatives-considered", "harness-signal-injected",
]);

const AUX_SYSTEM_PROMPT_MARKERS = ["tool classifier", "classify", "respond with only valid json"];

/** llm-exchange calls that are harness plumbing, not the agent's real reasoning. */
export function isAux(trace: TraceEvent): boolean {
  if (trace.kind === "kernel-state-snapshot") return true;
  if (trace.kind !== "llm-exchange") return false;
  const t = trace as Extract<TraceEvent, { kind: "llm-exchange" }>;
  if (t.requestKind === "completeStructured") return true;
  const sys = (t.systemPrompt ?? "").toLowerCase();
  return AUX_SYSTEM_PROMPT_MARKERS.some((m) => sys.includes(m));
}

export function categoryOf(trace: TraceEvent): TimelineCategory {
  if (isAux(trace)) return "aux";
  if (trace.kind === "llm-exchange") return "llm";
  if (trace.kind === "tool-call-start" || trace.kind === "tool-call-end") return "tool";
  if (CONTROL_KINDS.has(trace.kind)) return "control";
  return "aux"; // run-started/-completed/entropy/etc. — not surfaced as primary rows
}

export function filterRows(rows: readonly TimelineRow[], active: ReadonlySet<TimelineCategory>): TimelineRow[] {
  return rows.filter((r) => active.has(r.category));
}

export function countByCategory(rows: readonly TimelineRow[]): Record<TimelineCategory, number> {
  const out: Record<TimelineCategory, number> = { reasoning: 0, llm: 0, tool: 0, control: 0, aux: 0 };
  for (const r of rows) out[r.category] += 1;
  return out;
}
