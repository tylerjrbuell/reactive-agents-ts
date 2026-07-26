/**
 * Live-stream debug logger for ReasoningStepCompleted events.
 *
 * Subscribes to the EventBus and renders thought/action/observation text at
 * verbose verbosity. Model-io logging is handled exclusively by LLMExchangeEmitted
 * (the single chokepoint at the LLMService layer).
 *
 * Extracted from `execution-engine.ts:981-1033` (W23 step 6a-7) to shrink
 * the engine module without changing behavior.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { EbLike, ObsLike } from "../../runtime-context.js";
import { buildSubAgentLogPrefix } from "../../../builder/build-effect/log-prefix.js";

export interface SubscribeReasoningStreamLoggerArgs {
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly logModelIO: boolean;
  readonly isVerbose: boolean;
  readonly isDebug: boolean;
}

/**
 * Subscribe and return an unsubscribe function (or null if logging is gated
 * off — caller can no-op the cleanup).
 */
export const subscribeReasoningStreamLogger = (
  args: SubscribeReasoningStreamLoggerArgs,
): Effect.Effect<(() => void) | null, never> => {
  const { eb, obs, logModelIO, isVerbose, isDebug } = args;
  return Effect.gen(function* () {
    if (!eb || !obs || !isVerbose) return null;
    const capturedObs = obs;
    const capturedLogModelIO = logModelIO;
    const capturedIsDebug = isDebug;

    // This subscription is root-only (one shared EventBus observes every
    // descendant — see the caller's isRootExecution gate), so every child's
    // ReasoningStepCompleted event was rendering through the ROOT's `obs`
    // with no attribution: three parallel sub-agents' thought/action/obs
    // lines interleaved into one indistinguishable stream (the same
    // "difficult to follow" defect `buildSubAgentLogPrefix` already fixed
    // for `obs.info/debug` calls made directly inside a child's own
    // execution — this stream just never looked up the same prefix). Build
    // the taskId → prefix map from AgentStarted (already flowing on the same
    // shared bus for the status renderer) so each step can be attributed by
    // its `taskId` without threading a prefix through the event schema.
    const prefixByTaskId = new Map<string, string>();
    const unsubscribeAgentStarted = yield* eb.on(
      "AgentStarted",
      (event) => {
        if (event.depth && event.depth > 0) {
          prefixByTaskId.set(
            event.taskId,
            buildSubAgentLogPrefix(event.depth, event.agentDisplayName ?? event.agentId),
          );
        }
        return Effect.void;
      },
    );

    const unsubscribe = yield* eb.on(
      "ReasoningStepCompleted",
      (event) => {
        const rawContent = event.thought ?? event.action ?? event.observation ?? "";
        // Skip events with no displayable content (e.g. prompt-only events when logModelIO is off)
        if (!rawContent) return Effect.void;
        const prefix = event.thought
          ? "┄ [thought]"
          : event.action
            ? "┄ [action] "
            : "┄ [obs]    ";
        const content =
          capturedIsDebug || rawContent.length <= 180
            ? rawContent
            : rawContent.slice(0, 180) + "...";
        const linePrefix = prefixByTaskId.get(event.taskId) ?? "";
        return capturedObs
          .debug(`${linePrefix}  ${prefix}  ${content}`)
          .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:log-step-content", tag: errorTag(err) })));
      },
    );

    // Task 7 — surface every direct LLM call (LLMExchangeEmitted) when
    // logModelIO is on. Captures bypass sites the ReasoningStepCompleted
    // listener misses: plan-execute analysis/synthesis, reflexion critique,
    // ToT BFS, code-action generation. Emitted by the makeObservableLLM
    // wrapper at the LLMService layer (single chokepoint).
    let unsubscribeExchange: (() => void) | null = null;
    if (capturedLogModelIO) {
      unsubscribeExchange = yield* eb.on(
        "LLMExchangeEmitted",
        (event) => {
          const indent = (s: string) => s.replace(/\n/g, "\n    ");
          const threadLines = event.messages
            .map((m) => `[${m.role.toUpperCase()}] ${m.content}`)
            .join("\n    ────\n    ");
          const sys = event.systemPrompt ?? "";
          const resp = event.response?.content ?? "";
          const tag = `direct-llm:${event.requestKind}:${event.provider}/${event.model}`;
          const linePrefix = prefixByTaskId.get(event.taskId) ?? "";
          return capturedObs
            .debug(
              `${linePrefix}  ┄ [model-io:${tag}]\n    ── system ──\n    ${indent(sys)}\n    ── thread (${event.messages.length} msg) ──\n    ${indent(threadLines)}\n    ── response ──\n    ${indent(resp)}`,
            )
            .pipe(
              Effect.catchAll((err) =>
                emitErrorSwallowed({
                  site: "runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:log-llm-exchange",
                  tag: errorTag(err),
                }),
              ),
            );
        },
      );
    }

    return () => {
      unsubscribeAgentStarted();
      unsubscribe();
      if (unsubscribeExchange) unsubscribeExchange();
    };
  });
};
