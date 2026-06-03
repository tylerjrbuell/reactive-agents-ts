/**
 * executeStream factory — produces the streaming execution method exposed by
 * `ExecutionEngineLive`. Wraps the underlying `execute(task)` with a Queue-backed
 * AgentStreamEvent emitter, EventBus subscriptions for ReasoningIterationProgress
 * + ReasoningStepCompleted, and a FiberRef-bound daemon fork that lets the
 * reasoning kernel route StreamingTextCallback writes back to consumers.
 *
 * Extracted from execution-engine.ts (W26-A step 3). The body is behavior-preserving;
 * the only structural change is that `config` and `execute` are now factory parameters
 * instead of closure-captured.
 */
import { Effect, Option, Queue, Stream as EStream } from "effect";
import type { Task, TaskResult, RunControllerLike, AgentEvent } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import {
  StreamingTextCallback,
  RunControllerRef,
  EventBus,
  emitErrorSwallowed,
  errorTag,
} from "@reactive-agents/core";
import type { ReactiveAgentsConfig } from "../types.js";
import type { AgentResultMetadata } from "../builder/types.js";
import type { AgentStreamEvent, StreamDensity } from "../stream-types.js";
import type { RuntimeErrors } from "../errors.js";
import type { EbLike } from "./runtime-context.js";

export interface ExecuteStreamDeps {
  readonly config: ReactiveAgentsConfig;
  readonly execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
}

export const makeExecuteStream =
  ({ config, execute }: ExecuteStreamDeps) =>
  (
    task: Task,
    options?: { density?: StreamDensity; runController?: RunControllerLike },
  ): Effect.Effect<EStream.Stream<AgentStreamEvent, Error>> =>
    Effect.gen(function* () {
      const queue = yield* Queue.unbounded<AgentStreamEvent>();
      const density = options?.density ?? config.streamDensity ?? "tokens";
      const startMs = Date.now();

      const ebOpt = yield* Effect.serviceOption(EventBus).pipe(
        Effect.catchAll(() => Effect.succeed({ _tag: "None" as const })),
      );
      const eb: EbLike | null = ebOpt._tag === "Some" ? (ebOpt.value as EbLike) : null;

      if (eb) {
        yield* eb
          .publish({
            _tag: "AgentStreamStarted",
            taskId: String(task.id),
            agentId: config.agentId,
            density,
            timestamp: startMs,
          } as AgentEvent)
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/execute-stream.ts:AgentStreamStarted",
                tag: errorTag(err),
              }),
            ),
          );
      }

      if (eb) {
        yield* eb
          .on("ReasoningIterationProgress", (event) =>
            Effect.gen(function* () {
              const eventTaskId = String((event as { taskId?: string }).taskId ?? "");
              if (eventTaskId !== String(task.id)) {
                return;
              }
              yield* Queue.offer(queue, {
                _tag: "IterationProgress",
                iteration: event.iteration,
                maxIterations: event.maxIterations,
                toolsCalledThisStep: event.toolsThisStep,
                status: `iteration ${event.iteration}/${event.maxIterations}`,
              } as AgentStreamEvent).pipe(
                Effect.catchAll((err) =>
                  emitErrorSwallowed({
                    site: "runtime/src/engine/execute-stream.ts:IterationProgress-offer",
                    tag: errorTag(err),
                  }),
                ),
              );
            }),
          )
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/execute-stream.ts:IterationProgress-subscribe",
                tag: errorTag(err),
              }),
            ),
          );
      }

      if (eb && density === "full") {
        yield* eb
          .on("ReasoningStepCompleted", (event) =>
            Effect.gen(function* () {
              const eventTaskId = String((event as { taskId?: string }).taskId ?? "");
              if (eventTaskId !== String(task.id)) {
                return;
              }
              const thought =
                typeof (event as { thought?: unknown }).thought === "string"
                  ? ((event as { thought?: string }).thought ?? "").trim()
                  : "";
              if (thought.length === 0) {
                return;
              }
              const iteration =
                typeof (event as { step?: unknown }).step === "number"
                  ? ((event as { step?: number }).step ?? 0)
                  : 0;
              yield* Queue.offer(queue, {
                _tag: "ThoughtEmitted",
                content: thought,
                iteration,
              } as AgentStreamEvent).pipe(
                Effect.catchAll((err) =>
                  emitErrorSwallowed({
                    site: "runtime/src/engine/execute-stream.ts:ThoughtEmitted-offer",
                    tag: errorTag(err),
                  }),
                ),
              );
            }),
          )
          .pipe(
            Effect.catchAll((err) =>
              emitErrorSwallowed({
                site: "runtime/src/engine/execute-stream.ts:ThoughtEmitted-subscribe",
                tag: errorTag(err),
              }),
            ),
          );
      }

      // Bind the streaming callback + run-controller as FiberRef values for the
      // reasoning kernel. We use `Effect.locally` *wrapping execute(task)* (not a
      // bare FiberRef.set) so the values are scoped to this run and RESTORED when
      // execute completes. StreamingTextCallback is a process-global FiberRef
      // (FiberRef.unsafeMake); a bare `set` inside this forkDaemon could leak the
      // callback to unrelated executions, making complete()-only run() paths take
      // the streaming branch and crash on `llm.stream is not a function`.
      // `Effect.locally` around execute is fiber-correct here (it sets+restores
      // within the same daemon fiber that runs execute) and plugs the leak at the
      // source. (The earlier "set as first step inside the fork" pattern only
      // covered inheritance INTO the fork, not restoration after it.)
      const streamCallback = (text: string) =>
        Queue.offer(queue, { _tag: "TextDelta", text }).pipe(Effect.map(() => {}));

      yield* execute(task).pipe(
        Effect.tap((taskResult) => {
          const debriefToolsUsed = (taskResult as { debrief?: { toolsUsed?: Array<{ name: string; calls: number; successRate: number }> } })
            .debrief?.toolsUsed;
          const toolSummary =
            debriefToolsUsed && debriefToolsUsed.length > 0
              ? debriefToolsUsed.map((t) => ({ name: t.name, calls: t.calls, avgMs: 0 }))
              : [];
          const completedEvent: AgentStreamEvent = {
            _tag: "StreamCompleted",
            output: String((taskResult as { output?: unknown }).output ?? ""),
            metadata:
              ((taskResult as { metadata?: AgentResultMetadata }).metadata) ?? {
                duration: Date.now() - startMs,
                cost: 0,
                tokensUsed: 0,
                stepsCount: 0,
              },
            taskId: String(task.id),
            agentId: String(task.agentId),
            ...(toolSummary.length > 0 ? { toolSummary } : {}),
          };
          const offer = Queue.offer(queue, completedEvent);
          if (!eb) return offer;
          return offer.pipe(
            Effect.tap(() =>
              eb
                .publish({
                  _tag: "AgentStreamCompleted",
                  taskId: String(task.id),
                  agentId: config.agentId,
                  success: true,
                  durationMs: Date.now() - startMs,
                } as AgentEvent)
                .pipe(
                  Effect.catchAll((err) =>
                    emitErrorSwallowed({
                      site: "runtime/src/engine/execute-stream.ts:AgentStreamCompleted-success",
                      tag: errorTag(err),
                    }),
                  ),
                ),
            ),
          );
        }),
        Effect.catchAll((err: unknown) => {
          const cause =
            typeof err === "object" && err !== null && "message" in err
              ? String((err as { message: unknown }).message)
              : String(err);
          const errorEvent: AgentStreamEvent = { _tag: "StreamError", cause };
          const offer = Queue.offer(queue, errorEvent);
          if (!eb) return offer;
          return offer.pipe(
            Effect.tap(() =>
              eb
                .publish({
                  _tag: "AgentStreamCompleted",
                  taskId: String(task.id),
                  agentId: config.agentId,
                  success: false,
                  durationMs: Date.now() - startMs,
                } as AgentEvent)
                .pipe(
                  Effect.catchAll((err) =>
                    emitErrorSwallowed({
                      site: "runtime/src/engine/execute-stream.ts:AgentStreamCompleted-failure",
                      tag: errorTag(err),
                    }),
                  ),
                ),
            ),
          );
        }),
        Effect.locally(StreamingTextCallback, streamCallback),
        Effect.locally(RunControllerRef, options?.runController ?? null),
        Effect.forkDaemon,
      );

      // Stream reads from queue, stops after terminal event.
      return EStream.unfoldEffect(false as boolean, (done) => {
        if (done) return Effect.succeed(Option.none());
        return Queue.take(queue).pipe(
          Effect.map((event) => {
            const isTerminal =
              event._tag === "StreamCompleted" ||
              event._tag === "StreamError" ||
              event._tag === "StreamCancelled";
            return Option.some([event, isTerminal] as const);
          }),
        );
      });
    });
