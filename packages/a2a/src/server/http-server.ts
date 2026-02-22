import type { JsonRpcRequest, SendMessageParams, TaskQueryParams, TaskCancelParams } from "../types.js";
import type { A2AMessage, A2ATask } from "../types.js";
import { A2AError } from "../errors.js";
import { Effect, Context, Layer, Stream } from "effect";
import { A2AServer } from "./a2a-server.js";

export class A2AHttpServer extends Context.Tag("A2AHttpServer")<
  A2AHttpServer,
  {
    readonly handleJsonRpc: (request: JsonRpcRequest) => Effect.Effect<unknown, A2AError>;
    readonly start: () => Effect.Effect<void>;
    readonly stop: () => Effect.Effect<void>;
  }
>() {}

const JSONRPC_VERSION = "2.0";

type JsonRpcMethod = "message/send" | "message/stream" | "tasks/get" | "tasks/cancel" | "tasks/sendSubscribe" | "agent/card";

interface JsonRpcHandler {
  readonly method: JsonRpcMethod;
  readonly handler: (params: unknown) => Effect.Effect<unknown, A2AError>;
}

export const createA2AHttpServer = (port: number = 3000) =>
  Layer.effect(
    A2AHttpServer,
    Effect.gen(function* () {
      const server = yield* A2AServer;

      const handleMessageSend = (params: unknown) =>
        Effect.gen(function* () {
          const sendParams = params as SendMessageParams;
          const message = sendParams.message;
          return { jsonrpc: JSONRPC_VERSION, id: null, result: { taskId: crypto.randomUUID() } };
        });

      const handleTasksGet = (params: unknown) =>
        Effect.gen(function* () {
          const queryParams = params as TaskQueryParams;
          const task = yield* server.getTask(queryParams.id);
          return { jsonrpc: JSONRPC_VERSION, id: null, result: task };
        }).pipe(
          Effect.mapError((e) => new A2AError({ code: "TASK_NOT_FOUND", message: e.taskId })),
        );

      const handleTasksCancel = (params: unknown) =>
        Effect.gen(function* () {
          const cancelParams = params as TaskCancelParams;
          const task = yield* server.cancelTask(cancelParams.id);
          return { jsonrpc: JSONRPC_VERSION, id: null, result: task };
        }).pipe(
          Effect.mapError((e) => {
            if (e._tag === "TaskNotFoundError") {
              return new A2AError({ code: "TASK_NOT_FOUND", message: e.taskId });
            }
            if (e._tag === "InvalidTaskStateError") {
              return new A2AError({ code: "INVALID_TASK_STATE", message: `Cannot ${e.attemptedTransition} task in state ${e.currentState}` });
            }
            return new A2AError({ code: "TASK_CANCELED", message: e.reason ?? "Task canceled" });
          }),
        );

      const handleAgentCard = () =>
        Effect.gen(function* () {
          const card = yield* server.getAgentCard();
          return { jsonrpc: JSONRPC_VERSION, id: null, result: card };
        });

      const routeRequest = (request: JsonRpcRequest): Effect.Effect<unknown, A2AError> => {
        switch (request.method) {
          case "message/send":
            return handleMessageSend(request.params);
          case "tasks/get":
            return handleTasksGet(request.params);
          case "tasks/cancel":
            return handleTasksCancel(request.params);
          case "agent/card":
            return handleAgentCard();
          default:
            return Effect.fail(
              new A2AError({
                code: "METHOD_NOT_FOUND",
                message: `Method not found: ${request.method}`,
              }),
            );
        }
      };

      return {
        handleJsonRpc: (request) => routeRequest(request),
        start: () => Effect.sync(() => {}),
        stop: () => Effect.sync(() => {}),
      };
    }),
  );
