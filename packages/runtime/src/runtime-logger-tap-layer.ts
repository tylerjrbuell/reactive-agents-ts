import { Layer, Effect } from "effect";
import { EventBus } from "@reactive-agents/core";
import type { AgentEvent } from "@reactive-agents/core";
import type { RuntimeOptions } from "./runtime-types.js";

/**
 * Structured logging tap — subscribes to EventBus and writes to configured
 * output. `Layer.empty` when `loggingConfig` is unset. Extracted verbatim
 * from `createRuntime` (GH #267).
 */
export function buildLoggerTapLayer(
  options: RuntimeOptions,
  eventBusLayer: Layer.Layer<EventBus>,
) {
  const loggerTapOptLayer = options.loggingConfig
    ? (() => {
        const { makeLoggerService } =
          require("@reactive-agents/observability") as typeof import("@reactive-agents/observability");
        const loggerCfg = options.loggingConfig;
        return Layer.effectDiscard(
          Effect.gen(function* () {
            const logger = makeLoggerService(loggerCfg);
            const eb = yield* EventBus;

            type E<T extends AgentEvent["_tag"]> = Extract<AgentEvent, { _tag: T }>;

            yield* eb.on("AgentStarted", (event: E<"AgentStarted">) =>
              Effect.sync(() =>
                logger.info("[agent:started]", { agentId: event.agentId, taskId: event.taskId }),
              ),
            );

            yield* eb.on("AgentCompleted", (event: E<"AgentCompleted">) =>
              Effect.sync(() =>
                event.success
                  ? logger.info("[agent:completed]", {
                      agentId: event.agentId,
                      taskId: event.taskId,
                      durationMs: event.durationMs,
                      totalTokens: event.totalTokens,
                      totalIterations: event.totalIterations,
                    })
                  : logger.warn("[agent:failed]", {
                      agentId: event.agentId,
                      taskId: event.taskId,
                      durationMs: event.durationMs,
                    }),
              ),
            );

            yield* eb.on("ExecutionPhaseCompleted", (event: E<"ExecutionPhaseCompleted">) =>
              Effect.sync(() =>
                logger.debug(`[phase:${event.phase}]`, {
                  taskId: event.taskId,
                  durationMs: event.durationMs,
                }),
              ),
            );

            yield* eb.on("ToolCallCompleted", (event: E<"ToolCallCompleted">) =>
              Effect.sync(() => {
                if (event.success) {
                  logger.info(`[tool:${event.toolName}]`, {
                    taskId: event.taskId,
                    durationMs: event.durationMs,
                  });
                } else {
                  logger.warn(`[tool:${event.toolName}:error]`, {
                    taskId: event.taskId,
                    durationMs: event.durationMs,
                  });
                }
              }),
            );

            yield* eb.on("LLMRequestCompleted", (event: E<"LLMRequestCompleted">) =>
              Effect.sync(() =>
                logger.debug("[llm:completed]", {
                  taskId: event.taskId,
                  model: event.model,
                  tokensUsed: event.tokensUsed,
                  // Live as of Task 3 (LLMRequestCompleted now has a real
                  // producer). Fall back to the raw figure, never to 0 — a
                  // provider without cache reporting must log as "billed
                  // everything", not as free.
                  billedTokens: event.billedTokens ?? event.tokensUsed,
                  cacheReadTokensIn: event.cacheReadTokensIn ?? 0,
                  durationMs: event.durationMs,
                }),
              ),
            );

            yield* eb.on("GuardrailViolationDetected", (event: E<"GuardrailViolationDetected">) =>
              Effect.sync(() =>
                logger.warn("[guardrail:violation]", {
                  taskId: event.taskId,
                  blocked: event.blocked,
                  violations: event.violations,
                }),
              ),
            );
          }),
        ).pipe(Layer.provide(eventBusLayer));
      })()
    : Layer.empty;
  return loggerTapOptLayer;
}
