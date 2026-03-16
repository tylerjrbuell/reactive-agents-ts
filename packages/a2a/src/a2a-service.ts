/**
 * Unified A2AService — wraps server + client into a single Effect-TS service.
 */
import { Effect, Context, Layer } from "effect";
import type { AgentCard, A2ATask, SendMessageParams, TaskQueryParams } from "./types.js";
import { A2AServer } from "./server/a2a-server.js";
import { A2AClient } from "./client/a2a-client.js";
import { A2AError, TransportError, DiscoveryError } from "./errors.js";

export class A2AService extends Context.Tag("A2AService")<
  A2AService,
  {
    // Server operations
    readonly getAgentCard: () => Effect.Effect<AgentCard>;
    readonly getTask: (id: string) => Effect.Effect<A2ATask, A2AError>;
    readonly cancelTask: (id: string) => Effect.Effect<A2ATask, A2AError>;
    // Client operations
    readonly sendRemoteMessage: (params: SendMessageParams) => Effect.Effect<{ taskId: string }, A2AError | TransportError>;
    readonly getRemoteTask: (params: TaskQueryParams) => Effect.Effect<A2ATask, A2AError | TransportError>;
    readonly discoverRemoteAgent: (url: string) => Effect.Effect<AgentCard, DiscoveryError | TransportError>;
  }
>() {}

export const A2AServiceLive = Layer.effect(
  A2AService,
  Effect.gen(function* () {
    const server = yield* A2AServer;
    const client = yield* A2AClient;

    return {
      getAgentCard: () => server.getAgentCard(),
      getTask: (id) =>
        server.getTask(id).pipe(
          Effect.mapError((e) => new A2AError({ code: "TASK_NOT_FOUND", message: e.taskId })),
        ),
      cancelTask: (id) =>
        server.cancelTask(id).pipe(
          Effect.mapError((e) => {
            if (e._tag === "TaskNotFoundError")
              return new A2AError({ code: "TASK_NOT_FOUND", message: e.taskId });
            if (e._tag === "InvalidTaskStateError")
              return new A2AError({
                code: "INVALID_TASK_STATE",
                message: `${e.currentState} -> ${e.attemptedTransition}`,
              });
            return new A2AError({
              code: "TASK_CANCELED",
              message: "reason" in e ? (e.reason as string) ?? "canceled" : "canceled",
            });
          }),
        ),
      sendRemoteMessage: (params) => client.sendMessage(params),
      getRemoteTask: (params) => client.getTask(params),
      discoverRemoteAgent: (url) => client.getAgentCard(url),
    };
  }),
);
