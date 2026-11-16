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
import type { ChecklistItemStatus, ChecklistSnapshot, PlanFinding, RunOrigin, RunPosture, Task, TaskCurrentTurn } from "@reactive-agents/core";
import { findingsMetadata, findingsOfEntries, mergeFindings, validPlanFindings, type PlanFindingsOption } from "./plan-findings.js";
import type { CurrentTurnOption } from "../agent/history-block.js";
import type { AgentStreamEvent } from "../stream-types.js";
import { ENVIRONMENT_UPDATE_CONTEXT_KEY, type EnvironmentUpdateOption } from "./environment-snapshot.js";
import { skillsCarry, type SkillsRunOption } from "../runtime-skills-layer.js";

/**
 * One to-do row persisted between turns. Structurally identical to the
 * kernel's `AdvisorySeedItem`.
 */
export interface TodoSeedItem {
  readonly id: string;
  readonly title: string;
  readonly status: ChecklistItemStatus;
  /** Tool the step named (a plan step's hint); the kernel's propose-done advisory reads it. Absent = none. */
  readonly tool?: string;
  /** `"harness-derived"` when the harness derived the row from the model's reply; absent = a model or user row. */
  readonly origin?: "harness-derived";
}

/** Options-bag mixin: a turn/run that starts from a prior to-do list. */
export interface TodoSeedOption extends PlanFindingsOption {
  /** The conversation's latest to-do list; becomes the run's seeded advisory list. */
  readonly initialTodo?: readonly TodoSeedItem[];
}

/** Options-bag mixin: a conversation rebuilt from stored state starts holding its plan's findings. */
export interface InitialPlanFindingsOption {
  /** The conversation's stored plan findings; seeded like `initialTodo` so a rebuilt session carries them into the next Execute turn. Malformed rows are dropped. */
  readonly initialPlanFindings?: readonly PlanFinding[];
}

/** Options-bag mixin: the posture a turn/run executes under (`"plan"` ⇒ plan-only). */
export interface PostureOption {
  /** Absent or `"execute"` ⇒ nothing is carried (bytes identical); `"plan"` ⇒ `RunEnvelope.rails.posture`. */
  readonly posture?: RunPosture;
}

/** Options-bag mixin: the caller that started the run, recorded on `run-started.origin`. */
export interface OriginOption {
  /** Absent ⇒ the engine derives it (`"subagent"` for delegated children, else `"user"`). */
  readonly origin?: RunOrigin;
}

/** Key under `task.metadata.context` that carries the caller origin into the engine. */
export const ORIGIN_CONTEXT_KEY = "origin";

/** Spread-ready carrier: `{ origin }` when set, `{}` otherwise (bytes identical). */
export const originCarry = (origin?: RunOrigin): { origin?: RunOrigin } =>
  origin !== undefined ? { origin } : {};

/** Key under `task.metadata.context` that carries the posture into the engine. */
export const POSTURE_CONTEXT_KEY = "posture";

/** Spread-ready carrier: `{ posture: "plan" }` for plan, `{}` for execute/absent (the default is never serialized). */
export const planPosture = (posture?: RunPosture): { posture?: RunPosture } =>
  posture === "plan" ? { posture } : {};

/** Read the posture back off a task. Only `"plan"` is ever carried; everything else is `undefined`. */
export function readPosture(task: Pick<Task, "metadata">): RunPosture | undefined {
  return task.metadata?.context?.[POSTURE_CONTEXT_KEY] === "plan" ? "plan" : undefined;
}

/**
 * Everything a chat turn or `runStream()` hands its run besides history: the
 * to-do seed, the environment notice, the posture, the origin and the per-run
 * skill pins (`skills: { activate }`, same as `run()`).
 */
export type TurnCarryOption = TodoSeedOption & EnvironmentUpdateOption & PostureOption & OriginOption & SkillsRunOption & CurrentTurnOption;

/**
 * Spread into `task.metadata`: {@link todoSeedMetadata} plus the environment notice
 * (`context.environmentUpdate`), posture, origin and skill pins when present.
 * All absent ⇒ nothing (bytes identical).
 */
export function turnCarryMetadata(opts: TurnCarryOption): { context?: Record<string, unknown>; currentTurn?: TaskCurrentTurn } {
  const context = {
    ...todoSeedMetadata(opts.initialTodo, opts.planFindings).context,
    ...(opts.environmentUpdate ? { [ENVIRONMENT_UPDATE_CONTEXT_KEY]: opts.environmentUpdate } : {}),
    ...(opts.posture === "plan" ? { [POSTURE_CONTEXT_KEY]: opts.posture } : {}),
    ...(opts.origin !== undefined ? { [ORIGIN_CONTEXT_KEY]: opts.origin } : {}),
    ...skillsCarry(opts.skills),
  };
  return { ...(Object.keys(context).length > 0 ? { context } : {}), ...(opts.currentTurn ? { currentTurn: opts.currentTurn } : {}) };
}

/** Key under `task.metadata.context` that carries the seed into the engine. */
export const TODO_SEED_CONTEXT_KEY = "initialTodo";

/**
 * Project a checklist snapshot onto the persistable to-do shape: the root
 * group's ADVISORY rows the model or user wrote (the `todo` tool's list), with
 * the row status `done` mapped back to the ledger's `completed`. Requirements
 * are per-run and never carried; harness plan rows (`source: "plan"`, e.g. a
 * plan-execute turn's streamed plan) are turn-scoped and never carried either.
 */
export function snapshotToTodoSeed(snapshot: ChecklistSnapshot): TodoSeedItem[] {
  return snapshot.root.rows.flatMap((row): TodoSeedItem[] =>
    row.kind !== "advisory" || row.source === "plan"
      ? []
      : [{
          id: row.id, title: row.title, status: row.status === "done" ? "completed" : row.status === "in_progress" ? "in_progress" : "pending",
          ...(row.tool !== undefined ? { tool: row.tool } : {}), ...(row.origin === "harness-derived" ? { origin: row.origin } : {}),
        }],
  );
}

/**
 * Spread into `task.metadata`: a non-empty seed as `context.initialTodo` and non-empty
 * plan findings as `context.planFindings`, else nothing (bytes identical).
 */
export function todoSeedMetadata(
  seed: readonly TodoSeedItem[] | undefined,
  findings?: readonly PlanFinding[],
): { context?: Record<string, unknown> } {
  const context = { ...(seed !== undefined && seed.length > 0 ? { [TODO_SEED_CONTEXT_KEY]: seed } : {}), ...findingsMetadata(findings) };
  return Object.keys(context).length > 0 ? { context } : {};
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
      STATUSES.has((r as TodoSeedItem).status) &&
      ((r as TodoSeedItem).tool === undefined || typeof (r as TodoSeedItem).tool === "string"),
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
  #findings: readonly PlanFinding[] = [];
  readonly #onChange: ((before: readonly TodoSeedItem[], after: readonly TodoSeedItem[]) => void) | undefined;
  /** @param onChange called with the list before and after each turn-driven update (not on `replace`). */
  constructor(initial?: readonly TodoSeedItem[], onChange?: (before: readonly TodoSeedItem[], after: readonly TodoSeedItem[]) => void, initialFindings?: unknown) {
    this.#items = initial ?? [];
    this.#findings = validPlanFindings(initialFindings);
    this.#onChange = onChange;
  }
  /** Current list (oldest id first). */
  get items(): readonly TodoSeedItem[] {
    return this.#items;
  }
  /** Replace the list (a plan edit); the next turn seeds from it. */
  replace(items: readonly TodoSeedItem[]): void {
    this.#items = items;
  }
  /** Take a turn's final list (buffered turns); announces step changes like a streamed update. */
  update(items: readonly TodoSeedItem[]): void {
    const before = this.#items;
    this.#items = items;
    this.#onChange?.(before, items);
  }
  /** The plan's recon findings held for the conversation (empty when the plan ran no recon). */
  get findings(): readonly PlanFinding[] {
    return this.#findings;
  }
  /** Replace the held findings (a plan edit). */
  setFindings(findings: readonly PlanFinding[]): void {
    this.#findings = findings;
  }
  /** Add findings a plan turn recorded; one already held is kept once. */
  addFindings(findings: readonly PlanFinding[]): void {
    this.#findings = mergeFindings(this.#findings, findings);
  }
  /** Fold one stream event; checklist events replace the list, plan-finding ledger entries add findings, the rest are ignored. */
  observe(event: AgentStreamEvent): void {
    if (event._tag === "ChecklistUpdated") this.update(snapshotToTodoSeed(event.checklist));
    else if (event._tag === "LedgerEntry") this.addFindings(findingsOfEntries([event.entry], Date.now()));
  }
}

/**
 * Spread into a buffered turn's `runTask` options: the conversation's list as the
 * run's seed, and the port the host reports the run's final list through.
 */
export const todoTurnPorts = (carry: TodoCarry): TodoSeedOption & TodoReportOption => ({
  ...todoSeedOf(carry),
  onTodo: (items) => carry.update(items),
  onFindings: (findings) => carry.addFindings(findings),
});

/** Spread-ready forwarder: the to-do seed and the plan findings of `o` when present, `{}` otherwise (bytes identical). */
export const seedCarry = (o: TodoSeedOption | undefined): TodoSeedOption => ({
  ...(o?.initialTodo ? { initialTodo: o.initialTodo } : {}),
  ...(o?.planFindings && o.planFindings.length > 0 ? { planFindings: o.planFindings } : {}),
});

/** The seed a turn starts from: the held list and the held plan findings (each only when non-empty). */
export const todoSeedOf = (carry: TodoCarry): TodoSeedOption => ({
  ...(carry.items.length > 0 ? { initialTodo: carry.items } : {}),
  ...(carry.findings.length > 0 ? { planFindings: carry.findings } : {}),
});

/** Options-bag mixin: the host calls these with the run's final to-do list and recon findings (buffered turns). */
export interface TodoReportOption {
  readonly onTodo?: (items: readonly TodoSeedItem[]) => void;
  readonly onFindings?: (findings: readonly PlanFinding[]) => void;
}
