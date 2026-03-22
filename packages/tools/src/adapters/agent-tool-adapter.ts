import { Effect, Schema } from "effect";
import type { AgentConfig, Capability } from "@reactive-agents/core";
import type { ToolDefinition, ToolParameter } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const MAX_RECURSION_DEPTH = 3;

/** Maximum characters of parent context to forward to sub-agents. */
export const MAX_PARENT_CONTEXT_CHARS = 2000;

/**
 * Tools that are always included in every sub-agent's tool scope regardless of
 * what the parent configured. Sub-agents need scratchpad access to store/read
 * intermediate results during reasoning.
 */
export const ALWAYS_INCLUDE_TOOLS = ["scratchpad-read", "scratchpad-write"] as const;

/** Maximum characters per individual tool result summary. */
const MAX_TOOL_RESULT_CHARS = 200;

// ─── Parent Context ───

export interface ParentContextItem {
  /** Tool name that produced the result */
  readonly toolName: string;
  /** Summary of the tool result (will be truncated to MAX_TOOL_RESULT_CHARS) */
  readonly result: string;
}

export interface ParentContext {
  /** Recent tool results from the parent agent */
  readonly toolResults?: readonly ParentContextItem[];
  /** Working memory items from the parent agent */
  readonly workingMemory?: readonly string[];
  /** Parent's current task description */
  readonly taskDescription?: string;
}

/**
 * Build a structured prefix string from parent context for injection into
 * sub-agent system prompts. Returns empty string if no context is provided.
 * Output is bounded to MAX_PARENT_CONTEXT_CHARS.
 */
export const buildParentContextPrefix = (ctx: ParentContext | undefined): string => {
  if (!ctx) return "";

  const sections: string[] = [];

  if (ctx.taskDescription) {
    sections.push(`Parent task: ${ctx.taskDescription.slice(0, 200)}`);
  }

  if (ctx.toolResults && ctx.toolResults.length > 0) {
    const items = ctx.toolResults.map((tr) => {
      const result = tr.result.length > MAX_TOOL_RESULT_CHARS
        ? tr.result.slice(0, MAX_TOOL_RESULT_CHARS) + "..."
        : tr.result;
      return `- ${tr.toolName}: ${result}`;
    });
    sections.push("Tool results:\n" + items.join("\n"));
  }

  if (ctx.workingMemory && ctx.workingMemory.length > 0) {
    sections.push("Working memory:\n" + ctx.workingMemory.map((m) => `- ${m}`).join("\n"));
  }

  if (sections.length === 0) return "";

  let prefix = "PARENT CONTEXT (use this data to avoid re-fetching):\n" + sections.join("\n\n");

  if (prefix.length > MAX_PARENT_CONTEXT_CHARS) {
    prefix = prefix.slice(0, MAX_PARENT_CONTEXT_CHARS - 3) + "...";
  }

  return prefix;
};

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
  readonly stepsCompleted?: number;
  /** Scratchpad keys forwarded to the parent with a `sub:<agentName>:` prefix */
  readonly forwardedScratchpadKeys?: readonly string[];
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
    enableMemory?: boolean;
    enableDebrief?: boolean;
    enableReactiveIntelligence?: boolean;
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
    /** Whitelist of tool names — only these tools are available to the sub-agent. */
    allowedTools?: readonly string[];
  }) => Promise<{
    output: string;
    success: boolean;
    tokensUsed: number;
    stepsCompleted?: number;
    /** Scratchpad entries written by the sub-agent during execution */
    scratchpadEntries?: ReadonlyMap<string, string> | Map<string, string>;
  }>,
  depth: number = 0,
  parentContextProvider?: () => ParentContext | undefined,
  /** Optional writer to forward sub-agent scratchpad entries to the parent */
  parentScratchpadWriter?: (key: string, value: string) => void,
): ((task: string | Record<string, unknown>) => Promise<SubAgentResult>) => {
  return async (rawTask: string | Record<string, unknown>): Promise<SubAgentResult> => {
    // Normalize input — accept both string and object (e.g. { query: "..." })
    const task: string =
      typeof rawTask === "string"
        ? rawTask
        : typeof (rawTask as Record<string, unknown>).query === "string"
          ? ((rawTask as Record<string, unknown>).query as string)
          : typeof (rawTask as Record<string, unknown>).task === "string"
            ? ((rawTask as Record<string, unknown>).task as string)
            : JSON.stringify(rawTask);
    if (depth >= MAX_RECURSION_DEPTH) {
      return {
        subAgentName: config.name,
        success: false,
        summary: `Maximum agent recursion depth (${MAX_RECURSION_DEPTH}) exceeded`,
        tokensUsed: 0,
      };
    }

    try {
      // Build parent context prefix if a provider was given
      const parentCtx = parentContextProvider?.();
      const parentPrefix = buildParentContextPrefix(parentCtx);

      // Compose system prompt: parent context prefix + configured system prompt
      let composedSystemPrompt = config.systemPrompt;
      if (parentPrefix) {
        composedSystemPrompt = composedSystemPrompt
          ? `${parentPrefix}\n\n${composedSystemPrompt}`
          : parentPrefix;
      }

      // Fix 1: Always include scratchpad tools in sub-agent tool scope so
      // sub-agents can store/retrieve intermediate results during reasoning.
      const baseTools = config.tools;
      const effectiveTools: readonly string[] = baseTools !== undefined
        ? [...new Set([...baseTools, ...ALWAYS_INCLUDE_TOOLS])]
        : undefined as unknown as readonly string[];

      // Tighter sub-agent defaults — prevents spin-out and reduces overhead.
      // Sub-agents should complete focused tasks quickly (1-3 steps typical).
      const subAgentDefaults = {
        maxIterations: 3,
        enableMemory: false,
        enableDebrief: false,
        enableReactiveIntelligence: true,
      };

      // User-configured SubAgentConfig values override defaults.
      const effectiveMaxIter = Math.min(
        config.maxIterations ?? subAgentDefaults.maxIterations,
        subAgentDefaults.maxIterations,
      );

      const result = await executeFn({
        agentId: `sub-${config.name}-${Date.now()}`,
        provider: config.provider,
        model: config.model,
        maxIterations: effectiveMaxIter,
        enableMemory: subAgentDefaults.enableMemory,
        enableDebrief: subAgentDefaults.enableDebrief,
        enableReactiveIntelligence: subAgentDefaults.enableReactiveIntelligence,
        systemPrompt: composedSystemPrompt,
        persona: config.persona,
        enableReasoning: true,
        enableTools: true,
        task,
        // Step 2: Explicitly pass config.name so log prefix uses the configured name,
        // matching the dynamic spawn-agent path which also forwards opts.name.
        name: config.name,
        allowedTools: effectiveTools,
      });

      // Fix 3: Forward sub-agent scratchpad entries to parent with a
      // `sub:<agentName>:` prefix so parent agents can access sub-results.
      const forwardedKeys: string[] = [];
      if (result.scratchpadEntries && parentScratchpadWriter) {
        for (const [key, value] of result.scratchpadEntries) {
          const forwardedKey = `sub:${config.name}:${key}`;
          parentScratchpadWriter(forwardedKey, value);
          forwardedKeys.push(forwardedKey);
        }
      }

      // Extract a concise summary — strip ReAct artifacts and trim
      let summary = result.output;
      // Remove leading ReAct markers (FINAL ANSWER:, Thought:, etc.)
      summary = summary.replace(/^(FINAL ANSWER:\s*|Thought:\s*|Answer:\s*)/i, "").trim();
      if (summary.length > 1200) {
        summary = summary.slice(0, 1200) + "…";
      }

      // Append forwarded key list to summary for parent agent visibility
      if (forwardedKeys.length > 0) {
        summary += `\n\n[Scratchpad keys forwarded to parent: ${forwardedKeys.join(", ")}]`;
      }

      return {
        subAgentName: config.name,
        success: result.success,
        summary,
        tokensUsed: result.tokensUsed,
        stepsCompleted: result.stepsCompleted,
        forwardedScratchpadKeys: forwardedKeys.length > 0 ? forwardedKeys : undefined,
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
    description: "Input to pass to the agent. Accepts a string task description or an object with a 'query' field.",
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
      description: "Agent input data. Accepts a string task description or an object with a 'query' field.",
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
    "all infrastructure. Optionally steer the sub-agent's approach with role/instructions. " +
    "Use 'tools' to restrict which tools the sub-agent can access.",
  parameters: [
    {
      name: "task",
      type: "string" as const,
      description:
        "Complete, self-contained task description. The sub-agent has ZERO knowledge of " +
        "your conversation — you MUST include ALL specific values it needs: phone numbers, " +
        "email addresses, URLs, repository names, file paths, IDs, usernames, dates, etc. " +
        "Never say 'send to the user' — say 'send to +1234567890'. Never say 'the repo' — " +
        "say 'github.com/owner/repo'. The sub-agent cannot ask you for clarification. " +
        "Example: 'Fetch the 5 latest commits from github.com/owner/repo, summarize them " +
        "in 3 bullet points, then send the summary via Signal to +1234567890'",
      required: true,
    },
    {
      name: "name",
      type: "string" as const,
      description:
        "Descriptive kebab-case name for this sub-agent (e.g., 'commit-summarizer', " +
        "'signal-notifier', 'code-reviewer'). Appears in logs and metrics. " +
        "MUST reflect the sub-agent's specific purpose — never use generic names.",
      required: true,
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
    {
      name: "tools",
      type: "array" as const,
      description:
        "Optional whitelist of tool names the sub-agent can use. " +
        "When set, only these tools are available — all others are filtered out. " +
        "Example: ['web-search', 'file-read']. Default: all parent tools.",
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
