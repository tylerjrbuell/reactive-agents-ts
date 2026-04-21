import { Effect } from "effect"
import type { InterventionHandler } from "../intervention.js"

export const toolFailureRedirectHandler: InterventionHandler<"tool-failure-redirect"> = {
  type: "tool-failure-redirect",
  description: "Inject redirect guidance when a tool has failed repeatedly; escalates to early-stop on second fire",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    // First dispatch: soft redirect nudge — ask the model to try a different approach
    // Second+ dispatch: hard stop — the model ignored the soft nudge, terminate the loop.
    // Use controllerDecisionLog (populated from prior dispatches) instead of budget
    // (budget.interventionsFiredThisRun is currently hardcoded to 0 — not yet tracked).
    const decisionLog = (state as unknown as { controllerDecisionLog?: readonly string[] }).controllerDecisionLog ?? [];
    const priorRedirects = decisionLog.filter((e) => e.startsWith("tool-failure-redirect")).length;
    const isEscalation = priorRedirects >= 1;

    if (isEscalation) {
      return Effect.succeed({
        applied: true,
        patches: [{ kind: "early-stop" as const, reason: `"${decision.failingTool}" failed ${decision.streakCount} times; redirect nudge was ignored` }],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: `tool-streak-escalate-${decision.streakCount}`,
        telemetry: { failingTool: decision.failingTool, streakCount: decision.streakCount, escalated: true },
      })
    }

    const text =
      `IMPORTANT: "${decision.failingTool}" is unavailable and has failed ${decision.streakCount} consecutive times. ` +
      `You MUST stop calling it. Do not retry. ` +
      `Instead, call the final-answer tool immediately with whatever information you have gathered so far. ` +
      `Do not call "${decision.failingTool}" again.`
    return Effect.succeed({
      applied: true,
      patches: [{ kind: "append-system-nudge" as const, text }],
      cost: { tokensEstimated: 60, latencyMsEstimated: 0 },
      reason: `tool-streak-${decision.streakCount}`,
      telemetry: { failingTool: decision.failingTool, streakCount: decision.streakCount, escalated: false },
    })
  },
}
