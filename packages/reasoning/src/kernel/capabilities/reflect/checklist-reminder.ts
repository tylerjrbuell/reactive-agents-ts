/**
 * reflect/checklist-reminder.ts — opt-in, default-OFF todo guidance (ruling V5,
 * wiki/Planning/Implementation-Plans/2026-10-28-plan-and-goal-primitives.md).
 *
 * Two independent, inert-unless-`todo`-is-visible inputs:
 *  - M3-midrun: a pure producer for `PendingGuidance.checklistReminder`. Fires
 *    only when advisory rows are open AND the last two completed iterations each
 *    ran a non-todo tool without changing any todo status; capped at 2 per run;
 *    never on the iteration that produced the final answer. Advisory only: it
 *    never gates completion (M3-terminal is REJECTED).
 *  - M1: one stable system-prompt line.
 * Everything here is deterministic (golden rule 5) and writes no ledger facts.
 */
import { foldAdvisory, type AdvisoryItem, type ChecklistFact } from "@reactive-agents/core";
import type { RunLedger } from "../../ledger/run-ledger.js";
import { markRendered, openSignal, type SignalLedger } from "../../state/signal-ledger.js";

// Interface merging keeps kernel-state.ts (LOC-pinned) untouched. The reminder
// itself rides `PendingGuidance.checklistReminder` (state/guidance-channel.ts).
declare module "../../state/kernel-state.js" {
  interface KernelInput {
    /** Opt-in todo guidance (V5 M3-midrun reminder / M1 system line), default OFF. */
    readonly checklistGuidance?: ChecklistGuidanceOptions;
  }
}

/** Hard cap on reminders fired per run. */
export const CHECKLIST_REMINDER_CAP = 2;
/** Signal-ledger kind; the cap counts ledger signals of this kind. */
export const CHECKLIST_REMINDER_SIGNAL_KIND = "checklist-reminder";
/** M1: the one stable system-prompt line (byte-stable across turns). */
export const CHECKLIST_SYSTEM_LINE =
  "For multi-step tasks, keep your todo list current: add the steps, mark each one started and done as you go.";

/** Opt-in switches (both default OFF). Threaded as `KernelInput.checklistGuidance`. */
export interface ChecklistGuidanceOptions {
  readonly reminder?: boolean;
  readonly systemLine?: boolean;
}

/** What one completed iteration did, as far as the reminder cares. */
export interface RecentRound {
  readonly toolNames: readonly string[];
  readonly todoStatusChanges: number;
}

export interface ChecklistReminderInput {
  readonly enabled: boolean;
  readonly todoVisible: boolean;
  readonly items: readonly AdvisoryItem[];
  /** The last completed iterations, oldest first. */
  readonly recentRounds: readonly RecentRound[];
  readonly remindersFired: number;
  readonly producedFinalAnswer?: boolean;
}

const MAX_LISTED = 5;

/** Pure M3-midrun producer. Returns the reminder text, or undefined when inert. */
export function buildChecklistReminder(input: ChecklistReminderInput): string | undefined {
  if (!input.enabled || !input.todoVisible || input.producedFinalAnswer === true) return undefined;
  if (input.remindersFired >= CHECKLIST_REMINDER_CAP) return undefined;
  const openRows = input.items.filter((i) => i.status === "pending" || i.status === "in_progress");
  if (openRows.length === 0) return undefined;
  if (input.recentRounds.length < 2) return undefined;
  const lastTwo = input.recentRounds.slice(-2);
  const stale = lastTwo.every(
    (r) => r.todoStatusChanges === 0 && r.toolNames.some((n) => n !== "todo"),
  );
  if (!stale) return undefined;
  const listed = openRows.slice(0, MAX_LISTED).map((i) => `[${i.id}] ${i.title}`);
  if (openRows.length > MAX_LISTED) listed.push(`+${openRows.length - MAX_LISTED} more`);
  return `Todo: ${openRows.length} open (${listed.join(", ")}). Mark finished items done (todo action done, id) before continuing.`;
}

/** M1: the system line, only when todo is visible AND the option is on. */
export function checklistSystemLine(todoVisible: boolean, enabled: boolean): string | undefined {
  return todoVisible && enabled ? CHECKLIST_SYSTEM_LINE : undefined;
}

const CHILD_PASS_PREFIX = "sub-agent:";

/**
 * The last two completed rounds, oldest first, read from the run ledger. An act
 * round is stamped `state.iteration + 1`, so at think-time the newest completed
 * round carries the label `currentIteration` itself.
 */
export function summarizeRecentRounds(ledger: RunLedger | undefined, currentIteration: number): readonly RecentRound[] {
  const iterations = [currentIteration - 1, currentIteration];
  return iterations.map((iteration) => {
    const toolNames: string[] = [];
    let todoStatusChanges = 0;
    for (const e of ledger ?? []) {
      if (e.iteration !== iteration) continue;
      if (e.kind === "tool-invocation") toolNames.push(e.toolName);
      else if (e.kind === "checklist-item" && e.change.op === "status" && !(e.pass ?? "").startsWith(CHILD_PASS_PREFIX)) {
        todoStatusChanges += 1;
      }
    }
    return { toolNames, todoStatusChanges };
  });
}

/** The run's own advisory rows (merged sub-agent facts excluded). */
function ownItems(ledger: RunLedger | undefined): readonly AdvisoryItem[] {
  const own: ChecklistFact[] = [];
  for (const e of ledger ?? []) {
    if (e.kind === "checklist-item" && !(e.pass ?? "").startsWith(CHILD_PASS_PREFIX)) own.push(e);
  }
  return foldAdvisory(own);
}

export interface ChecklistReminderStep {
  readonly reminder?: string;
  readonly signalLedger?: SignalLedger;
}

/**
 * Think-time wiring: derive inputs from run state, produce at most one reminder,
 * and record it as a rendered signal (target: the `todo` tool) so the existing
 * classifySignalEffect edge measures whether a todo call followed. The cap is
 * counted from those ledger signals. Inert (no ledger change) when no reminder.
 */
export function stepChecklistReminder(args: {
  readonly enabled: boolean;
  readonly todoVisible: boolean;
  readonly ledger: RunLedger | undefined;
  readonly signalLedger: SignalLedger | undefined;
  readonly iteration: number;
  readonly stepCount: number;
}): ChecklistReminderStep {
  if (!args.enabled || !args.todoVisible) return {};
  const signals = args.signalLedger ?? [];
  const reminder = buildChecklistReminder({
    enabled: true,
    todoVisible: true,
    items: ownItems(args.ledger),
    recentRounds: summarizeRecentRounds(args.ledger, args.iteration),
    remindersFired: signals.filter((s) => s.signalKind === CHECKLIST_REMINDER_SIGNAL_KIND).length,
  });
  if (reminder === undefined) return {};
  const opened = openSignal(signals, {
    signalKind: CHECKLIST_REMINDER_SIGNAL_KIND,
    origin: "checklist-reminder",
    target: { tool: "todo", policy: "required-tool" },
    iter: args.iteration,
    content: reminder,
  });
  return {
    reminder,
    signalLedger: markRendered(opened.ledger, opened.signalId, args.iteration, args.stepCount),
  };
}
