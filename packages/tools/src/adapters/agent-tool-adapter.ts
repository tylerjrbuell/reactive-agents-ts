import { Effect, Schema } from "effect";
import type { AgentConfig, Capability } from "@reactive-agents/core";
import type { ToolDefinition, ToolParameter } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const MAX_RECURSION_DEPTH = 3;

const deriveInputSchemaFromCapabilities = (
  capabilities: readonly Capability[]
): ToolParameter[] => {
  const params: ToolParameter[] = [];

  for (const cap of capabilities) {
    if (cap.type === "tool") {
      params.push({
        name: "toolName",
        type: "string" as const,
        description: `Tool to invoke: ${cap.name}`,
        required: true,
      });
    }
  }

  params.push({
    name: "input",
    type: "object" as const,
    description: "Input to pass to the agent",
    required: false,
  });

  if (capabilities.some((c) => c.type === "reasoning")) {
    params.push({
      name: "reasoning",
      type: "boolean" as const,
      description: "Include reasoning trace in response",
      required: false,
      default: false,
    });
  }

  if (capabilities.some((c) => c.type === "memory")) {
    params.push({
      name: "remember",
      type: "boolean" as const,
      description: "Store result in memory",
      required: false,
      default: true,
    });
  }

  if (params.length === 0) {
    params.push({
      name: "input",
      type: "object" as const,
      description: "Agent input data",
      required: false,
    });
  }

  return params;
};

export const createAgentTool = (
  name: string,
  agent: AgentConfig,
  _execute?: (input: Record<string, unknown>) => Promise<unknown>
): ToolDefinition => {
  const description = agent.description ?? `Agent: ${agent.name}`;

  return {
    name,
    description,
    parameters: deriveInputSchemaFromCapabilities(agent.capabilities),
    returnType: "object",
    category: "custom",
    riskLevel: "medium",
    timeoutMs: 60_000,
    requiresApproval: true,
    source: "function",
  };
};

export const createRemoteAgentTool = (
  name: string,
  _agentCardUrl: string,
  baseUrl: string
): ToolDefinition => {
  return {
    name,
    description: `Remote agent accessed via A2A at ${baseUrl}`,
    parameters: [
      {
        name: "message",
        type: "string" as const,
        description: "Message to send to the remote agent",
        required: true,
      },
      {
        name: "stream",
        type: "boolean" as const,
        description: "Enable streaming responses",
        required: false,
        default: false,
      },
    ],
    returnType: "object",
    category: "custom",
    riskLevel: "high",
    timeoutMs: 120_000,
    requiresApproval: true,
    source: "plugin",
  };
};

export const executeAgentTool = async (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  executeFn: (input: Record<string, unknown>) => Promise<unknown>,
  depth: number = 0
): Promise<unknown> => {
  if (depth >= MAX_RECURSION_DEPTH) {
    throw new ToolExecutionError({
      message: `Maximum agent recursion depth (${MAX_RECURSION_DEPTH}) exceeded`,
      toolName: tool.name,
      input,
    });
  }

  try {
    const result = await executeFn(input);
    return result;
  } catch (error) {
    throw new ToolExecutionError({
      message: error instanceof Error ? error.message : String(error),
      toolName: tool.name,
      input,
    });
  }
};

export interface RemoteAgentClient {
  sendMessage: (params: {
    message: { role: string; content: string };
    agentCardUrl: string;
  }) => Effect.Effect<{ taskId: string }, Error>;
  getTask: (params: { id: string }) => Effect.Effect<{ status: string; result: unknown }, Error>;
}

export interface TaskResult {
  taskId: string;
  status: string;
  result: unknown;
}

export const executeRemoteAgentTool = async (
  tool: ToolDefinition,
  input: Record<string, unknown>,
  client: RemoteAgentClient,
  agentCardUrl: string
): Promise<TaskResult> => {
  const message = input.message as string;
  const _stream = (input.stream as boolean) ?? false;

  if (!message) {
    throw new ToolExecutionError({
      message: "Missing required parameter: message",
      toolName: tool.name,
      input,
    });
  }

  const sendResult = await Effect.runPromise(
    client.sendMessage({
      message: {
        role: "user",
        content: message,
      },
      agentCardUrl,
    })
  );

  const task = await Effect.runPromise(
    client.getTask({
      id: sendResult.taskId,
    })
  );

  return {
    taskId: sendResult.taskId,
    status: task.status,
    result: task.result,
  };
};
