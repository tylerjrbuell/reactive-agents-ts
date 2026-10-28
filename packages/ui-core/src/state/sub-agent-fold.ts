import type { SubAgentActivity, SubAgentRunInfoWire, UiStreamEvent } from "../protocol/events.js";
import type { TurnTraceState } from "./turn-trace.js";

/**
 * Sub-agent fold: places each wrapped `SubAgentActivity` chunk into the block of
 * the child run it belongs to and applies the UNWRAPPED event to that child's own
 * state with the caller's fold (`foldTurnTrace` for turns, the same fold for run
 * state). There is no second fold: a child is just another turn trace.
 *
 * ## Keying rule
 * A block is keyed by the FIRST `run.runId` seen for the child (its stable key,
 * the key of {@link SubAgentTrace} records). Runtime caveat: a child's earliest
 * chunks (its `PhaseStarted(sub-agent)` and early phases) carry its task id until
 * a grandchild's `parentRunId` resolves the minted run id, so one child can show
 * up under two run ids. Resolution of a chunk with run id `r`, name `n`, depth `d`:
 *  1. `r` equals the key or a recorded alias of a block -> that block.
 *  2. A `PhaseStarted(sub-agent)` for an unknown `r` -> NEW block (the lifecycle
 *     start always announces a distinct child, so same-name siblings stay apart).
 *  3. Any other chunk for an unknown `r` -> the oldest still-running block at the
 *     same depth with the same name that has no alias yet; `r` is recorded as its
 *     alias (runId drift). Otherwise a NEW block.
 * Nesting: the runtime sends descendants flat. A chunk whose `parentRunId` is the
 * key/alias of a block is folded INTO that block (recursively); an unknown parent
 * with `depth > 1` falls back to the single running block at `depth - 1`, else the
 * chunk becomes a direct child here. Known limit: drift chunks of two same-name
 * siblings that both still lack an alias resolve to the older one.
 */

/** One sub-agent's accumulated state. `S` is the child's own folded state. */
export interface SubAgentBlock<S> {
  /** Latest identity seen for the child. */
  readonly run: SubAgentRunInfoWire;
  /** Every run id seen for it (first = the record key). */
  readonly runIds: readonly string[];
  readonly status: "running" | "done" | "failed";
  /** The child's own state, folded by the same function as its parent's. */
  readonly trace: S;
  readonly output?: string;
  readonly tokens?: number;
  readonly costUsd?: number;
  /** `timestamp` of its `PhaseStarted(sub-agent)`, 0 if never seen. */
  readonly startedAt: number;
  /** `startedAt` + reported duration, when both are known. */
  readonly endedAt?: number;
}

/** Live sub-agent block: its trace is a full {@link TurnTraceState}. */
export type SubAgentTrace = SubAgentBlock<TurnTraceState>;

/** Fold hooks supplied by the caller (keeps this module free of an import cycle). */
export interface SubAgentFolder<S> {
  readonly init: () => S;
  readonly fold: (s: S, event: UiStreamEvent) => S;
  /** The block map nested inside a child's state. */
  readonly nested: (s: S) => Readonly<Record<string, SubAgentBlock<S>>>;
  readonly withNested: (s: S, blocks: Readonly<Record<string, SubAgentBlock<S>>>) => S;
}

type Blocks<S> = Readonly<Record<string, SubAgentBlock<S>>>;

const isStart = (e: UiStreamEvent): boolean => e._tag === "PhaseStarted" && e.phase === "sub-agent";

const hasId = <S>(b: SubAgentBlock<S>, id: string): boolean => b.runIds.includes(id);

/** Key path (outermost first) to the block that owns `id`, searching nested blocks too. */
function pathTo<S>(f: SubAgentFolder<S>, blocks: Blocks<S>, id: string): string[] | undefined {
  for (const [key, b] of Object.entries(blocks)) {
    if (hasId(b, id)) return [key];
    const inner = pathTo(f, f.nested(b.trace), id);
    if (inner) return [key, ...inner];
  }
  return undefined;
}

/** Key paths of every running block at `depth` (fallback parent lookup). */
function runningAt<S>(f: SubAgentFolder<S>, blocks: Blocks<S>, depth: number, prefix: string[] = []): string[][] {
  return Object.entries(blocks).flatMap(([key, b]) => [
    ...(b.status === "running" && b.run.depth === depth ? [[...prefix, key]] : []),
    ...runningAt(f, f.nested(b.trace), depth, [...prefix, key]),
  ]);
}

const update = <S>(f: SubAgentFolder<S>, blocks: Blocks<S>, path: readonly string[], fn: (b: SubAgentBlock<S>) => SubAgentBlock<S>): Blocks<S> => {
  const [head, ...rest] = path;
  const target = blocks[head!]!;
  const next = rest.length === 0 ? fn(target) : { ...target, trace: f.withNested(target.trace, update(f, f.nested(target.trace), rest, fn)) };
  return { ...blocks, [head!]: next };
};

const settle = <S>(b: SubAgentBlock<S>, event: UiStreamEvent): SubAgentBlock<S> => {
  if (event._tag === "PhaseStarted" && event.phase === "sub-agent") return { ...b, startedAt: event.timestamp };
  if (event._tag === "StreamError" || event._tag === "StreamCancelled") return { ...b, status: "failed" };
  if (event._tag === "StreamCompleted") {
    const m = event.metadata ?? {};
    return {
      ...b,
      status: event.success === false ? "failed" : "done",
      output: event.output,
      ...(typeof m.tokensUsed === "number" ? { tokens: m.tokensUsed } : {}),
      ...(typeof m.cost === "number" ? { costUsd: m.cost } : {}),
      ...(b.startedAt > 0 && typeof m.duration === "number" ? { endedAt: b.startedAt + m.duration } : {}),
    };
  }
  return b;
};

/** Fold one `SubAgentActivity` into `blocks` (immutably). See the module keying rule. */
export function foldSubAgentActivity<S>(f: SubAgentFolder<S>, blocks: Blocks<S>, ev: SubAgentActivity): Blocks<S> {
  const { run, event } = ev;
  // Nesting: descend into the parent block when the parent is known (or unambiguous).
  let parentPath = run.parentRunId !== undefined ? pathTo(f, blocks, run.parentRunId) : undefined;
  if (parentPath === undefined && run.depth > 1) {
    const candidates = runningAt(f, blocks, run.depth - 1);
    if (candidates.length === 1) parentPath = candidates[0];
  }
  if (parentPath !== undefined) {
    return update(f, blocks, parentPath, (p) => ({ ...p, trace: f.withNested(p.trace, foldSubAgentActivity(f, f.nested(p.trace), ev)) }));
  }
  // Direct child at this level.
  const entries = Object.entries(blocks);
  let key = entries.find(([, b]) => hasId(b, run.runId))?.[0];
  if (key === undefined && !isStart(event)) {
    key = entries.find(([, b]) => b.status === "running" && b.run.depth === run.depth && b.run.name === run.name && b.runIds.length === 1)?.[0];
  }
  const base: SubAgentBlock<S> =
    key !== undefined ? blocks[key]! : { run, runIds: [run.runId], status: "running", trace: f.init(), startedAt: 0 };
  const runIds = base.runIds.includes(run.runId) ? base.runIds : [...base.runIds, run.runId];
  const folded = settle({ ...base, run, runIds, trace: f.fold(base.trace, event) }, event);
  return { ...blocks, [key ?? run.runId]: folded };
}
