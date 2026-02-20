import { Effect } from "effect";

import type { ToolDefinition, FunctionCallingTool } from "../types.js";
import { ToolExecutionError } from "../errors.js";

/**
 * Adapt a native function into a ToolDefinition + handler pair
 * suitable for registration in the ToolRegistry.
 */
export const adaptFunction = (opts: {
  readonly name: string;
  readonly description: string;
  readonly parameters: ToolDefinition["parameters"];
  readonly category?: ToolDefinition["category"];
  readonly riskLevel?: ToolDefinition["riskLevel"];
  readonly timeoutMs?: number;
  readonly fn: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, ToolExecutionError>;
}): {
  definition: ToolDefinition;
  handler: (
    args: Record<string, unknown>,
  ) => Effect.Effect<unknown, ToolExecutionError>;
} => ({
  definition: {
    name: opts.name,
    description: opts.description,
    parameters: opts.parameters,
    category: opts.category,
    riskLevel: opts.riskLevel ?? "low",
    timeoutMs: opts.timeoutMs ?? 30_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: opts.fn,
});

/**
 * Convert a ToolDefinition to the Anthropic/OpenAI function calling format.
 */
export const toFunctionCallingTool = (
  definition: ToolDefinition,
): FunctionCallingTool => ({
  name: definition.name,
  description: definition.description,
  input_schema: {
    type: "object" as unknown,
    properties: Object.fromEntries(
      definition.parameters.map((p) => [
        p.name,
        {
          type: p.type,
          description: p.description,
          ...(p.enum ? { enum: p.enum } : {}),
        },
      ]),
    ) as Record<string, unknown>,
    required: definition.parameters
      .filter((p) => p.required)
      .map((p) => p.name),
  } as Record<string, unknown>,
});
