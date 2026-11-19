/**
 * Strategy run persistence: the folded {@link StrategyRunState} of a turn, bounded for storage and
 * read back defensively, so a UI can keep a turn's strategy card after the turn ended and after a
 * reload. Pure and framework-free; the host decides where the JSON lives (Cortex stores it in the
 * turn trace). A stored run from an older or newer writer degrades to `undefined`, never throws.
 */
import {
  endStrategyRun,
  strategyStepOf,
  totNodeOfWire,
  type StrategyRow,
  type StrategyRowStatus,
  type StrategyRunState,
} from "./strategy-phases.js";
import { planStepPayloadOf, strategyChoicePayloadOf, type PlanStepEvent, type StrategyChoicePayload } from "./strategy-plan-history.js";

/** Size bounds for a stored strategy run. */
export interface StrategyRunCaps {
  /** Chars kept of one code block, stdout or stderr. */
  readonly textChars: number;
  /** Chars kept of one critique or verify summary. */
  readonly noteChars: number;
  /** Chars kept of one tree-of-thought node's content. */
  readonly nodeChars: number;
  /** Rows kept (the newest). */
  readonly maxRows: number;
  /** Tree-of-thought nodes kept (the first scored). */
  readonly maxNodes: number;
  /** History events kept per plan step (the newest). */
  readonly maxHistory: number;
  /** Chars kept of one history note or adaptive reason. */
  readonly historyChars: number;
}

/** Default bounds: a turn's strategy payload stays near 40 KB at most. */
export const DEFAULT_STRATEGY_RUN_CAPS: StrategyRunCaps = {
  textChars: 2_000,
  noteChars: 1_000,
  nodeChars: 400,
  maxRows: 60,
  maxNodes: 120,
  maxHistory: 12,
  historyChars: 300,
};

const clip = (s: string | undefined, max: number): string | undefined =>
  s === undefined ? undefined : s.length > max ? `${s.slice(0, max)}…` : s;

function clipEvent(e: PlanStepEvent, max: number): PlanStepEvent {
  const note = clip(e.note, max);
  return { kind: e.kind, ...(e.attempt !== undefined ? { attempt: e.attempt } : {}), ...(note !== undefined ? { note } : {}) };
}

function clipChoice(c: StrategyChoicePayload, max: number): StrategyChoicePayload {
  const note = clip(c.note, max);
  return { selected: c.selected, reason: clip(c.reason, max) ?? "", ...(note !== undefined ? { note } : {}) };
}

/**
 * The run reduced for storage: settled (`ended`), long text clipped, rows and nodes bounded, and
 * the `current` step cut to its label (its detail already lives on the rows). `undefined` for a
 * run that never reported a step.
 */
export function strategyRunForStorage(
  run: StrategyRunState,
  caps: StrategyRunCaps = DEFAULT_STRATEGY_RUN_CAPS,
): StrategyRunState | undefined {
  if (run.current === undefined || run.rows.length === 0) return undefined;
  const settled = endStrategyRun(run);
  const rows = settled.rows.slice(-caps.maxRows).map((r): StrategyRow => {
    const code = clip(r.code, caps.textChars);
    const stdout = clip(r.stdout, caps.textChars);
    const stderr = clip(r.stderr, caps.textChars);
    const critique = clip(r.critique, caps.noteChars);
    const note = clip(r.note, caps.noteChars);
    return {
      key: r.key,
      phase: r.phase,
      ...(r.n !== undefined ? { n: r.n } : {}),
      label: r.label,
      status: r.status,
      ...(r.sub !== undefined ? { sub: r.sub } : {}),
      ...(code !== undefined ? { code } : {}),
      ...(stdout !== undefined ? { stdout } : {}),
      ...(stderr !== undefined ? { stderr } : {}),
      ...(r.verify ? { verify: { verdict: r.verify.verdict, summary: clip(r.verify.summary, caps.noteChars) ?? "" } } : {}),
      ...(critique !== undefined ? { critique } : {}),
      ...(r.accepted !== undefined ? { accepted: r.accepted } : {}),
      ...(note !== undefined ? { note } : {}),
      ...(r.choice ? { choice: clipChoice(r.choice, caps.historyChars) } : {}),
      ...(r.history && r.history.length > 0 ? { history: r.history.slice(-caps.maxHistory).map((e) => clipEvent(e, caps.historyChars)) } : {}),
    };
  });
  const nodes = settled.nodes.slice(0, caps.maxNodes).map((n) => {
    const content = clip(n.content, caps.nodeChars);
    return { ...n, ...(content !== undefined ? { content } : {}) };
  });
  const c = settled.current!;
  return {
    ...(settled.strategy !== undefined ? { strategy: settled.strategy } : {}),
    ...(settled.label !== undefined ? { label: settled.label } : {}),
    current: { strategy: c.strategy, pass: c.pass, phase: c.phase, ...(c.n !== undefined ? { n: c.n } : {}), ...(c.sub !== undefined ? { sub: c.sub } : {}) },
    rows,
    nodes,
    ...(settled.path ? { path: settled.path } : {}),
    ended: true,
  };
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const STATUSES: ReadonlySet<string> = new Set<StrategyRowStatus>(["running", "done", "failed"]);

function rowOfStored(raw: unknown): StrategyRow | undefined {
  const r = record(raw);
  if (!r) return undefined;
  const key = text(r.key);
  const phase = text(r.phase);
  const label = text(r.label);
  if (key === undefined || phase === undefined || label === undefined) return undefined;
  const status = typeof r.status === "string" && STATUSES.has(r.status) ? (r.status as StrategyRowStatus) : "done";
  const v = record(r.verify);
  const verdict = v ? text(v.verdict) : undefined;
  const sub = text(r.sub);
  const code = text(r.code);
  const stdout = text(r.stdout);
  const stderr = text(r.stderr);
  const critique = text(r.critique);
  const note = text(r.note);
  const choice = strategyChoicePayloadOf(r.choice);
  const history = Array.isArray(r.history)
    ? r.history.flatMap((x): PlanStepEvent[] => {
        const e = record(x);
        const kind = e ? planStepPayloadOf({ stepIndex: 0, status: e.kind })?.status : undefined;
        if (!e || kind === undefined) return [];
        const note = text(e.note);
        return [{ kind, ...(typeof e.attempt === "number" && Number.isFinite(e.attempt) ? { attempt: e.attempt } : {}), ...(note !== undefined ? { note } : {}) }];
      })
    : [];
  return {
    key,
    phase,
    ...(typeof r.n === "number" && Number.isFinite(r.n) ? { n: r.n } : {}),
    label,
    // A stored run is over: nothing in it is still running.
    status: status === "running" ? "done" : status,
    ...(sub !== undefined ? { sub } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(verdict !== undefined ? { verify: { verdict, summary: typeof v?.summary === "string" ? v.summary : "" } } : {}),
    ...(critique !== undefined ? { critique } : {}),
    ...(typeof r.accepted === "boolean" ? { accepted: r.accepted } : {}),
    ...(note !== undefined ? { note } : {}),
    ...(choice ? { choice } : {}),
    ...(history.length > 0 ? { history } : {}),
  };
}

/**
 * A stored strategy run read back from JSON, `undefined` when it is absent or malformed. The result
 * is always `ended`. Malformed rows and nodes are dropped, not repaired.
 */
export function strategyRunFromStorage(raw: unknown): StrategyRunState | undefined {
  const r = record(raw);
  if (!r || !Array.isArray(r.rows)) return undefined;
  const rows = r.rows.flatMap((x) => {
    const row = rowOfStored(x);
    return row ? [row] : [];
  });
  const cur = record(r.current);
  const current = cur && text(cur.pass) !== undefined ? strategyStepOf(text(cur.pass)!) : undefined;
  if (rows.length === 0 || current === undefined) return undefined;
  const nodes = (Array.isArray(r.nodes) ? r.nodes : []).flatMap((x) => {
    const n = totNodeOfWire(x);
    return n ? [n] : [];
  });
  const path = Array.isArray(r.path) && r.path.length > 0 && r.path.every((p) => typeof p === "string") ? (r.path as string[]) : undefined;
  const strategy = text(r.strategy);
  const label = text(r.label);
  return {
    ...(strategy !== undefined ? { strategy } : {}),
    ...(label !== undefined ? { label } : {}),
    current,
    rows,
    nodes,
    ...(path ? { path } : {}),
    ended: true,
  };
}
