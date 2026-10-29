/**
 * todo-seed.ts — the conversation-level to-do list, carried across chat turns.
 *
 * The to-do list belongs to the CONVERSATION, not to one message: the model's
 * `todo` tool edits it during a turn, and the next turn must start from where
 * the last one left it. The kernel can already seed a run from a prior list
 * (`RunEnvelopeRails.initialAdvisory`); this module is the runtime side:
 *
 *  - {@link snapshotToTodoSeed}   — pure: streamed checklist snapshot -> seed rows
 *                                   (the ONE mapping a host persists with).
 *  - {@link todoSeedMetadata} / {@link readTodoSeed} — the per-run carrier
 *                                   (`task.metadata.context.initialTodo`).
 *  - {@link TodoCarry}            — the engine's held list, updated from the
 *                                   `ChecklistUpdated` events of each turn.
 */
import type { ChecklistItemStatus, ChecklistSnapshot, RunPosture, Task } from "@reactive-agents/core";
import type { AgentStreamEvent } from "../stream-types.js";
import { ENVIRONMENT_UPDATE_CONTEXT_KEY, type EnvironmentUpdateOption } from "./environment-snapshot.js";

/**
 * One to-do row persisted between turns. Structurally identical to the
 * kernel's `AdvisorySeedItem`.
 */
export interface TodoSeedItem {
  readonly id: string;
  readonly title: string;
  readonly status: ChecklistItemStatus;
}

/** Options-bag mixin: a turn/run that starts from a prior to-do list. */
export interface TodoSeedOption {
  /** The conversation's latest to-do list; becomes the run's seeded advisory list. */
  readonly initialTodo?: readonly TodoSeedItem[];
}

/** Options-bag mixin: the posture a turn/run executes under (`"plan"` ⇒ plan-only). */
export interface PostureOption {
  /** Absent or `"execute"` ⇒ nothing is carried (bytes identical); `"plan"` ⇒ `RunEnvelope.rails.posture`. */
  readonly posture?: RunPosture;
}

/** Key under `task.metadata.context` that carries the posture into the engine. */
export const POSTURE_CONTEXT_KEY = "posture";

/** Spread-ready carrier: `{ posture: "plan" }` for plan, `{}` for execute/absent (the default is never serialized). */
export const planPosture = (posture?: RunPosture): { posture?: RunPosture } =>
  posture === "plan" ? { posture } : {};

/** Read the posture back off a task. Only `"plan"` is ever carried; everything else is `undefined`. */
export function readPosture(task: Pick<Task, "metadata">): RunPosture | undefined {
  return task.metadata?.context?.[POSTURE_CONTEXT_KEY] === "plan" ? "plan" : undefined;
}

/** Everything a chat turn hands its run besides history: the to-do seed, the environment notice and the posture. */
export type TurnCarryOption = TodoSeedOption & EnvironmentUpdateOption & PostureOption;

/**
 * Spread into `task.metadata`: {@link todoSeedMetadata} plus the environment notice
 * (`context.environmentUpdate`) when present. Both absent ⇒ nothing (bytes identical).
 */
export function turnCarryMetadata(opts: TurnCarryOption): { context?: Record<string, unknown> } {
  const context = {
    ...todoSeedMetadata(opts.initialTodo).context,
    ...(opts.environmentUpdate ? { [ENVIRONMENT_UPDATE_CONTEXT_KEY]: opts.environmentUpdate } : {}),
    ...(opts.posture === "plan" ? { [POSTURE_CONTEXT_KEY]: opts.posture } : {}),
  };
  return Object.keys(context).length > 0 ? { context } : {};
}

/** Key under `task.metadata.context` that carries the seed into the engine. */
export const TODO_SEED_CONTEXT_KEY = "initialTodo";

/**
 * Project a checklist snapshot onto the persistable to-do shape: the root
 * group's ADVISORY rows only (requirements are per-run and never carried),
 * with the row status `done` mapped back to the ledger's `completed`.
 */
export function snapshotToTodoSeed(snapshot: ChecklistSnapshot): TodoSeedItem[] {
  return snapshot.root.rows.flatMap((row): TodoSeedItem[] =>
    row.kind !== "advisory"
      ? []
      : [{ id: row.id, title: row.title, status: row.status === "done" ? "completed" : row.status === "in_progress" ? "in_progress" : "pending" }],
  );
}

/** Spread into `task.metadata`: a non-empty seed as `context.initialTodo`, else nothing (bytes identical). */
export function todoSeedMetadata(seed: readonly TodoSeedItem[] | undefined): { context?: Record<string, unknown> } {
  return seed !== undefined && seed.length > 0 ? { context: { [TODO_SEED_CONTEXT_KEY]: seed } } : {};
}

const STATUSES: ReadonlySet<string> = new Set(["pending", "in_progress", "completed"]);

/** Read the seed back off a task, dropping anything malformed. Undefined when absent/empty. */
export function readTodoSeed(task: Pick<Task, "metadata">): readonly TodoSeedItem[] | undefined {
  const raw = task.metadata?.context?.[TODO_SEED_CONTEXT_KEY];
  if (!Array.isArray(raw)) return undefined;
  const items = raw.filter(
    (r): r is TodoSeedItem =>
      typeof r === "object" && r !== null &&
      typeof (r as TodoSeedItem).id === "string" &&
      typeof (r as TodoSeedItem).title === "string" &&
      STATUSES.has((r as TodoSeedItem).status),
  );
  return items.length > 0 ? items : undefined;
}

/**
 * The engine's held conversation to-do list. Each turn it is handed to the run
 * as the seed, and every `ChecklistUpdated` the turn streams replaces it, so
 * after the turn it holds the turn's FINAL list (the run's list always begins
 * with the seed, so a turn that never touches `todo` leaves it unchanged).
 */
export class TodoCarry {
  #items: readonly TodoSeedItem[];
  constructor(initial?: readonly TodoSeedItem[]) {
    this.#items = initial ?? [];
  }
  /** Current list (oldest id first). */
  get items(): readonly TodoSeedItem[] {
    return this.#items;
  }
  /** Fold one stream event; non-checklist events are ignored. */
  observe(event: AgentStreamEvent): void {
    if (event._tag === "ChecklistUpdated") this.#items = snapshotToTodoSeed(event.checklist);
  }
}
