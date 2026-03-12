// @ts-nocheck
/**
 * Example 26: Hono Agent API
 *
 * Demonstrates integrating Reactive Agents with Hono:
 * - Create a lightweight HTTP API with Hono framework
 * - POST /api/agent endpoint with streaming SSE response
 * - GET /health health check endpoint
 * - Graceful shutdown handling via SIGTERM
 * - Error handling with JSON responses
 *
 * Hono is a lightweight, multi-runtime web framework that works on
 * Node.js, Cloudflare Workers, Deno, and more.
 *
 * Dependencies (install):
 *   - npm install hono reactive-agents @reactive-agents/runtime
 *
 * Usage:
 *   node --loader tsx main.ts
 *   # Then: curl -X POST http://localhost:3000/api/agent -d '{"prompt":"Hello"}'
 *
 * Example main.ts:
 *   import app from './agent-api.ts';
 *   const port = 3000;
 *   app.listen(port, () => console.log(`Server on port ${port}`));
 */

import { Hono } from "hono";
import { ReactiveAgents, AgentStream } from "reactive-agents";

// ─── Create Hono app ───
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
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    service: "agent-api",
    timestamp: new Date().toISOString(),
  });
});

// ─── Agent streaming endpoint ───
app.post("/api/agent", async (c) => {
  try {
    // 1. Parse JSON body
    const body = await c.req.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return c.json(
        { error: "Missing or invalid 'prompt' field" },
        { status: 400 }
      );
    }

    // 2. Get agent
    const agent = await getOrCreateAgent();

    // 3. Create streaming response
    const stream = agent.runStream(prompt);
    const sseStream = AgentStream.toSSE(stream);

    // 4. Return SSE response
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
    { status: 500 }
  );
});

// ─── Graceful shutdown ───
async function shutdown() {
  console.log("Shutting down gracefully...");

  // Dispose agent if cleanup method exists
  if (
    agentInstance &&
    typeof agentInstance === "object" &&
    "dispose" in agentInstance
  ) {
    try {
      await (agentInstance as any).dispose();
      console.log("Agent disposed");
    } catch (e) {
      console.error("Error disposing agent:", e);
    }
  }

  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

// ─── Export for use in main.ts ───
export default app;

/**
 * ─── EXAMPLE USAGE ───
 *
 * 1. Create app/main.ts:
 *
 *    import app from './26-hono-agent-api.ts';
 *
 *    const port = parseInt(process.env.PORT || '3000', 10);
 *    app.listen(port, () => {
 *      console.log(`🚀 Agent API listening on port ${port}`);
 *    });
 *
 * 2. Run:
 *    node --loader tsx app/main.ts
 *
 * 3. Test health:
 *    curl http://localhost:3000/health
 *
 * 4. Test agent (with streaming):
 *    curl -X POST http://localhost:3000/api/agent \
 *      -H "Content-Type: application/json" \
 *      -d '{"prompt":"What is 2+2?"}'
 *
 * 5. Test with curl EventSource wrapper:
 *    # For SSE, use curl's built-in support or a client library
 *    npm install eventsource
 *    node -e "
 *      const EventSource = require('eventsource');
 *      const es = new EventSource('http://localhost:3000/api/agent?prompt=hello');
 *      es.onmessage = (e) => console.log(e.data);
 *    "
 */

/**
 * ─── HONO ADVANTAGES ───
 *
 * - Ultra-lightweight: ~12KB (no dependencies)
 * - Multi-runtime: Works on Node.js, Cloudflare Workers, Deno, Bun
 * - Built-in middleware: Logging, CORS, compression, etc.
 * - WebStandard: Uses standard Request/Response objects (fetch API)
 * - Type-safe: Full TypeScript support out of the box
 *
 * ─── FOR CLOUDFLARE WORKERS DEPLOYMENT ───
 *
 * Deploy the same code to Cloudflare Workers:
 * 1. Add wrangler.toml
 * 2. Export handler: export default app
 * 3. wrangler deploy
 *
 * ─── EXAMPLE WRANGLER.TOML ───
 *
 * name = "reactive-agent-api"
 * type = "javascript"
 * main = "src/index.ts"
 * compatibility_date = "2024-01-01"
 *
 * [env.production]
 * routes = [{pattern = "api.example.com/*"}]
 * vars = {ANTHROPIC_API_KEY = "..."}
 */
