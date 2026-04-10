import { Effect, Ref } from "effect";
import { CONTEXT_PRESSURE_THRESHOLDS } from "../phases/think.js";

/** Meta-tool names excluded from auto-checkpoint content. */
const META_TOOLS = new Set([
  "final-answer", "task-complete", "context-status",
  "brief", "pulse", "find", "recall", "checkpoint",
]);

/**
 * How far below the hard pressure gate the auto-checkpoint fires.
 * E.g. frontier hard gate = 0.95, so auto-checkpoint fires at 0.90.
 */
export const AUTO_CHECKPOINT_OFFSET = 0.05;

/**
 * Returns true when token utilization is in the "soft zone" — close enough
 * to the hard pressure gate that we should auto-save, but not yet past it.
 */
export function shouldAutoCheckpoint(opts: {
  estimatedTokens: number;
  maxTokens: number;
  tier?: string;
  alreadyCheckpointed?: boolean;
}): boolean {
  if (opts.alreadyCheckpointed) return false;

  const hardThreshold = CONTEXT_PRESSURE_THRESHOLDS[opts.tier ?? "mid"] ?? 0.85;
  const softThreshold = hardThreshold - AUTO_CHECKPOINT_OFFSET;
  const utilization = opts.estimatedTokens / opts.maxTokens;

  return utilization >= softThreshold && utilization < hardThreshold;
}

/** Minimal step shape needed for checkpoint content assembly. */
interface StepLike {
  readonly type: string;
  readonly content: string;
  readonly metadata?: {
    readonly observationResult?: {
      readonly success: boolean;
      readonly toolName: string;
      readonly displayText: string;
    };
  };
}

/**
 * Assembles checkpoint content from successful non-meta tool observations.
 * Returns empty string when there's nothing worth saving.
 */
export function buildAutoCheckpointContent(steps: readonly StepLike[]): string {
  const sections: string[] = [];

  for (const step of steps) {
    if (step.type !== "observation") continue;
    const obs = step.metadata?.observationResult;
    if (!obs) continue;
    if (!obs.success) continue;
    if (META_TOOLS.has(obs.toolName)) continue;

    sections.push(`## ${obs.toolName}\n${obs.displayText}`);
  }

  return sections.join("\n\n");
}

/**
 * Auto-checkpoint Effect: saves best observations to the checkpoint store.
 * Returns true if content was saved, false if nothing to save.
 */
export function autoCheckpoint(
  storeRef: Ref.Ref<Map<string, string>>,
  steps: readonly StepLike[],
): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    const content = buildAutoCheckpointContent(steps);
    if (content.length === 0) return false;

    yield* Ref.update(storeRef, (m) => {
      const next = new Map(m);
      next.set("_auto_checkpoint", content);
      return next;
    });
    return true;
  });
}
