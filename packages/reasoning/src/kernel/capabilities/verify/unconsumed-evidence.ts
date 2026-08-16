import type { ReasoningStep } from "../../../types/index.js";
import { resolveScratchpadValue } from "@reactive-agents/tools";

/**
 * Shared, canonical scan for the "unconsumed stored evidence" signal
 * (2026-08-16 root fix — deterministic grounding, no recall() dependency).
 *
 * A tool observation compressed to `metadata.storedKey` carries the full
 * result in the run's scratchpad. Prior design relied on the MODEL calling
 * `recall({key})` to read it back — measured live against gemma4:e4b: the
 * advisory nudge suggesting recall fired correctly 5/5 times in one run and
 * was ignored 5/5 times. This module is consumed by every deterministic
 * consumer of that signal instead of each maintaining its own copy:
 *   - `reflect/reactive-observer.ts` (tool-inject's remedy choice)
 *   - `act/guard.ts` (`unconsumedEvidenceGuard`, blocks the `final-answer`
 *     TOOL call)
 *   - `decide/arbitrator.ts` (`llmEndTurnEvaluator`, blocks the far more
 *     common `end_turn` prose exit — the path the fabrication/honest-hedge
 *     variance traced this session actually went through)
 */
export function findUnconsumedStoredKeys(steps: readonly ReasoningStep[]): string[] {
  const stored = new Set<string>();
  const recalled = new Set<string>();
  for (const st of steps) {
    if (st.type === "observation") {
      const key = (st.metadata as { storedKey?: string } | undefined)?.storedKey;
      if (key) stored.add(key);
    } else if (st.type === "action") {
      const stepTc = st.metadata?.toolCall as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (stepTc?.name === "recall" && typeof stepTc.arguments?.key === "string") {
        recalled.add(stepTc.arguments.key);
      }
    }
  }
  return [...stored].filter((k) => !recalled.has(k));
}

/**
 * Resolves unconsumed stored evidence to its full scratchpad content, joined.
 * Returns `null` when there is nothing unconsumed, or the keys reference
 * nothing in the scratchpad (defensive — should not happen in practice).
 */
export function resolveUnconsumedEvidence(
  steps: readonly ReasoningStep[],
  scratchpad: ReadonlyMap<string, string>,
): string | null {
  const keys = findUnconsumedStoredKeys(steps);
  if (keys.length === 0) return null;
  const payloads = keys
    .map((k) => scratchpad.get(k))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(resolveScratchpadValue);
  if (payloads.length === 0) return null;
  return payloads.join("\n\n---\n\n");
}
