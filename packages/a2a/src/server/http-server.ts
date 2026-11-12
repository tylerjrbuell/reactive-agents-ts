/**
 * A2A HTTP Server — JSON-RPC 2.0 over HTTP with SSE streaming support.
 * Uses Bun.serve() for start/stop and createTaskHandler for task persistence.
 */
import type {
  JsonRpcRequest,
  SendMessageParams,
  TaskQueryParams,
  TaskCancelParams,
  AgentCard,
} from "../types.js";
import { A2AError } from "../errors.js";
import { Effect, Context, Layer, Schema, Either, ParseResult } from "effect";
import {
  SendMessageParamsSchema,
  TaskQueryParamsSchema,
  TaskCancelParamsSchema,
} from "../types.js";
import { secureServe } from "@reactive-agents/runtime-shim";
import type { ServerLike } from "@reactive-agents/runtime-shim";
import { A2AServer } from "./a2a-server.js";
import { createTaskHandler, type TaskExecutor } from "./task-handler.js";
import { formatSSEEvent, type StreamEvent } from "./streaming.js";

export class A2AHttpServer extends Context.Tag("A2AHttpServer")<
  A2AHttpServer,
  {
    readonly handleJsonRpc: (request: JsonRpcRequest) => Effect.Effect<unknown, A2AError>;
    /** Binds a real port and returns the port actually bound (useful with `port: 0`). */
    readonly start: () => Effect.Effect<number>;
    readonly stop: () => Effect.Effect<void>;
  }
>() {}

const JSONRPC_VERSION = "2.0";

type JsonRpcId = JsonRpcRequest["id"];

/** Strips a trailing slash and ensures a single leading slash; `undefined`/`"/"` normalize to `""` (no prefix). */
const normalizeBasePath = (basePath?: string): string => {
  if (!basePath || basePath === "/") return "";
  const trimmed = basePath.replace(/\/+$/, "");
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
};

export interface A2AHttpServerOptions {
  /** Bind hostname. Defaults to `RA_A2A_HOST` env, then `secureServe`'s own loopback default. */
  readonly hostname?: string;
  /** Bearer token required on every request. Defaults to `RA_A2A_TOKEN` env. */
  readonly token?: string;
  /** Maximum JSON-RPC request body in bytes, counted on the stream. Default 1 MiB. */
  readonly maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1024 * 1024;

const PARAMS_SCHEMAS: Readonly<Record<string, Schema.Schema.AnyNoContext>> = {
  "message/send": SendMessageParamsSchema,
  "message/stream": SendMessageParamsSchema,
  "tasks/get": TaskQueryParamsSchema,
  "tasks/cancel": TaskCancelParamsSchema,
};

/** Returns a short description of why `params` is invalid for `method`, or `null` when valid / method takes no params. */
const validateMethodParams = (method: unknown, params: unknown): string | null => {
  if (typeof method !== "string" || !Object.hasOwn(PARAMS_SCHEMAS, method)) return null;
  const schema = PARAMS_SCHEMAS[method];
  if (!schema) return null;
  const result = Schema.decodeUnknownEither(schema)(params);
  return Either.isLeft(result) ? ParseResult.TreeFormatter.formatErrorSync(result.left) : null;
};

/**
 * Read a request body as text, counting bytes as they stream. Returns `null` (and cancels the
 * stream) as soon as `max` is exceeded, so an oversized or chunked body is never buffered whole.
 */
const readCappedText = async (req: Request, max: number): Promise<string | null> => {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(next.value);
  }
  return Buffer.concat(chunks).toString("utf8");
};

export const createA2AHttpServer = (
  port: number = 3000,
  executor?: TaskExecutor,
  basePath?: string,
  serverOptions?: A2AHttpServerOptions,
) =>
  Layer.effect(
    A2AHttpServer,
    Effect.gen(function* () {
      const server = yield* A2AServer;
      const base = normalizeBasePath(basePath);
      const maxBodyBytes = serverOptions?.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
      // All three routes live under `base` (default `""`, i.e. root) — the
      // JSON-RPC endpoint at `base` itself (or `/` when there is no base),
      // the fallback card at `base/agent/card`, and A2A standard discovery
      // at `base/.well-known/agent.json`. Clients (`a2a-client.ts`,
      // `discovery.ts`) already treat these as relative to whatever base URL
      // they're given, so prefixing all three keeps client and server in
      // sync without touching the JSON-RPC dispatch logic itself.
      const rpcPath = base === "" ? "/" : base;
      const cardPath = `${base}/agent/card`;
      const wellKnownPath = `${base}/.well-known/agent.json`;
      // Single task store: the http server writes/reads through the
      // A2AServer service's own store (via TaskStore's getTask/setTask),
      // rather than keeping a second independent Ref. This is what makes
      // tasks/cancel able to find a task that message/send just created.
      const taskHandler = createTaskHandler(server, executor);

      // Mutable reference to the server instance
      let bunServer: ServerLike | null = null;

      const handleMessageSend = (params: unknown, id: JsonRpcId) =>
        Effect.gen(function* () {
          const sendParams = params as SendMessageParams;
          const task = yield* taskHandler.handleMessageSend(sendParams);
          return { jsonrpc: JSONRPC_VERSION, id, result: task };
        });

      const handleMessageStream = (params: unknown, agentCard: AgentCard) =>
        Effect.gen(function* () {
          const sendParams = params as SendMessageParams;
          // Force blocking mode regardless of what the caller sent: Task 1's
          // spec-shaped default is non-blocking, but this handler joins the
          // task's events into a single SSE response after the fact (it does
          // not actually stream incremental events) — without blocking it
          // would emit one `working`/`final:false` event and close,
          // stranding the caller with no result (final-review I1). This
          // restores the previously-described "await full completion" shape.
          const task = yield* taskHandler.handleMessageSend({
            ...sendParams,
            configuration: { ...sendParams.configuration, blocking: true },
          });

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

      const handleTasksGet = (params: unknown, id: JsonRpcId) =>
        Effect.gen(function* () {
          const queryParams = params as TaskQueryParams;
          const task = yield* server.getTask(queryParams.id);
          return { jsonrpc: JSONRPC_VERSION, id, result: task };
        }).pipe(
          Effect.mapError(
            (e) => new A2AError({ code: "TASK_NOT_FOUND", message: e.taskId }),
          ),
        );

      const handleTasksCancel = (params: unknown, id: JsonRpcId) =>
        Effect.gen(function* () {
          const cancelParams = params as TaskCancelParams;
          const task = yield* server.cancelTask(cancelParams.id);
          return { jsonrpc: JSONRPC_VERSION, id, result: task };
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

      const handleAgentCard = (id: JsonRpcId) =>
        Effect.gen(function* () {
          const card = yield* server.getAgentCard();
          return { jsonrpc: JSONRPC_VERSION, id, result: card };
        });

      const routeRequest = (
        request: JsonRpcRequest,
      ): Effect.Effect<unknown, A2AError> => {
        switch (request.method) {
          case "message/send":
            return handleMessageSend(request.params, request.id);
          case "tasks/get":
            return handleTasksGet(request.params, request.id);
          case "tasks/cancel":
            return handleTasksCancel(request.params, request.id);
          case "agent/card":
            return handleAgentCard(request.id);
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

            // Secure-by-default ingress (F4): binds loopback unless a hostname
            // is given, and refuses a non-loopback bind without a token.
            // Explicit `serverOptions` (per-call, e.g. from `serveA2A()`)
            // take priority; RA_A2A_HOST/RA_A2A_TOKEN env vars are only the
            // fallback default (used by `rax serve`), never a global mutation
            // — each call to this factory is isolated from every other.
            bunServer = yield* Effect.promise(() => secureServe({
              port,
              hostname: serverOptions?.hostname ?? process.env.RA_A2A_HOST,
              token: serverOptions?.token ?? process.env.RA_A2A_TOKEN,
              maxBodyBytes,
              fetch: async (req) => {
                const url = new URL(req.url);

                // GET {base}/.well-known/agent.json — A2A standard discovery
                if (req.method === "GET" && url.pathname === wellKnownPath) {
                  return new Response(JSON.stringify(agentCard), {
                    headers: { "Content-Type": "application/json" },
                  });
                }

                // GET {base}/agent/card — fallback discovery
                if (req.method === "GET" && url.pathname === cardPath) {
                  return new Response(JSON.stringify(agentCard), {
                    headers: { "Content-Type": "application/json" },
                  });
                }

                // POST {base} (default "/") — JSON-RPC endpoint
                if (req.method === "POST" && url.pathname === rpcPath) {
                  // Stream-counted cap: chunked bodies carry no Content-Length, so
                  // secureServe's header check alone cannot bound them.
                  const raw = await readCappedText(req, maxBodyBytes);
                  if (raw === null) {
                    return new Response(`Request body exceeds ${maxBodyBytes} bytes`, { status: 413 });
                  }
                  try {
                    const body = JSON.parse(raw) as JsonRpcRequest;

                    // Params are untrusted: validate against the method's schema before dispatch.
                    const paramsError = validateMethodParams(body.method, body.params);
                    if (paramsError !== null) {
                      return new Response(
                        JSON.stringify({
                          jsonrpc: JSONRPC_VERSION,
                          id: body.id ?? null,
                          error: { code: -32602, message: `Invalid params: ${paramsError}` },
                        }),
                        { headers: { "Content-Type": "application/json" } },
                      );
                    }

                    // Handle message/stream — return SSE, or a JSON-RPC error
                    // if the task never started (e.g. no executor configured)
                    // — nothing has been written yet, so a plain JSON error
                    // response is correct here, not a malformed SSE body.
                    if (body.method === "message/stream") {
                      const streamOutcome = await Effect.runPromise(
                        handleMessageStream(body.params, agentCard).pipe(Effect.either),
                      );

                      if (streamOutcome._tag === "Left") {
                        const error = streamOutcome.left;
                        return new Response(
                          JSON.stringify({
                            jsonrpc: JSONRPC_VERSION,
                            id: body.id,
                            error: {
                              code: -32000,
                              message: error.message,
                              data: { a2aCode: error.code },
                            },
                          }),
                          { headers: { "Content-Type": "application/json" } },
                        );
                      }

                      const sseBody = streamOutcome.right.events
                        .map((evt) => formatSSEEvent(evt, body.id))
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
            }));

            return bunServer.port;
          }),

        stop: () =>
          Effect.sync(() => {
            if (bunServer) {
              bunServer.stop();
              bunServer = null;
            }
          }),
      };
    }),
  );
