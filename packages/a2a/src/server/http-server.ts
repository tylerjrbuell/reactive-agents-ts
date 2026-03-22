/**
 * A2A HTTP Server — JSON-RPC 2.0 over HTTP with SSE streaming support.
 * Uses Bun.serve() for start/stop and createTaskHandler for task persistence.
 */
import type {
  JsonRpcRequest,
  SendMessageParams,
  TaskQueryParams,
  TaskCancelParams,
  A2ATask,
  AgentCard,
} from "../types.js";
import { A2AError } from "../errors.js";
import { Effect, Context, Layer, Ref } from "effect";
import { getPlatformSync, type ServerHandle } from "@reactive-agents/platform";
import { A2AServer } from "./a2a-server.js";
import { createTaskHandler, type TaskExecutor } from "./task-handler.js";
import { formatSSEEvent, type StreamEvent } from "./streaming.js";

export class A2AHttpServer extends Context.Tag("A2AHttpServer")<
  A2AHttpServer,
  {
    readonly handleJsonRpc: (request: JsonRpcRequest) => Effect.Effect<unknown, A2AError>;
    readonly start: () => Effect.Effect<void>;
    readonly stop: () => Effect.Effect<void>;
  }
>() {}

const JSONRPC_VERSION = "2.0";

type JsonRpcMethod =
  | "message/send"
  | "message/stream"
  | "tasks/get"
  | "tasks/cancel"
  | "tasks/sendSubscribe"
  | "agent/card";

export const createA2AHttpServer = (port: number = 3000, executor?: TaskExecutor) =>
  Layer.effect(
    A2AHttpServer,
    Effect.gen(function* () {
      const server = yield* A2AServer;
      const store = yield* Ref.make<{ tasks: Map<string, A2ATask> }>({ tasks: new Map() });
      const taskHandler = createTaskHandler(store, executor);

      // Mutable reference to the server instance
      let serverHandle: ServerHandle | null = null;

      const handleMessageSend = (params: unknown) =>
        Effect.gen(function* () {
          const sendParams = params as SendMessageParams;
          const task = yield* taskHandler.handleMessageSend(sendParams);
          return { jsonrpc: JSONRPC_VERSION, id: null, result: task };
        });

      const handleMessageStream = (params: unknown, agentCard: AgentCard) =>
        Effect.gen(function* () {
          const sendParams = params as SendMessageParams;
          const task = yield* taskHandler.handleMessageSend(sendParams);

          // Build SSE events for the completed task
          const events: StreamEvent[] = [
            {
              type: "status-update",
              data: {
                taskId: task.id,
                contextId: task.contextId,
                status: task.status,
                final: task.status.state === "completed" || task.status.state === "failed",
                kind: "status-update" as const,
              },
            },
          ];

          // If task has artifacts, emit artifact events
          if (task.artifacts) {
            for (const artifact of task.artifacts) {
              events.push({
                type: "artifact-update",
                data: {
                  taskId: task.id,
                  contextId: task.contextId,
                  artifact,
                  append: false,
                  lastChunk: true,
                  kind: "artifact-update" as const,
                },
              });
            }
          }

          return { task, events };
        });

      const handleTasksGet = (params: unknown) =>
        Effect.gen(function* () {
          const queryParams = params as TaskQueryParams;
          // Try the local store first, then fall back to the server store
          const state = yield* Ref.get(store);
          const localTask = state.tasks.get(queryParams.id);
          if (localTask) {
            return { jsonrpc: JSONRPC_VERSION, id: null, result: localTask };
          }
          const task = yield* server.getTask(queryParams.id);
          return { jsonrpc: JSONRPC_VERSION, id: null, result: task };
        }).pipe(
          Effect.mapError(
            (e) => new A2AError({ code: "TASK_NOT_FOUND", message: e.taskId }),
          ),
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
              return new A2AError({
                code: "INVALID_TASK_STATE",
                message: `Cannot ${e.attemptedTransition} task in state ${e.currentState}`,
              });
            }
            return new A2AError({
              code: "TASK_CANCELED",
              message: e.reason ?? "Task canceled",
            });
          }),
        );

      const handleAgentCard = () =>
        Effect.gen(function* () {
          const card = yield* server.getAgentCard();
          return { jsonrpc: JSONRPC_VERSION, id: null, result: card };
        });

      const routeRequest = (
        request: JsonRpcRequest,
      ): Effect.Effect<unknown, A2AError> => {
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

        start: () =>
          Effect.gen(function* () {
            const agentCard = yield* server.getAgentCard();
            const platform = getPlatformSync();
            serverHandle = yield* Effect.promise(() =>
              platform.server.serve({
                port,
                fetch: async (req) => {
                  const url = new URL(req.url);

                  // GET /.well-known/agent.json — A2A standard discovery
                  if (req.method === "GET" && url.pathname === "/.well-known/agent.json") {
                    return new Response(JSON.stringify(agentCard), {
                      headers: { "Content-Type": "application/json" },
                    });
                  }

                  // GET /agent/card — fallback discovery
                  if (req.method === "GET" && url.pathname === "/agent/card") {
                    return new Response(JSON.stringify(agentCard), {
                      headers: { "Content-Type": "application/json" },
                    });
                  }

                  // POST / — JSON-RPC endpoint
                  if (req.method === "POST") {
                    try {
                      const body = (await req.json()) as JsonRpcRequest;

                      // Handle message/stream — return SSE
                      if (body.method === "message/stream") {
                        const streamResult = await Effect.runPromise(
                          handleMessageStream(body.params, agentCard),
                        );
                        const sseBody = streamResult.events
                          .map((evt) => formatSSEEvent(evt))
                          .join("");

                        return new Response(sseBody, {
                          headers: {
                            "Content-Type": "text/event-stream",
                            "Cache-Control": "no-cache",
                            Connection: "keep-alive",
                          },
                        });
                      }

                      // Standard JSON-RPC
                      const result = await Effect.runPromise(
                        routeRequest(body).pipe(
                          Effect.catchAll((error) =>
                            Effect.succeed({
                              jsonrpc: JSONRPC_VERSION,
                              id: body.id,
                              error: {
                                code: -32000,
                                message: error.message,
                                data: { a2aCode: error.code },
                              },
                            }),
                          ),
                        ),
                      );

                      return new Response(JSON.stringify(result), {
                        headers: { "Content-Type": "application/json" },
                      });
                    } catch {
                      return new Response(
                        JSON.stringify({
                          jsonrpc: JSONRPC_VERSION,
                          id: null,
                          error: { code: -32700, message: "Parse error" },
                        }),
                        {
                          status: 400,
                          headers: { "Content-Type": "application/json" },
                        },
                      );
                    }
                  }

                  return new Response("Not Found", { status: 404 });
                },
              })
            );
          }),

        stop: () =>
          Effect.promise(async () => {
            if (serverHandle) {
              await serverHandle.stop();
              serverHandle = null;
            }
          }),
      };
    }),
  );
