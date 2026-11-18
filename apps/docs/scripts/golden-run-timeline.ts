/**
 * Pairs a captured run's real tool calls with its lifecycle hook log, for the home-page replay.
 *
 * The runtime fires `act before` more than once per tool call (before execution, again after the
 * calls already ran, and again in the engine's post-kernel bookkeeping), so the N-th `act before`
 * hook is NOT the N-th tool call (see wiki/Research/Harness-Reports/2026-11-18-extra-iterations).
 * Pairing is therefore by tool name + time: each recorded `tool-call-start` (name, timestamp) claims
 * the nearest unclaimed `act before` hook. Hooks that claim no call are dropped, and an `observe`
 * survives only when it follows a claimed tool row. This holds whatever the hook multiplicity is.
 */

export interface HookEntry {
  readonly phase: string;
  readonly timing: "before" | "after";
  readonly t: number;
}

/** A tool call's real start, from the run trace's `tool-call-start` event. */
export interface ToolStart {
  readonly name: string;
  readonly t: number;
}

/** One replay row, before display details are attached. `toolIndex` indexes the run's toolCalls. */
export interface SkeletonRow {
  readonly atMs: number;
  readonly phase: string;
  readonly toolIndex: number | null;
}

/** A hook this close (ms) to a call's start counts as that call's `act before`. */
export const CLAIM_TOLERANCE_MS = 2000;

/** `tool-call-start` events from a trace's JSONL text, in order. Unparseable lines are skipped. */
export const toolStartsFromTrace = (jsonl: string): ToolStart[] => {
  const out: ToolStart[] = [];
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { kind?: string; toolName?: string; timestamp?: number };
      if (e.kind === "tool-call-start" && typeof e.toolName === "string" && typeof e.timestamp === "number") {
        out.push({ name: e.toolName, t: e.timestamp });
      }
    } catch {
      // not a JSON line; ignore
    }
  }
  return out;
};

/**
 * Replay rows (one per `before` hook worth showing, plus tool rows) with act/observe phantoms removed.
 *
 * `starts` must line up with `toolNames` by order and name; when it does not (or is absent), tool
 * calls are claimed one per think-turn instead: the first `act before` after each `think after`.
 * That fallback cannot see a turn that made several calls, so prefer passing the trace.
 */
export const buildTimelineSkeleton = (
  hookLog: readonly HookEntry[],
  toolNames: readonly string[],
  starts?: readonly ToolStart[],
): SkeletonRow[] => {
  const before = hookLog.filter((e) => e.timing === "before");
  const t0 = before[0]?.t ?? 0;
  const aligned =
    starts !== undefined && starts.length === toolNames.length && starts.every((s, i) => s.name === toolNames[i]);

  // hook index in `before` -> tool index
  const claims = new Map<number, number>();
  const extraTools: { t: number; toolIndex: number }[] = [];

  if (aligned) {
    toolNames.forEach((_, ti) => {
      const start = starts[ti]!.t;
      let best = -1;
      let bestD = Infinity;
      before.forEach((h, hi) => {
        if (h.phase !== "act" || claims.has(hi)) return;
        const d = Math.abs(h.t - start);
        if (d < bestD) {
          best = hi;
          bestD = d;
        }
      });
      if (best !== -1 && bestD <= CLAIM_TOLERANCE_MS) claims.set(best, ti);
      else extraTools.push({ t: start, toolIndex: ti });
    });
  } else {
    // Fallback: first `act before` following each `think after`, in order.
    let armed = false;
    let next = 0;
    for (const h of hookLog) {
      if (h.phase === "think" && h.timing === "after") armed = true;
      else if (h.phase === "act" && h.timing === "before" && armed && next < toolNames.length) {
        const hi = before.indexOf(h);
        claims.set(hi, next++);
        armed = false;
      }
    }
  }

  const rows: { t: number; phase: string; toolIndex: number | null }[] = [];
  let toolPending = false;
  before.forEach((h, hi) => {
    if (h.phase === "act") {
      const ti = claims.get(hi);
      if (ti === undefined) return; // phantom: no tool call behind this hook
      toolPending = true;
      rows.push({ t: h.t, phase: "act", toolIndex: ti });
      return;
    }
    if (h.phase === "observe") {
      if (!toolPending) return; // phantom: nothing new to observe
      toolPending = false;
    }
    if (h.phase === "think") toolPending = false;
    rows.push({ t: h.t, phase: h.phase, toolIndex: null });
  });
  for (const x of extraTools) rows.push({ t: x.t, phase: "act", toolIndex: x.toolIndex });
  rows.sort((a, b) => a.t - b.t); // stable
  return rows.map((r) => ({ atMs: r.t - t0, phase: r.phase, toolIndex: r.toolIndex }));
};
