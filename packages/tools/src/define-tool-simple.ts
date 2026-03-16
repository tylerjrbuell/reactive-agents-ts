import { Effect } from "effect";
import type { ToolDefinition, ToolParameter } from "./types.js";
import { ToolExecutionError } from "./errors.js";

type SimpleParam = {
  type: ToolParameter["type"];
  required?: boolean;
  description: string;
  default?: unknown;
  enum?: string[];
};

type SimpleToolOptions = {
  params?: Record<string, SimpleParam>;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  riskLevel?: ToolDefinition["riskLevel"];
  timeoutMs?: number;
  category?: ToolDefinition["category"];
  requiresApproval?: boolean;
};

type SimpleHandler = (args: Record<string, unknown>) => Promise<unknown> | unknown;

export interface SimpleTool {
  readonly definition: ToolDefinition;
  readonly handler: (args: Record<string, unknown>) => Effect.Effect<unknown, ToolExecutionError>;
}

/**
 * Create a tool with minimal boilerplate. No Effect or Schema knowledge required.
 *
 * Overload 1: tool(name, description, handler) — simplest form
 * Overload 2: tool(name, description, options) — with typed params and config
 *
 * @example
 * ```typescript
 * // Minimal
 * const greetTool = tool("greet", "Greet a user by name", async (args) => {
 *   return `Hello, ${args.name}!`;
 * });
 *
 * // With typed params and config
 * const searchTool = tool("search", "Search the web", {
 *   params: {
 *     query: { type: "string", required: true, description: "Search query" },
 *     limit: { type: "number", required: false, description: "Max results", default: 5 },
 *   },
 *   handler: async (args) => `Results for: ${args.query}`,
 *   riskLevel: "low",
 *   timeoutMs: 30_000,
 *   category: "search",
 * });
 * ```
 */
export function tool(
  name: string,
  description: string,
  handlerOrOptions: SimpleHandler | SimpleToolOptions,
): SimpleTool {
  const isOptions =
    typeof handlerOrOptions === "object" &&
    handlerOrOptions !== null &&
    "handler" in handlerOrOptions;

  const options: SimpleToolOptions = isOptions
    ? (handlerOrOptions as SimpleToolOptions)
    : { handler: handlerOrOptions as SimpleHandler };

  const parameters: ToolParameter[] = options.params
    ? Object.entries(options.params).map(([paramName, param]) => ({
        name: paramName,
        type: param.type,
        description: param.description,
        required: param.required ?? false,
        ...(param.default !== undefined ? { default: param.default } : {}),
        ...(param.enum ? { enum: param.enum } : {}),
      }))
    : [];

  const definition: ToolDefinition = {
    name,
    description,
    parameters,
    riskLevel: options.riskLevel ?? "low",
    timeoutMs: options.timeoutMs ?? 30_000,
    requiresApproval: options.requiresApproval ?? false,
    source: "function",
    ...(options.category ? { category: options.category } : {}),
  };

  const handler = (
    args: Record<string, unknown>,
  ): Effect.Effect<unknown, ToolExecutionError> =>
    Effect.tryPromise({
      try: () => Promise.resolve(options.handler(args)),
      catch: (e) =>
        new ToolExecutionError({
          message: `Tool "${name}" failed: ${e instanceof Error ? e.message : String(e)}`,
          toolName: name,
        }),
    });

  return { definition, handler };
}
