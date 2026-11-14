import { buildContextSummary } from "../chat.js";
import type { AgentDebrief } from "../debrief.js";
import type { AgentResultMetadata } from "../builder/types.js";

/** A reasoning step as far as observation extraction reads it. */
export interface ObservationStep {
  readonly type: string;
  readonly content: string;
  readonly metadata?: { readonly observationResult?: { readonly success?: boolean } };
}

/**
 * Tool observations plus the analysis thoughts that follow them, from one run's
 * reasoning steps. Moved verbatim from the run-task facade so a chat session and
 * the agent-level `_lastRunObservations` share one extraction.
 */
export function observationsFromSteps(steps: readonly ObservationStep[]): string[] {
  const parts: string[] = [];
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i]!;
    if (s.type === "observation") {
      // Successful tool results only.
      if (
        s.metadata?.observationResult?.success !== false &&
        s.content.length > 10 &&
        !s.content.startsWith("⚠️") &&
        !s.content.startsWith("✓ final-answer")
      ) {
        parts.push(`[Tool result]: ${s.content}`);
      }
    } else if (s.type === "thought" && i > 0) {
      // Analysis thoughts that follow observations carry the synthesized data.
      if (steps[i - 1]?.type === "observation" && s.content.length > 50) {
        parts.push(`[Agent analysis]: ${s.content}`);
      }
    }
  }
  return parts;
}

/**
 * The "last run" context block for ONE chat session's direct (tools-off) path,
 * built from that session's own latest tool turn. Never agent-level: a shared
 * agent serves many conversations and one conversation's tool output must not
 * reach another's prompt.
 */
export function lastRunContextOf(debrief: AgentDebrief | undefined, metadata: AgentResultMetadata): string {
  return buildContextSummary(debrief, observationsFromSteps(metadata.reasoningSteps ?? []));
}
