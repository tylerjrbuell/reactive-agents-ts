import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const webSearchTool: ToolDefinition = {
  name: "web-search",
  description: "Search the web for information using a query string",
  parameters: [
    {
      name: "query",
      type: "string",
      description: "Search query",
      required: true,
    },
    {
      name: "maxResults",
      type: "number",
      description: "Max results to return",
      required: false,
      default: 5,
    },
  ],
  category: "search",
  riskLevel: "low",
  timeoutMs: 10_000,
  requiresApproval: false,
  source: "builtin",
};

export const webSearchHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const query = args.query as string;
      const maxResults = (args.maxResults as number) ?? 5;

      // In production: call search API (Tavily, SerpAPI, etc.)
      // Stub implementation for Phase 1
      return {
        query,
        maxResults,
        results: [],
        message: "Web search stub - configure TAVILY_API_KEY for real results",
      };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Web search failed: ${e}`,
        toolName: "web-search",
        cause: e,
      }),
  });
