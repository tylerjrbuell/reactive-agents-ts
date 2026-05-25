# Example 26 — Hono Agent API

Demonstrates integrating Reactive Agents with Hono:

- Lightweight HTTP API via Hono
- `POST /api/agent` streaming SSE endpoint
- `GET /health` health check
- Graceful shutdown on `SIGTERM` / `SIGINT`
- JSON error responses

Hono is a lightweight, multi-runtime web framework that runs on Node.js, Cloudflare Workers, Deno, and Bun.

## Dependencies

```bash
npm install hono reactive-agents @reactive-agents/runtime
```

## File: `agent-api.ts`

```ts
import { Hono } from "hono";
import { ReactiveAgents, AgentStream } from "reactive-agents";

const app = new Hono();

// ─── Module-level agent singleton ───
let agentInstance: Awaited<ReturnType<typeof ReactiveAgents.create>> | null =
  null;

async function getOrCreateAgent() {
  if (!agentInstance) {
    agentInstance = await ReactiveAgents.create()
      .withName("hono-agent")
      .withProvider("anthropic")
      .withReasoning()
      .withTools()
      .build();
  }
  return agentInstance;
}

// ─── Health check ───
app.get("/health", (c) =>
  c.json({
    status: "ok",
    service: "agent-api",
    timestamp: new Date().toISOString(),
  }),
);

// ─── Agent streaming endpoint ───
app.post("/api/agent", async (c) => {
  try {
    const body = await c.req.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return c.json(
        { error: "Missing or invalid 'prompt' field" },
        { status: 400 },
      );
    }

    const agent = await getOrCreateAgent();
    const stream = agent.runStream(prompt);
    const sseStream = AgentStream.toSSE(stream);

    return c.body(sseStream, 200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
  } catch (error) {
    console.error("Agent endpoint error:", error);
    const message =
      error instanceof Error ? error.message : "Unknown error occurred";
    return c.json({ error: message }, { status: 500 });
  }
});

// ─── Error handler middleware ───
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    { error: err.message || "Internal server error" },
    { status: 500 },
  );
});

// ─── Graceful shutdown ───
async function shutdown() {
  console.log("Shutting down gracefully...");

  if (agentInstance) {
    try {
      await agentInstance.dispose();
      console.log("Agent disposed");
    } catch (e) {
      console.error("Error disposing agent:", e);
    }
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

export default app;
```

## Run

```ts
// main.ts
import app from "./agent-api.ts";

const port = 3000;
app.listen(port, () => console.log(`Server on port ${port}`));
```

```bash
node --loader tsx main.ts
curl http://localhost:3000/health
curl -X POST http://localhost:3000/api/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is 2+2?"}'
```

## Hono advantages

- **Ultra-lightweight** — ~12KB, no dependencies
- **Multi-runtime** — Node.js, Cloudflare Workers, Deno, Bun
- **Built-in middleware** — logging, CORS, compression
- **Web Standard** — standard `Request` / `Response` (fetch API)
- **Type-safe** — full TypeScript support

## Cloudflare Workers deployment

Same source ships to Workers:

1. Add `wrangler.toml`
2. `export default app`
3. `wrangler deploy`

```toml
# wrangler.toml
name = "reactive-agent-api"
type = "javascript"
main = "src/index.ts"
compatibility_date = "2024-01-01"

[env.production]
routes = [{ pattern = "api.example.com/*" }]
vars = { ANTHROPIC_API_KEY = "..." }
```
