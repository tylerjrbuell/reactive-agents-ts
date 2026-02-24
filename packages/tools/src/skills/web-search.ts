import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const webSearchTool: ToolDefinition = {
  name: "web-search",
  description:
    "Search the web and return a list of relevant results. " +
    "Use for current information, facts, prices, news, documentation, or anything requiring up-to-date knowledge. " +
    "Returns an array of results, each with { title, url, content } fields. " +
    "Read the 'content' field of results to extract the information you need.",
  parameters: [
    {
      name: "query",
      type: "string",
      description:
        "The search query. Be specific for better results. " +
        "Examples: 'Bitcoin price today USD', 'TypeScript async await tutorial 2024', 'Node.js fs.readFile docs'.",
      required: true,
    },
    {
      name: "maxResults",
      type: "number",
      description:
        "Maximum number of results to return (1–10). Default: 5. " +
        "Use 3 for quick single-fact lookups, 5 for general research, up to 10 for broad topics.",
      required: false,
      default: 5,
    },
  ],
  returnType:
    "{ query: string, results: Array<{ title: string, url: string, content: string }> }",
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

      // No API key — warn the user
      console.warn(
        "[web-search] TAVILY_API_KEY is not set. Web search is inactive. " +
          "Set TAVILY_API_KEY in your environment to enable real web search results.",
      );
      return {
        query,
        maxResults,
        results: [],
        error: "Web search is not activated — TAVILY_API_KEY is missing. Set it in your .env file.",
      };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `Web search failed: ${e}`,
        toolName: "web-search",
        cause: e,
      }),
  });
