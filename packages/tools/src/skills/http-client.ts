import { Effect } from "effect";

import type { ToolDefinition } from "../types.js";
import { ToolExecutionError } from "../errors.js";

export const httpGetTool: ToolDefinition = {
  name: "http-get",
  description: "Make an HTTP GET request to a URL",
  parameters: [
    {
      name: "url",
      type: "string",
      description: "URL to fetch",
      required: true,
    },
    {
      name: "headers",
      type: "object",
      description: "Optional request headers",
      required: false,
    },
  ],
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
        headers: Object.fromEntries(response.headers.entries()),
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
