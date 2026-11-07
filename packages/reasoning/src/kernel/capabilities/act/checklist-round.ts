/**
 * act/checklist-round.ts — round-local staging of `todo` ledger facts.
 *
 * `handleActing` owns one {@link ChecklistRound} per act round. Each `todo`
 * call sees `foldAdvisory(ledger facts + staged changes)`, so several calls in
 * one turn compose in order, and every exit path of the round commits the
 * staged changes ONCE via {@link commitRound} into the ledger it returns.
 * There is no process-global list: the ledger is the only truth, so strategy
 * switches, continuation passes and crash-resume all see the same items.
 *
 * Plan: wiki/Planning/Implementation-Plans/2026-10-28-plan-and-goal-primitives.md (Task 4).
 */
import {
  foldAdvisory,
  type AdvisoryItem,
  type ChecklistFact,
  type ChecklistItemOp,
} from "@reactive-agents/core";
import { recordChecklistItems, recordSkillActivations, type SkillActivationFact } from "../../ledger/emit.js";
import type { RunLedger } from "../../ledger/run-ledger.js";

/** One staged change plus the tool call that produced it. */
interface StagedChange {
  readonly change: ChecklistItemOp;
  readonly toolCallId: string;
}

/** One `activate-skill` activation staged this round (committed as a `skill-activated` fact). */
export type StagedSkillActivation = Omit<SkillActivationFact, "iteration">;

/**
 * Mutable per-round staging buffer. Create with {@link startRound}. Carries the
 * round's checklist changes and its skill activations; both commit once, on
 * every exit path of the round.
 */
export interface ChecklistRound {
  readonly staged: StagedChange[];
  readonly skills: StagedSkillActivation[];
}

/** Provenance prefix of facts merged up from a child run; never part of this run's own list. */
const CHILD_PASS_PREFIX = "sub-agent:";

/** Begin a round with nothing staged. */
export function startRound(): ChecklistRound {
  return { staged: [], skills: [] };
}

/** Stage `changes` (in order) as produced by tool call `toolCallId`. */
export function stageChanges(
  round: ChecklistRound,
  changes: readonly ChecklistItemOp[],
  toolCallId: string,
): void {
  for (const change of changes) round.staged.push({ change, toolCallId });
}

/**
 * The advisory items as this run sees them right now: committed ledger facts
 * (own run only; merged sub-agent facts are excluded) followed by this round's
 * staged changes.
 */
export function viewItems(round: ChecklistRound, ledger: RunLedger | undefined): readonly AdvisoryItem[] {
  const own: ChecklistFact[] = [];
  for (const e of ledger ?? []) {
    if (e.kind === "checklist-item" && !(e.pass ?? "").startsWith(CHILD_PASS_PREFIX)) own.push(e);
  }
  const staged: ChecklistFact[] = round.staged.map((s, i) => ({
    kind: "checklist-item",
    seq: -1 - i,
    iteration: 0,
    change: s.change,
  }));
  return foldAdvisory([...own, ...staged]);
}

/**
 * Commit the staged changes onto `ledger` (stamped `iteration`). Returns the
 * ledger by identity when nothing is staged. Pure over the round's contents.
 *
 * `roundStepTokens` is the estimated size of everything the round added to
 * the thread. Compaction keeps a whole assistant batch together, so a round
 * that activated a skill pins all of it: the first activation's fact carries
 * the batch's tokens beyond the staged envelopes (skills spec §11 item 1).
 */
export function commitRound(
  round: ChecklistRound,
  ledger: RunLedger | undefined,
  iteration: number,
  roundStepTokens = 0,
): RunLedger {
  const withChecklist = recordChecklistItems(
    ledger,
    round.staged.map((s) => ({ iteration, change: s.change, toolCallId: s.toolCallId })),
  );
  const envelopes = round.skills.reduce((sum, s) => sum + s.tokens, 0);
  const batchOverhead = Math.max(0, roundStepTokens - envelopes);
  return (
    recordSkillActivations(
      withChecklist,
      round.skills.map((s, i) => ({ ...s, iteration, tokens: i === 0 ? s.tokens + batchOverhead : s.tokens })),
    ) ?? withChecklist
  );
}
