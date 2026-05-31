// packages/trace/src/analyze.ts
//
// Intervention-density analyzer. Reads a recorded Trace (JSONL → loadTrace)
// and produces a per-run picture of WHICH harness interventions fired, WHERE
// they overlap, and which trace-detectable failure modes occurred — the
// instrument for debugging "what is the harness actually doing to this run."
//
// SCOPE / HONESTY (do not over-claim): this reads the trace only. It reports
//   - frequency: how often each guard fired
//   - overlap: multiple deciders firing in the SAME iteration (the redundancy
//     signal — the thick-harness fingerprint)
//   - outcome correlation: guard outcomes vs the run's terminal status
//   - trace-detectable failure modes (below)
// It does NOT establish causality ("guard X is dead weight"). A guard's local
// outcome is not a counterfactual on run success — that still needs ablation
// (turn it off, compare pass^k). This analyzer produces the CANDIDATE list and
// the evidence to prioritize ablations, not the verdicts.
//
// NOT trace-detectable here (reported as gaps): dishonest-success (artifact
// content correct vs claimed) — needs post-condition/artifact inspection, and
// RA_POST_CONDITIONS is currently OFF.

import type { Trace } from "./replay.js";
import type {
  TraceEvent,
  GuardFiredEvent,
  KernelStateSnapshotEvent,
  ToolCallEvent,
  RunCompletedEvent,
} from "./events.js";

export interface GuardStat {
  readonly guard: string;
  readonly count: number;
  /** outcome → count, e.g. { warn: 2, terminate: 1 }. */
  readonly outcomes: Readonly<Record<string, number>>;
  /** iterations at which this guard fired (with duplicates for repeat-in-iter). */
  readonly iters: readonly number[];
}

/** An iteration where ≥2 DISTINCT guards fired — the redundancy fingerprint. */
export interface OverlapStorm {
  readonly iter: number;
  readonly guards: readonly string[];
}

export interface FailureMode {
  readonly mode: string;
  readonly evidence: string;
}

export interface InterventionAnalysis {
  readonly runId: string;
  readonly status?: RunCompletedEvent["status"];
  readonly iterations: number;
  readonly guardsFired: number;
  /** Per-guard stats, sorted by count desc. */
  readonly byGuard: readonly GuardStat[];
  /** Iterations with ≥2 distinct guards firing. */
  readonly overlapStorms: readonly OverlapStorm[];
  /** The decider that actually ended the run, if recoverable from the trace. */
  readonly terminalDecision?: { guard: string; outcome: string; reason: string };
  /** terminatedBy from the last snapshot, if present. */
  readonly terminatedBy?: string;
  /** tool name → number of tool-call-start events. */
  readonly toolCallCounts: Readonly<Record<string, number>>;
  /** Largest single-iteration token increase across snapshots. */
  readonly maxIterTokenDelta: number;
  readonly totalTokens: number;
  /** Trace-detectable failure modes (see SCOPE). */
  readonly failureModes: readonly FailureMode[];
  /** Honest gaps — modes that require non-trace inspection. */
  readonly notDetectable: readonly string[];
}

export interface AnalyzeOptions {
  /** A single-iteration token jump ≥ this flags a runaway. Default 30000. */
  readonly runawayTokenDelta?: number;
  /** Same guard firing redirect/warn ≥ this flags a nudge-loop. Default 3. */
  readonly nudgeLoopThreshold?: number;
  /** ≥ this many recall tool-calls flags a recall-loop. Default 3. */
  readonly recallLoopThreshold?: number;
}

const isGuard = (e: TraceEvent): e is GuardFiredEvent => e.kind === "guard-fired";
const isSnapshot = (e: TraceEvent): e is KernelStateSnapshotEvent =>
  e.kind === "kernel-state-snapshot";
const isToolStart = (e: TraceEvent): e is ToolCallEvent => e.kind === "tool-call-start";
const isCompleted = (e: TraceEvent): e is RunCompletedEvent => e.kind === "run-completed";

export function analyzeInterventions(
  trace: Trace,
  opts: AnalyzeOptions = {},
): InterventionAnalysis {
  const runawayTokenDelta = opts.runawayTokenDelta ?? 30_000;
  const nudgeLoopThreshold = opts.nudgeLoopThreshold ?? 3;
  const recallLoopThreshold = opts.recallLoopThreshold ?? 3;

  const guards = trace.events.filter(isGuard);
  const snapshots = trace.events.filter(isSnapshot);
  const toolStarts = trace.events.filter(isToolStart);
  const completed = trace.events.filter(isCompleted).at(-1);

  // ── Per-guard stats ──────────────────────────────────────────────────────
  const guardMap = new Map<string, { count: number; outcomes: Record<string, number>; iters: number[] }>();
  for (const g of guards) {
    const cur = guardMap.get(g.guard) ?? { count: 0, outcomes: {}, iters: [] };
    cur.count += 1;
    cur.outcomes[g.outcome] = (cur.outcomes[g.outcome] ?? 0) + 1;
    cur.iters.push(g.iter);
    guardMap.set(g.guard, cur);
  }
  const byGuard: GuardStat[] = [...guardMap.entries()]
    .map(([guard, s]) => ({ guard, count: s.count, outcomes: s.outcomes, iters: s.iters }))
    .sort((a, b) => b.count - a.count);

  // ── Overlap storms (≥2 distinct guards in one iter) ──────────────────────
  const guardsByIter = new Map<number, Set<string>>();
  for (const g of guards) {
    const set = guardsByIter.get(g.iter) ?? new Set<string>();
    set.add(g.guard);
    guardsByIter.set(g.iter, set);
  }
  const overlapStorms: OverlapStorm[] = [...guardsByIter.entries()]
    .filter(([, set]) => set.size >= 2)
    .map(([iter, set]) => ({ iter, guards: [...set] }))
    .sort((a, b) => a.iter - b.iter);

  // ── Terminal decision ────────────────────────────────────────────────────
  const terminalGuard = [...guards].reverse().find((g) => g.outcome === "terminate");
  const terminalDecision = terminalGuard
    ? { guard: terminalGuard.guard, outcome: terminalGuard.outcome, reason: terminalGuard.reason }
    : undefined;
  const lastSnapshot = snapshots.at(-1);
  const terminatedBy = lastSnapshot?.terminatedBy;

  // ── Tool-call counts ──────────────────────────────────────────────────────
  const toolCallCounts: Record<string, number> = {};
  for (const t of toolStarts) toolCallCounts[t.toolName] = (toolCallCounts[t.toolName] ?? 0) + 1;

  // ── Token deltas across snapshots ─────────────────────────────────────────
  let maxIterTokenDelta = 0;
  let prevTokens = 0;
  for (const s of snapshots) {
    const delta = s.tokens - prevTokens;
    if (delta > maxIterTokenDelta) maxIterTokenDelta = delta;
    prevTokens = s.tokens;
  }
  const totalTokens = completed?.totalTokens ?? lastSnapshot?.tokens ?? 0;

  // ── Iterations ─────────────────────────────────────────────────────────────
  const iters = trace.events.map((e) => e.iter).filter((i) => i >= 0);
  const iterations = iters.length > 0 ? Math.max(...iters) + 1 : 0;

  // ── Failure modes (trace-detectable only) ──────────────────────────────────
  const failureModes: FailureMode[] = [];
  if (overlapStorms.length > 0) {
    const worst = overlapStorms.reduce((a, b) => (b.guards.length > a.guards.length ? b : a));
    failureModes.push({
      mode: "overlap-storm",
      evidence: `${overlapStorms.length} iter(s) with ≥2 deciders; worst iter ${worst.iter}: [${worst.guards.join(", ")}]`,
    });
  }
  for (const g of byGuard) {
    const steers = (g.outcomes["redirect"] ?? 0) + (g.outcomes["warn"] ?? 0);
    if (steers >= nudgeLoopThreshold) {
      failureModes.push({
        mode: "nudge-loop",
        evidence: `guard "${g.guard}" steered ${steers}× (redirect/warn) without terminal resolution`,
      });
    }
  }
  const recallCalls = toolCallCounts["recall"] ?? 0;
  if (recallCalls >= recallLoopThreshold) {
    failureModes.push({ mode: "recall-loop", evidence: `recall called ${recallCalls}× (indirection thrash)` });
  }
  if (maxIterTokenDelta >= runawayTokenDelta) {
    failureModes.push({ mode: "runaway-tokens", evidence: `single-iter token delta ${maxIterTokenDelta} ≥ ${runawayTokenDelta}` });
  }
  if ((terminatedBy ?? "").includes("max_iterations")) {
    failureModes.push({ mode: "max-iter-no-progress", evidence: `terminatedBy=${terminatedBy} (ran out of iterations)` });
  }

  return {
    runId: trace.runId,
    status: completed?.status,
    iterations,
    guardsFired: guards.length,
    byGuard,
    overlapStorms,
    terminalDecision,
    terminatedBy,
    toolCallCounts,
    maxIterTokenDelta,
    totalTokens,
    failureModes,
    notDetectable: [
      "dishonest-success (claimed done but artifact content wrong) — needs post-condition/artifact inspection; RA_POST_CONDITIONS currently OFF",
    ],
  };
}

/** Human-readable per-run report — the debug view for a single trace. */
export function renderInterventionReport(a: InterventionAnalysis): string {
  const lines: string[] = [];
  lines.push(`Run ${a.runId} — status=${a.status ?? "?"} iterations=${a.iterations} tokens=${a.totalTokens}`);
  lines.push(`Interventions fired: ${a.guardsFired}`);
  if (a.byGuard.length > 0) {
    lines.push(`  By guard (count · outcomes):`);
    for (const g of a.byGuard) {
      const oc = Object.entries(g.outcomes).map(([k, v]) => `${k}:${v}`).join(" ");
      lines.push(`    ${g.guard.padEnd(24)} ${String(g.count).padStart(3)}  [${oc}]  iters=${g.iters.join(",")}`);
    }
  }
  if (a.overlapStorms.length > 0) {
    lines.push(`  ⚠ Overlap storms (≥2 deciders/iter):`);
    for (const s of a.overlapStorms) lines.push(`    iter ${s.iter}: ${s.guards.join(" + ")}`);
  }
  if (a.terminalDecision) {
    lines.push(`  Terminal decision: ${a.terminalDecision.guard} (${a.terminalDecision.outcome}) — ${a.terminalDecision.reason}`);
  } else if (a.terminatedBy) {
    lines.push(`  terminatedBy: ${a.terminatedBy}`);
  }
  const tools = Object.entries(a.toolCallCounts);
  if (tools.length > 0) {
    lines.push(`  Tool calls: ${tools.map(([n, c]) => `${n}×${c}`).join(", ")}`);
  }
  if (a.failureModes.length > 0) {
    lines.push(`  🔴 Failure modes (trace-detectable):`);
    for (const f of a.failureModes) lines.push(`    ${f.mode}: ${f.evidence}`);
  } else {
    lines.push(`  ✓ No trace-detectable failure modes.`);
  }
  lines.push(`  (not trace-detectable: ${a.notDetectable.join("; ")})`);
  return lines.join("\n");
}
