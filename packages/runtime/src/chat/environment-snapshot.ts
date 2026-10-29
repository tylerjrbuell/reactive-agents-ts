/**
 * environment-snapshot.ts — between-turn environment awareness for the chat engine.
 *
 * The chat environment (tools, model, skills, docs, goal, user to-do edits...)
 * can change between two turns of the SAME conversation. The model cannot see
 * that unless told. This module is deterministic (no model call):
 *
 *  - {@link snapshotEnvironment}      — normalise host-supplied facts into a snapshot.
 *  - {@link diffEnvironment}          — pure diff of two snapshots into one-line facts.
 *  - {@link renderEnvironmentUpdate}  — the capped, model-neutral notice text.
 *  - {@link EnvironmentTracker}       — the engine's held state (snapshot at end of
 *                                       each turn, diff at the next turn's start).
 *  - {@link environmentUpdateMetadata} / {@link readEnvironmentUpdate} — the per-run
 *                                       carrier (`task.metadata.context.environmentUpdate`)
 *                                       that reaches the run envelope.
 *
 * Zero cost when nothing changed: an empty diff, the first turn, or the opt-out
 * (`environmentUpdates: false`) all yield `undefined` — request bytes are identical
 * to the feature being absent.
 */
import type { EnvironmentChangedEvent, EnvironmentChangeKind, Task } from "@reactive-agents/core";

/** Host-supplied facts about the current environment. Every field optional. */
export interface EnvironmentSnapshotInput {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string | boolean;
  /** Omit and `session()` fills it from the agent's actually registered tools. */
  readonly toolNames?: Iterable<string>;
  readonly skills?: Iterable<string>;
  readonly docSources?: Iterable<string>;
  /** `status: "active"` means a goal is in progress; any other status means finished/none. */
  readonly goal?: { readonly status: string; readonly objective?: string };
  readonly agentControl?: string;
  /** CUMULATIVE count of rows the user added/removed from the agent's to-do list. */
  readonly todoUserEdits?: { readonly added: number; readonly removed: number };
}

/** Normalised (sorted, de-duplicated) snapshot; safe to compare and hold. */
export interface EnvironmentSnapshot {
  readonly provider?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly toolNames: readonly string[];
  readonly skills: readonly string[];
  readonly docSources: readonly string[];
  readonly goal?: { readonly status: string; readonly objective?: string };
  readonly agentControl?: string;
  readonly todoUserEdits: { readonly added: number; readonly removed: number };
}

/** One detected change: a kind plus a one-line, model-neutral summary. */
export interface EnvironmentChange {
  readonly kind: EnvironmentChangeKind;
  readonly summary: string;
}

/** Max change lines rendered into the notice; the rest collapse into "…and N more". */
export const MAX_NOTICE_LINES = 6;
const MAX_NAMES_PER_LINE = 5;
const MAX_TEXT = 120;
/** Header of the rendered notice. */
export const ENVIRONMENT_UPDATE_HEADER = "Environment update since your last turn:";

const uniqSorted = (xs: Iterable<string> | undefined): string[] => [...new Set(xs ?? [])].sort();
const oneLine = (s: string): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};

/** Normalise host facts into a comparable snapshot (pure). */
export function snapshotEnvironment(input: EnvironmentSnapshotInput): EnvironmentSnapshot {
  return {
    ...(input.provider !== undefined ? { provider: input.provider } : {}),
    ...(input.model !== undefined ? { model: input.model } : {}),
    ...(input.thinking !== undefined ? { thinking: String(input.thinking) } : {}),
    toolNames: uniqSorted(input.toolNames),
    skills: uniqSorted(input.skills),
    docSources: uniqSorted(input.docSources),
    ...(input.goal !== undefined ? { goal: input.goal } : {}),
    ...(input.agentControl !== undefined ? { agentControl: input.agentControl } : {}),
    todoUserEdits: input.todoUserEdits ?? { added: 0, removed: 0 },
  };
}

function setDelta(prev: readonly string[], next: readonly string[]): { added: string[]; removed: string[] } {
  const p = new Set(prev);
  const n = new Set(next);
  return { added: next.filter((x) => !p.has(x)), removed: prev.filter((x) => !n.has(x)) };
}

function names(xs: readonly string[], sign: "+" | "-"): string {
  const shown = xs.slice(0, MAX_NAMES_PER_LINE).map((x) => `${sign}${oneLine(x)}`);
  return xs.length > MAX_NAMES_PER_LINE ? [...shown, `${sign}…(${xs.length - MAX_NAMES_PER_LINE} more)`].join(", ") : shown.join(", ");
}

const isActive = (g: EnvironmentSnapshot["goal"]): boolean => g?.status === "active";
const goalText = (g: NonNullable<EnvironmentSnapshot["goal"]>): string =>
  g.objective ? `: ${oneLine(g.objective)}` : "";

/**
 * Pure diff of two snapshots into one-line facts, in stable kind order. Empty
 * array means nothing changed. Uncapped; {@link renderEnvironmentUpdate} caps.
 */
export function diffEnvironment(prev: EnvironmentSnapshot, next: EnvironmentSnapshot): EnvironmentChange[] {
  const out: EnvironmentChange[] = [];
  const listChange = (kind: EnvironmentChangeKind, label: string, a: readonly string[], b: readonly string[]) => {
    const d = setDelta(a, b);
    const parts = [d.added.length > 0 ? names(d.added, "+") : "", d.removed.length > 0 ? names(d.removed, "-") : ""].filter(Boolean);
    if (parts.length > 0) out.push({ kind, summary: `${label}: ${parts.join(", ")}.` });
  };
  listChange("tools", "Tools", prev.toolNames, next.toolNames);
  if (next.provider !== prev.provider && next.provider !== undefined) {
    out.push({ kind: "model", summary: `Provider switched to ${oneLine(next.provider)}${next.model !== undefined ? ` (model ${oneLine(next.model)})` : ""}.` });
  } else if (next.model !== prev.model && next.model !== undefined) {
    out.push({ kind: "model", summary: `Model switched to ${oneLine(next.model)}.` });
  }
  if (next.thinking !== prev.thinking && next.thinking !== undefined) {
    out.push({ kind: "thinking", summary: `Thinking set to ${oneLine(next.thinking)}.` });
  }
  const sk = setDelta(prev.skills, next.skills);
  if (sk.added.length > 0) out.push({ kind: "skills", summary: `Skills pinned: ${sk.added.slice(0, MAX_NAMES_PER_LINE).map(oneLine).join(", ")}.` });
  if (sk.removed.length > 0) out.push({ kind: "skills", summary: `Skills unpinned: ${sk.removed.slice(0, MAX_NAMES_PER_LINE).map(oneLine).join(", ")}.` });
  listChange("docs", "Documents", prev.docSources, next.docSources);
  if (!isActive(prev.goal) && isActive(next.goal)) {
    out.push({ kind: "goal", summary: `Goal started${goalText(next.goal!)}` + (next.goal!.objective ? "" : ".") });
  } else if (isActive(prev.goal) && !isActive(next.goal)) {
    out.push({ kind: "goal", summary: `Goal finished${goalText(prev.goal!)}` + (prev.goal!.objective ? "" : ".") });
  }
  if (next.agentControl !== prev.agentControl && next.agentControl !== undefined) {
    out.push({ kind: "agent-control", summary: `Agent control is now ${oneLine(next.agentControl)}.` });
  }
  const added = next.todoUserEdits.added - prev.todoUserEdits.added;
  const removed = next.todoUserEdits.removed - prev.todoUserEdits.removed;
  if (added > 0 || removed > 0) {
    out.push({ kind: "todo-user-edit", summary: `The user edited your to-do list (+${Math.max(added, 0)}, -${Math.max(removed, 0)}).` });
  }
  return out;
}

/** Render the capped notice text; `undefined` for an empty diff. */
export function renderEnvironmentUpdate(changes: readonly EnvironmentChange[]): string | undefined {
  if (changes.length === 0) return undefined;
  const lines = changes.slice(0, MAX_NOTICE_LINES).map((c) => `- ${c.summary}`);
  if (changes.length > MAX_NOTICE_LINES) lines.push(`- …and ${changes.length - MAX_NOTICE_LINES} more`);
  return `${ENVIRONMENT_UPDATE_HEADER}\n${lines.join("\n")}`;
}

/** Options-bag mixin: a turn/run that carries a rendered environment notice. */
export interface EnvironmentUpdateOption {
  /** Rendered notice for this run; becomes `RunEnvelope.rails.environmentUpdate`. */
  readonly environmentUpdate?: string;
}

/** Key under `task.metadata.context` that carries the notice into the engine. */
export const ENVIRONMENT_UPDATE_CONTEXT_KEY = "environmentUpdate";

/** Read the notice back off a task. Undefined when absent/empty. */
export function readEnvironmentUpdate(task: Pick<Task, "metadata">): string | undefined {
  const raw = task.metadata?.context?.[ENVIRONMENT_UPDATE_CONTEXT_KEY];
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

/** Options-bag mixin: seed the tracker so a REBUILT engine's first turn still diffs. */
export interface EnvironmentSeedOption {
  /**
   * Environment the previous (dropped/evicted) engine last saw. The first `begin()`
   * diffs against it instead of recording a baseline, so a change made while the
   * session was rebuilt is still reported. Absent ⇒ first turn is baseline-only.
   */
  readonly initialEnvironment?: EnvironmentSnapshotInput;
}

/** Host ports the tracker needs; both optional. */
export interface EnvironmentTrackerPorts {
  readonly environment?: () => EnvironmentSnapshotInput;
  readonly publishEnvironment?: (event: EnvironmentChangedEvent) => Promise<void>;
  /** Swallow-site reporter for publish failures (never fails a turn). */
  readonly onPublishError?: (err: unknown) => void;
}

/**
 * The engine's held environment state. `begin()` diffs the current environment
 * against the last committed snapshot and returns the notice (or `undefined`);
 * `commit()` records the end-of-turn snapshot. Inert when disabled or when the
 * host wires no `environment` source.
 */
export class EnvironmentTracker {
  #prev?: EnvironmentSnapshot;
  constructor(
    private readonly sessionId: string,
    private readonly ports: EnvironmentTrackerPorts,
    private readonly enabled: boolean,
    seed?: EnvironmentSnapshotInput,
  ) {
    if (seed) this.#prev = snapshotEnvironment(seed);
  }

  #current(): EnvironmentSnapshot | undefined {
    return this.enabled && this.ports.environment ? snapshotEnvironment(this.ports.environment()) : undefined;
  }

  /** Turn start: diff, publish `EnvironmentChanged` on a non-empty diff, return the notice. */
  async begin(): Promise<string | undefined> {
    const cur = this.#current();
    if (!cur) return undefined;
    const prev = this.#prev;
    // First turn: baseline only, never a notice.
    this.#prev ??= cur;
    if (!prev) return undefined;
    const changes = diffEnvironment(prev, cur);
    if (changes.length === 0) return undefined;
    try {
      await this.ports.publishEnvironment?.({ _tag: "EnvironmentChanged", sessionId: this.sessionId, changes, timestamp: Date.now() });
    } catch (err) {
      this.ports.onPublishError?.(err);
    }
    return renderEnvironmentUpdate(changes);
  }

  /** Turn end (successful turns only): record the baseline for the next diff. */
  commit(): void {
    const cur = this.#current();
    if (cur) this.#prev = cur;
  }
}
