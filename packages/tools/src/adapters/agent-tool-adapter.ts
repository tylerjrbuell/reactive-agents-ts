import { Effect, Schema } from "effect";
import type { AgentConfig, Capability } from "@reactive-agents/core";
import type { ToolDefinition, ToolParameter } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const MAX_RECURSION_DEPTH = 3;

// ─── Sub-Agent Configuration ───

export interface SubAgentConfig {
  /** Display name for the sub-agent */
  readonly name: string;
  /** Description of what this sub-agent does */
  readonly description?: string;
  /** LLM provider override */
  readonly provider?: string;
  /** Model override */
  readonly model?: string;
  /** Subset of parent's tools this sub-agent can access */
  readonly tools?: readonly string[];
  /** Max reasoning iterations (default: 5, lower than parent) */
  readonly maxIterations?: number;
  /** Focused system prompt for this sub-agent */
  readonly systemPrompt?: string;
  /** Optional persona for steering sub-agent behavior */
  readonly persona?: {
    readonly role?: string;
    readonly instructions?: string;
    readonly tone?: string;
    readonly background?: string;
  };
}

export interface SubAgentResult {
  readonly subAgentName: string;
  readonly success: boolean;
  readonly summary: string;
  readonly tokensUsed: number;
}

/**
 * Create a sub-agent executor that delegates tasks to a sub-agent.
 * Returns a structured summary instead of raw output.
 *
 * The `executeFn` is provided by the caller (builder.ts) to avoid circular
 * imports between tools and runtime packages. It creates the runtime and
 * runs the task against it.
 */
export const createSubAgentExecutor = (
  config: SubAgentConfig,
  executeFn: (opts: {
    agentId: string;
    provider?: string;
    model?: string;
    maxIterations?: number;
    systemPrompt?: string;
    persona?: {
      role?: string;
      instructions?: string;
      tone?: string;
      background?: string;
    };
    enableReasoning: boolean;
    enableTools: boolean;
    task: string;
    name: string;
  }) => Promise<{ output: string; success: boolean; tokensUsed: number }>,
  depth: number = 0,
): ((task: string) => Promise<SubAgentResult>) => {
  return async (task: string): Promise<SubAgentResult> => {
    if (depth >= MAX_RECURSION_DEPTH) {
      return {
        subAgentName: config.name,
        success: false,
        summary: `Maximum agent recursion depth (${MAX_RECURSION_DEPTH}) exceeded`,
        tokensUsed: 0,
      };
    }

    try {
      const result = await executeFn({
        agentId: `sub-${config.name}-${Date.now()}`,
        provider: config.provider,
        model: config.model,
        maxIterations: config.maxIterations ?? 5,
        systemPrompt: config.systemPrompt,
        persona: config.persona,
        enableReasoning: true,
        enableTools: true,
        task,
        name: config.name,
      });

      const summary = result.output.length > 1500
        ? result.output.slice(0, 1500) + "..."
        : result.output;

      return {
        subAgentName: config.name,
        success: result.success,
        summary,
        tokensUsed: result.tokensUsed,
      };
    } catch (error) {
      return {
        subAgentName: config.name,
        success: false,
        summary: error instanceof Error ? error.message : String(error),
        tokensUsed: 0,
      };
    }
  };
};

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

/**
 * Create the `spawn-agent` tool definition used when `.withDynamicSubAgents()`
 * is enabled on the builder. The handler is registered separately by the
 * builder so it can capture the parent's provider/model config as a closure.
 */
export const createSpawnAgentTool = (): ToolDefinition => ({
  name: "spawn-agent",
  description:
    "Spawn a sub-agent to handle a self-contained subtask. The sub-agent automatically " +
    "inherits all parent capabilities (tools, MCP servers, model, reasoning, guardrails) " +
    "and runs with a fresh context window. Just describe the task — the framework handles " +
    "all infrastructure. Optionally steer the sub-agent's approach with role/instructions.",
  parameters: [
    {
      name: "task",
      type: "string" as const,
      description:
        "Complete task description in natural language. The sub-agent has no knowledge of " +
        "the parent conversation — be explicit about what to do and what to return. " +
        "Example: 'Fetch the 5 latest commits from github.com/owner/repo and return a bullet-point summary'",
      required: true,
    },
    {
      name: "name",
      type: "string" as const,
      description: "Short label for logs. Default: 'dynamic-agent'.",
      required: false,
    },
    {
      name: "role",
      type: "string" as const,
      description: "Optional role to steer approach (e.g., 'researcher', 'code reviewer').",
      required: false,
    },
    {
      name: "instructions",
      type: "string" as const,
      description: "Optional behavioral guidance (e.g., 'Be concise', 'Focus on security issues').",
      required: false,
    },
    {
      name: "tone",
      type: "string" as const,
      description: "Optional tone (e.g., 'professional', 'casual', 'detailed').",
      required: false,
    },
  ],
  returnType: "object" as const,
  category: "custom" as const,
  riskLevel: "medium" as const,
  timeoutMs: 120_000,
  requiresApproval: false,
  source: "function" as const,
});

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
