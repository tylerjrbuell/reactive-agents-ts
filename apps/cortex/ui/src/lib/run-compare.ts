/**
 * Run compare: the client and the display rules over `GET /api/runs/compare`
 * (server `services/run-compare.ts`: summary + config difference, and the
 * framework replay `diffTraces` step diff when both runs recorded a trace).
 * Pure apart from `fetchRunCompare`.
 */
import { formatTokensPerSecond } from "@reactive-agents/ui-core";
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { runNameOf, type RunRow } from "$lib/runs-table.js";

/** Output speed of one run (Model page rule: exact rates only, else lower bound). */
export interface CompareSpeed {
  readonly tokensPerSecond?: { readonly median: number; readonly lowerBound: boolean; readonly calls: number };
  readonly firstTokenMs?: { readonly median: number; readonly calls: number };
}

/** One side: the stored run row plus what Cortex measured. */
export interface CompareSide {
  readonly run: RunRow;
  readonly durationMs?: number;
  readonly speed: CompareSpeed;
  readonly hasTrace: boolean;
}

/** One differing config path; values are compact JSON, absent = not set. */
export interface ConfigDiffRow {
  readonly path: string;
  readonly a?: string;
  readonly b?: string;
}

/** The resolved-config difference (`AgentStarted.config`). */
export interface CompareConfig {
  readonly a: boolean;
  readonly b: boolean;
  readonly differs: readonly ConfigDiffRow[];
  readonly sameCount: number;
  readonly truncated: boolean;
}

/** One tool call in a step row; `loop` is 1-based. */
export interface StepCall {
  readonly toolName: string;
  readonly argsHash: string;
  readonly ok: boolean;
  readonly loop: number | null;
  readonly args: string;
}

/** Position `index` of both tool-call sequences. */
export interface CompareStep {
  readonly index: number;
  readonly a?: StepCall;
  readonly b?: StepCall;
  readonly same: boolean;
}

/** One loop on both runs: indexes into `steps`. */
export interface CompareLoop {
  readonly loop: number;
  readonly a: readonly number[];
  readonly b: readonly number[];
  readonly same: boolean;
}

/** Trace-level figures for one side. */
export interface TraceSideStats {
  readonly task: string;
  readonly model: string;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly durationMs: number;
}

/** Framework `ReplayDiff` (`outputDiff.original` = run A, `replay` = run B). */
export interface ReplayDiff {
  readonly identical: boolean;
  readonly iterationsDelta: number;
  readonly toolSequenceDiff: readonly unknown[];
  readonly outputDiff: { readonly original?: string; readonly replay?: string; readonly equal: boolean };
  readonly tokensDelta: number;
  readonly costDelta: number;
  readonly durationDeltaMs: number;
}

/** The trace comparison, or which runs had no readable trace. */
export type CompareTrace =
  | { readonly available: false; readonly missing: readonly ("a" | "b")[] }
  | {
      readonly available: true;
      readonly diff: ReplayDiff;
      readonly a: TraceSideStats;
      readonly b: TraceSideStats;
      readonly steps: readonly CompareStep[];
      readonly loops: readonly CompareLoop[];
      readonly firstDivergence: { readonly step: number; readonly loopA: number | null; readonly loopB: number | null } | null;
    };

/** Wire shape of `GET /api/runs/compare?a=&b=`. */
export interface RunCompareReport {
  readonly a: CompareSide;
  readonly b: CompareSide;
  readonly config: CompareConfig;
  readonly trace: CompareTrace;
}

/** URL of the compare page for two runs. */
export function compareHref(a: string, b: string): string {
  return `/runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`;
}

/** Fetch a comparison; throws with the server's message on an error status. */
export async function fetchRunCompare(
  a: string,
  b: string,
  fetchImpl: (url: string) => Promise<Response> = (u) => fetch(u),
): Promise<RunCompareReport> {
  const res = await fetchImpl(`${CORTEX_SERVER_URL}/api/runs/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`);
  if (!res.ok) {
    let msg = `Server returned ${res.status}`;
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string") msg = body.error;
    } catch {
      /* keep the status */
    }
    throw new Error(msg);
  }
  return (await res.json()) as RunCompareReport;
}

/** The two selected run ids in selection order when exactly two are selected, else `null`. */
export function comparePair(selected: ReadonlySet<string>): readonly [string, string] | null {
  if (selected.size !== 2) return null;
  const [a, b] = [...selected];
  return a !== undefined && b !== undefined ? [a, b] : null;
}

/**
 * Runs offered by the run header's "Compare with…" picker: every other run
 * that is not live, the ones with the same name first (likely the same task),
 * then newest first; `query` filters by name, model or id.
 */
export function compareCandidates(runs: readonly RunRow[], runId: string, query = "", limit = 30): RunRow[] {
  const q = query.trim().toLowerCase();
  const current = runs.find((r) => r.runId === runId);
  const name = current ? runNameOf(current) : "";
  return runs
    .filter((r) => r.runId !== runId && r.status !== "live")
    .filter((r) => !q || `${runNameOf(r)} ${r.model ?? ""} ${r.runId}`.toLowerCase().includes(q))
    .sort((x, y) => {
      const sx = runNameOf(x) === name ? 0 : 1;
      const sy = runNameOf(y) === name ? 0 : 1;
      return sx - sy || y.startedAt - x.startedAt;
    })
    .slice(0, limit);
}

/** A row of the trace section: one loop, or a span of loops that match on both runs. */
export type LoopRow =
  | { readonly kind: "match"; readonly from: number; readonly to: number; readonly calls: number }
  | { readonly kind: "loop"; readonly loop: CompareLoop; readonly first: boolean };

/**
 * Loops for display: consecutive matching loops collapse into one span; a loop
 * that differs shows on its own, `first` on the loop of the first divergence
 * (by run A's loop, else run B's).
 */
export function loopRows(trace: Extract<CompareTrace, { available: true }>): LoopRow[] {
  const firstLoop = trace.firstDivergence ? (trace.firstDivergence.loopA ?? trace.firstDivergence.loopB) : null;
  const out: LoopRow[] = [];
  for (const loop of trace.loops) {
    if (loop.same) {
      const last = out[out.length - 1];
      if (last?.kind === "match" && last.to === loop.loop - 1) {
        out[out.length - 1] = { ...last, to: loop.loop, calls: last.calls + loop.a.length };
      } else {
        out.push({ kind: "match", from: loop.loop, to: loop.loop, calls: loop.a.length });
      }
    } else {
      out.push({ kind: "loop", loop, first: loop.loop === firstLoop });
    }
  }
  return out;
}

/** "Loop 3" or "Loops 1–3". */
export function loopSpanLabel(from: number, to: number): string {
  return from === to ? `Loop ${from}` : `Loops ${from}–${to}`;
}

/** Signed difference B − A as text (`+120`, `−0.4`, `same`), with an optional unit formatter. */
export function signedDelta(delta: number, fmt: (n: number) => string = (n) => String(n)): string {
  if (delta === 0) return "same";
  return `${delta > 0 ? "+" : "−"}${fmt(Math.abs(delta))}`;
}

/** Speed text (ui-core `formatTokensPerSecond`): `~` for a lower bound, `—` when unmeasured. */
export function speedLabel(s: CompareSpeed): string {
  const t = s.tokensPerSecond;
  return t ? formatTokensPerSecond(t.median, t.lowerBound) : "—";
}

/** The note shown when there is no step diff. */
export function noTraceNote(missing: readonly ("a" | "b")[]): string {
  const who = missing.length === 2 ? "Neither run" : missing[0] === "a" ? "Run A" : "Run B";
  return `${who} recorded a readable trace, so only the summary is compared. Runs record one when tracing is on.`;
}

/** A step call as one short line: `web-search {"q":"…"}`. */
export function stepCallLabel(c: StepCall): string {
  return c.args && c.args !== "null" && c.args !== "{}" ? `${c.toolName} ${c.args}` : c.toolName;
}
