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
import { emitErrorSwallowed, errorTag } from "@reactive-agents/core";

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

// Accepts both { name, minCalls? } objects and bare strings (backward-compat).
// Normalization to { name, minCalls: number } happens in the processing code below.
const ToolClassificationResultSchema = Schema.Struct({
  required: Schema.Array(
    Schema.Union(
      Schema.Struct({ name: Schema.String, minCalls: Schema.optional(Schema.Number) }),
      Schema.String,
    ),
  ),
  relevant: Schema.Array(Schema.String),
});

type InferRequiredToolsResult = typeof InferRequiredToolsResultSchema.Type;

function extractPrimaryTaskDescription(taskDescription: string): string {
  const originalTask = taskDescription.match(/^\s*Original task:\s*(.+)$/im)?.[1];
  return (originalTask ?? taskDescription).trim();
}

export function estimateEntityCount(taskDescription: string): number {
  const primaryTask = extractPrimaryTaskDescription(taskDescription)
    .replace(/\bthen\b[\s\S]*$/i, "")
    .replace(/\bwith columns?\b[\s\S]*$/i, "")
    .trim();

  const candidate = (primaryTask.match(/\bfor\b\s*:?\s*([^.\n]+)/i)?.[1] ?? primaryTask).trim();
  // A comma is required to consider the candidate an enumeration. Verb conjunctions
  // like "Fetch and summarize" contain `and` but name one task, not two entities —
  // treating them as enumeration wrongly bumps required-tool minCalls. When the LLM
  // classifier detects a real multi-entity list ("prices of A, B, and C"), commas
  // are reliably present; we trust the LLM's minCalls otherwise.
  if (!candidate.includes(",")) return 1;

  const entities = candidate
    .replace(/\band\b/gi, ",")
    .split(",")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0 && /[a-z0-9]/i.test(segment));
  if (entities.length === 0) return 1;

  const uniqueEntities = new Set(entities.map((segment) => segment.toLowerCase()));
  return Math.max(1, uniqueEntities.size);
}

function isPerEntityLookupTool(toolName: string): boolean {
  const lowered = toolName.toLowerCase();
  return (
    lowered.includes("search") ||
    lowered.includes("http") ||
    lowered.includes("fetch") ||
    lowered.includes("get")
  );
}

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
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/infer-required-tools.ts:184", tag: errorTag(err) })))
          : Effect.void,
      ),
      Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/infer-required-tools.ts:187", tag: errorTag(err) })),
    );

    return validated.map((t) => t.name);
  });

// ── Combined tool classification result ──

export interface ToolClassificationResult {
  /** Tools that MUST be called for the task to succeed (names only, backward-compat) */
  readonly required: readonly string[];
  /** Tools that are relevant and should be shown to the agent (includes required) */
  readonly relevant: readonly string[];
  /**
   * Minimum number of times each required tool must be called before the task is complete.
   * Derived from the classifier's per-tool minCalls field. Defaults to 1 for all required tools.
   * Used by the repetition guard and final-answer gate for count-based enforcement.
   */
  readonly requiredToolQuantities: Readonly<Record<string, number>>;
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
      return { required: [], relevant: [], requiredToolQuantities: {} };
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
  "required": [{ "name": "tool-name", "minCalls": N }],
  "relevant": ["tools that MAY help but aren't strictly required"]
}

Rules:
- "required" = tools the agent MUST call or the task literally cannot be completed.
  Ask: "if I deleted this tool, would the task still be doable?" If yes → NOT required.
  Prefer a SHORTER required list. When in doubt, put the tool in "relevant" instead.
  Example: "fetch prices for X, Y, Z then render markdown table" → required: [web-search×3].
  code-execute, file-write, etc. are NOT required unless the task explicitly asks to
  run code or save a file to disk.
- **Factual knowledge questions need NO tools.** If the task asks "what is X?",
  "explain Y", "define Z", "who/when/where", or otherwise requests information the
  model already knows (history, science facts, definitions, common knowledge) AND
  the task does NOT explicitly name a tool/agent to use, return required: [].
  Examples that need NO tools:
    - "What is the speed of light?" → required: []
    - "Explain how a linked list works" → required: []
    - "What year was TypeScript released?" → required: []
    - "Capital of France?" → required: []
- **Explicit tool/agent mentions override the no-tool rule.** If the task says
  "use X", "ask X", "call X", "delegate to X", or otherwise names a specific
  tool or agent, that tool IS required regardless of question shape.
    - "Use your research-assistant to explain linked lists" → required: [research-assistant]
    - "Search the web for X" → required: [web-search]
    - "Run code to compute X" → required: [code-execute]
- "required" minCalls: count distinct named items (each comma-separated name, ticker, URL,
  or entity). Set minCalls to that count when each item needs its own lookup call.
  Single-call tasks (e.g. "what time is it?") → minCalls = 1.
  Multi-entity lookups (e.g. "prices of XRP, XLM, ETH, BTC") → minCalls = 4.
- "relevant" = tools that could assist but aren't strictly needed. Include supporting
  tools like recall, find, and any tool adjacent to the required domain.
- If the task mentions a service name (e.g. "Signal", "GitHub"), include the SPECIFIC
  action tools needed, not all tools from that namespace.
- Use EXACT tool names from the list above.`;

    const result = yield* extractStructuredOutput({
      schema: ToolClassificationResultSchema,
      prompt,
      systemPrompt: "You are a tool classifier. Output only valid JSON. Be precise.",
      maxRetries: 1,
      temperature: 0,
      maxTokens: 500,
    });

    // Normalize: collapse string | { name, minCalls? } union to { name, minCalls } objects.
    // Bare strings are backward-compat from old LLM responses; transform them to struct form.
    const availableNames = new Set(config.availableTools.map((t) => t.name));
    const normalized: { name: string; minCalls: number }[] = result.data.required.map(
      (e): { name: string; minCalls: number } =>
        typeof e === "string"
          ? { name: e, minCalls: 1 }
          : { name: e.name, minCalls: e.minCalls ?? 1 },
    );
    const requiredEntries = normalized.filter((e) => availableNames.has(e.name));
    const required = requiredEntries.map((e) => e.name);
    const requiredToolQuantities: Record<string, number> = {};
    const entityCount = estimateEntityCount(config.taskDescription);
    for (const e of requiredEntries) {
      const llmMinCalls = Math.max(1, e.minCalls);
      const minCalls = isPerEntityLookupTool(e.name) && entityCount > 1
        ? Math.max(llmMinCalls, entityCount)
        : llmMinCalls;
      requiredToolQuantities[e.name] = minCalls;
    }
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
                thought: `Classified tools — required: [${required.map((toolName) => {
                  const quantity = requiredToolQuantities[toolName] ?? 1;
                  return quantity > 1 ? `${toolName}×${quantity}` : toolName;
                }).join(", ")}], relevant: [${relevant.join(", ")}]`,
              })
              .pipe(Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/infer-required-tools.ts:324", tag: errorTag(err) })))
          : Effect.void,
      ),
      Effect.catchAll((err) => emitErrorSwallowed({ site: "reasoning/src/structured-output/infer-required-tools.ts:327", tag: errorTag(err) })),
    );

    return { required, relevant, requiredToolQuantities };
  });
