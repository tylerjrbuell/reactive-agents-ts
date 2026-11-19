// File: src/strategies/reflexion/completed-actions.ts
/**
 * What reflexion's earlier passes actually did with their tool calls: the
 * improve pass's ALREADY COMPLETED ACTIONS list, the critique's execution
 * evidence, and the side-effect tools an improve pass may not re-run.
 *
 * One pairing rule for all three (QA N4, 2026-11-19). Each call pairs with the
 * observation that answers it by `toolCallId` (not by index), and the outcome
 * is read from typed step metadata: a call a guard or the tool gate refused
 * never ran (`GUARD_OBSERVATION_TAG` / tool-gate intervention), a failed result
 * is `observationResult.success === false`. Before, only a `[Tool error` text
 * match counted as a failure, so repetition-guard refusals were listed as
 * `✅` done (`✅ city-population({"city":"Cairo"})` while Cairo never ran), and
 * the list only covered the last tool-calling pass.
 *
 * Pure functions, no services.
 */
import type { ReasoningStep } from "../../types/index.js";
import { GUARD_OBSERVATION_TAG } from "../../kernel/state/kernel-constants.js";
import { isFailedToolObservation, isToolGateRefusal } from "../../kernel/utils/observation-helpers.js";

/** How one tool call ended: ran (`ok`), ran and failed, or was refused before it ran. */
export type ToolCallOutcome = "ok" | "failed" | "not-run";

/** One tool call (action step) with the observation that answered it. */
export interface PairedToolCall {
  readonly action: ReasoningStep;
  readonly observation?: ReasoningStep;
  readonly outcome: ToolCallOutcome;
  readonly toolName?: string;
}

const LEGACY_TOOL_ERROR = /\[Tool error/i;

function outcomeOf(observation: ReasoningStep | undefined): ToolCallOutcome {
  // No answering observation: kept as ran, so a side-effect tool is never re-run on a guess.
  if (observation === undefined) return "ok";
  if (observation.metadata?.frameworkInstrumentation === GUARD_OBSERVATION_TAG || isToolGateRefusal(observation)) return "not-run";
  if (isFailedToolObservation(observation) || LEGACY_TOOL_ERROR.test(observation.content)) return "failed";
  return "ok";
}

function toolNameOf(action: ReasoningStep): string | undefined {
  return action.metadata?.toolCall?.name
    ?? (action.metadata?.toolUsed as string | undefined)
    ?? action.content.match(/"tool"\s*:\s*"([^"]+)"/)?.[1]
    ?? action.content.match(/^(\S+?)\(/)?.[1];
}

/**
 * Pair every action step with the observation answering it: the first later
 * observation carrying the action's `toolCall.id` (ids may repeat across
 * passes, so the search runs forward from the action), else, for an action
 * without an id, the first later unclaimed observation without one.
 */
export function pairToolCalls(steps: readonly ReasoningStep[] | undefined): readonly PairedToolCall[] {
  if (steps === undefined) return [];
  const claimed = new Set<number>();
  const out: PairedToolCall[] = [];
  steps.forEach((action, i) => {
    if (action.type !== "action") return;
    const id = action.metadata?.toolCall?.id;
    let at = -1;
    for (let j = i + 1; j < steps.length; j++) {
      const s = steps[j];
      if (s === undefined || s.type !== "observation" || claimed.has(j)) continue;
      const answers = id !== undefined ? s.metadata?.toolCallId === id : s.metadata?.toolCallId === undefined;
      if (answers) { at = j; break; }
    }
    if (at >= 0) claimed.add(at);
    const observation = at >= 0 ? steps[at] : undefined;
    out.push({ action, ...(observation !== undefined ? { observation } : {}), outcome: outcomeOf(observation), toolName: toolNameOf(action) });
  });
  return out;
}

const OUTCOME_RANK: Readonly<Record<ToolCallOutcome, number>> = { ok: 2, failed: 1, "not-run": 0 };
const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}...` : text);

/**
 * Side-effect detection via word splitting (not regex \b which treats _ as word char).
 * Splits tool names on / _ - separators, then checks for side-effect verbs.
 */
const SIDE_EFFECT_WORDS = new Set([
  "send", "write", "create", "delete", "post", "push",
  "publish", "notify", "deploy", "upload", "remove", "update",
]);

function isSideEffectTool(toolName: string): boolean {
  const words = toolName.toLowerCase().split(/[/_\-]/);
  return words.some((w) => SIDE_EFFECT_WORDS.has(w));
}

/**
 * The improve pass's ALREADY COMPLETED ACTIONS list over every pass so far.
 * One line per distinct call (its best outcome across passes): `✅` ran,
 * `❌` failed, `⛔` refused before it ran (not done).
 * Then the side-effect tools that ran and must not be called again.
 */
export function buildCompletedActionsContext(steps?: readonly ReasoningStep[]): string {
  const calls = pairToolCalls(steps);
  if (calls.length === 0) return "";

  const byCall = new Map<string, PairedToolCall>();
  for (const call of calls) {
    const prior = byCall.get(call.action.content);
    if (prior === undefined || OUTCOME_RANK[call.outcome] >= OUTCOME_RANK[prior.outcome]) byCall.set(call.action.content, call);
  }

  const lines: string[] = ["ALREADY COMPLETED ACTIONS (do NOT repeat successful ones):"];
  for (const call of byCall.values()) {
    const content = clip(call.action.content, 200);
    if (call.outcome === "not-run") lines.push(`  ⛔ ${content} — NOT run (refused by the harness)`);
    else if (call.outcome === "failed") lines.push(`  ❌ ${content}`);
    else lines.push(`  ✅ ${content}`);
  }

  const sideEffects = extractSuccessfulSideEffectTools(steps);
  if (sideEffects.length > 0) {
    lines.push("\n⚠️ DO NOT call these tools again (they have side effects and already executed):");
    for (const name of sideEffects) lines.push(`  - ${name}`);
  }
  return lines.join("\n");
}

/**
 * The critique's execution evidence: each tool call with its result, so the
 * critique judges what happened. A refused call reads `⛔` (it never ran).
 */
export function buildExecutionEvidence(steps?: readonly ReasoningStep[]): string {
  if (!steps || steps.length === 0) return "No execution steps recorded.";
  const calls = pairToolCalls(steps);
  if (calls.length === 0) return "No tool calls were made.";
  return calls
    .map((call) => {
      const icon = call.outcome === "ok" ? "✅" : call.outcome === "failed" ? "❌" : "⛔";
      return `${icon} ${clip(call.action.content, 200)}\n   → ${clip(call.observation?.content ?? "no result recorded", 150)}`;
    })
    .join("\n");
}

/**
 * Tool names that have side effects AND ran in a prior kernel pass. These tools
 * are blocked from re-execution in improvement passes to prevent duplicate
 * sends, writes, creates, etc. A refused or failed call does not block its tool.
 */
export function extractSuccessfulSideEffectTools(steps?: readonly ReasoningStep[]): readonly string[] {
  const blocked = new Set<string>();
  for (const call of pairToolCalls(steps)) {
    if (call.outcome === "ok" && call.toolName !== undefined && isSideEffectTool(call.toolName)) blocked.add(call.toolName);
  }
  return [...blocked];
}
