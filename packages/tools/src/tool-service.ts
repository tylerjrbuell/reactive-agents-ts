import { Effect, Context, Layer } from "effect";

import type {
  ToolInput,
  ToolOutput,
  ToolDefinition,
  MCPServer,
  FunctionCallingTool,
} from "./types.js";
import {
  ToolNotFoundError,
  ToolExecutionError,
  ToolTimeoutError,
  ToolValidationError,
  ToolAuthorizationError,
  MCPConnectionError,
} from "./errors.js";
import { makeToolRegistry } from "./registry/tool-registry.js";
import { makeMCPClient } from "./mcp/mcp-client.js";
import { makeSandbox } from "./execution/sandbox.js";
import { validateToolInput } from "./validation/input-validator.js";
import { EventBus } from "@reactive-agents/core";

// ─── Service Tag ───

export class ToolService extends Context.Tag("ToolService")<
  ToolService,
  {
    readonly execute: (
      input: ToolInput,
    ) => Effect.Effect<
      ToolOutput,
      | ToolNotFoundError
      | ToolExecutionError
      | ToolTimeoutError
      | ToolValidationError
      | ToolAuthorizationError
    >;

    readonly register: (
      definition: ToolDefinition,
      handler: (
        args: Record<string, unknown>,
      ) => Effect.Effect<unknown, ToolExecutionError>,
    ) => Effect.Effect<void, never>;

    readonly connectMCPServer: (
      config: Pick<
        MCPServer,
        "name" | "transport" | "endpoint" | "command" | "args"
      >,
    ) => Effect.Effect<MCPServer, MCPConnectionError>;

    readonly disconnectMCPServer: (
      serverName: string,
    ) => Effect.Effect<void, MCPConnectionError>;

    readonly listTools: (filter?: {
      category?: string;
      source?: string;
      riskLevel?: string;
    }) => Effect.Effect<readonly ToolDefinition[], never>;

    readonly getTool: (
      name: string,
    ) => Effect.Effect<ToolDefinition, ToolNotFoundError>;

    readonly toFunctionCallingFormat: () => Effect.Effect<
      readonly FunctionCallingTool[],
      never
    >;

    readonly listMCPServers: () => Effect.Effect<readonly MCPServer[], never>;
  }
>() {}

// ─── Live Implementation ───

export const ToolServiceLive = Layer.effect(
  ToolService,
  Effect.gen(function* () {
    const eventBus = yield* EventBus;
    const registry = yield* makeToolRegistry;
    const mcpClient = yield* makeMCPClient;
    const sandbox = makeSandbox();

    const execute = (
      input: ToolInput,
    ): Effect.Effect<
      ToolOutput,
      | ToolNotFoundError
      | ToolExecutionError
      | ToolTimeoutError
      | ToolValidationError
      | ToolAuthorizationError
    > =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Step 1: Look up tool
        const tool = yield* registry.get(input.toolName);

        // Step 2: Validate input
        const validatedArgs = yield* validateToolInput(
          tool.definition,
          input.arguments,
        );

        // Step 3: Execute in sandbox with timeout
        const result = yield* sandbox.execute(
          () => tool.handler(validatedArgs),
          {
            timeoutMs: tool.definition.timeoutMs,
            toolName: input.toolName,
          },
        );

        const executionTimeMs = Date.now() - startTime;

        // Step 4: Emit event
        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.executed",
          payload: {
            toolName: input.toolName,
            success: true,
            executionTimeMs,
          },
        });

        return {
          toolName: input.toolName,
          success: true as const,
          result,
          executionTimeMs,
        } satisfies ToolOutput;
      });

    const register = (
      definition: ToolDefinition,
      handler: (
        args: Record<string, unknown>,
      ) => Effect.Effect<unknown, ToolExecutionError>,
    ): Effect.Effect<void, never> => registry.register(definition, handler);

    const connectMCPServer = (
      config: Pick<
        MCPServer,
        "name" | "transport" | "endpoint" | "command" | "args"
      >,
    ): Effect.Effect<MCPServer, MCPConnectionError> =>
      Effect.gen(function* () {
        const server = yield* mcpClient.connect(config);

        // Register each MCP tool in the registry
        for (const toolName of server.tools) {
          yield* registry.register(
            {
              name: `${server.name}/${toolName}`,
              description: `MCP tool from ${server.name}`,
              parameters: [],
              riskLevel: "medium",
              timeoutMs: 30_000,
              requiresApproval: false,
              source: "mcp",
            },
            (args) =>
              mcpClient.callTool(server.name, toolName, args).pipe(
                Effect.mapError(
                  (e) =>
                    new ToolExecutionError({
                      message: `MCP tool ${toolName} failed`,
                      toolName,
                      cause: e,
                    }),
                ),
              ),
          );
        }

        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.mcp-connected",
          payload: { serverName: server.name, tools: server.tools },
        });

        return server;
      });

    const disconnectMCPServer = (
      serverName: string,
    ): Effect.Effect<void, MCPConnectionError> =>
      Effect.gen(function* () {
        yield* mcpClient.disconnect(serverName);
        yield* eventBus.publish({
          _tag: "Custom",
          type: "tools.mcp-disconnected",
          payload: { serverName },
        });
      });

    const listTools = (filter?: {
      category?: string;
      source?: string;
      riskLevel?: string;
    }): Effect.Effect<readonly ToolDefinition[], never> =>
      registry.list(filter);

    const getTool = (
      name: string,
    ): Effect.Effect<ToolDefinition, ToolNotFoundError> =>
      registry.get(name).pipe(Effect.map((t) => t.definition));

    const toFunctionCallingFormat = (): Effect.Effect<
      readonly FunctionCallingTool[],
      never
    > => registry.toFunctionCallingFormat();

    const listMCPServers = (): Effect.Effect<readonly MCPServer[], never> =>
      mcpClient.listServers();

    return {
      execute,
      register,
      connectMCPServer,
      disconnectMCPServer,
      listTools,
      getTool,
      toFunctionCallingFormat,
      listMCPServers,
    };
  }),
);
