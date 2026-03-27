/**
 * Adaptive Tool Classification — LLM-powered pre-reasoning analysis.
 *
 * Analyzes the task description and available tool definitions to determine:
 *   1. Which tools MUST be called for the task to be considered complete (required)
 *   2. Which tools are relevant and should be shown to the agent (relevant)
 *
 * Feeds results into the `requiredTools` guard and adaptive tool filtering.
 * Uses the structured output pipeline (5-layer fallback) for reliable extraction.
 */
import { Effect, Schema } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import { EventBus } from "@reactive-agents/core";
import { extractStructuredOutput } from "./pipeline.js";

// ── Schema for the inference result ──

const InferredToolSchema = Schema.Struct({
  name: Schema.String,
  reason: Schema.String,
});

const InferRequiredToolsResultSchema = Schema.Struct({
  requiredTools: Schema.Array(InferredToolSchema),
  reasoning: Schema.String,
});

// ── Schema for the combined classification result ──

const ToolClassificationResultSchema = Schema.Struct({
  required: Schema.Array(Schema.String),
  relevant: Schema.Array(Schema.String),
});

type InferRequiredToolsResult = typeof InferRequiredToolsResultSchema.Type;

/** Compact tool schema representation for the inference prompt. */
export interface ToolSummary {
  readonly name: string;
  readonly description: string;
  readonly parameters: readonly {
    name: string;
    type: string;
    description: string;
    required: boolean;
  }[];
}

/** Configuration for the inference step. */
export interface InferRequiredToolsConfig {
  /** The user's task description. */
  readonly taskDescription: string;
  /** Available tool definitions with schemas. */
  readonly availableTools: readonly ToolSummary[];
  /** Optional system-level context about the agent's persona/role. */
  readonly systemPrompt?: string;
}

/**
 * Use the LLM to analyze a task and determine which tools MUST be called.
 *
 * Returns an array of tool names that the agent should be required to use,
 * compatible with the `requiredTools` field on `KernelInput`.
 *
 * The LLM is asked to be conservative — only tools that are truly required
 * for task completion are returned, not merely helpful ones.
 */
export const inferRequiredTools = (
  config: InferRequiredToolsConfig,
): Effect.Effect<readonly string[], Error, LLMService> =>
  Effect.gen(function* () {
    // Skip inference if no tools are available
    if (config.availableTools.length === 0) return [];

    const toolList = config.availableTools
      .map(
        (t) =>
          `- **${t.name}**: ${t.description}${
            t.parameters.length > 0
              ? ` (params: ${t.parameters.map((p) => `${p.name}${p.required ? "*" : ""}: ${p.type}`).join(", ")})`
              : ""
          }`,
      )
      .join("\n");

    const prompt = `Analyze the following task and determine which tools MUST be called for the task to be considered successfully completed. Be conservative — only include tools that are truly REQUIRED, not merely helpful.

## Task
${config.taskDescription}

## Available Tools
${toolList}

## Instructions
- A tool is REQUIRED if the task CANNOT be completed without calling it.
- If the task asks to "send", "write to", "save to", "post to", or "deliver" something, the corresponding delivery/output tool is REQUIRED.
- If the task asks to "search", "look up", "find", or "fetch" information, the corresponding search/retrieval tool is REQUIRED.
- If NO tools are strictly required (e.g. the task is purely conversational), return an empty array.
- Only return tool names that exactly match the available tools listed above.

Respond with JSON matching this schema:
{
  "requiredTools": [{ "name": "tool_name", "reason": "why it's required" }],
  "reasoning": "brief explanation of the analysis"
}`;

    const result = yield* extractStructuredOutput({
      schema: InferRequiredToolsResultSchema,
      prompt,
      systemPrompt: config.systemPrompt
        ? `${config.systemPrompt}\n\nYou are analyzing which tools are required for a task.`
        : "You are analyzing which tools are required for a task. Be precise and conservative.",
      maxRetries: 1,
      temperature: 0.1,
      maxTokens: 1024,
    });

    // Validate that returned tool names actually exist in the available set
    const availableNames = new Set(config.availableTools.map((t) => t.name));
    const validated = result.data.requiredTools.filter((t) =>
      availableNames.has(t.name),
    );

    // Emit an EventBus event for observability
    yield* Effect.serviceOption(EventBus).pipe(
      Effect.flatMap((opt) =>
        opt._tag === "Some"
          ? opt.value
              .publish({
                _tag: "ReasoningStepCompleted",
                taskId: "infer-required-tools",
                strategy: "infer-required-tools",
                step: 1,
                totalSteps: 1,
                thought: `Inferred ${validated.length} required tool(s): ${validated.map((t) => t.name).join(", ") || "(none)"}. ${result.data.reasoning}`,
              })
              .pipe(Effect.catchAll(() => Effect.void))
          : Effect.void,
      ),
      Effect.catchAll(() => Effect.void),
    );

    return validated.map((t) => t.name);
  });

// ── Combined tool classification result ──

export interface ToolClassificationResult {
  /** Tools that MUST be called for the task to succeed */
  readonly required: readonly string[];
  /** Tools that are relevant and should be shown to the agent (includes required) */
  readonly relevant: readonly string[];
}

/**
 * LLM-powered tool classification — determines both required and relevant tools
 * in a single structured output call.
 *
 * Replaces heuristic keyword matching with semantic understanding of the task.
 * Used by the execution engine for:
 *   1. Adaptive tool filtering (show only relevant tools to reduce context noise)
 *   2. Required tools enforcement (agent must call these before completing)
 *
 * The call is cheap (~200-400 tokens) and runs once before reasoning starts.
 */
export const classifyToolRelevance = (
  config: InferRequiredToolsConfig,
): Effect.Effect<ToolClassificationResult, Error, LLMService> =>
  Effect.gen(function* () {
    if (config.availableTools.length === 0) {
      return { required: [], relevant: [] };
    }

    // Build compact tool list — name + truncated description only (no params, saves tokens)
    const toolLines = config.availableTools
      .map((t) => `- ${t.name}: ${(t.description || "no description").slice(0, 100)}`)
      .join("\n");

    const prompt = `Given this task and tool list, classify which tools are needed.

TASK: ${config.taskDescription}

TOOLS:
${toolLines}

Respond with JSON:
{
  "required": ["tools the task CANNOT succeed without"],
  "relevant": ["tools that MAY help but aren't strictly required"]
}

Rules:
- "required" = tools that MUST be called. The task explicitly asks for an action that only this tool can perform (e.g. "send a Signal message" → signal/send_message_to_user). Be strict — typically 1-3 tools.
- "relevant" = tools that could assist the agent (e.g. tools from the same service namespace as required tools, or tools whose capabilities match the task context). Always include recall.
- If the task mentions a service name (e.g. "Signal", "GitHub"), include the SPECIFIC action tools needed, not all tools from that namespace.
- An empty required list is valid for simple questions that need no tools.
- Use EXACT tool names from the list above.`;

    const result = yield* extractStructuredOutput({
      schema: ToolClassificationResultSchema,
      prompt,
      systemPrompt: "You are a tool classifier. Output only valid JSON. Be precise.",
      maxRetries: 1,
      temperature: 0,
      maxTokens: 500,
    });

    // Validate tool names against available set
    const availableNames = new Set(config.availableTools.map((t) => t.name));
    const required = result.data.required.filter((n) => availableNames.has(n));
    const relevant = result.data.relevant.filter((n) => availableNames.has(n));

    // Emit EventBus event for observability
    yield* Effect.serviceOption(EventBus).pipe(
      Effect.flatMap((opt) =>
        opt._tag === "Some"
          ? opt.value
              .publish({
                _tag: "ReasoningStepCompleted",
                taskId: "classify-tool-relevance",
                strategy: "classify-tool-relevance",
                step: 1,
                totalSteps: 1,
                thought: `Classified tools — required: [${required.join(", ")}], relevant: [${relevant.join(", ")}]`,
              })
              .pipe(Effect.catchAll(() => Effect.void))
          : Effect.void,
      ),
      Effect.catchAll(() => Effect.void),
    );

    return { required, relevant };
  });
