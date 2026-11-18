/**
 * bad-key-run-child.ts — child process for the bad-API-key error-output test.
 *
 * Starts a local OpenAI-compatible endpoint that answers every request with
 * 401 (what a typo'd or revoked key gets), then calls `agent.run()` at a
 * top-level await WITHOUT catching. The runtime prints the uncaught rejection
 * to stderr; the parent asserts that output is the one readable line, not a
 * wall of nested source frames.
 *
 * Run by `run-error-output.test.ts` via `Bun.spawn`.
 */
import { ReactiveAgents } from "../../src/builder.js";

const server = Bun.serve({
  port: 0,
  fetch: () =>
    new Response(
      JSON.stringify({
        error: {
          message: "Incorrect API key provided: sk-bad. You can find your API key at https://platform.openai.com/account/api-keys.",
          type: "invalid_request_error",
          code: "invalid_api_key",
        },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    ),
});

const agent = await ReactiveAgents.create()
  .withProvider("openai", { baseUrl: `http://localhost:${server.port}/v1`, apiKey: "sk-bad" })
  .withModel("gpt-4o-mini")
  .build();

// Uncaught on purpose: the rejection ends the process (exit 1), server and all.
await agent.run("say ok");
