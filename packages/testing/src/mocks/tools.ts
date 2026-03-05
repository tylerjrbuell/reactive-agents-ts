import { Effect, Layer } from "effect";
import { ToolService } from "@reactive-agents/tools";
import type { CapturedToolCall } from "../types.js";

/**
 * Create a mock ToolService that records all tool calls and returns configured results.
 *
 * @param toolResults - Map of tool name to result value. Unrecognized tools return `{ success: true }`.
 */
export function createMockToolService(
  toolResults: Record<string, unknown> = {},
) {
  const calls: CapturedToolCall[] = [];

  const service = {
    execute: (input: { toolName: string; arguments: Record<string, unknown> }) =>
      Effect.gen(function* () {
        calls.push({
          toolName: input.toolName,
          arguments: input.arguments,
          timestamp: Date.now(),
        });

        const result =
          input.toolName in toolResults
            ? toolResults[input.toolName]
            : { success: true };

        return {
          toolName: input.toolName,
          success: true as const,
          result,
          executionTimeMs: 1,
        };
      }),

    register: (_definition: unknown, _handler: unknown) => Effect.void,

    connectMCPServer: (_config: unknown) =>
      Effect.succeed({
        name: "mock-mcp",
        version: "1.0.0",
        transport: "stdio" as const,
        tools: [],
        status: "connected" as const,
      }),

    disconnectMCPServer: (_serverName: string) => Effect.void,

    listTools: (_filter?: unknown) =>
      Effect.succeed(
        Object.keys(toolResults).map((name) => ({
          name,
          description: `Mock tool: ${name}`,
          parameters: [],
          riskLevel: "low" as const,
          timeoutMs: 30_000,
          requiresApproval: false,
          source: "function" as const,
        })),
      ),

    getTool: (name: string) =>
      Effect.succeed({
        name,
        description: `Mock tool: ${name}`,
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 30_000,
        requiresApproval: false,
        source: "function" as const,
      }),

    toFunctionCallingFormat: () =>
      Effect.succeed(
        Object.keys(toolResults).map((name) => ({
          name,
          description: `Mock tool: ${name}`,
          input_schema: { type: "object", properties: {}, required: [] },
        })),
      ),

    listMCPServers: () => Effect.succeed([]),
  };

  const layer = Layer.succeed(ToolService, service as any);

  return {
    layer,
    service,
    calls,
    get callCount() {
      return calls.length;
    },
    callsFor(name: string) {
      return calls.filter((c) => c.toolName === name);
    },
    reset() {
      calls.length = 0;
    },
  };
}
