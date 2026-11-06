/**
 * Chat run-trace + export helpers (pure; no DOM). Turns the framework tracer's
 * JSONL (one TraceEvent per line, sub-agents sharing `rootRunId`) into the frame
 * shape the existing TracePanel / TraceFrameCard already render, and builds the
 * export URLs/filenames the drawer and `/export` use.
 */
import type { TraceEvent } from "@reactive-agents/trace";
import type { CortexTraceFrame } from "./stores/trace-store.js";
import { categoryOf, type TimelineRow } from "./stores/timeline-filter.js";
import { traceTitle, type TimelineGroup } from "./stores/timeline-store.js";

export type ExportFormat = "md" | "json" | "jsonl";

/** One run in a delegation tree, with its frames and nested sub-agent runs. */
export interface RunTraceView {
  readonly runId: string;
  readonly parentRunId?: string;
  readonly depth: number;
  /** The run's task text (sub-agents: what they were asked), else the run id. */
  readonly name: string;
  readonly status: "running" | "done" | "failed";
  readonly frames: CortexTraceFrame[];
  /** The same run as TracePanel's Timeline tab rows (one group per kernel iteration). */
  readonly timeline: TimelineGroup[];
  readonly children: RunTraceView[];
}

type Ev = Record<string, unknown> & { kind?: string; runId?: string; iter?: number; timestamp?: number };

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string => (typeof v === "string" ? v : "");
const show = (v: unknown): string => (typeof v === "string" ? v : v === undefined ? "" : JSON.stringify(v));

function parse(text: string): Ev[] {
  const out: Ev[] = [];
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const v: unknown = JSON.parse(line);
      if (v && typeof v === "object" && typeof (v as Ev).runId === "string") out.push(v as Ev);
    } catch {
      /* a corrupt line never hides the rest of the trace */
    }
  }
  return out;
}

function framesOf(events: readonly Ev[]): CortexTraceFrame[] {
  const byIter = new Map<number, Ev[]>();
  for (const e of events) {
    const it = typeof e.iter === "number" ? e.iter : -1;
    if (it < 0) continue;
    (byIter.get(it) ?? byIter.set(it, []).get(it)!).push(e);
  }
  const frames: CortexTraceFrame[] = [];
  for (const [iteration, evs] of [...byIter].sort((a, b) => a[0] - b[0])) {
    const llm = evs.filter((e) => e.kind === "llm-exchange");
    const starts = evs.filter((e) => e.kind === "tool-call-start");
    const ends = evs.filter((e) => e.kind === "tool-call-end");
    if (llm.length === 0 && starts.length === 0) continue;
    const first = llm[0] as { response?: Record<string, unknown>; messages?: Array<{ role: string; content: string }>; model?: string; provider?: string } | undefined;
    const tools = starts.map((s) => str(s.toolName));
    const toolEnd = ends[0];
    const content = llm.map((e) => str((e.response as Record<string, unknown> | undefined)?.content)).filter(Boolean).join("\n\n");
    const thinking = str(first?.response?.thinkingPreview);
    const entropy = evs.find((e) => e.kind === "entropy-scored")?.composite;
    frames.push({
      iteration,
      thought: tools.length > 0 ? tools.join(", ") : "(reasoning)",
      ...(content || thinking ? { llmThought: content || thinking } : {}),
      ...(content ? { rawResponse: content } : {}),
      ...(first?.messages && first.messages.length > 0 ? { messages: first.messages.map((m) => ({ role: m.role, content: m.content })) } : {}),
      ...(starts[0] ? { action: `${str(starts[0].toolName)}(${show(starts[0].args)})`, toolName: str(starts[0].toolName), toolArgs: starts[0].args } : {}),
      ...(toolEnd ? { observation: toolEnd.error ? `error: ${str(toolEnd.error)}` : show(toolEnd.result) } : {}),
      ...(typeof entropy === "number" ? { entropy } : {}),
      tokensUsed: llm.reduce((n, e) => n + num((e.response as Record<string, unknown> | undefined)?.tokensIn) + num((e.response as Record<string, unknown> | undefined)?.tokensOut), 0),
      durationMs: llm.reduce((n, e) => n + num((e.response as Record<string, unknown> | undefined)?.durationMs), 0),
      ts: num(evs[0]?.timestamp),
      kind: "step",
      ...(tools.length > 0 ? { toolsThisStep: tools } : {}),
      ...(first?.model ? { model: first.model } : {}),
      ...(first?.provider ? { provider: first.provider } : {}),
      estimatedCost: llm.reduce((n, e) => n + num((e.response as Record<string, unknown> | undefined)?.costUsd), 0),
    });
  }
  return frames;
}

/**
 * Timeline rows for one run's tracer events. The run view builds its timeline from
 * live AgentEvents; a chat turn only has the tracer JSONL, whose lines are already
 * TraceEvents, so each becomes a row directly (categorised by the same `categoryOf`).
 * The tracer records no ReasoningStepCompleted, so the model's text from each real
 * (non-aux) LLM exchange stands in as the reasoning row, and run-completed's output is
 * the final row.
 */
function timelineOf(events: readonly Ev[]): TimelineGroup[] {
  const rows: TimelineRow[] = [];
  // Run-level events carry iter -1: run-started opens iteration 0, run-completed closes the last one.
  const lastIter = events.reduce((m, e) => (typeof e.iter === "number" && e.iter > m ? e.iter : m), 0);
  events.forEach((e, seq) => {
    if (typeof e.kind !== "string") return;
    const trace = e as unknown as TraceEvent;
    const ts = num(e.timestamp);
    const iteration = e.kind === "run-completed" ? lastIter : typeof e.iter === "number" && e.iter > 0 ? e.iter : 0;
    if (e.kind === "run-completed") {
      const out = str(e.output) || (e.error ? `Failed: ${str(e.error)}` : "");
      if (out) rows.push({ id: `${seq}-final`, seq, ts, iteration, category: "reasoning", kind: "final", title: out.slice(0, 120), reasoning: { thought: out } });
      return;
    }
    const category = categoryOf(trace);
    if (e.kind === "llm-exchange" && category === "llm") {
      const resp = (e.response ?? {}) as Record<string, unknown>;
      const thought = (str(resp.content) || str(resp.thinkingPreview)).trim();
      if (thought) rows.push({ id: `${seq}-reasoning-thought`, seq, ts, iteration, category: "reasoning", kind: "reasoning-thought", title: thought.slice(0, 120), reasoning: { thought, rawResponse: str(resp.content) || undefined } });
    }
    rows.push({ id: `${seq}-${e.kind}`, seq, ts, iteration, category, kind: e.kind, title: traceTitle(trace), trace });
  });
  const byIter = new Map<number, TimelineRow[]>();
  for (const r of rows) (byIter.get(r.iteration) ?? byIter.set(r.iteration, []).get(r.iteration)!).push(r);
  return [...byIter].sort((a, b) => a[0] - b[0]).map(([iteration, rs]) => ({ iteration, rows: rs }));
}

/**
 * Group tracer JSONL by run and nest sub-agent runs under their parent. Roots come first
 * in file order; children keep start order. Corrupt lines are skipped.
 */
export function buildRunTrees(jsonl: string): RunTraceView[] {
  const events = parse(jsonl);
  const order: string[] = [];
  const byRun = new Map<string, Ev[]>();
  for (const e of events) {
    const id = e.runId!;
    if (!byRun.has(id)) {
      byRun.set(id, []);
      order.push(id);
    }
    byRun.get(id)!.push(e);
  }
  const views = new Map<string, { view: RunTraceView; parent?: string }>();
  for (const id of order) {
    const evs = byRun.get(id)!;
    const started = evs.find((e) => e.kind === "run-started");
    const done = evs.find((e) => e.kind === "run-completed");
    const frames = framesOf(evs);
    if (done) {
      const out = str(done.output) || (done.error ? `Failed: ${str(done.error)}` : "");
      frames.push({
        iteration: (frames.at(-1)?.iteration ?? -1) + 1,
        thought: out,
        tokensUsed: num(done.totalTokens),
        durationMs: num(done.durationMs),
        ts: num(done.timestamp),
        kind: "final",
        estimatedCost: num(done.totalCostUsd),
      });
    }
    const parentRunId = str(started?.parentRunId) || str(evs.find((e) => typeof e.parentRunId === "string")?.parentRunId) || undefined;
    views.set(id, {
      parent: parentRunId,
      view: {
        runId: id,
        ...(parentRunId ? { parentRunId } : {}),
        depth: num(started?.depth ?? evs[0]?.depth),
        name: str(started?.task) || id,
        status: !done ? "running" : done.status === "success" ? "done" : "failed",
        frames,
        timeline: timelineOf(evs),
        children: [],
      },
    });
  }
  const roots: RunTraceView[] = [];
  for (const id of order) {
    const { view, parent } = views.get(id)!;
    const p = parent ? views.get(parent) : undefined;
    if (p) p.view.children.push(view);
    else roots.push(view);
  }
  return roots;
}

/** `my-chat.md`: a safe slug, matching the server's `content-disposition`. */
export function exportFilename(name: string, ext: ExportFormat): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/g, "");
  return `${slug || "chat"}.${ext}`;
}

export function exportUrl(base: string, sessionId: string, format: ExportFormat): string {
  return `${base}/api/chat/sessions/${encodeURIComponent(sessionId)}/export?format=${format}`;
}

/** The conversation as `**You**: …` / `**Assistant**: …` paragraphs (the "copy all" text). */
export function transcriptText(turns: readonly { readonly role: string; readonly content: string }[]): string {
  return turns.map((t) => `**${t.role === "user" ? "You" : "Assistant"}**: ${t.content}`).join("\n\n");
}

/** A fetched export, ready to save; `ok: false` when the request failed. */
export type FetchedExport = { readonly ok: true; readonly text: string; readonly filename: string; readonly mime: string } | { readonly ok: false };

/** Fetch a session export; the filename comes from the server's `content-disposition`. Never throws. */
export async function fetchExport(
  base: string,
  sessionId: string,
  format: ExportFormat,
  fetchFn: (url: string) => Promise<Response> = (url) => fetch(url),
): Promise<FetchedExport> {
  try {
    const res = await fetchFn(exportUrl(base, sessionId, format));
    if (!res.ok) return { ok: false };
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? exportFilename("chat", format);
    return { ok: true, text: await res.text(), filename, mime: res.headers.get("content-type") ?? "text/plain" };
  } catch {
    return { ok: false };
  }
}

/** In-app link to a run's detail page (`/run/[runId]`). */
export function runViewHref(runId: string): string {
  return `/run/${encodeURIComponent(runId)}`;
}

export function traceUrl(base: string, sessionId: string, turnId: number): string {
  return `${base}/api/chat/sessions/${encodeURIComponent(sessionId)}/turns/${turnId}/trace`;
}
