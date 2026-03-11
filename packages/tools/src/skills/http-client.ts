import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const httpGetTool: ToolDefinition = {
  name: "http-get",
  description:
    "Fetch content from a specific URL via HTTP GET. " +
    "Use when you have an exact URL to retrieve (API endpoint, direct link, raw file). " +
    "JSON responses are automatically parsed into objects; other responses are returned as text. " +
    "Returns { status, statusText, body } — check status === 200 for success.",
  parameters: [
    {
      name: "url",
      type: "string",
      description:
        "The full URL to fetch. Must include the scheme (https:// or http://). " +
        "Examples: 'https://api.example.com/v1/data', 'https://jsonplaceholder.typicode.com/posts/1'.",
      required: true,
    },
    {
      name: "headers",
      type: "object",
      description:
        "Optional HTTP headers as a JSON object of key-value string pairs. " +
        "Example: { \"Authorization\": \"Bearer mytoken\", \"Accept\": \"application/json\" }. " +
        "Omit this parameter entirely if no special headers are needed.",
      required: false,
    },
  ],
  returnType:
    "{ status: number, statusText: string, body: string | object }",
  category: "http",
  riskLevel: "medium",
  timeoutMs: 15_000,
  requiresApproval: false,
  source: "builtin",
};

export const httpGetHandler = (
  args: Record<string, unknown>,
): Effect.Effect<unknown, ToolExecutionError> =>
  Effect.tryPromise({
    try: async () => {
      const url = args.url as string;
      const headers = (args.headers as Record<string, string>) ?? {};

      const response = await fetch(url, { method: "GET", headers });
      const contentType = response.headers.get("content-type") ?? "";

      let body: unknown;
      if (contentType.includes("application/json")) {
        body = await response.json();
      } else {
        body = await response.text();
      }

      return {
        status: response.status,
        statusText: response.statusText,
        body,
      };
    },
    catch: (e) =>
      new ToolExecutionError({
        message: `HTTP GET failed: ${e}`,
        toolName: "http-get",
        cause: e,
      }),
  });
