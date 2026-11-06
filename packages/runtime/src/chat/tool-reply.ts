import { validateCitations } from "@reactive-agents/reasoning";
import type { ReasoningStep } from "@reactive-agents/reasoning";
import type { AgentResult } from "../builder/types.js";
import type { ChatOptions, ChatReply } from "../chat.js";

/**
 * Assemble the {@link ChatReply} for a tool-path result, byte-parity with the
 * mapping `agent.chat()`'s tool path uses today (reactive-agent.ts `chat()`):
 * `toolsUsed` from `metadata.toolCalls` with `debrief.toolsUsed` fallback,
 * `tokens`, `steps`, `cost`, `reasoningSteps`, `scratchpad`, and
 * `citationCheck` when `verifyCitations` is requested. (Moved verbatim out of
 * `chat/engine.ts` to keep the engine shell at its LOC ratchet.)
 */
export function assembleToolReply(
  result: AgentResult,
  options: ChatOptions,
  hostScratchpad: Readonly<Record<string, string>>,
): ChatReply {
  // toolsUsed is memory-gated on `result.debrief` (only populated when
  // `.withMemory()` is on — see debrief-synthesis.ts `shouldFinalize`).
  // `metadata.toolCalls` is derived from reasoningSteps unconditionally,
  // so it stays the primary source; debrief is only a fallback for any
  // path that doesn't populate it.
  const toolNamesFromMetadata = result.metadata.toolCalls?.map((t) => t.name);
  const toolsUsed =
    toolNamesFromMetadata && toolNamesFromMetadata.length > 0
      ? [...new Set(toolNamesFromMetadata)]
      : result.debrief?.toolsUsed.map((t) => t.name);
  const scratchpad = { ...(result.metadata.scratchpad ?? {}), ...hostScratchpad };
  const citationCheck = options.verifyCitations
    ? validateCitations(
        result.output,
        (result.metadata.reasoningSteps ?? []) as readonly ReasoningStep[],
        new Map(Object.entries(scratchpad)),
      )
    : undefined;
  return {
    message: result.output,
    toolsUsed,
    tokens: result.metadata.tokensUsed,
    steps: result.metadata.stepsCount,
    cost: result.metadata.cost,
    reasoningSteps: result.metadata.reasoningSteps,
    scratchpad,
    ...(citationCheck ? { citationCheck } : {}),
    // The run's own done/progress verdict, so a goal supervisor reading the
    // reply honors the exit gate (`goalRunOf(reply)`).
    ...(result.goalAchieved !== undefined ? { goalAchieved: result.goalAchieved } : {}),
    ...(result.metadata.outstandingCriteria !== undefined
      ? { outstandingCriteria: result.metadata.outstandingCriteria }
      : {}),
    ...(result.evidenceDelta !== undefined ? { evidenceDelta: result.evidenceDelta } : {}),
    // A durable pause: the host must see it is not a final answer (same
    // status/pending shape as a paused StreamCompleted).
    ...(result.status !== undefined ? { status: result.status } : {}),
    ...(result.pendingApproval !== undefined ? { pendingApproval: result.pendingApproval } : {}),
    ...(result.pendingInteraction !== undefined ? { pendingInteraction: result.pendingInteraction } : {}),
  };
}
