import { Effect } from "effect";
import type { InterventionHandler } from "../intervention.js";

interface HarmSignals {
  readonly interventionCount: number;
  readonly toolSuccessRate: number;
  readonly taskSucceeded: boolean;
}

const HARM_INTERVENTION_THRESHOLD = 3;
const HARM_TOOL_SUCCESS_THRESHOLD = 0.40;
const HARM_CONFIRMATION_RUNS = 3;

export function isHarnessHarmSuspected(signals: HarmSignals): boolean {
  return (
    !signals.taskSucceeded &&
    signals.interventionCount > HARM_INTERVENTION_THRESHOLD &&
    signals.toolSuccessRate < HARM_TOOL_SUCCESS_THRESHOLD
  );
}

export function isHarnessHarmConfirmed(suspectedRunCount: number): boolean {
  return suspectedRunCount >= HARM_CONFIRMATION_RUNS;
}

export const harnessHarmDetectorHandler: InterventionHandler<"harness-harm"> = {
  type: "harness-harm",
  description: "Circuit-breaks RI interventions when harness is provably making model performance worse",
  defaultMode: "dispatch",
  execute: (_decision, state, _ctx) => {
    const decisionLog = (state as unknown as { controllerDecisionLog?: readonly string[] }).controllerDecisionLog ?? [];
    const harmDecisions = decisionLog.filter((e) => e.startsWith("harness-harm")).length;

    if (harmDecisions === 0) {
      return Effect.succeed({
        applied: true,
        patches: [{
          kind: "append-system-nudge" as const,
          text: "Focus on using tools directly. Do not wait for additional guidance.",
        }],
        cost: { tokensEstimated: 20, latencyMsEstimated: 0 },
        reason: "harness-harm-suspected",
        telemetry: { harmSuspected: true, escalated: false },
      });
    }

    return Effect.succeed({
      applied: true,
      patches: [{ kind: "early-stop" as const, reason: "Harness harm confirmed — RI making performance worse for this model+task" }],
      cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
      reason: "harness-harm-confirmed",
      telemetry: { harmConfirmed: true, escalated: true },
    });
  },
};
