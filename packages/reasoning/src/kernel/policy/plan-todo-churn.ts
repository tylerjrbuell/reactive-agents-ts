/**
 * policy/plan-todo-churn.ts — plan-posture guard against `todo` list churn.
 *
 * Under plan posture a model that already recorded its plan sometimes keeps
 * calling `todo add` with REPHRASED steps ("Verify the current directory is a
 * git repository..." then "Confirm the working directory is a git repository...").
 * Core's `isNearDuplicateTitle` (80% of the larger title) misses rephrasings
 * that add detail, so a 4-step plan grew to 10 rows over four turns.
 *
 * This is the shared kernel path (`act/meta-tool-handlers.ts` calls it for every
 * strategy). Two deterministic rules, plan posture only:
 *   1. ADD when a plan exists: a step that restates an existing row (core's rule,
 *      or {@link isRephrasedStep}: >= 60% of the smaller title's key tokens are
 *      already in the other) is dropped. All dropped -> the model gets the
 *      existing list plus {@link planAlreadyRecordedMessage} instead of an append.
 *   2. CAP: at most {@link PLAN_TODO_MAX_MUTATIONS_PER_TURN} todo mutations per
 *      act round; the next gets the list plus a "present the plan" line.
 * Each intervention emits a `plan-todo-churn` guard event. Execute posture is
 * untouched. Model-visible behavior change: flagged for ablation.
 */
import { Effect } from "effect";
import { isNearDuplicateTitle, normalizeTitle, type AdvisoryItem } from "@reactive-agents/core";
import { renderTodoChecklist } from "@reactive-agents/tools";
import type { ReasoningStep } from "../../types/index.js";
import { emitGuardFired } from "../utils/diagnostics.js";

/** Trace `guard` name of the churn guard (reuses `GuardFiredEmitted`). */
export const PLAN_TODO_CHURN_GUARD = "plan-todo-churn";

/** Todo mutations (add/edit/remove/clear/patch) one act round may run under plan posture. */
export const PLAN_TODO_MAX_MUTATIONS_PER_TURN = 3;

/** Share of the smaller title's key tokens already in the other title that makes it a rephrasing. */
export const PLAN_REPHRASE_OVERLAP = 0.6;

/** Titles with fewer key tokens than this are judged by core's rule alone (too short to compare safely). */
const MIN_KEY_TOKENS = 4;

const MUTATING_ACTIONS: ReadonlySet<string> = new Set(["add", "edit", "remove", "clear", "patch"]);

/** One guidance line when an add only restated rows. */
export const planAlreadyRecordedMessage = (steps: number): string =>
  `A plan is already recorded (${steps} step${steps === 1 ? "" : "s"}). Edit or remove rows instead of adding rephrased ones, or finish.`;

/** One guidance line when the per-turn mutation cap is hit. */
export const planTodoCapMessage = (steps: number): string =>
  `Plan edits are capped at ${PLAN_TODO_MAX_MUTATIONS_PER_TURN} per turn. The plan has ${steps} step${steps === 1 ? "" : "s"}; present it to the user, or finish.`;

/** Plural-folded key tokens of a title (core's normalization plus a trailing-s fold). */
function keyTokens(title: string): ReadonlySet<string> {
  return new Set([...normalizeTitle(title)].map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w)));
}

/**
 * True when `candidate` restates `existing`: core's near-duplicate rule, or
 * (both titles have >= 4 key tokens) at least {@link PLAN_REPHRASE_OVERLAP} of
 * the smaller one's tokens appear in the other. Per-item numbered steps never
 * match: when both titles carry digit tokens and the sets differ they are
 * distinct work (core's numeric guard, kept). Symmetric, pure, never throws.
 */
export function isRephrasedStep(candidate: string, existing: string): boolean {
  if (isNearDuplicateTitle(candidate, existing)) return true;
  const a = keyTokens(candidate);
  const b = keyTokens(existing);
  if (a.size < MIN_KEY_TOKENS || b.size < MIN_KEY_TOKENS) return false;
  const da = [...a].filter((w) => /\p{N}/u.test(w));
  const db = [...b].filter((w) => /\p{N}/u.test(w));
  if (da.length > 0 && db.length > 0 && (da.length !== db.length || da.some((w) => !b.has(w)))) return false;
  let shared = 0;
  for (const w of a) if (b.has(w)) shared++;
  return shared / Math.min(a.size, b.size) >= PLAN_REPHRASE_OVERLAP;
}

/** Title of one `items` entry (plain string, or the record forms `extractAddItems` accepts). */
function entryTitle(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (typeof entry !== "object" || entry === null) return undefined;
  return [Reflect.get(entry, "text"), Reflect.get(entry, "title"), Reflect.get(entry, "step"), Reflect.get(entry, "task")]
    .find((v): v is string => typeof v === "string");
}

/** The `items` entries as an array (newline-split when a single string), or undefined when unreadable. */
function entriesOf(raw: unknown): readonly unknown[] | undefined {
  if (typeof raw === "string") return raw.split("\n").map((s) => s.trim()).filter(Boolean);
  return Array.isArray(raw) ? raw : undefined;
}

/** What the guard decided for one `todo` call. */
export type PlanTodoChurnVerdict =
  | { readonly kind: "pass" }
  /** Run the tool with `args` (rephrased entries removed); prefix its result with `note`. */
  | { readonly kind: "trim"; readonly args: Record<string, unknown>; readonly note: string; readonly dropped: number }
  /** Do not run the tool: answer with `content` (the existing list + one guidance line). */
  | { readonly kind: "answer"; readonly content: string; readonly reason: "already-recorded" | "turn-cap"; readonly dropped: number };

/** Number of todo mutations already made in this act round (read off the round's action steps). */
export function roundTodoMutations(roundSteps: readonly ReasoningStep[]): number {
  let n = 0;
  for (const s of roundSteps) {
    if (s.type !== "action" || s.metadata?.toolUsed !== "todo") continue;
    const action = s.metadata.toolCall?.arguments.action;
    if (typeof action === "string" && MUTATING_ACTIONS.has(action)) n++;
  }
  return n;
}

/**
 * Decide one `todo` call under plan posture. `items` is the list as the model
 * sees it (committed + this round's staged changes), `roundSteps` this round's
 * steps so far. Pure.
 */
export function judgePlanTodoCall(
  args: Record<string, unknown>,
  items: readonly AdvisoryItem[],
  roundSteps: readonly ReasoningStep[],
): PlanTodoChurnVerdict {
  const action = typeof args.action === "string" ? args.action : "";
  if (!MUTATING_ACTIONS.has(action)) return { kind: "pass" };
  const rendered = (line: string): string => `${renderTodoChecklist(items, "plan")}\n${line}`;
  if (roundTodoMutations(roundSteps) >= PLAN_TODO_MAX_MUTATIONS_PER_TURN) {
    return { kind: "answer", content: rendered(planTodoCapMessage(items.length)), reason: "turn-cap", dropped: 0 };
  }
  if (action !== "add" || items.length === 0) return { kind: "pass" };
  const entries = entriesOf(args.items);
  if (entries === undefined || entries.length === 0) return { kind: "pass" };
  const kept: unknown[] = [];
  const keptIdx: number[] = [];
  const accepted: string[] = [];
  entries.forEach((e, i) => {
    const title = entryTitle(e);
    const restates = title !== undefined &&
      (items.some((t) => isRephrasedStep(title, t.title)) || accepted.some((t) => isRephrasedStep(title, t)));
    if (restates) return;
    if (title !== undefined) accepted.push(title);
    kept.push(e);
    keptIdx.push(i);
  });
  const dropped = entries.length - kept.length;
  if (dropped === 0) return { kind: "pass" };
  if (kept.length === 0) {
    return { kind: "answer", content: rendered(planAlreadyRecordedMessage(items.length)), reason: "already-recorded", dropped };
  }
  const rawTools: unknown = args.tools;
  const tools = Array.isArray(rawTools) && rawTools.length === entries.length ? keptIdx.map((i) => rawTools[i]) : rawTools;
  return {
    kind: "trim",
    args: { ...args, items: kept, ...(tools !== undefined ? { tools } : {}) },
    note: `Skipped ${dropped} rephrased step(s): they restate rows already on the plan.`,
    dropped,
  };
}

/** Emit the `plan-todo-churn` guard event for an intervention. */
export function emitPlanTodoChurn(args: {
  readonly taskId: string;
  readonly iteration: number;
  readonly verdict: Exclude<PlanTodoChurnVerdict, { kind: "pass" }>;
  readonly planSteps: number;
}): Effect.Effect<void> {
  const { verdict } = args;
  const reason = verdict.kind === "answer" && verdict.reason === "turn-cap" ? "turn-cap" : "rephrased-add";
  return emitGuardFired({
    taskId: args.taskId,
    iteration: args.iteration,
    guard: PLAN_TODO_CHURN_GUARD,
    outcome: verdict.kind === "answer" ? "block" : "redirect",
    reason: reason === "turn-cap"
      ? `plan posture: todo mutations capped at ${PLAN_TODO_MAX_MUTATIONS_PER_TURN} per turn`
      : "plan posture: rephrased todo add answered with the existing plan",
    metadata: { posture: "plan", cause: reason, dropped: verdict.dropped, planSteps: args.planSteps },
  });
}
