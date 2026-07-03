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
import { Effect, Layer, Option, Queue, Stream as EStream } from "effect";
import type { Task, TaskResult, RunControllerLike, AgentEvent } from "@reactive-agents/core";
import type { TaskError } from "@reactive-agents/core";
import {
  StreamingTextCallback,
  RunControllerRef,
  EventBus,
  emitErrorSwallowed,
  errorTag,
} from "@reactive-agents/core";
import { hash } from "@reactive-agents/runtime-shim";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { ReactiveAgentsConfig } from "../types.js";
import type { AgentResultMetadata } from "../builder/types.js";
import type { AgentStreamEvent, StreamDensity } from "../stream-types.js";
import type { RuntimeErrors } from "../errors.js";
import type { EbLike } from "./runtime-context.js";
import { RunStoreLive, RunStoreService, durableConfigHash } from "../services/run-store.js";
import { installDurableCheckpointing } from "../run-controller.js";

export interface ExecuteStreamDeps {
  readonly config: ReactiveAgentsConfig;
  readonly execute: (task: Task) => Effect.Effect<TaskResult, RuntimeErrors | TaskError>;
}

/** Parse a persisted interaction schemaJson into an unknown value; empty object on parse failure. */
const safeParseSchema = (schemaJson: string): unknown => {
  try {
    return JSON.parse(schemaJson);
  } catch {
    return {};
  }
};

/** Persist a paused run: status → awaiting-approval + a pending approval row. */
const persistApprovalPause = (params: {
  runStoreLayer: Layer.Layer<RunStoreService>;
  runId: string;
  gate: { gateId: string; toolName: string; args: unknown };
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.setStatus(params.runId, "awaiting-approval");
    yield* store.putApproval({
      runId: params.runId,
      gateId: params.gate.gateId,
      toolName: params.gate.toolName,
      argsJson: JSON.stringify(params.gate.args ?? null),
    });
  }).pipe(
    Effect.provide(params.runStoreLayer),
    Effect.catchAllCause((cause) =>
      emitErrorSwallowed({
        site: "runtime/src/engine/execute-stream.ts:persistApprovalPause",
        tag: errorTag(cause),
      }),
    ),
  );

/** Persist a paused-for-interaction run: status → awaiting-interaction + a pending interaction row. Sibling of persistApprovalPause (Task 10). */
const persistInteractionPause = (params: {
  runStoreLayer: Layer.Layer<RunStoreService>;
  runId: string;
  interaction: { interactionId: string; kind: string; prompt: string; schemaJson: string };
}): Effect.Effect<void, never> =>
  Effect.gen(function* () {
    const store = yield* RunStoreService;
    yield* store.setStatus(params.runId, "awaiting-interaction");
    yield* store.putInteraction({
      runId: params.runId,
      interactionId: params.interaction.interactionId,
      kind: params.interaction.kind,
      prompt: params.interaction.prompt,
      schemaJson: params.interaction.schemaJson,
    });
  }).pipe(
    Effect.provide(params.runStoreLayer),
    Effect.catchAllCause((cause) =>
      emitErrorSwallowed({
        site: "runtime/src/engine/execute-stream.ts:persistInteractionPause",
        tag: errorTag(cause),
      }),
    ),
  );

export const makeExecuteStream =
  ({ config, execute }: ExecuteStreamDeps) =>
  (
    task: Task,
    options?: {
      density?: StreamDensity;
      runController?: RunControllerLike;
      /**
       * Agentic-UI kit (Task 13): fired ONCE, synchronously, right after the
       * durable run row is created and its `runId` computed — BEFORE the first
       * stream event is emitted. Only fires on the durable path (when
       * `config.durableRuns` + a runController are set). Lets endpoint helpers
       * open a per-run journal before any event flows. No-op otherwise.
       */
      onRunId?: (runId: string) => void;
      /**
       * Agentic-UI kit (Task 13): stamps the durable run row's `user_id`/`org_id`
       * columns so per-identity inbox filtering works. Durable path only.
       */
      identity?: { userId: string; orgId?: string };
    },
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

      // ── Durable runs (Phase B write-side) ──
      // Opt-in only: when `.withDurableRuns()` set `config.durableRuns` AND this
      // run carries a RunController, install a fire-and-forget `onCheckpoint`
      // that persists each Nth iteration's serialized snapshot to a SQLite
      // RunStore, plus a `finish(success)` to flip the run status at the end.
      // Absent the opt-in this whole block is skipped: no store, no run row, no
      // db file, and the controller's `onCheckpoint` stays undefined (zero cost).
      let durableFinish: ((success: boolean) => void) | undefined;
      let runStoreCtx: { runId: string; runStoreLayer: Layer.Layer<RunStoreService> } | undefined;
      if (config.durableRuns && options?.runController) {
        const agentId = config.agentId;
        const dir =
          config.durableRuns.dir ??
          join(homedir(), ".reactive-agents", agentId);
        mkdirSync(dir, { recursive: true });
        const dbPath = join(dir, "runs.db");
        const checkpointEvery = config.durableRuns.checkpointEvery ?? 1;
        const runStoreLayer = RunStoreLive(dbPath);
        // Stable-ish run id: content hash of agent + task + start time.
        const runId = hash(`${agentId}:${String(task.id)}:${startMs}`).toString(36);
        runStoreCtx = { runId, runStoreLayer };
        // Agentic-UI kit (Task 13): expose the runId before the first event is
        // emitted so endpoint helpers can open a journal keyed on it. Fired
        // synchronously here (durable path only), ahead of createRun below.
        options.onRunId?.(runId);
        // Phase C: hash the reproducible identity descriptor (not the whole
        // config) so ReactiveAgent.resume() can recompute a matching hash.
        const configHash = durableConfigHash({
          systemPrompt: config.systemPrompt,
          provider: config.provider,
        });

        yield* Effect.gen(function* () {
          const store = yield* RunStoreService;
          yield* store.createRun({
            runId,
            agentId,
            task: String((task.input as { question?: unknown })?.question ?? task.id),
            configHash,
            ...(options.identity?.userId !== undefined ? { userId: options.identity.userId } : {}),
            ...(options.identity?.orgId !== undefined ? { orgId: options.identity.orgId } : {}),
          });
        }).pipe(
          Effect.provide(runStoreLayer),
          Effect.catchAllCause((cause) =>
            emitErrorSwallowed({
              site: "runtime/src/engine/execute-stream.ts:durable-createRun",
              tag: errorTag(cause),
            }),
          ),
        );

        durableFinish = installDurableCheckpointing(options.runController, {
          runId,
          runStoreLayer,
          checkpointEvery,
        }).finish;
      }

      yield* execute(task).pipe(
        Effect.tap((taskResult) => {
          // Durable HITL: detect if the run paused for approval.
          const gate = (taskResult as { awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown } }).awaitingApprovalFor;
          const paused = gate !== undefined && runStoreCtx !== undefined;
          // Agentic-UI interaction rail (Task 10): mirror the approval pause
          // detection above for `request_user_input`.
          const interaction = (taskResult as { awaitingInteractionFor?: { interactionId: string; kind: string; prompt: string; schemaJson: string } }).awaitingInteractionFor;
          const pausedInteraction = interaction !== undefined && runStoreCtx !== undefined;

          // Only mark a non-paused run as finished in the durable store.
          if (!paused && !pausedInteraction) {
            durableFinish?.(true);
          }

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
            // Agentic-UI kit (Task 13): stamp the durable runId on EVERY durable
            // StreamCompleted (not just paused ones) so endpoint consumers can
            // attach/replay a completed run by its id. Backward-compatible: the
            // field is optional and was already populated on the pause paths.
            ...(runStoreCtx !== undefined ? { runId: runStoreCtx.runId } : {}),
            ...(paused && runStoreCtx !== undefined
              ? {
                  runId: runStoreCtx.runId,
                  pendingApproval: {
                    runId: runStoreCtx.runId,
                    gateId: gate!.gateId,
                    toolName: gate!.toolName,
                    args: gate!.args,
                  },
                }
              : {}),
            ...(pausedInteraction && runStoreCtx !== undefined
              ? {
                  runId: runStoreCtx.runId,
                  pendingInteraction: {
                    runId: runStoreCtx.runId,
                    interactionId: interaction!.interactionId,
                    kind: interaction!.kind,
                    prompt: interaction!.prompt,
                    schema: safeParseSchema(interaction!.schemaJson),
                  },
                }
              : {}),
          };
          // Persist the pause BEFORE emitting StreamCompleted so callers that
          // consume the event can immediately call decideApproval / respond.
          const persistStep = paused && runStoreCtx !== undefined
            ? persistApprovalPause({ runStoreLayer: runStoreCtx.runStoreLayer, runId: runStoreCtx.runId, gate: gate! })
            : pausedInteraction && runStoreCtx !== undefined
              ? persistInteractionPause({ runStoreLayer: runStoreCtx.runStoreLayer, runId: runStoreCtx.runId, interaction: interaction! })
              : Effect.void;
          const offer = persistStep.pipe(Effect.zipRight(Queue.offer(queue, completedEvent)));
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
          durableFinish?.(false);
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
