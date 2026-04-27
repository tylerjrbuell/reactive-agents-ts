import { Effect } from "effect";
import type { InterventionHandler } from "../intervention.js";

export function jaccardSimilarity(a: string, b: string): number {
  const tokensA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const tokensB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (tokensA.size === 0 && tokensB.size === 0) return 0;
  const intersection = [...tokensA].filter((t) => tokensB.has(t)).length;
  const union = new Set([...tokensA, ...tokensB]).size;
  return union === 0 ? 0 : intersection / union;
}

// Window size = number of recent similar thoughts that must occur before the
// stall detector fires. Local was 2 (any two consecutive similar thoughts →
// stall). Bumped to 3 because cross-model failure analysis showed gpt-oss and
// llama3.x naturally restate their plan once before progressing — the 2-step
// window false-positived on this benign restatement and the resulting veto
// terminated the run before the model could finish.
// See harness-reports/cross-model-failure-modes-2026-04-26.md (failure A3).
const STALL_WINDOW: Record<string, number> = { local: 3, mid: 3, large: 4, frontier: 5 };
const SIMILARITY_THRESHOLD = 0.85;

export function detectStall(
  recentSteps: ReadonlyArray<{ readonly type: string; readonly content: string }>,
  tier: string,
  windowOverride?: number,
): boolean {
  const window = windowOverride ?? STALL_WINDOW[tier] ?? 3;
  if (recentSteps.length < window) return false;

  const lastN = recentSteps.slice(-window);

  if (lastN.some((s) => s.type === "action")) return false;

  for (let i = 1; i < lastN.length; i++) {
    const sim = jaccardSimilarity(lastN[i - 1]!.content, lastN[i]!.content);
    if (sim < SIMILARITY_THRESHOLD) return false;
  }

  return true;
}

export const stallDetectorHandler: InterventionHandler<"stall-detect"> = {
  type: "stall-detect",
  description: "Detects when model repeats content without progress; escalates to early-stop on second fire",
  defaultMode: "dispatch",
  execute: (decision, state, _ctx) => {
    const decisionLog = (state as unknown as { controllerDecisionLog?: readonly string[] }).controllerDecisionLog ?? [];
    // controllerDecisionLog is pre-populated before dispatch fires, so priorStalls >= 1 on first fire.
    // Was `>= 2` (escalate on third stall total). Bumped to `>= 3` so models
    // get one extra recovery iteration after the soft nudge — observed on
    // gpt-oss where 2-stall escalation terminated the run before the post-
    // nudge revision could land. See cross-model failure analysis (A3).
    const priorStalls = decisionLog.filter((e) => e.startsWith("stall-detect")).length;
    const isEscalation = priorStalls >= 3;

    if (isEscalation) {
      return Effect.succeed({
        applied: true,
        patches: [{ kind: "early-stop" as const, reason: "Stall persisted after redirect nudge — terminating" }],
        cost: { tokensEstimated: 0, latencyMsEstimated: 0 },
        reason: "stall-escalate",
        telemetry: { escalated: true, stalledIterations: decision.stalledIterations },
      });
    }

    return Effect.succeed({
      applied: true,
      patches: [{
        kind: "append-system-nudge" as const,
        // Avoid "final-answer with what you know" — that wording primes local
        // models to dump a structural summary (Type:Array(N), Preview(first 5))
        // into the answer instead of synthesizing actual values. Point at the
        // tool observations as the source of truth and ask for synthesis from
        // the concrete fields. Discovery and other tools remain reachable.
        text: "You appear to be repeating the same reasoning. The tool observations above contain the actual data — read the specific values from them and write the answer in the format the user requested. If you need additional information, call a tool you haven't used yet.",
      }],
      cost: { tokensEstimated: 50, latencyMsEstimated: 0 },
      reason: "stall-nudge",
      telemetry: { escalated: false, stalledIterations: decision.stalledIterations },
    });
  },
};
