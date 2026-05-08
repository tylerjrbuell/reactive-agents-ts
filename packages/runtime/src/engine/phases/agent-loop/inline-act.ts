/**
 * Inline-path ACT phase: parallel tool execution for the no-ReasoningService
 * agent loop. Iterates over `pendingCalls`, executes each via ToolService,
 * publishes ToolCallStarted/Completed events, logs invocations, and returns
 * the updated context with toolResults appended.
 *
 * Body of the `guardedPhase(ctx, "act", ...)` invocation inside the inline
 * agent loop. Extracted from `execution-engine.ts:1986-2143` (W23 step 6a-1a)
 * to shrink the engine module without changing behavior.
 *
 * Behavior preserved verbatim — error sites (`runtime/src/execution-engine.ts:NNNN`)
 * are intentionally retained for log/diagnostic compatibility with the inline-path
 * test files.
 */
import { Context, Effect } from "effect";
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";
import { ToolService } from "@reactive-agents/tools";
import { BehavioralContractService } from "@reactive-agents/guardrails";
import { BehavioralContractViolationError } from "../../../errors.js";
import type { ExecutionContext, ReactiveAgentsConfig } from "../../../types.js";
import type { ObsLike, EbLike } from "../../runtime-context.js";

type ProgressLoggerLike = {
  logToolExecution: (
    toolName: string,
    status: "success" | "error",
    durationMs: number,
    errorMessage?: string,
  ) => Effect.Effect<void, never>;
};

export interface InlineActDeps {
  readonly config: ReactiveAgentsConfig;
  readonly pendingCalls: readonly unknown[];
  readonly eb: EbLike | null;
  readonly obs: ObsLike | null;
  readonly isNormal: boolean;
  readonly progressLogger: ProgressLoggerLike;
}

export const runInlineAct = (
  c: ExecutionContext,
  deps: InlineActDeps,
): Effect.Effect<ExecutionContext, BehavioralContractViolationError> => {
  const { config, pendingCalls, eb, obs, isNormal, progressLogger } = deps;
  return Effect.gen(function* () {
    const toolServiceOpt = yield* Effect.serviceOption(ToolService);

    const toolResults: unknown[] = yield* Effect.all(
      pendingCalls.map((call: any) =>
        Effect.gen(function* () {
          const callId = call.id ?? "unknown";
          const toolName =
            call.name ?? call.function?.name ?? "unknown";

          // ── Behavioral contract: check tool call ──
          if (config.enableBehavioralContracts) {
            const bcOpt = yield* Effect.serviceOption(BehavioralContractService)
              .pipe(Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })));
            if (bcOpt._tag === "Some") {
              const violation = yield* bcOpt.value
                .checkToolCall(toolName, c.toolResults.length)
                .pipe(Effect.catchAll(() => Effect.succeed(null)));
              if (violation?.severity === "block") {
                return yield* Effect.fail(new BehavioralContractViolationError({
                  message: violation.message, taskId: c.taskId,
                  rule: violation.rule, violation: violation.message,
                }));
              }
            }
          }
          const rawArgs =
            call.input ??
            call.arguments ??
            call.function?.arguments ??
            {};
          const args: Record<string, unknown> =
            typeof rawArgs === "string"
              ? (() => {
                  try {
                    return JSON.parse(rawArgs);
                  } catch {
                    return { input: rawArgs };
                  }
                })()
              : (rawArgs as Record<string, unknown>);
          // Log tool invocation before execution (direct-LLM path)
          if (obs && isNormal) {
            const isAgentDelegateTool =
              toolName === "spawn-agent" ||
              toolName.startsWith("agent-");
            if (isAgentDelegateTool) {
              const taskArg = typeof args.task === "string"
                ? args.task.slice(0, 80)
                : typeof args.input === "string"
                  ? args.input.slice(0, 80)
                  : "";
              const nameSuffix = typeof args.name === "string" ? ` [${args.name}]` : "";
              yield* obs.info(
                `  ◉ [act]        ↓ ${toolName}${nameSuffix}: "${taskArg}"`,
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2598", tag: errorTag(err) })));
            } else {
              const argPreview = Object.entries(args)
                .slice(0, 2)
                .map(([k, v]) => `${k}: ${String(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 40)}`)
                .join(", ");
              yield* obs.info(
                `  ◉ [act]        → ${toolName}(${argPreview})`,
              ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2606", tag: errorTag(err) })));
            }
          }

          const startMs = Date.now();

          // Phase 0.2: Publish ToolCallStarted
          if (eb) {
            yield* eb.publish({
              _tag: "ToolCallStarted",
              taskId: c.taskId,
              toolName,
              callId,
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2619", tag: errorTag(err) })));
          }

          if (toolServiceOpt._tag === "None") {
            const durationMs = Date.now() - startMs;
            if (eb) {
              yield* eb.publish({
                _tag: "ToolCallCompleted",
                taskId: c.taskId,
                toolName,
                callId,
                durationMs,
                success: false,
              }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2632", tag: errorTag(err) })));
            }
            return {
              toolCallId: callId,
              toolName,
              result: `[ToolService not available — add .withTools() to agent builder]`,
              durationMs,
            };
          }

          const toolResult = yield* toolServiceOpt.value
            .execute({
              toolName,
              arguments: args,
              agentId: c.agentId,
              sessionId: c.sessionId,
            })
            .pipe(
              Effect.map((r) => ({
                toolCallId: callId,
                toolName,
                result: r.result,
                durationMs: Date.now() - startMs,
                success: true,
              })),
              Effect.catchAll((e) =>
                Effect.succeed({
                  toolCallId: callId,
                  toolName,
                  result: `[Tool error: ${e instanceof Error ? e.message : String(e)}]`,
                  durationMs: Date.now() - startMs,
                  success: false,
                }),
              ),
            );

          // Log tool execution for progress visibility
          yield* progressLogger.logToolExecution(
            toolName,
            toolResult.success ? "success" : "error",
            toolResult.durationMs,
            toolResult.success ? undefined : (toolResult.result as string),
          ).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2674", tag: errorTag(err) })));

          // Phase 0.2: Publish ToolCallCompleted
          if (eb) {
            yield* eb.publish({
              _tag: "ToolCallCompleted",
              taskId: c.taskId,
              toolName,
              callId,
              durationMs: toolResult.durationMs,
              success: toolResult.success,
            }).pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "runtime/src/execution-engine.ts:2685", tag: errorTag(err) })));
          }

          return toolResult;
        }),
      ),
      { concurrency: 3 },
    );

    return {
      ...c,
      toolResults: [...c.toolResults, ...toolResults],
    };
  }) as unknown as Effect.Effect<ExecutionContext, BehavioralContractViolationError>;
};
