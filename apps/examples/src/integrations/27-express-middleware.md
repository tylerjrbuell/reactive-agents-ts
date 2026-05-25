# Example 27 — Express Agent Middleware

Demonstrates integrating Reactive Agents with Express:

- Reusable Express router with agent endpoints
- `POST /api/agent/run` — non-streaming
- `POST /api/agent/stream` — SSE streaming
- Error-handling middleware
- Graceful shutdown on `SIGTERM` / `SIGINT`
- Exports a middleware-compatible router

## Dependencies

```bash
npm install express reactive-agents @reactive-agents/runtime
npm install -D @types/express
```

## File: `agent-router.ts`

```ts
import express, { Router, Request, Response, NextFunction } from "express";
import { ReactiveAgents } from "reactive-agents";

// ─── Agent holder (module scope) ───
interface AgentState {
  instance: Awaited<ReturnType<typeof ReactiveAgents.create>> | null;
}

const agentState: AgentState = { instance: null };

async function initializeAgent() {
  if (!agentState.instance) {
    agentState.instance = await ReactiveAgents.create()
      .withName("express-agent")
      .withProvider("anthropic")
      .withReasoning()
      .withTools()
      .build();
  }
  return agentState.instance;
}

export async function createAgentRouter(): Promise<Router> {
  const router = Router();
  const agent = await initializeAgent();

  // ─── Health check ───
  router.get("/agent/health", (req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "agent-api",
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Non-streaming run ───
  router.post("/agent/run", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body as { prompt?: string };

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({
          error: "Missing or invalid 'prompt' field in request body",
          received: typeof prompt,
        });
      }

      const result = await agent.run(prompt);

      res.json({
        success: true,
        output: result.output,
        metadata: result.metadata,
        debrief: result.debrief,
      });
    } catch (error) {
      console.error("Agent execution error:", error);
      const message =
        error instanceof Error ? error.message : "Unknown error occurred";
      res.status(500).json({
        error: message,
        type: error instanceof Error ? error.constructor.name : "Error",
      });
    }
  });

  // ─── SSE streaming run ───
  router.post("/agent/stream", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body as { prompt?: string };

      if (!prompt || typeof prompt !== "string") {
        return res
          .status(400)
          .json({ error: "Missing or invalid 'prompt' field" });
      }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      const stream = agent.runStream(prompt);

      for await (const event of stream) {
        if (event._tag === "TextDelta") {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } else if (event._tag === "StreamCompleted") {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          res.end();
        }
      }
    } catch (error) {
      console.error("Streaming error:", error);
      res.write(
        `data: ${JSON.stringify({ _tag: "StreamError", error: String(error) })}\n\n`,
      );
      res.end();
    }
  });

  return router;
}

// ─── Error handling middleware (place after all routes) ───
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: err.message || "Internal server error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

// ─── Graceful shutdown ───
export function setupGracefulShutdown(server?: import("http").Server) {
  const shutdown = async () => {
    console.log("\nShutting down gracefully...");

    if (agentState.instance) {
      try {
        await agentState.instance.dispose();
        console.log("Agent disposed");
      } catch (e) {
        console.error("Error disposing agent:", e);
      }
    }

    if (server && typeof server.close === "function") {
      server.close(() => {
        console.log("Server closed");
        process.exit(0);
      });
      setTimeout(() => {
        console.error("Force exit due to timeout");
        process.exit(1);
      }, 10000);
    } else {
      process.exit(0);
    }
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}
```

## Run

```ts
// main.ts
import express from "express";
import {
  createAgentRouter,
  errorHandler,
  setupGracefulShutdown,
} from "./agent-router.ts";

async function main() {
  const app = express();
  const port = 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (req, res) => {
    res.json({ status: "ok", service: "express-agent-api" });
  });

  const agentRouter = await createAgentRouter();
  app.use("/api", agentRouter);

  app.use(errorHandler);

  const server = app.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
  });

  setupGracefulShutdown(server);
}

main().catch(console.error);
```

## Usage

```bash
curl http://localhost:3000/api/agent/health

curl -X POST http://localhost:3000/api/agent/run \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is 2+2?"}'

curl -X POST http://localhost:3000/api/agent/stream \
  -H "Content-Type: application/json" \
  -d '{"prompt":"Hello"}'
```

## Response shapes

`/api/agent/run`:

```json
{
  "success": true,
  "output": "The answer is 4.",
  "metadata": { "tokens": 150, "duration": 1234 },
  "debrief": { "summary": "..." }
}
```

`/api/agent/stream`:

```
data: {"_tag":"TextDelta","text":"Hi"}
data: {"_tag":"TextDelta","text":" there"}
data: {"_tag":"StreamCompleted","tokens":50}
```

## Deployment notes

1. **Agent singleton** — created once, reused. For higher concurrency consider an agent pool, request queue, or worker processes (Node.js cluster, Bull queue).
2. **Request validation** — use `express-validator` or `zod` for stricter input validation.
3. **Rate limiting** — add `express-rate-limit`:
   ```ts
   import rateLimit from "express-rate-limit";
   const limiter = rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 100,
   });
   app.use("/api", limiter);
   ```
4. **Logging** — `morgan` or `winston` for structured logs.
5. **CORS** — if serving frontend from a different origin, `app.use(cors())`.
