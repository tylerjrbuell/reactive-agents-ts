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
import { Effect, FiberRef, Option, Queue, Stream as EStream } from "effect";
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

      // Set the streaming callback inside the daemon so the FiberRef is
      // available to the reasoning kernel. forkDaemon creates a root fiber
      // that does NOT inherit FiberRef values from Effect.locally — the only
      // reliable way is FiberRef.set as the first step inside the fork.
      const streamCallback = (text: string) =>
        Queue.offer(queue, { _tag: "TextDelta", text }).pipe(Effect.map(() => {}));

      yield* FiberRef.set(StreamingTextCallback, streamCallback).pipe(
        Effect.andThen(FiberRef.set(RunControllerRef, options?.runController ?? null)),
        Effect.andThen(execute(task)),
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
              (taskResult as { metadata?: Record<string, unknown> }).metadata ?? {},
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
