/**
 * Run compare: "what changed between these two runs". Two halves:
 *
 * - **Summary** (every run Cortex stored): outcome, tokens, cost, duration,
 *   loops, output speed (the Model page's per-call rule, `modelThroughputOf`)
 *   and the difference between the two runs' resolved configs
 *   (`AgentStarted.config` = the trace's `run-started.config`,
 *   `{ mechanisms, builder, env }`).
 * - **Trace** (only when both runs recorded a tracer JSONL): the framework's
 *   `@reactive-agents/replay` `loadRecordedRun` + `diffTraces` over the two
 *   recordings. Cortex adds the step rows the page needs: tool calls aligned by
 *   position (the same alignment `diffTraces` uses), each tagged with its kernel
 *   loop, the loops aligned by number, and the first divergence.
 *
 * The trace half is cached per pair until either trace file changes.
 */
import { statSync } from "node:fs";
import { Effect, Option } from "effect";
import {
  diffTraces,
  loadRecordedRun,
  snapshotFromRecordedRun,
  type RecordedRun,
  type RecordedToolResult,
  type ReplayDiff,
  type TraceSnapshot,
} from "@reactive-agents/replay";
import { CortexError, CortexNotFoundError } from "../errors.js";
import type { RunSummary } from "../types.js";
import { CortexStoreService } from "./store-service.js";
import { modelThroughputOf } from "./model-throughput.js";
import { findRunTraceFile, traceDirs } from "./run-trace-file.js";

// ─── Wire shapes ────────────────────────────────────────────────────────────

/** Output speed of one run: median tok/s and time to first token over its own model calls. */
export interface CompareSpeed {
  readonly tokensPerSecond?: { readonly median: number; readonly lowerBound: boolean; readonly calls: number };
  readonly firstTokenMs?: { readonly median: number; readonly calls: number };
}

/** One side of a comparison: the stored run row plus what Cortex measured on it. */
export interface CompareSide {
  readonly run: RunSummary;
  /** `completedAt - startedAt`, unset while the run is live. */
  readonly durationMs?: number;
  readonly speed: CompareSpeed;
  /** The run recorded a tracer JSONL Cortex can read. */
  readonly hasTrace: boolean;
}

/** One config path whose value differs. Values are compact JSON; absent = not set on that run. */
export interface ConfigDiffRow {
  readonly path: string;
  readonly a?: string;
  readonly b?: string;
}

/** The resolved-config difference. */
export interface CompareConfig {
  /** Each run reported its resolved config (`AgentStarted.config` / `run-started.config`). */
  readonly a: boolean;
  readonly b: boolean;
  readonly differs: readonly ConfigDiffRow[];
  /** Paths with the same value on both runs. */
  readonly sameCount: number;
  /** More rows differed than the response carries. */
  readonly truncated: boolean;
}

/** One tool call in a step row. */
export interface StepCall {
  readonly toolName: string;
  readonly argsHash: string;
  readonly ok: boolean;
  /** 1-based kernel loop (the run view's trace row), `null` when the trace has no loop for it. */
  readonly loop: number | null;
  /** Compact JSON of the call's arguments, capped. */
  readonly args: string;
}

/** Position `index` of both runs' tool-call sequences, aligned the way `diffTraces` aligns them. */
export interface CompareStep {
  readonly index: number;
  readonly a?: StepCall;
  readonly b?: StepCall;
  /** Same tool and same arguments on both sides. */
  readonly same: boolean;
}

/** Loop `loop` on both runs: indexes into `steps` of the calls each made in it. */
export interface CompareLoop {
  readonly loop: number;
  readonly a: readonly number[];
  readonly b: readonly number[];
  /** Same tool calls, same arguments, same order. */
  readonly same: boolean;
}

/** Trace-level figures for one side (framework `TraceSnapshot`). */
export interface TraceSideStats {
  readonly task: string;
  readonly model: string;
  readonly iterations: number;
  readonly toolCalls: number;
  readonly totalTokens: number;
  readonly totalCostUsd: number;
  readonly durationMs: number;
}

/** The trace comparison, or why there is none. */
export type CompareTrace =
  | { readonly available: false; readonly missing: readonly ("a" | "b")[] }
  | {
      readonly available: true;
      /** The framework's diff, as `diffTraces` returns it (`outputDiff.original` = run A). */
      readonly diff: ReplayDiff;
      readonly a: TraceSideStats;
      readonly b: TraceSideStats;
      readonly steps: readonly CompareStep[];
      readonly loops: readonly CompareLoop[];
      /** First position where the tool sequences part (`diffTraces` edits), `null` when they never do. */
      readonly firstDivergence: { readonly step: number; readonly loopA: number | null; readonly loopB: number | null } | null;
    };

/** `GET /api/runs/compare?a=&b=` response. */
export interface RunCompareReport {
  readonly a: CompareSide;
  readonly b: CompareSide;
  readonly config: CompareConfig;
  readonly trace: CompareTrace;
}

// ─── Pure helpers ───────────────────────────────────────────────────────────

const VALUE_CAP = 300;
const ARGS_CAP = 160;
const MAX_CONFIG_ROWS = 200;
const MAX_DEPTH = 8;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** JSON with object keys sorted, so key order never reads as a difference. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableJson(v[k])}`)
      .join(",")}}`;
  }
  const s = JSON.stringify(v);
  return s === undefined ? "null" : s;
}

const cap = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Leaf paths of a config object (`mechanisms.posture.mode`); arrays and values below the depth cap are leaves. */
function leaves(obj: Record<string, unknown>, prefix = "", depth = 0, out = new Map<string, string>()): Map<string, string> {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (isPlainObject(v) && depth < MAX_DEPTH && Object.keys(v).length > 0) leaves(v, path, depth + 1, out);
    else out.set(path, stableJson(v));
  }
  return out;
}

/** Config paths whose values differ between two resolved configs, sorted by path. */
export function diffConfigs(a: Record<string, unknown> | undefined, b: Record<string, unknown> | undefined): CompareConfig {
  const la = a ? leaves(a) : new Map<string, string>();
  const lb = b ? leaves(b) : new Map<string, string>();
  const paths = [...new Set([...la.keys(), ...lb.keys()])].sort();
  const differs: ConfigDiffRow[] = [];
  let sameCount = 0;
  for (const path of paths) {
    const va = la.get(path);
    const vb = lb.get(path);
    if (va === vb) {
      sameCount++;
      continue;
    }
    differs.push({
      path,
      ...(va !== undefined ? { a: cap(va, VALUE_CAP) } : {}),
      ...(vb !== undefined ? { b: cap(vb, VALUE_CAP) } : {}),
    });
  }
  return {
    a: a !== undefined,
    b: b !== undefined,
    differs: differs.slice(0, MAX_CONFIG_ROWS),
    sameCount,
    truncated: differs.length > MAX_CONFIG_ROWS,
  };
}

/**
 * A recorded run's tool calls in the order they ran (by trace `seq`).
 * `snapshotFromRecordedRun` lists them grouped by tool + arguments (its tool
 * table's key order), which is not the run's order once a call repeats, so the
 * step diff re-sorts them (gap reported to the replay owner).
 */
export function chronologicalCalls(run: RecordedRun): RecordedToolResult[] {
  return [...run.toolTable.values()].flat().sort((x, y) => x.seq - y.seq);
}

/** The framework snapshot with its tool calls in run order. */
export function snapshotOf(run: RecordedRun, calls: readonly RecordedToolResult[]): TraceSnapshot {
  return {
    ...snapshotFromRecordedRun(run),
    toolCalls: calls.map((c) => ({ toolName: c.toolName, argsHash: c.argsHash, ok: c.ok })),
  };
}

const loopOfIter = (iter: number): number | null => (iter >= 0 ? iter + 1 : null);

const stepCall = (c: RecordedToolResult): StepCall => ({
  toolName: c.toolName,
  argsHash: c.argsHash,
  ok: c.ok,
  loop: loopOfIter(c.iter),
  args: cap(stableJson(c.args ?? null), ARGS_CAP),
});

const statsOf = (s: TraceSnapshot): TraceSideStats => ({
  task: s.task,
  model: s.model,
  iterations: s.iterations,
  toolCalls: s.toolCalls.length,
  totalTokens: s.totalTokens,
  totalCostUsd: s.totalCostUsd,
  durationMs: s.durationMs,
});

/** Compare two recorded runs: the framework diff plus step and loop rows. Pure. */
export function compareRecordedRuns(a: RecordedRun, b: RecordedRun): Extract<CompareTrace, { available: true }> {
  const callsA = chronologicalCalls(a);
  const callsB = chronologicalCalls(b);
  const snapA = snapshotOf(a, callsA);
  const snapB = snapshotOf(b, callsB);
  const diff = diffTraces(snapA, snapB);

  const steps: CompareStep[] = [];
  for (let i = 0; i < Math.max(callsA.length, callsB.length); i++) {
    const x = callsA[i];
    const y = callsB[i];
    steps.push({
      index: i,
      ...(x ? { a: stepCall(x) } : {}),
      ...(y ? { b: stepCall(y) } : {}),
      same: x !== undefined && y !== undefined && x.toolName === y.toolName && x.argsHash === y.argsHash,
    });
  }

  const byLoop = (side: "a" | "b"): Map<number, number[]> => {
    const m = new Map<number, number[]>();
    for (const s of steps) {
      const loop = s[side]?.loop;
      if (loop === null || loop === undefined) continue;
      const list = m.get(loop) ?? [];
      list.push(s.index);
      m.set(loop, list);
    }
    return m;
  };
  const loopsA = byLoop("a");
  const loopsB = byLoop("b");
  const lastLoop = Math.max(snapA.iterations, snapB.iterations, ...loopsA.keys(), ...loopsB.keys(), 0);
  const keyOf = (side: "a" | "b", idx: number): string => {
    const c = steps[idx]?.[side];
    return c ? `${c.toolName}#${c.argsHash}` : "";
  };
  const loops: CompareLoop[] = [];
  for (let loop = 1; loop <= lastLoop; loop++) {
    const la = loopsA.get(loop) ?? [];
    const lb = loopsB.get(loop) ?? [];
    const same = la.length === lb.length && la.every((idx, k) => keyOf("a", idx) === keyOf("b", lb[k] ?? -1));
    loops.push({ loop, a: la, b: lb, same });
  }

  const firstEdit = diff.toolSequenceDiff.reduce<number | null>((min, e) => {
    const at = e.kind === "reordered" ? Math.min(e.from, e.to) : e.atIndex;
    return min === null || at < min ? at : min;
  }, null);
  const firstDivergence =
    firstEdit === null
      ? null
      : {
          step: firstEdit,
          loopA: steps[firstEdit]?.a?.loop ?? null,
          loopB: steps[firstEdit]?.b?.loop ?? null,
        };

  return { available: true, diff, a: statsOf(snapA), b: statsOf(snapB), steps, loops, firstDivergence };
}

/** `AgentStarted.config` from a run's stored events, if it reported one. */
export function startedConfigOf(events: readonly { readonly type: string; readonly payload: string }[]): Record<string, unknown> | undefined {
  for (const e of events) {
    if (e.type !== "AgentStarted") continue;
    try {
      const p: unknown = JSON.parse(e.payload);
      if (isPlainObject(p) && isPlainObject(p.config)) return p.config;
    } catch {
      /* unparseable payload: keep looking */
    }
  }
  return undefined;
}

/** Median speed over a run's own stored `LLMRequestCompleted` calls (Model page rule). */
export function speedOf(run: RunSummary, events: readonly { readonly type: string; readonly payload: string }[]): CompareSpeed {
  if (!run.provider || !run.model) return {};
  const calls = events.filter((e) => e.type === "LLMRequestCompleted").map((e) => ({ runId: run.runId, payload: e.payload }));
  const t = modelThroughputOf(run.provider, run.model, calls);
  return {
    ...(t.tokensPerSecond ? { tokensPerSecond: t.tokensPerSecond } : {}),
    ...(t.firstTokenMs ? { firstTokenMs: t.firstTokenMs } : {}),
  };
}

// ─── Reader (I/O + cache) ───────────────────────────────────────────────────

/** Reads and caches run comparisons. One per server (see `runsRouter`). */
export interface RunCompareReader {
  /** Compare run `a` with run `b`; a `CortexNotFoundError` value (not a failure) when Cortex has no row for one of them. */
  readonly compare: (
    a: string,
    b: string,
  ) => Effect.Effect<RunCompareReport | CortexNotFoundError, CortexError, CortexStoreService>;
}

/** The trace half of a pair plus each recording's `run-started.config` (the config fallback for runs with no stored `AgentStarted`). */
interface TraceHalf {
  readonly trace: CompareTrace;
  readonly configA?: Record<string, unknown>;
  readonly configB?: Record<string, unknown>;
}

interface Loaded {
  readonly file: string;
  readonly stamp: string;
  readonly run: RecordedRun | undefined;
}

/**
 * Build a {@link RunCompareReader} over `dirs` (default: the tracer's directories).
 * The trace half is cached per pair, keyed by both files' size and mtime, so a
 * run still writing its trace is re-read; at most `maxEntries` pairs are kept.
 */
export function makeRunCompareReader(
  opts: { readonly dirs?: () => readonly string[]; readonly maxEntries?: number } = {},
): RunCompareReader {
  const dirs = opts.dirs ?? traceDirs;
  const maxEntries = opts.maxEntries ?? 100;
  const cache = new Map<string, { readonly stamp: string; readonly half: TraceHalf }>();
  const remember = (key: string, stamp: string, half: TraceHalf): void => {
    cache.delete(key);
    cache.set(key, { stamp, half });
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  };

  const stampOf = (runId: string): Effect.Effect<{ file: string; stamp: string } | undefined, CortexError> =>
    Effect.gen(function* () {
      const file = findRunTraceFile(runId, dirs());
      if (file === undefined) return undefined;
      const st = yield* Effect.try({
        try: () => statSync(file),
        catch: (cause) => new CortexError({ message: `Could not read the trace for ${runId}`, cause }),
      });
      return { file, stamp: `${st.size}:${st.mtimeMs}` };
    });

  // A trace the replay loader rejects (no run-started) counts as no trace: the page degrades to the summary.
  const load = (s: { file: string; stamp: string }): Effect.Effect<Loaded> =>
    Effect.tryPromise(() => loadRecordedRun(s.file)).pipe(
      Effect.map((run): Loaded => ({ ...s, run })),
      Effect.orElseSucceed((): Loaded => ({ ...s, run: undefined })),
    );

  const traceOf = (a: string, b: string): Effect.Effect<TraceHalf, CortexError> =>
    Effect.gen(function* () {
      const sa = yield* stampOf(a);
      const sb = yield* stampOf(b);
      const key = `${a}|${b}`;
      const stamp = `${sa?.stamp ?? "-"}|${sb?.stamp ?? "-"}`;
      const hit = cache.get(key);
      if (hit && hit.stamp === stamp) return hit.half;
      const ra = sa ? (yield* load(sa)).run : undefined;
      const rb = sb ? (yield* load(sb)).run : undefined;
      const trace: CompareTrace =
        ra && rb
          ? yield* Effect.try({
              try: () => compareRecordedRuns(ra, rb),
              catch: (cause) => new CortexError({ message: `Could not compare ${a} with ${b}`, cause }),
            })
          : { available: false, missing: [...(ra ? [] : ["a" as const]), ...(rb ? [] : ["b" as const])] };
      const half: TraceHalf = {
        trace,
        ...(ra && isPlainObject(ra.config) && Object.keys(ra.config).length > 0 ? { configA: ra.config } : {}),
        ...(rb && isPlainObject(rb.config) && Object.keys(rb.config).length > 0 ? { configB: rb.config } : {}),
      };
      remember(key, stamp, half);
      return half;
    });

  return {
    compare: (a, b) =>
      Effect.gen(function* () {
        const store = yield* CortexStoreService;
        const runA = yield* store.getRun(a);
        if (Option.isNone(runA)) return new CortexNotFoundError({ id: a, resource: "run" });
        const runB = yield* store.getRun(b);
        if (Option.isNone(runB)) return new CortexNotFoundError({ id: b, resource: "run" });
        const evA = yield* store.getRunEvents(a);
        const evB = yield* store.getRunEvents(b);
        const { trace, configA, configB } = yield* traceOf(a, b);
        const side = (run: RunSummary, events: typeof evA, hasTrace: boolean): CompareSide => ({
          run,
          ...(run.completedAt !== undefined ? { durationMs: Math.max(0, run.completedAt - run.startedAt) } : {}),
          speed: speedOf(run, events),
          hasTrace,
        });
        const missing = trace.available ? [] : trace.missing;
        return {
          a: side(runA.value, evA, !missing.includes("a")),
          b: side(runB.value, evB, !missing.includes("b")),
          config: diffConfigs(startedConfigOf(evA) ?? configA, startedConfigOf(evB) ?? configB),
          trace,
        };
      }),
  };
}
