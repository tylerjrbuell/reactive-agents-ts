// apps/cortex/ui/src/lib/stores/timeline-store.ts
import { derived, type Readable } from "svelte/store";
import type { AgentEvent } from "@reactive-agents/core";
import { toTraceEvent } from "@reactive-agents/trace/normalize"; // browser-safe subpath — NOT the root (root pulls node:fs)
import type { RunState } from "./run-store.js";
import type { ConvMessage } from "./trace-store.js";
import { categoryOf, type TimelineRow } from "./timeline-filter.js";

export interface TimelineGroup {
  readonly iteration: number;
  readonly rows: TimelineRow[];
}

function safeMessages(raw: unknown): readonly ConvMessage[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const msgs = raw
    .filter((m): m is { role: string; content: unknown } => !!m && typeof m === "object" && typeof (m as { role?: unknown }).role === "string")
    .map((m) => ({ role: String((m as { role: string }).role), content: typeof (m as { content?: unknown }).content === "string" ? (m as { content: string }).content : JSON.stringify((m as { content: unknown }).content) }));
  return msgs.length > 0 ? msgs : undefined;
}

/** One reasoning row per populated RSC facet (thought / action / observation). */
function reasoningRows(p: Record<string, unknown>, seq: number, ts: number, iteration: number, entropy: number | undefined): TimelineRow[] {
  const out: TimelineRow[] = [];
  const thought = typeof p.thought === "string" ? p.thought.trim() : "";
  const action = typeof p.action === "string" ? p.action.trim() : "";
  const obs = typeof p.observation === "string" ? p.observation.trim() : "";
  const rawResponse = typeof p.rawResponse === "string" ? p.rawResponse.trim() : "";
  const messages = safeMessages(p.messages);
  const mk = (kind: string, title: string, extra: TimelineRow["reasoning"]): TimelineRow => ({
    id: `${seq}-${kind}`, seq, ts, iteration, category: "reasoning", kind, title, reasoning: { entropy, ...extra },
  });
  if (thought) out.push(mk("reasoning-thought", thought.slice(0, 120), { thought, rawResponse: rawResponse || undefined, messages }));
  if (action) out.push(mk("reasoning-action", action.slice(0, 120), { action }));
  if (obs) out.push(mk("reasoning-observation", obs.slice(0, 120), { observation: obs }));
  return out;
}

function traceTitle(trace: NonNullable<TimelineRow["trace"]>): string {
  switch (trace.kind) {
    case "llm-exchange": { const t = trace as { requestKind: string; model: string; response?: { tokensIn?: number; tokensOut?: number } }; return `LLM ${t.requestKind} · ${t.model} · in ${t.response?.tokensIn ?? "?"} / out ${t.response?.tokensOut ?? "?"}`; }
    case "tool-call-start": return `→ tool ${(trace as { toolName: string }).toolName}`;
    case "tool-call-end": { const t = trace as { toolName: string; ok?: boolean; durationMs?: number }; return `✓ tool ${t.toolName} ${t.ok === false ? "FAILED" : ""} ${t.durationMs ?? 0}ms`; }
    case "strategy-switched": { const t = trace as { from: string; to: string; reason: string }; return `strategy ${t.from} → ${t.to}: ${t.reason}`; }
    case "verifier-verdict": { const t = trace as { verified: boolean; summary: string }; return `verifier ${t.verified ? "✓" : "✗"} ${t.summary}`; }
    case "guard-fired": { const t = trace as { guard?: string; outcome?: string; reason?: string }; return `guard ${t.guard ?? ""} ${t.outcome ?? ""}: ${t.reason ?? ""}`; }
    default: return trace.kind;
  }
}

export function createTimelineStore(runState: Readable<RunState>): Readable<TimelineGroup[]> {
  return derived(runState, ($state): TimelineGroup[] => {
    const rows: TimelineRow[] = [];
    let iteration = 0;
    let pendingEntropy: number | undefined;
    const seenIterations = new Set<number>();
    const events = ($state.events ?? []) as readonly { type: string; payload: Record<string, unknown>; ts: number }[];

    events.forEach((msg, seq) => {
      const p = msg.payload;
      if (msg.type === "ReasoningIterationProgress") {
        iteration = typeof p.iteration === "number" ? p.iteration : iteration + 1;
        seenIterations.add(iteration);
        return;
      }
      if (msg.type === "EntropyScored") {
        if (typeof p.composite === "number") pendingEntropy = p.composite;
        return;
      }
      if (msg.type === "ReasoningStepCompleted") {
        for (const r of reasoningRows(p, seq, msg.ts, iteration, pendingEntropy)) rows.push(r);
        return;
      }
      if (msg.type === "FinalAnswerProduced") {
        const answer = typeof p.answer === "string" ? p.answer.trim() : "";
        if (answer) rows.push({ id: `${seq}-final`, seq, ts: msg.ts, iteration, category: "reasoning", kind: "final", title: answer.slice(0, 120), reasoning: { thought: answer } });
        return;
      }
      const trace = toTraceEvent({ ...p, _tag: msg.type } as unknown as AgentEvent, seq);
      if (!trace) return;
      const category = categoryOf(trace);
      const iter = (trace as { iter?: number }).iter;
      rows.push({ id: `${seq}-${trace.kind}`, seq, ts: msg.ts, iteration: typeof iter === "number" && iter > 0 ? iter : iteration, category, kind: trace.kind, title: traceTitle(trace), trace });
    });

    const byIter = new Map<number, TimelineRow[]>();
    for (const it of seenIterations) byIter.set(it, []);
    for (const r of rows) {
      const g = byIter.get(r.iteration) ?? [];
      g.push(r);
      byIter.set(r.iteration, g);
    }
    return [...byIter.entries()].sort((a, b) => a[0] - b[0]).map(([iteration, rows]) => ({ iteration, rows }));
  });
}

export type TimelineStore = ReturnType<typeof createTimelineStore>;
