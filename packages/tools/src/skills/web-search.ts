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

      const apiKey = process.env.TAVILY_API_KEY;
      if (apiKey) {
        const response = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            max_results: maxResults,
            api_key: apiKey,
          }),
        });

        if (!response.ok) {
          throw new Error(
            `Tavily API returned ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as {
          results: Array<{
            title: string;
            url: string;
            content: string;
            score: number;
          }>;
        };

        return {
          query,
          maxResults,
          results: data.results.map((r) => ({
            title: r.title,
            url: r.url,
            content: r.content,
          })),
        };
      }

      // Stub when no API key is set
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
