/**
 * Live-stream debug logger for ReasoningStepCompleted events.
 *
 * Subscribes to the EventBus and renders thought/action/observation text at
 * verbose verbosity, with full prompt-trace support when `logModelIO` is on
 * (renders the FC messages array if present, falling back to legacy
 * system+user format).
 *
 * Extracted from `execution-engine.ts:981-1033` (W23 step 6a-7) to shrink
 * the engine module without changing behavior.
 */
import { Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import type { EbLike, ObsLike } from "../../runtime-context.js";

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
    const unsubscribe = yield* eb.on(
      "ReasoningStepCompleted",
      (event) => {
        // Prompt trace: log full conversation thread when logModelIO is enabled.
        if (event.prompt && capturedLogModelIO) {
          const pass = event.kernelPass ?? event.strategy;
          const indent = (s: string) => s.replace(/\n/g, "\n    ");

          // Prefer full FC messages array (role-labelled) over flat text
          if (event.messages && event.messages.length > 0) {
            const threadLines = event.messages.map((m) =>
              `[${m.role.toUpperCase()}] ${m.content}`,
            ).join("\n    ────\n    ");
            const sysLine = `── system ──\n    ${indent(event.prompt.system)}`;
            const rawLine = event.rawResponse
              ? `\n    ── raw response ──\n    ${indent(event.rawResponse)}`
              : "";
            return capturedObs
              .debug(`  ┄ [model-io:${pass}]\n    ${sysLine}\n    ── thread (${event.messages.length} msg) ──\n    ${indent(threadLines)}${rawLine}`)
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:log-model-io-thread", tag: errorTag(err) })));
          }

          // Fallback: legacy system+user flat format
          const sysPreview = event.prompt.system;
          const userPreview = event.prompt.user;
          return capturedObs
            .debug(`  ┄ [model-io:${pass}]\n    ── system ──\n    ${indent(sysPreview)}\n    ── user ──\n    ${indent(userPreview)}`)
            .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/engine/phases/agent-loop/reasoning-stream-logger.ts:log-model-io-flat", tag: errorTag(err) })));
        }
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
        return capturedObs
          .debug(`  ${prefix}  ${content}`)
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
          return capturedObs
            .debug(
              `  ┄ [model-io:${tag}]\n    ── system ──\n    ${indent(sys)}\n    ── thread (${event.messages.length} msg) ──\n    ${indent(threadLines)}\n    ── response ──\n    ${indent(resp)}`,
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
      unsubscribe();
      if (unsubscribeExchange) unsubscribeExchange();
    };
  });
};
