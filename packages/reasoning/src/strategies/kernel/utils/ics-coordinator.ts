/**
 * ICS Coordinator — produces a steering nudge for the next think call.
 *
 * Replaces the SynthesizedContext replacement system. The native FC
 * conversation thread is never replaced; instead a lean steering nudge
 * is appended as a user message when the model needs directional guidance.
 *
 * Nudge frequency is tier-adaptive:
 * - local/mid: always nudge when required tools are missing
 * - large/frontier: only nudge in the last 30% of iterations
 */
import { Effect } from "effect"
import type { KernelState } from "../../../kernel/state/kernel-state.js"

export interface ICSInput {
  readonly task: string
  readonly requiredTools: readonly string[]
  readonly toolsUsed: ReadonlySet<string>
  readonly availableTools: readonly { name: string; description: string; parameters: unknown[] }[]
  readonly tier: string
  readonly iteration: number
  readonly maxIterations: number
  readonly lastErrors: readonly string[]
}

export interface ICSOutput {
  readonly steeringNudge: string | undefined
}

/**
 * Build a steering nudge message for the current iteration.
 * Returns undefined when no nudge is needed.
 */
export function coordinateICS(
  _state: KernelState,
  input: ICSInput,
): Effect.Effect<ICSOutput, never, never> {
  return Effect.sync(() => {
    const { requiredTools, toolsUsed, tier, iteration, maxIterations, lastErrors } = input
    const missingTools = requiredTools.filter((t) => !toolsUsed.has(t))
    const urgencyThreshold = maxIterations * 0.7 // nudge in last 30%

    // Tier-adaptive nudge frequency
    const shouldNudge =
      tier === "local" || tier === "mid"
        ? missingTools.length > 0
        : iteration >= urgencyThreshold && missingTools.length > 0

    if (!shouldNudge) return { steeringNudge: undefined }

    const lines: string[] = []
    const completedRequired = requiredTools.filter((t) => toolsUsed.has(t))

    if (completedRequired.length > 0) {
      lines.push(`Completed: ${completedRequired.map((t) => `${t} ✓`).join(", ")}`)
    }

    for (const err of lastErrors) {
      lines.push(`Error: ${err} — skip this tool, use data from other calls`)
    }

    const iterationsLeft = maxIterations - iteration
    const urgency = iterationsLeft <= 2 ? ` (${iterationsLeft} iterations remaining)` : ""

    if (missingTools.length > 0) {
      lines.push(`Now call ${missingTools[0]} with the appropriate arguments.${urgency}`)
    }

    return { steeringNudge: lines.length > 0 ? lines.join("\n") : undefined }
  })
}
