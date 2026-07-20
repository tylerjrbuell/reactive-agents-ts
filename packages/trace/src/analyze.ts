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
// the post-condition gate operates on the ledger, not the trace.

import type { Trace } from "./replay.js";
import type {
  TraceEvent,
  GuardFiredEvent,
  KernelStateSnapshotEvent,
  ToolCallEvent,
  RunCompletedEvent,
  EntropyScoredEvent,
  DecisionEvaluatedEvent,
  InterventionDispatchedEvent,
  InterventionSuppressedEvent,
  HarnessSignalInjectedEvent,
  LLMExchangeEvent,
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

  // ── Overlap storms (≥2 distinct deciders in one iter) ────────────────────
  // IMPORTANT (2026-05-31 artifact correction): `terminal_decision` is the
  // post-loop MIRROR emit (runner.ts §10) — it fires once at the terminating
  // iteration carrying the final terminatedBy, NOT a per-iteration decider. It
  // co-occurs with whichever guard terminated, so counting it inflates every
  // terminating run into a false "≥2 guard" storm. It is EXCLUDED here.
  //
  // With it excluded, real same-iteration overlap is STRUCTURALLY IMPOSSIBLE in
  // the current kernel: `terminate()` is the single writer and every give-up
  // site does `return "break"`, so the first decider to trip ends the loop —
  // two give-up deciders cannot fire in one iteration. This metric therefore
  // reads ~0 by construction today; it stays as a forward guard for any future
  // multi-decider iteration. (The USEFUL signal — "condition-met overlap" /
  // wrong-winner, where a weak give-up terminates while a stronger deliverable
  // signal was also true — needs condition-emits, not terminate-emits; deferred.)
  const guardsByIter = new Map<number, Set<string>>();
  for (const g of guards) {
    if (g.guard === "terminal_decision") continue; // post-loop mirror, not a decider
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
      "dishonest-success (claimed done but artifact content wrong) — needs artifact CONTENT inspection; post-conditions are default-on live (existence/tool checks) but content-match is not traced",
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

// ════════════════════════════════════════════════════════════════════════════
// RunAnalysis — the COMPLETE decision-grade signal for one run.
//
// Built over the LIVE event kinds only (verified emitters: kernel-state-snapshot,
// entropy-scored, decision-evaluated, intervention-dispatched/suppressed,
// tool-call-*, harness-signal-injected, guard-fired). The `coverage` field is
// the CENTERPIECE: it tells you when a metric is 0 because nothing emits it
// (blind) vs 0 because it didn't happen — so feedback is never misleading.
//
// The `honesty` field is the KEYSTONE: `status` is self-reported (the prose
// verifier; content-aware post-conditions are OFF), so every success-correlated
// number is suspect until honesty is checked. We never label a run bare
// "success" — only "claimed-success (unverified)" or, where the trace proves it,
// "dishonest-success-suspected".
// ════════════════════════════════════════════════════════════════════════════

const isEntropy = (e: TraceEvent): e is EntropyScoredEvent => e.kind === "entropy-scored";
const isDecision = (e: TraceEvent): e is DecisionEvaluatedEvent => e.kind === "decision-evaluated";
const isDispatched = (e: TraceEvent): e is InterventionDispatchedEvent => e.kind === "intervention-dispatched";
const isSuppressed = (e: TraceEvent): e is InterventionSuppressedEvent => e.kind === "intervention-suppressed";
const isSignal = (e: TraceEvent): e is HarnessSignalInjectedEvent => e.kind === "harness-signal-injected";
const isToolEnd = (e: TraceEvent): e is ToolCallEvent => e.kind === "tool-call-end";
const isLLMExchange = (e: TraceEvent): e is LLMExchangeEvent => e.kind === "llm-exchange";

/** Tools that count as substantive (non-introspection) work. */
const INTROSPECTION_TOOLS = new Set([
  "brief", "pulse", "find", "recall", "discover-tools", "context-status",
  "checkpoint", "final-answer", "task-complete", "activate-skill",
]);
/** Tools that produce a deliverable artifact. */
const isDeliverableTool = (name: string): boolean =>
  name.includes("write") || name === "write_result_to_file";

export interface HonestyCheck {
  /** True when the run reported done/success. */
  readonly claimedSuccess: boolean;
  /** A deliverable-producing tool call succeeded (file written). */
  readonly deliverableProduced: boolean;
  /** Any substantive (non-introspection) tool call succeeded. */
  readonly substantiveWorkDone: boolean;
  /**
   * The trust-labeled verdict. NEVER bare "success" — `status` is self-reported.
   *   - honest-failure            : claimed failure (trustworthy negative)
   *   - claimed-success (unverified): claimed success + did real work; content
   *                                   correctness NOT checkable from trace (task
   *                                   text absent) — treat as UNVERIFIED.
   *   - dishonest-success-suspected: claimed success but did NO substantive tool
   *                                   work — the prose-lie class.
   */
  readonly label:
    | "honest-failure"
    | "claimed-success (unverified)"
    | "dishonest-success-suspected";
  readonly evidence: string;
}

export interface CostSignal {
  readonly totalTokens: number;
  /** Cumulative token reading at each snapshot. */
  readonly tokenTrajectory: readonly number[];
  readonly maxIterTokenDelta: number;
  /** LLM call count — proxy for harness sub-call overhead (synthesis, classify). */
  readonly llmCalls: number;
  /** Sum of intervention-dispatched cost.tokensEstimated — harness intervention spend. */
  readonly interventionEstimatedTokens: number;
  /**
   * Whether per-exchange input/output + cache token split is available.
   * llm-exchange fires on the live kernel path via observable-llm.ts (verified
   * 2026-07-05); response payloads complete as of Arc 1 Task 1. Currently FALSE
   * because no provider populates tokensIn/tokensOut/cacheRead yet (coverage gap).
   */
  readonly inOutSplitAvailable: boolean;
}

export interface ReasoningTrajectory {
  readonly entropyFirst?: number;
  readonly entropyLast?: number;
  readonly entropyShape: "converging" | "flat" | "diverging" | "unknown";
  /** decisionType → count, from decision-evaluated events. */
  readonly decisionTypes: Readonly<Record<string, number>>;
  /** Final step composition, from the last snapshot. */
  readonly stepsByTypeFinal: Readonly<Record<string, number>>;
}

export interface ToolOutcome {
  readonly tool: string;
  readonly calls: number;
  readonly ok: number;
  readonly errors: number;
  readonly truncated: number;
}

export interface InterventionPressure {
  /** Reactive interventions that fired (intervention-dispatched). */
  readonly dispatched: number;
  /** Interventions evaluated but NOT fired, by suppression reason. */
  readonly suppressedByReason: Readonly<Record<string, number>>;
  /** Harness-authored steps injected into the model stream, by kind. */
  readonly signalsInjectedByKind: Readonly<Record<string, number>>;
}

export interface CoverageReport {
  /** event kind → count present in this trace. */
  readonly present: Readonly<Record<string, number>>;
  /** Emitters known to have ZERO callers (signal is structurally blind). */
  readonly knownDeadEmitters: readonly string[];
  /**
   * Metrics that cannot be computed because their source events are missing —
   * with WHY. The anti-misleading guarantee: a blind metric is never reported
   * as a real zero.
   */
  readonly blindSpots: readonly { readonly metric: string; readonly reason: string }[];
}

/**
 * What actually crossed the provider boundary, summarized per run — the
 * closed-loop replacement for hand-rolled logging proxies.
 *
 * Born 2026-07-10: three wire-level defects (empty assistant prose, a 67%
 * meta-tool schema share, a hidden memory-extraction call) were invisible to
 * every existing report even though `llm-exchange` RECORDED the evidence —
 * nobody asked the questions. This section asks them on every run.
 */
export interface WireVisibility {
  /** Provider requests this run sent (mirror of llmExchangeCount). */
  readonly exchanges: number;
  /** Assistant turns replayed across all requests. */
  readonly assistantTurns: number;
  /**
   * Chars of the model's OWN PROSE re-shown to it across assistant turns
   * (placeholders like `[tool_use:x]` excluded). 0 with multiple turns means
   * the model never re-reads a word of its reasoning (thought continuity OFF).
   */
  readonly assistantProseChars: number;
  /** Distinct tool schemas the model was offered, across the run. */
  readonly toolSchemaNames: readonly string[];
  /** Mean schemas per request — the per-turn schema tax. */
  readonly avgToolSchemasPerRequest: number;
  /** Wire-level anomalies worth a human look. */
  readonly flags: readonly string[];
}

export interface RunAnalysis {
  readonly runId: string;
  readonly status?: RunCompletedEvent["status"];
  readonly iterations: number;
  /** KEYSTONE — trust-labeled outcome (never bare "success"). */
  readonly honesty: HonestyCheck;
  readonly interventions: InterventionAnalysis;
  readonly pressure: InterventionPressure;
  readonly cost: CostSignal;
  readonly reasoning: ReasoningTrajectory;
  readonly tools: readonly ToolOutcome[];
  readonly failureModes: readonly FailureMode[];
  /** CENTERPIECE — what the trace could and could NOT see. */
  readonly coverage: CoverageReport;
  /** Count of llm-exchange events in this run — proxy for model round-trips. */
  readonly llmExchangeCount: number;
  /** What crossed the provider boundary (undefined when no exchanges recorded). */
  readonly wire?: WireVisibility;
}

/** Emitters verified (this session) to have zero call sites. */
const KNOWN_DEAD_EMITTERS = [
  "emitCuratorDecision (0 callers — context-fidelity/budget-decision signal blind)",
  "emitAlternativesConsidered (0 callers — counterfactual signal blind)",
];

export function analyzeRun(trace: Trace, opts: AnalyzeOptions = {}): RunAnalysis {
  const interventions = analyzeInterventions(trace, opts);
  const ev = trace.events;
  const snapshots = ev.filter(isSnapshot);
  const lastSnap = snapshots.at(-1);
  const completed = ev.filter(isCompleted).at(-1);
  const toolStarts = ev.filter((e): e is ToolCallEvent => e.kind === "tool-call-start");
  const toolEnds = ev.filter(isToolEnd);

  // ── Honesty (KEYSTONE) ─────────────────────────────────────────────────────
  const claimedSuccess =
    completed?.status === "success" ||
    (completed === undefined &&
      (lastSnap?.status === "done" ||
        (lastSnap?.terminatedBy ?? "").startsWith("final_answer")));
  const okEnds = toolEnds.filter((t) => t.ok !== false);
  const deliverableProduced = okEnds.some((t) => isDeliverableTool(t.toolName));
  const substantiveWorkDone = okEnds.some((t) => !INTROSPECTION_TOOLS.has(t.toolName));
  let label: HonestyCheck["label"];
  let evidence: string;
  if (!claimedSuccess) {
    label = "honest-failure";
    evidence = `status=${completed?.status ?? lastSnap?.status ?? "?"}`;
  } else if (!substantiveWorkDone) {
    label = "dishonest-success-suspected";
    evidence = "claimed success but no substantive (non-introspection) tool call succeeded";
  } else {
    label = "claimed-success (unverified)";
    evidence = deliverableProduced
      ? "claimed success + deliverable tool succeeded; CONTENT correctness not checkable from trace (task text absent)"
      : "claimed success + substantive tool work; no deliverable-file write seen";
  }
  const honesty: HonestyCheck = {
    claimedSuccess, deliverableProduced, substantiveWorkDone, label, evidence,
  };

  // ── Cost ────────────────────────────────────────────────────────────────────
  const tokenTrajectory = snapshots.map((s) => s.tokens);
  let maxIterTokenDelta = 0;
  for (let i = 1; i < tokenTrajectory.length; i++) {
    const d = (tokenTrajectory[i] ?? 0) - (tokenTrajectory[i - 1] ?? 0);
    if (d > maxIterTokenDelta) maxIterTokenDelta = d;
  }
  const interventionEstimatedTokens = ev
    .filter(isDispatched)
    .reduce((sum, d) => sum + (d.cost?.tokensEstimated ?? 0), 0);
  const cost: CostSignal = {
    totalTokens: completed?.totalTokens ?? lastSnap?.tokens ?? 0,
    tokenTrajectory,
    maxIterTokenDelta,
    llmCalls: lastSnap?.llmCalls ?? 0,
    interventionEstimatedTokens,
    inOutSplitAvailable: false,
  };

  // ── Reasoning trajectory ──────────────────────────────────────────────────
  const entropies = ev.filter(isEntropy).map((e) => e.composite);
  const entropyFirst = entropies.at(0);
  const entropyLast = entropies.at(-1);
  let entropyShape: ReasoningTrajectory["entropyShape"] = "unknown";
  if (entropyFirst !== undefined && entropyLast !== undefined && entropies.length >= 2) {
    const d = entropyLast - entropyFirst;
    entropyShape = Math.abs(d) < 0.05 ? "flat" : d < 0 ? "converging" : "diverging";
  }
  const decisionTypes: Record<string, number> = {};
  for (const d of ev.filter(isDecision)) decisionTypes[d.decisionType] = (decisionTypes[d.decisionType] ?? 0) + 1;
  const reasoning: ReasoningTrajectory = {
    ...(entropyFirst !== undefined ? { entropyFirst } : {}),
    ...(entropyLast !== undefined ? { entropyLast } : {}),
    entropyShape,
    decisionTypes,
    stepsByTypeFinal: lastSnap?.stepsByType ?? {},
  };

  // ── Tool outcomes ──────────────────────────────────────────────────────────
  const toolMap = new Map<string, { calls: number; ok: number; errors: number; truncated: number }>();
  for (const t of toolStarts) {
    const cur = toolMap.get(t.toolName) ?? { calls: 0, ok: 0, errors: 0, truncated: 0 };
    cur.calls += 1;
    toolMap.set(t.toolName, cur);
  }
  for (const t of toolEnds) {
    const cur = toolMap.get(t.toolName) ?? { calls: 0, ok: 0, errors: 0, truncated: 0 };
    if (t.ok === false) cur.errors += 1; else cur.ok += 1;
    if (t.resultTruncated) cur.truncated += 1;
    toolMap.set(t.toolName, cur);
  }
  const tools: ToolOutcome[] = [...toolMap.entries()]
    .map(([tool, s]) => ({ tool, ...s }))
    .sort((a, b) => b.calls - a.calls);

  // ── Intervention pressure ───────────────────────────────────────────────────
  const suppressedByReason: Record<string, number> = {};
  for (const s of ev.filter(isSuppressed)) suppressedByReason[s.reason] = (suppressedByReason[s.reason] ?? 0) + 1;
  const signalsInjectedByKind: Record<string, number> = {};
  for (const s of ev.filter(isSignal)) signalsInjectedByKind[s.signalKind] = (signalsInjectedByKind[s.signalKind] ?? 0) + 1;
  const pressure: InterventionPressure = {
    dispatched: ev.filter(isDispatched).length,
    suppressedByReason,
    signalsInjectedByKind,
  };

  // ── Coverage (CENTERPIECE) ──────────────────────────────────────────────────
  const present: Record<string, number> = {};
  for (const e of ev) present[e.kind] = (present[e.kind] ?? 0) + 1;
  const blindSpots: { metric: string; reason: string }[] = [];
  if ((present["llm-exchange"] ?? 0) === 0) {
    blindSpots.push({ metric: "tokensIn/Out + cache hit-rate (KV-stability)", reason: "no llm-exchange events (emitter does not fire on live path)" });
    blindSpots.push({ metric: "what-model-saw / context-fidelity", reason: "no llm-exchange events" });
  }
  if ((present["curator-decision"] ?? 0) === 0) {
    blindSpots.push({ metric: "context kept/dropped/compressed (budget-inversion evidence)", reason: "emitCuratorDecision has 0 callers" });
  }
  if ((present["guard-fired"] ?? 0) <= 1) {
    blindSpots.push({ metric: "intervention overlap-storms on real runs", reason: "emitGuardFired wired at terminal only; per-site fan-out pending (the decision-critical gap)" });
  }
  if ((present["verifier-verdict"] ?? 0) === 0) {
    blindSpots.push({ metric: "verifier accept/reject reasons", reason: "no verifier-verdict events this run (conditional emitter)" });
  }
  const coverage: CoverageReport = { present, knownDeadEmitters: KNOWN_DEAD_EMITTERS, blindSpots };

  // ── LLM exchange count ──────────────────────────────────────────────────
  const exchanges = ev.filter(isLLMExchange);
  const llmExchangeCount = exchanges.length;
  const wire = analyzeWire(exchanges);

  return {
    runId: trace.runId,
    ...(completed?.status ? { status: completed.status } : {}),
    iterations: interventions.iterations,
    honesty, interventions, pressure, cost, reasoning, tools,
    failureModes: interventions.failureModes,
    coverage,
    llmExchangeCount,
    ...(wire !== undefined ? { wire } : {}),
  };
}

/** `messageContentToString` placeholders — NOT the model's own prose. */
const EXCHANGE_PLACEHOLDER = /\[tool_use:[^\]]*\]|\[tool_result\]/g;

/**
 * Summarize what crossed the provider boundary. Every input here was already
 * on disk when the 2026-07-10 wire audit ran; the defect was that no report
 * read it. See {@link WireVisibility}.
 */
export function analyzeWire(
  exchanges: readonly LLMExchangeEvent[],
): WireVisibility | undefined {
  if (exchanges.length === 0) return undefined;

  let assistantTurns = 0;
  let assistantProseChars = 0;
  const schemaUnion = new Set<string>();
  let schemaTotal = 0;

  for (const e of exchanges) {
    for (const n of e.toolSchemaNames) schemaUnion.add(n);
    schemaTotal += e.toolSchemaNames.length;
    for (const m of e.messages) {
      if (m.role !== "assistant") continue;
      assistantTurns++;
      assistantProseChars += m.content.replace(EXCHANGE_PLACEHOLDER, "").trim().length;
    }
  }

  const flags: string[] = [];
  if (assistantTurns >= 2 && assistantProseChars === 0) {
    flags.push(
      "assistant turns carry NO prose — the model never re-reads its own reasoning (thought continuity OFF; RA_THOUGHT_CONTINUITY=1 to trial)",
    );
  }
  const avg = schemaTotal / exchanges.length;
  if (avg >= 8) {
    flags.push(
      `high schema tax: ${avg.toFixed(1)} tool schemas per request — check for unused meta-tools`,
    );
  }

  return {
    exchanges: exchanges.length,
    assistantTurns,
    assistantProseChars,
    toolSchemaNames: [...schemaUnion].sort(),
    avgToolSchemasPerRequest: Math.round(avg * 10) / 10,
    flags,
  };
}

/** Full per-run forensic report — the human debug view. */
export function renderRunReport(a: RunAnalysis): string {
  const L: string[] = [];
  L.push(`═══ Run ${a.runId} ═══`);
  L.push(`OUTCOME: ${a.honesty.label}  (${a.honesty.evidence})`);
  L.push(`  iterations=${a.iterations} tokens=${a.cost.totalTokens} llmCalls=${a.cost.llmCalls} interventionTokens≈${a.cost.interventionEstimatedTokens}`);
  if (a.interventions.terminalDecision) L.push(`  ended by: ${a.interventions.terminalDecision.reason}`);
  L.push(`REASONING: entropy ${a.reasoning.entropyFirst ?? "?"}→${a.reasoning.entropyLast ?? "?"} (${a.reasoning.entropyShape}); steps=${JSON.stringify(a.reasoning.stepsByTypeFinal)}`);
  if (Object.keys(a.reasoning.decisionTypes).length) L.push(`  decisions: ${Object.entries(a.reasoning.decisionTypes).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  L.push(`COST: trajectory=[${a.cost.tokenTrajectory.join("→")}] maxΔ=${a.cost.maxIterTokenDelta}${a.cost.inOutSplitAvailable ? "" : "  (in/out+cache split BLIND)"}`);
  if (a.tools.length) {
    L.push(`TOOLS:`);
    for (const t of a.tools) L.push(`  ${t.tool.padEnd(22)} calls=${t.calls} ok=${t.ok} err=${t.errors} trunc=${t.truncated}`);
  }
  L.push(`INTERVENTIONS: ${a.interventions.guardsFired} guard(s); dispatched=${a.pressure.dispatched}; suppressed=${JSON.stringify(a.pressure.suppressedByReason)}; injected=${JSON.stringify(a.pressure.signalsInjectedByKind)}`);
  if (a.interventions.overlapStorms.length) L.push(`  ⚠ overlap storms: ${a.interventions.overlapStorms.map((s) => `iter${s.iter}[${s.guards.join("+")}]`).join(" ")}`);
  if (a.failureModes.length) {
    L.push(`FAILURE MODES:`);
    for (const f of a.failureModes) L.push(`  🔴 ${f.mode}: ${f.evidence}`);
  } else L.push(`FAILURE MODES: none trace-detectable`);
  if (a.wire) {
    L.push(
      `WIRE: ${a.wire.exchanges} request(s); assistant prose re-shown=${a.wire.assistantProseChars}ch across ${a.wire.assistantTurns} turn(s); ~${a.wire.avgToolSchemasPerRequest} schemas/request [${a.wire.toolSchemaNames.join(",")}]`,
    );
    for (const f of a.wire.flags) L.push(`  ⚠ ${f}`);
  }
  L.push(`COVERAGE:`);
  L.push(`  present: ${Object.entries(a.coverage.present).map(([k, v]) => `${k}:${v}`).join(" ")}`);
  if (a.coverage.blindSpots.length) {
    L.push(`  🔭 BLIND (metric unavailable, NOT a real zero):`);
    for (const b of a.coverage.blindSpots) L.push(`    - ${b.metric} — ${b.reason}`);
  }
  return L.join("\n");
}
