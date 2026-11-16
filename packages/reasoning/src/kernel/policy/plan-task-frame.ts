/**
 * policy/plan-task-frame.ts — the model-visible task framing under plan posture.
 *
 * Under `"plan"` the harness-authored guidance says "plan, do not execute", but
 * the user's task text still reads as an instruction to do the work, which pulls
 * the model toward answering or executing. The posture therefore frames the
 * GOAL the model sees with one deterministic prefix. Only the rendered goal
 * changes: `KernelInput.task`, the typed `currentTurnText` and `state.messages`
 * stay untouched for intent / telemetry readers. Execute posture and absent
 * posture are identity (same reference, byte-identical). Pure, idempotent, no LLM.
 */
import type { MessageContent, RunPosture } from "@reactive-agents/core";

/** Prefix of the framed goal under plan posture. */
export const PLAN_TASK_FRAME = "Plan how to accomplish this; do not carry it out: ";

/**
 * The goal as the model should see it: framed under plan posture, else the same
 * value. A parts goal gets the frame as a leading text part. Idempotent.
 */
export function frameGoalForPosture(goal: MessageContent, posture: RunPosture | undefined): MessageContent {
  if (posture !== "plan") return goal;
  if (typeof goal === "string") return goal.startsWith(PLAN_TASK_FRAME) ? goal : `${PLAN_TASK_FRAME}${goal}`;
  const first = goal[0];
  if (first?.type === "text" && first.text.startsWith(PLAN_TASK_FRAME)) return goal;
  return [{ type: "text", text: PLAN_TASK_FRAME }, ...goal];
}
