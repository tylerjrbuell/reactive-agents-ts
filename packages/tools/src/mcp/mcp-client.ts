import { Effect, Ref } from "effect";

import type { MCPServer, MCPRequest, MCPResponse } from "../types.js";
import { MCPConnectionError, ToolExecutionError } from "../errors.js";

// ─── Active Transport State ───

interface StdioTransport {
  type: "stdio";
  subprocess: ReturnType<typeof Bun.spawn>;
  pendingRequests: Map<
    string | number,
    {
      resolve: (response: MCPResponse) => void;
      reject: (err: Error) => void;
    }
  >;
  readerStopped: boolean;
}

interface SseTransport {
  type: "sse";
  endpoint: string;
  pendingRequests: Map<
    string | number,
    {
      resolve: (response: MCPResponse) => void;
      reject: (err: Error) => void;
    }
  >;
  abortController: AbortController | null;
  connected: boolean;
  reconnectAttempt: number;
  reconnectTimeoutId: ReturnType<typeof setTimeout> | null;
}

interface WebSocketTransport {
  type: "websocket";
  socket: WebSocket | null;
  endpoint: string;
  pendingRequests: Map<
    string | number,
    {
      resolve: (response: MCPResponse) => void;
      reject: (err: Error) => void;
    }
  >;
  connected: boolean;
  reconnectAttempt: number;
  reconnectTimeoutId: ReturnType<typeof setTimeout> | null;
  reconnecting: boolean;
  closing: boolean;
}

type ActiveTransport = StdioTransport | SseTransport | WebSocketTransport;

// Module-level map: serverName -> ActiveTransport
const activeTransports = new Map<string, ActiveTransport>();

// ─── Background stdout reader ───

const startStdioReader = (
  serverName: string,
  transport: StdioTransport,
): void => {
  const { subprocess } = transport;

  void (async () => {
    // Cast to AsyncIterable — Bun.spawn({stdout:"pipe"}) returns ReadableStream
    const stdout = subprocess.stdout as AsyncIterable<Uint8Array> | null;
    if (!stdout) return;

    const decoder = new TextDecoder();
    let buffer = "";

    try {
      for await (const chunk of stdout) {
        if (transport.readerStopped) break;

        buffer += decoder.decode(chunk as Uint8Array, { stream: true });

        // Split on newlines — process each complete line
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          let parsed: MCPResponse;
          try {
            parsed = JSON.parse(trimmed) as MCPResponse;
          } catch {
            // Not valid JSON (e.g., server log lines) — skip
            continue;
          }

          const pending = transport.pendingRequests.get(parsed.id);
          if (pending) {
            transport.pendingRequests.delete(parsed.id);
            pending.resolve(parsed);
          }
          // Unsolicited notifications (no matching pending) are silently dropped
        }
      }
    } catch (err) {
      // Reader died — reject all pending requests
      transport.readerStopped = true;
      for (const [id, pending] of transport.pendingRequests) {
        transport.pendingRequests.delete(id);
        pending.reject(
          err instanceof Error
            ? err
            : new Error(
                `MCP stdio reader error for "${serverName}": ${String(err)}`,
              ),
        );
      }
    }
  })();
};

// ─── SSE Transport ───

const SSE_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const SSE_CONNECTION_TIMEOUT = 30000;

const isStdioTransport = (t: ActiveTransport): t is StdioTransport =>
  t.type === "stdio";

const isSseTransport = (t: ActiveTransport): t is SseTransport =>
  t.type === "sse";

const isWebSocketTransport = (t: ActiveTransport): t is WebSocketTransport =>
  t.type === "websocket";

const parseSseEvent = (line: string): { event?: string; data?: string } => {
  if (line.startsWith("event:")) {
    return { event: line.slice(6).trim() };
  }
  if (line.startsWith("data:")) {
    return { data: line.slice(5).trim() };
  }
  return {};
};

const startSseReader = (
  serverName: string,
  transport: SseTransport,
): void => {
  const connect = () => {
    if (transport.connected) return;

    const abortController = new AbortController();
    transport.abortController = abortController;

    const sseEndpoint = transport.endpoint.includes("?")
      ? `${transport.endpoint}&session=${serverName}`
      : `${transport.endpoint}?session=${serverName}`;

    const initSSE = async () => {
      const timeoutId = setTimeout(() => {
        abortController.abort();
      }, SSE_CONNECTION_TIMEOUT);

      try {
        transport.connected = true;
        transport.reconnectAttempt = 0;

        const response = await fetch(sseEndpoint, {
          method: "GET",
          headers: { Accept: "text/event-stream" },
          signal: abortController.signal,
        });

        clearTimeout(timeoutId);

        if (!response.ok || !response.body) {
          throw new Error(`SSE connection failed: ${response.status}`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        const readStream = async (): Promise<void> => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done || abortController.signal.aborted) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              let eventType = "";
              let eventData = "";

              for (const line of lines) {
                const parsed = parseSseEvent(line);
                if (parsed.event) eventType = parsed.event;
                if (parsed.data) eventData = parsed.data;
              }

              if (eventType === "message" && eventData) {
                try {
                  const parsed = JSON.parse(eventData) as MCPResponse;
                  const pending = transport.pendingRequests.get(parsed.id);
                  if (pending) {
                    transport.pendingRequests.delete(parsed.id);
                    pending.resolve(parsed);
                  }
                } catch {
                  // Invalid JSON in SSE data - skip
                }
              }

              if (eventType === "ping" || eventType === "keepalive") {
                // Keepalive received, reset reconnect attempt
                transport.reconnectAttempt = 0;
              }
            }
          } catch {
            // Stream ended or error
          }
        };

        readStream().catch(() => {
          // Ignore read errors during cleanup
        });
      } catch (err) {
        clearTimeout(timeoutId);
        transport.connected = false;

        if (!abortController.signal.aborted) {
          const delay =
            SSE_RECONNECT_DELAYS[
              Math.min(
                transport.reconnectAttempt,
                SSE_RECONNECT_DELAYS.length - 1,
              )
            ];
          transport.reconnectAttempt++;

          transport.reconnectTimeoutId = setTimeout(() => {
            if (!abortController.signal.aborted) {
              initSSE();
            }
          }, delay);
        }
      }
    };

    initSSE();
  };

  connect();
};

const createSseTransport = (
  config: Pick<MCPServer, "name" | "endpoint">,
): SseTransport => {
  const endpoint = config.endpoint ?? "";
  return {
    type: "sse",
    endpoint,
    pendingRequests: new Map(),
    abortController: null,
    connected: false,
    reconnectAttempt: 0,
    reconnectTimeoutId: null,
  };
};

// ─── WebSocket Transport ───

const WS_RECONNECT_DELAYS = [1000, 2000, 4000, 8000, 16000, 30000];
const WS_CONNECTION_TIMEOUT = 30000;

const createWebSocketTransport = (
  config: Pick<MCPServer, "name" | "endpoint">,
): WebSocketTransport => {
  const endpoint = config.endpoint ?? "";
  return {
    type: "websocket",
    socket: null,
    endpoint,
    pendingRequests: new Map(),
    connected: false,
    reconnectAttempt: 0,
    reconnectTimeoutId: null,
    reconnecting: false,
    closing: false,
  };
};

const connectWebSocket = (
  serverName: string,
  transport: WebSocketTransport,
): Promise<void> => {
  if (transport.connected && transport.socket?.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  if (transport.socket && transport.socket.readyState === WebSocket.CONNECTING) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error(`WebSocket connecting timeout for "${serverName}"`));
      }, WS_CONNECTION_TIMEOUT);

      transport.socket!.onopen = () => {
        clearTimeout(timeoutId);
        transport.connected = true;
        resolve();
      };
      transport.socket!.onerror = () => {
        clearTimeout(timeoutId);
        reject(new Error(`WebSocket error while connecting for "${serverName}"`));
      };
    });
  }

  if (transport.socket) {
    try {
      transport.socket.close();
    } catch {
      // Ignore close errors
    }
  }

  return new Promise((resolve, reject) => {
    const endpoint = transport.endpoint;
    if (!endpoint) {
      const err = new Error(
        `WebSocket endpoint not configured for MCP server "${serverName}"`,
      );
      reject(err);
      return;
    }

    const timeoutId = setTimeout(() => {
      if (transport.socket && transport.socket.readyState === WebSocket.CONNECTING) {
        transport.socket.close();
      }
      reject(new Error(`WebSocket connection timeout for "${serverName}"`));
    }, WS_CONNECTION_TIMEOUT);

    const socket = new WebSocket(endpoint);
    transport.socket = socket;

    socket.onopen = () => {
      clearTimeout(timeoutId);
      transport.connected = true;
      transport.reconnectAttempt = 0;
      transport.reconnecting = false;
      resolve();
    };

    socket.onmessage = (event) => {
      try {
        const parsed = JSON.parse(event.data as string) as MCPResponse;
        const pending = transport.pendingRequests.get(parsed.id);
        if (pending) {
          transport.pendingRequests.delete(parsed.id);
          pending.resolve(parsed);
        }
      } catch {
        // Invalid JSON - skip
      }
    };

    socket.onerror = () => {
      clearTimeout(timeoutId);
      transport.connected = false;
      reject(new Error(`WebSocket error for "${serverName}"`));
    };

    socket.onclose = () => {
      clearTimeout(timeoutId);
      transport.connected = false;

      if (!transport.closing && transport.reconnectAttempt < WS_RECONNECT_DELAYS.length) {
        transport.reconnecting = true;
        const delay = WS_RECONNECT_DELAYS[transport.reconnectAttempt];
        transport.reconnectAttempt++;

        transport.reconnectTimeoutId = setTimeout(() => {
          if (!transport.closing) {
            connectWebSocket(serverName, transport).catch(() => {});
          }
        }, delay);
      }
    };
  });
};

// ─── Transport Creation ───

const createTransport = (
  config: Pick<
    MCPServer,
    "name" | "transport" | "endpoint" | "command" | "args"
  >,
): Effect.Effect<void, unknown> => {
  if (config.transport === "stdio") {
    return Effect.tryPromise(async () => {
      const command = config.command;
      if (!command) {
        throw new Error(
          `MCP server "${config.name}" has transport "stdio" but no command specified`,
        );
      }

      const subprocess = Bun.spawn([command, ...(config.args ?? [])], {
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      });

      const transport: StdioTransport = {
        type: "stdio",
        subprocess,
        pendingRequests: new Map(),
        readerStopped: false,
      };

      activeTransports.set(config.name, transport);
      startStdioReader(config.name, transport);
    });
  }

  // SSE transport — implement HTTP event stream
  if (config.transport === "sse") {
    return Effect.tryPromise(async () => {
      const endpoint = config.endpoint;
      if (!endpoint) {
        throw new Error(
          `MCP server "${config.name}" has transport "sse" but no endpoint specified`,
        );
      }

      const transport = createSseTransport({ name: config.name, endpoint });
      activeTransports.set(config.name, transport);
      startSseReader(config.name, transport);
    });
  }

  // WebSocket transport
  if (config.transport === "websocket") {
    return Effect.tryPromise(async () => {
      const endpoint = config.endpoint;
      if (!endpoint) {
        throw new Error(
          `MCP server "${config.name}" has transport "websocket" but no endpoint specified`,
        );
      }

      const transport = createWebSocketTransport({
        name: config.name,
        endpoint,
      });
      activeTransports.set(config.name, transport);
      await connectWebSocket(config.name, transport);
    });
  }

  return Effect.void;
};

// ─── JSON-RPC Request Sender ───

const sendRequest = (
  config: Pick<MCPServer, "name" | "transport" | "endpoint" | "command">,
  request: MCPRequest,
): Effect.Effect<MCPResponse, MCPConnectionError> => {
  if (config.transport === "stdio") {
    return Effect.tryPromise({
      try: () => {
        const transport = activeTransports.get(config.name);
        if (!transport || !isStdioTransport(transport)) {
          return Promise.reject(
            new Error(
              `No active stdio transport for MCP server "${config.name}" — was createTransport called?`,
            ),
          );
        }

        return new Promise<MCPResponse>((resolve, reject) => {
          // Register before writing to avoid a race where the server
          // responds faster than we register the handler
          transport.pendingRequests.set(request.id, { resolve, reject });

          const line = JSON.stringify(request) + "\n";
          const encoded = new TextEncoder().encode(line);
          const stdin = transport.subprocess.stdin;

          if (!stdin) {
            transport.pendingRequests.delete(request.id);
            reject(
              new Error(
                `Subprocess stdin is not writable for MCP server "${config.name}"`,
              ),
            );
            return;
          }

          // Bun.FileSink.write() is synchronous — returns bytes written, not a Promise
          try {
            (stdin as unknown as { write(b: Uint8Array): number }).write(
              encoded,
            );
            // flush() may return void or Promise<void>
            const flushed = (
              stdin as unknown as { flush?(): void | Promise<void> }
            ).flush?.();
            if (flushed instanceof Promise) {
              flushed.catch((err: unknown) => {
                transport.pendingRequests.delete(request.id);
                reject(
                  err instanceof Error
                    ? err
                    : new Error(
                        `Flush failed for MCP server "${config.name}": ${String(err)}`,
                      ),
                );
              });
            }
          } catch (err) {
            transport.pendingRequests.delete(request.id);
            reject(
              err instanceof Error
                ? err
                : new Error(
                    `Failed to write to MCP server "${config.name}" stdin: ${String(err)}`,
                  ),
            );
          }
        });
      },
      catch: (e) =>
        new MCPConnectionError({
          message:
            e instanceof Error
              ? e.message
              : `Failed to send request to MCP server "${config.name}"`,
          serverName: config.name,
          transport: config.transport,
          cause: e,
        }),
    });
  }

  // SSE transport
  if (config.transport === "sse") {
    return Effect.tryPromise({
      try: () => {
        const transport = activeTransports.get(config.name);
        if (!transport || !isSseTransport(transport)) {
          return Promise.reject(
            new Error(
              `No active SSE transport for MCP server "${config.name}" — was createTransport called?`,
            ),
          );
        }

        const endpoint = transport.endpoint;
        if (!endpoint) {
          return Promise.reject(
            new Error(
              `No endpoint configured for SSE transport on "${config.name}"`,
            ),
          );
        }

        return new Promise<MCPResponse>((resolve, reject) => {
          transport.pendingRequests.set(request.id, { resolve, reject });

          const rpcMessage = JSON.stringify(request);

          fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: rpcMessage,
          })
            .then((response) => {
              if (!response.ok) {
                transport.pendingRequests.delete(request.id);
                reject(
                  new Error(
                    `SSE request failed for "${config.name}": ${response.status} ${response.statusText}`,
                  ),
                );
                return null;
              }
              return response.text();
            })
            .then((text) => {
              if (text) {
                try {
                  const data = JSON.parse(text) as MCPResponse;
                  transport.pendingRequests.delete(request.id);
                  resolve(data);
                } catch {
                  transport.pendingRequests.delete(request.id);
                  reject(
                    new Error(
                      `SSE response parse error for "${config.name}": ${text}`,
                    ),
                  );
                }
              }
            })
            .catch((err) => {
              transport.pendingRequests.delete(request.id);
              reject(
                err instanceof Error
                  ? err
                  : new Error(
                      `SSE request failed for "${config.name}": ${String(err)}`,
                    ),
              );
            });
        });
      },
      catch: (e) =>
        new MCPConnectionError({
          message:
            e instanceof Error
              ? e.message
              : `Failed to send request to MCP server "${config.name}"`,
          serverName: config.name,
          transport: config.transport,
          cause: e,
        }),
    });
  }

  // WebSocket transport
  if (config.transport === "websocket") {
    return Effect.tryPromise({
      try: async () => {
        const transport = activeTransports.get(config.name);
        if (!transport || !isWebSocketTransport(transport)) {
          throw new Error(
            `No active WebSocket transport for MCP server "${config.name}" — was createTransport called?`,
          );
        }

        if (!transport.connected || !transport.socket || transport.socket.readyState !== WebSocket.OPEN) {
          await connectWebSocket(config.name, transport);
        }

        const socket = transport.socket;
        if (!socket || socket.readyState !== WebSocket.OPEN) {
          throw new Error(
            `WebSocket not connected for MCP server "${config.name}" (state: ${socket?.readyState})`,
          );
        }

        return new Promise<MCPResponse>((resolve, reject) => {
          transport.pendingRequests.set(request.id, { resolve, reject });

          const rpcMessage = JSON.stringify(request);

          try {
            socket.send(rpcMessage);
          } catch (err) {
            transport.pendingRequests.delete(request.id);
            reject(
              err instanceof Error
                ? err
                : new Error(
                    `Failed to send WebSocket message to MCP server "${config.name}": ${String(err)}`,
                  ),
            );
          }
        });
      },
      catch: (e) =>
        new MCPConnectionError({
          message:
            e instanceof Error
              ? e.message
              : `Failed to send request to MCP server "${config.name}"`,
          serverName: config.name,
          transport: config.transport,
          cause: e,
        }),
    });
  }

  return Effect.succeed({
    jsonrpc: "2.0" as const,
    id: request.id,
    result: {},
  });
};

// ─── MCP Client ───

export const makeMCPClient = Effect.gen(function* () {
  const serversRef = yield* Ref.make<Map<string, MCPServer>>(new Map());
  const requestIdRef = yield* Ref.make(0);

  const nextRequestId = Ref.updateAndGet(requestIdRef, (id) => id + 1);

  const connect = (
    config: Pick<
      MCPServer,
      "name" | "transport" | "endpoint" | "command" | "args"
    >,
  ): Effect.Effect<MCPServer, MCPConnectionError> =>
    Effect.gen(function* () {
      yield* createTransport(config).pipe(
        Effect.mapError(
          (e) =>
            new MCPConnectionError({
              message: `Failed to connect to MCP server "${config.name}"`,
              serverName: config.name,
              transport: config.transport,
              cause: e,
            }),
        ),
      );

      // MCP initialize handshake
      const reqId1 = yield* nextRequestId;
      const initResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: reqId1,
        method: "initialize",
        params: {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          clientInfo: { name: "reactive-agents", version: "1.0.0" },
        },
      });

      // Discover available tools
      const reqId2 = yield* nextRequestId;
      const toolsResponse = yield* sendRequest(config, {
        jsonrpc: "2.0",
        id: reqId2,
        method: "tools/list",
      });

      // Parse full tool schemas from MCP tools/list response
      const rawTools = Array.isArray(
        (toolsResponse.result as Record<string, unknown>)?.tools,
      )
        ? ((toolsResponse.result as Record<string, unknown>).tools as Array<
            Record<string, unknown>
          >)
        : Array.isArray(toolsResponse.result)
          ? (toolsResponse.result as Array<Record<string, unknown>>)
          : [];

      const toolNames = rawTools.map((t) => t.name as string);
      const toolSchemas = rawTools.map((t) => ({
        name: t.name as string,
        description: t.description as string | undefined,
        inputSchema: t.inputSchema as
          | Record<string, unknown>
          | undefined,
      }));

      const server: MCPServer = {
        name: config.name,
        version:
          (initResponse.result as Record<string, unknown>)?.serverInfo != null
            ? String(
                (
                  (initResponse.result as Record<string, unknown>)
                    .serverInfo as Record<string, unknown>
                )?.version,
              )
            : "unknown",
        transport: config.transport,
        endpoint: config.endpoint,
        command: config.command,
        args: config.args,
        tools: toolNames,
        toolSchemas,
        status: "connected",
      };

      yield* Ref.update(serversRef, (servers) => {
        const newServers = new Map(servers);
        newServers.set(server.name, server);
        return newServers;
      });

      return server;
    });

  const callTool = (
    serverName: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, MCPConnectionError | ToolExecutionError> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      const server = servers.get(serverName);

      if (!server || server.status !== "connected") {
        return yield* Effect.fail(
          new MCPConnectionError({
            message: `MCP server "${serverName}" not connected`,
            serverName,
            transport: server?.transport ?? "unknown",
          }),
        );
      }

      const reqId = yield* nextRequestId;
      const response = yield* sendRequest(
        {
          name: serverName,
          transport: server.transport,
          endpoint: server.endpoint,
          command: server.command,
        },
        {
          jsonrpc: "2.0",
          id: reqId,
          method: "tools/call",
          params: { name: toolName, arguments: args },
        },
      );

      if (response.error) {
        return yield* Effect.fail(
          new ToolExecutionError({
            message: `MCP tool "${toolName}" failed: ${response.error.message}`,
            toolName,
            input: args,
          }),
        );
      }

      return response.result;
    });

  const disconnect = (
    serverName: string,
  ): Effect.Effect<void, MCPConnectionError> =>
    Effect.gen(function* () {
      const transport = activeTransports.get(serverName);
      if (transport) {
        // Reject any in-flight requests before disconnecting
        for (const [id, pending] of transport.pendingRequests) {
          transport.pendingRequests.delete(id);
          pending.reject(
            new Error(
              `MCP server "${serverName}" disconnected with pending request id=${String(id)}`,
            ),
          );
        }

        if (isStdioTransport(transport)) {
          transport.readerStopped = true;
          try {
            transport.subprocess.kill();
          } catch {
            // Process may already be gone
          }
        } else if (isSseTransport(transport)) {
          if (transport.reconnectTimeoutId) {
            clearTimeout(transport.reconnectTimeoutId);
          }
          if (transport.abortController) {
            transport.abortController.abort();
          }
          transport.connected = false;
        } else if (isWebSocketTransport(transport)) {
          if (transport.reconnectTimeoutId) {
            clearTimeout(transport.reconnectTimeoutId);
          }
          transport.closing = true;
          if (transport.socket) {
            transport.socket.close();
            transport.socket = null;
          }
          transport.connected = false;
        }

        activeTransports.delete(serverName);
      }

      yield* Ref.update(serversRef, (servers) => {
        const newServers = new Map(servers);
        const server = newServers.get(serverName);
        if (server) {
          newServers.set(serverName, { ...server, status: "disconnected" });
        }
        return newServers;
      });
    });

  const listServers = (): Effect.Effect<readonly MCPServer[], never> =>
    Effect.gen(function* () {
      const servers = yield* Ref.get(serversRef);
      return [...servers.values()];
    });

  return { connect, callTool, disconnect, listServers };
});
