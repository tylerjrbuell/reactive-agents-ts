import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"
import { asHandlerState } from "../handler-state.js"

export const toolFailureRedirectHandler: InterventionHandler<"tool-failure-redirect"> = {
  type: "tool-failure-redirect",
  description: "Inject redirect guidance when a tool has failed repeatedly; escalates to early-stop on second fire",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    // First dispatch: soft redirect nudge — ask the model to try a different approach
    // Second+ dispatch: hard stop — the model ignored the soft nudge, terminate the loop.
    // (The evaluator only fires again when no pending batch has dropped the
    // failing tool, so a second fire means the model still calls it.)
    // Use controllerDecisionLog to count fires of THIS decision specifically;
    // budget.interventionsFiredThisRun (now tracked in W3 FIX-23 via
    // KernelState.meta.riBudget) counts ALL prior fires across decision types,
    // which is too broad for re-fire detection of a single decision class.
    // The kernel observer appends the current decision to the log BEFORE
    // dispatch (as for stall-detect), so the first fire already counts 1.
    // Testing `>= 1` here made every first fire an early-stop: 30 of 30 fires
    // in the lh-a0 + H3 traces (2026-11-06) escalated and the nudge never ran.
    const decisionLog = asHandlerState(state).controllerDecisionLog ?? [];
    const redirectFires = decisionLog.filter((e) => e.startsWith("tool-failure-redirect")).length;
    const isEscalation = redirectFires >= 2;

    if (isEscalation) {
      return Effect.succeed({
        applied: true,
        patches: [{ kind: "early-stop" as const, reason: `"${decision.failingTool}" failed ${decision.streakCount} times; redirect nudge was ignored` }],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: `tool-streak-escalate-${decision.streakCount}`,
        telemetry: { failingTool: decision.failingTool, streakCount: decision.streakCount, escalated: true },
      })
    }

    // A failure is often recoverable (missing file, bad arguments): do not
    // claim the tool is unavailable or order a final answer. Point at the
    // error and ask for a changed approach.
    const text =
      `"${decision.failingTool}" has failed ${decision.streakCount} times in a row. ` +
      `Stop retrying that call. Read the error above, then change your approach: ` +
      `different arguments, a different tool, or the next step of the task. ` +
      `If you have the evidence you need, answer from it.`
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "append-system-nudge" as const, text }],
      cost: { tokensEstimated: 60, latencyMsEstimated: 0 },
      reason: `tool-streak-${decision.streakCount}`,
      telemetry: { failingTool: decision.failingTool, streakCount: decision.streakCount, escalated: false },
    })
  },
}
