/**
 * Live strategy phases: what a reasoning strategy is doing right now, folded from the
 * `kernelPass` labels the framework stamps on its step events. One table maps every
 * registered strategy to its phases; a strategy with no entry (or a phase no entry knows)
 * degrades to a generic phase stepper, never to nothing. Pure and framework-free, so a
 * builder's own chat UI draws the same cards Cortex does.
 *
 * Label grammar: `<strategy>:<phase>[-n][:sub]`, for example `reflexion:critique-2`,
 * `plan-execute:step-3:done`, `code-action:execute:2`, `tree-of-thought:explore`.
 * Registry names and label prefixes differ for plan-execute (`plan-execute-reflect`
 * registers, `plan-execute` labels), so each entry names its own prefix.
 */

/** One phase a strategy moves through. */
export interface StrategyPhaseDef {
  readonly id: string;
  /** Present-tense line for the status line, e.g. "Critiquing". */
  readonly label: string;
}

/** What the table knows about one strategy. */
export interface StrategySpec {
  /** Display name, e.g. "Tree of Thought". */
  readonly label: string;
  /** The prefix of this strategy's `kernelPass` labels. */
  readonly pass: string;
  /** Phases in the order they usually run; empty for a strategy that has none to show. */
  readonly phases: readonly StrategyPhaseDef[];
}

const REACTIVE: StrategySpec = { label: "Reactive", pass: "reactive", phases: [] };
const BLUEPRINT: StrategySpec = {
  label: "Blueprint",
  pass: "blueprint",
  phases: [
    { id: "plan", label: "Planning" },
    { id: "verify", label: "Checking the plan" },
    { id: "execute", label: "Running the plan" },
    { id: "step", label: "Running a step" },
    { id: "patch", label: "Patching the plan" },
    { id: "solve", label: "Writing the answer" },
  ],
};

/**
 * Phase table, keyed by the strategy's registry name (every name in
 * `packages/reasoning/src/services/strategy-registry.ts`; a test pins the two together,
 * so a new strategy fails until it is mapped here).
 */
export const STRATEGY_PHASES: Readonly<Record<string, StrategySpec>> = {
  reactive: REACTIVE,
  react: REACTIVE,
  direct: { label: "Direct", pass: "direct", phases: [] },
  adaptive: { label: "Adaptive", pass: "adaptive", phases: [{ id: "select", label: "Choosing a strategy" }] },
  reflexion: {
    label: "Reflexion",
    pass: "reflexion",
    phases: [
      { id: "generate", label: "Drafting" },
      { id: "critique", label: "Critiquing" },
      { id: "improve", label: "Improving" },
    ],
  },
  "plan-execute-reflect": {
    label: "Plan, execute, reflect",
    pass: "plan-execute",
    phases: [
      { id: "plan", label: "Planning" },
      { id: "refine", label: "Refining the plan" },
      { id: "augment", label: "Extending the plan" },
      { id: "step", label: "Running a step" },
      { id: "reflect", label: "Reflecting" },
      { id: "synthesize", label: "Writing the answer" },
    ],
  },
  "tree-of-thought": {
    label: "Tree of Thought",
    pass: "tree-of-thought",
    phases: [
      { id: "explore", label: "Exploring options" },
      { id: "select", label: "Choosing the best path" },
      { id: "execute", label: "Carrying out the best path" },
    ],
  },
  "code-action": {
    label: "Code action",
    pass: "code-action",
    phases: [
      { id: "plan", label: "Planning" },
      { id: "execute", label: "Running code" },
      { id: "verify", label: "Checking the result" },
    ],
  },
  blueprint: BLUEPRINT,
  rewoo: BLUEPRINT,
};

/** Spec for a registry name or a label prefix; `undefined` for a strategy the table does not know. */
export function strategySpecOf(strategyOrPass: string | undefined): StrategySpec | undefined {
  if (!strategyOrPass) return undefined;
  const direct = STRATEGY_PHASES[strategyOrPass];
  if (direct) return direct;
  return Object.values(STRATEGY_PHASES).find((s) => s.pass === strategyOrPass);
}

/** The phases to draw for a strategy: its table entry's, or none (generic fallback draws what ran). */
export function strategyPhasesOf(strategy: string | undefined): readonly StrategyPhaseDef[] {
  return strategySpecOf(strategy)?.phases ?? [];
}

/** A tree-of-thought node as the strategy scored it. */
export interface TotNode {
  readonly id: string;
  readonly parentId?: string;
  readonly depth: number;
  readonly score?: number;
  readonly content?: string;
  /** Dropped from further expansion. */
  readonly pruned?: boolean;
  /** On the path the strategy selected. */
  readonly selected?: boolean;
}

/** Verification outcome of a code-action turn. */
export interface CodeVerify {
  readonly verdict: string;
  readonly summary: string;
}

/** Optional detail a step may carry. Every field is absent when the framework did not report it. */
export interface StrategyStepDetail {
  readonly node?: TotNode;
  /** Node ids from root to leaf of the path tree-of-thought selected. */
  readonly path?: readonly string[];
  /** Code the model wrote (code-action). */
  readonly code?: string;
  /** Sandbox output (code-action). */
  readonly stdout?: string;
  /** Sandbox error output (code-action). */
  readonly stderr?: string;
  /** Verification of the turn (code-action). */
  readonly verify?: CodeVerify;
  /** The critique text (reflexion). */
  readonly critique?: string;
  /** The critique accepted the attempt (reflexion). */
  readonly accepted?: boolean;
}

/** One strategy step: a parsed `kernelPass` label plus optional detail. */
export interface StrategyStep extends StrategyStepDetail {
  /** The label prefix as sent (`plan-execute`), the key the card registry resolves. */
  readonly strategy: string;
  /** The raw `kernelPass` label. */
  readonly pass: string;
  /** Phase id without its number: `critique` for `critique-2`. */
  readonly phase: string;
  /** The number in the phase (`critique-2`, `step-3`) or sub-label (`execute:2`). */
  readonly n?: number;
  /** The trailing sub-label: `start`, `done`, `failed`, `retry-1`, `patch`. */
  readonly sub?: string;
}

const PHASE_NUMBER = /^(.*?)-(\d+)$/;

/** Capitalise the first letter, spaces for dashes: the label of a phase the table does not know. */
const titleOfId = (id: string): string => {
  const text = id.replace(/[-_]+/g, " ").trim();
  return text.length === 0 ? "Working" : text[0]!.toUpperCase() + text.slice(1);
};

/** The phase id of a label (`critique-2` -> `critique`), `undefined` for an unlabelled pass. */
export function phaseIdOf(pass: string): string | undefined {
  const token = pass.split(":")[1];
  if (!token) return undefined;
  return PHASE_NUMBER.exec(token)?.[1] ?? token;
}

/** Parse one `kernelPass` label; `undefined` when it is empty. */
export function strategyStepOf(pass: string, detail: StrategyStepDetail = {}): StrategyStep | undefined {
  const parts = pass.split(":");
  const strategy = parts[0]?.trim();
  if (!strategy) return undefined;
  const token = parts[1] ?? "";
  const numbered = PHASE_NUMBER.exec(token);
  const phase = (numbered?.[1] ?? token) || "run";
  const rest = parts.slice(2).join(":");
  // `execute:2` carries its number in the sub-label; `step-2:done` carries it in the phase.
  const subNumber = /^\d+$/.test(rest) ? Number(rest) : undefined;
  const n = numbered ? Number(numbered[2]) : subNumber;
  const sub = rest.length > 0 && subNumber === undefined ? rest : undefined;
  return {
    strategy,
    pass,
    phase,
    ...(n !== undefined ? { n } : {}),
    ...(sub !== undefined ? { sub } : {}),
    ...detail,
  };
}

const record = (v: unknown): Record<string, unknown> | undefined =>
  v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
const text = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

/** A tree-of-thought node from a structured payload (`node`, or flat `nodeId`/`parentId`/`depth`/`score`), read defensively. */
export function totNodeOfWire(raw: unknown): TotNode | undefined {
  const r = record(raw);
  if (!r) return undefined;
  const n = record(r.node) ?? r;
  const id = text(n.id) ?? text(n.nodeId);
  const depth = num(n.depth);
  if (id === undefined || depth === undefined) return undefined;
  const parentId = text(n.parentId);
  const score = num(n.score);
  const content = text(n.content) ?? text(n.thought);
  return {
    id,
    depth,
    ...(parentId !== undefined ? { parentId } : {}),
    ...(score !== undefined ? { score } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(typeof n.pruned === "boolean" ? { pruned: n.pruned } : {}),
    ...(typeof n.selected === "boolean" ? { selected: n.selected } : {}),
  };
}

const TOT_THOUGHT = /^\[TOT d=(\d+)\] score=([\d.]+): ([\s\S]*)$/;

/**
 * A node read from the explore step's narration (`[TOT d=2] score=0.80: ...`), for runs whose
 * framework does not yet report structured nodes. No parent is known; `index` keeps ids unique.
 */
export function totNodeOfThought(thought: string, index: number): TotNode | undefined {
  const m = TOT_THOUGHT.exec(thought);
  if (!m) return undefined;
  return { id: `thought-${index}`, depth: Number(m[1]), score: Number(m[2]), content: m[3]!.replace(/\.\.\.$/, "") };
}

/**
 * A step from its wire form (the `StepEvent.step` of a chat stream), read defensively:
 * anything but `{ kind: "strategy-step", pass: string }` is `undefined`, optional detail that
 * is not the expected type is dropped.
 */
export function strategyStepFromWire(raw: unknown): StrategyStep | undefined {
  const r = record(raw);
  if (!r || r.kind !== "strategy-step") return undefined;
  const pass = text(r.pass);
  if (pass === undefined) return undefined;
  const node = totNodeOfWire(r.node ?? (r.nodeId !== undefined ? r : undefined));
  const code = text(r.code);
  const stdout = text(r.stdout);
  const stderr = text(r.stderr);
  const critique = text(r.critique);
  const path = Array.isArray(r.path) && r.path.every((p) => typeof p === "string") && r.path.length > 0 ? (r.path as string[]) : undefined;
  const v = record(r.verify);
  const verify = v && text(v.verdict) !== undefined ? { verdict: text(v.verdict)!, summary: typeof v.summary === "string" ? v.summary : "" } : undefined;
  return strategyStepOf(pass, {
    ...(node ? { node } : {}),
    ...(path ? { path } : {}),
    ...(code !== undefined ? { code } : {}),
    ...(stdout !== undefined ? { stdout } : {}),
    ...(stderr !== undefined ? { stderr } : {}),
    ...(verify ? { verify } : {}),
    ...(critique !== undefined ? { critique } : {}),
    ...(typeof r.accepted === "boolean" ? { accepted: r.accepted } : {}),
  });
}

/** Where one row of the phase stepper stands. */
export type StrategyRowStatus = "running" | "done" | "failed";

/** One row of the stepper: a phase (and its number) the run has entered. */
export interface StrategyRow {
  /** `phase` or `phase-n`; unique within the run. */
  readonly key: string;
  readonly phase: string;
  readonly n?: number;
  readonly label: string;
  readonly status: StrategyRowStatus;
  /** Latest sub-label seen for the row (`retry-1`, `patch`). */
  readonly sub?: string;
  readonly code?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly verify?: CodeVerify;
  readonly critique?: string;
  readonly accepted?: boolean;
}

/** Folded state of one run's strategy activity; start from {@link initialStrategyRun}. */
export interface StrategyRunState {
  /** Label prefix of the strategy that is running. */
  readonly strategy?: string;
  /** Display name: the table's, or the prefix when the table does not know it. */
  readonly label?: string;
  readonly current?: StrategyStep;
  readonly rows: readonly StrategyRow[];
  /** Tree-of-thought nodes, in the order first scored; a later report of the same id replaces the earlier one. */
  readonly nodes: readonly TotNode[];
  /** Node ids of the selected path, root to leaf, once the strategy reported it. */
  readonly path?: readonly string[];
  /** True once the run ended (every row settled). */
  readonly ended: boolean;
}

/** Mixin for a turn view that carries its strategy's live phases (absent when the strategy reported none). */
export interface StrategyRunHolder {
  strategyRun?: StrategyRunState;
}

/** The empty fold. */
export const initialStrategyRun: StrategyRunState = { rows: [], nodes: [], ended: false };

const keyOf = (s: StrategyStep): string => (s.n !== undefined ? `${s.phase}-${s.n}` : s.phase);

/** Row label: "Critiquing 2" for a numbered phase the table knows, "Running a step 3" for a step. */
function rowLabel(strategy: string, s: StrategyStep): string {
  const def = strategyPhasesOf(strategy).find((p) => p.id === s.phase);
  const base = def?.label ?? titleOfId(s.phase);
  return s.n !== undefined ? `${base} ${s.n}` : base;
}

/** Fold one step into the run. A new phase settles the previous row; same-phase steps update their row. */
export function foldStrategyRun(state: StrategyRunState, step: StrategyStep): StrategyRunState {
  const key = keyOf(step);
  const failed = step.sub === "failed";
  const settled = step.sub === "done" || failed;
  const existing = state.rows.find((r) => r.key === key);
  const rows: StrategyRow[] = state.rows.map((r) => (r.key !== key && r.status === "running" ? { ...r, status: "done" } : r));
  const status: StrategyRowStatus = failed ? "failed" : settled ? "done" : "running";
  const detail = {
    ...(step.code !== undefined ? { code: step.code } : {}),
    ...(step.stdout !== undefined ? { stdout: step.stdout } : {}),
    ...(step.stderr !== undefined ? { stderr: step.stderr } : {}),
    ...(step.verify !== undefined ? { verify: step.verify } : {}),
    ...(step.critique !== undefined ? { critique: step.critique } : {}),
    ...(step.accepted !== undefined ? { accepted: step.accepted } : {}),
  };
  if (existing) {
    const i = rows.findIndex((r) => r.key === key);
    rows[i] = { ...existing, ...detail, status, ...(step.sub !== undefined ? { sub: step.sub } : {}) };
  } else {
    rows.push({ key, phase: step.phase, ...(step.n !== undefined ? { n: step.n } : {}), label: rowLabel(step.strategy, step), status, ...(step.sub !== undefined ? { sub: step.sub } : {}), ...detail });
  }
  const incoming = step.node;
  const nodes = !incoming
    ? state.nodes
    : state.nodes.some((n) => n.id === incoming.id)
      ? state.nodes.map((n) => (n.id === incoming.id ? { ...n, ...incoming } : n))
      : [...state.nodes, incoming];
  const path = step.path ?? state.path;
  return {
    ...(path ? { path } : {}),
    strategy: step.strategy,
    label: strategySpecOf(step.strategy)?.label ?? titleOfId(step.strategy),
    current: step,
    rows,
    nodes,
    ended: false,
  };
}

/** Mark the run over: every running row settles. */
export function endStrategyRun(state: StrategyRunState): StrategyRunState {
  if (state.ended) return state;
  return { ...state, ended: true, rows: state.rows.map((r) => (r.status === "running" ? { ...r, status: "done" } : r)) };
}

/**
 * The status-line text for the run's current phase ("Critiquing 2", "Exploring options, level 2"),
 * or `undefined` when the strategy has no phase to name (the caller keeps its own line).
 */
export function strategyStatusOf(state: StrategyRunState): string | undefined {
  const step = state.current;
  if (!step || state.ended || state.strategy === undefined) return undefined;
  // A strategy the table does not know, or one with no phases (reactive, direct), has no phase to name.
  if (strategyPhasesOf(state.strategy).length === 0 && strategySpecOf(state.strategy) !== undefined) return undefined;
  const base = rowLabel(state.strategy, step);
  if (step.phase === "explore") {
    const depth = state.nodes.at(-1)?.depth;
    if (depth !== undefined) return `${base}, level ${depth}`;
  }
  return base;
}

/** One level of the tree-of-thought view. */
export interface TotLevel {
  readonly depth: number;
  readonly nodes: readonly (TotNode & { readonly best: boolean })[];
  /** Best score at this level. */
  readonly best?: number;
}

/**
 * The tree-of-thought levels: nodes grouped by depth (shallow first), each level marking its
 * best-scored node. Without parent links this is "best at depth"; the node's `parentId`
 * rides along for a renderer that can draw edges.
 */
export function totTreeOf(state: StrategyRunState): readonly TotLevel[] {
  const byDepth = new Map<number, TotNode[]>();
  for (const n of state.nodes) byDepth.set(n.depth, [...(byDepth.get(n.depth) ?? []), n]);
  return [...byDepth.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([depth, nodes]) => {
      const scored = nodes.filter((n) => n.score !== undefined);
      const best = scored.length > 0 ? Math.max(...scored.map((n) => n.score!)) : undefined;
      const bestId = best !== undefined ? scored.find((n) => n.score === best)?.id : undefined;
      return { depth, nodes: nodes.map((n) => ({ ...n, best: n.id === bestId })), ...(best !== undefined ? { best } : {}) };
    });
}

/** A node with its children, for drawing the tree. */
export interface TotTreeNode {
  readonly node: TotNode;
  readonly children: readonly TotTreeNode[];
  /** On the selected path (the reported path, else the node's own `selected` flag). */
  readonly onPath: boolean;
}

/**
 * The tree-of-thought as a forest: nodes nested under their `parentId`. A node whose parent was not
 * reported (or a framework that reports no parents) is a root, so a flat node list still draws, as
 * a list of roots. The selected path is the reported `tot-path`, else the nodes marked `selected`.
 */
export function totForestOf(state: StrategyRunState): readonly TotTreeNode[] {
  const ids = new Set(state.nodes.map((n) => n.id));
  const onPath = new Set<string>(state.path ?? state.nodes.filter((n) => n.selected === true).map((n) => n.id));
  const build = (n: TotNode): TotTreeNode => ({
    node: n,
    onPath: onPath.has(n.id),
    children: state.nodes.filter((c) => c.parentId === n.id && c.id !== n.id).map(build),
  });
  return state.nodes.filter((n) => n.parentId === undefined || !ids.has(n.parentId)).map(build);
}

/** True when any node reported a parent: the tree has edges to draw (else the level view reads better). */
export const totHasEdges = (state: StrategyRunState): boolean => state.nodes.some((n) => n.parentId !== undefined);

/** Rows of one attempt (reflexion improve/critique rounds, code-action execute/verify rounds). */
export interface StrategyAttempt {
  /** 0 for the first draft (reflexion generate), else the round number. */
  readonly n: number;
  readonly rows: readonly StrategyRow[];
}

/** Rows grouped by attempt number (unnumbered rows join attempt 0), ascending. */
export function attemptsOf(state: StrategyRunState): readonly StrategyAttempt[] {
  const by = new Map<number, StrategyRow[]>();
  for (const r of state.rows) by.set(r.n ?? 0, [...(by.get(r.n ?? 0) ?? []), r]);
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([n, rows]) => ({ n, rows }));
}
