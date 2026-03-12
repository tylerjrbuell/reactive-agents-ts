// @ts-nocheck
/**
 * Example 27: Express Agent Middleware
 *
 * Demonstrates integrating Reactive Agents with Express:
 * - Create a reusable Express router with agent endpoints
 * - POST /api/agent endpoint that runs the agent
 * - Error handling middleware for graceful error responses
 * - Graceful shutdown with SIGTERM handler
 * - Export as a middleware-compatible router
 *
 * This example shows how to integrate reactive agents into an
 * existing Express application or build a standalone API.
 *
 * Dependencies (install):
 *   - npm install express reactive-agents @reactive-agents/runtime
 *   - npm install -D @types/express
 *
 * Usage:
 *   // In your main server file (main.ts):
 *   import express from 'express';
 *   import { createAgentRouter } from './27-express-middleware.ts';
 *
 *   const app = express();
 *   app.use(express.json());
 *   const agentRouter = await createAgentRouter();
 *   app.use('/agents', agentRouter);
 *   app.listen(3000);
 */

import express, { Router, Request, Response, NextFunction } from "express";
import { ReactiveAgents } from "reactive-agents";

// ─── Agent holder (module scope) ───
interface AgentState {
  instance: Awaited<ReturnType<typeof ReactiveAgents.create>> | null;
}

const agentState: AgentState = { instance: null };

/**
 * Create or retrieve the agent singleton.
 * Call this once at application startup.
 */
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

/**
 * Create an Express router with agent endpoints.
 *
 * Usage:
 *   const app = express();
 *   const agentRouter = await createAgentRouter();
 *   app.use('/api', agentRouter);
 */
export async function createAgentRouter(): Promise<Router> {
  const router = Router();

  // Initialize agent
  const agent = await initializeAgent();

  // ─── Health check ───
  router.get("/agent/health", (req: Request, res: Response) => {
    res.json({
      status: "ok",
      service: "agent-api",
      timestamp: new Date().toISOString(),
    });
  });

  // ─── Agent execution endpoint ───
  router.post("/agent/run", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body as { prompt?: string };

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({
          error: "Missing or invalid 'prompt' field in request body",
          received: typeof prompt,
        });
      }

      // Run agent (non-streaming for simplicity)
      const result = await agent.run(prompt);

      // Return result
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

  // ─── Optional: Streaming endpoint for SSE ───
  router.post("/agent/stream", async (req: Request, res: Response) => {
    try {
      const { prompt } = req.body as { prompt?: string };

      if (!prompt || typeof prompt !== "string") {
        return res.status(400).json({
          error: "Missing or invalid 'prompt' field",
        });
      }

      // Set SSE headers
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");

      // Stream agent output
      const stream = agent.runStream(prompt);

      for await (const event of stream) {
        // Send each event as SSE
        if (event._tag === "TextDelta") {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
        } else if (event._tag === "StreamCompleted") {
          res.write(`data: ${JSON.stringify(event)}\n\n`);
          res.end();
        }
      }
    } catch (error) {
      console.error("Streaming error:", error);
      res.write(`data: ${JSON.stringify({ _tag: "StreamError", error: String(error) })}\n\n`);
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
  next: NextFunction
) => {
  console.error("Unhandled error:", err);
  res.status(500).json({
    error: err.message || "Internal server error",
    stack: process.env.NODE_ENV === "development" ? err.stack : undefined,
  });
};

// ─── Graceful shutdown handler ───
export function setupGracefulShutdown(server?: any) {
  const shutdown = async () => {
    console.log("\n🛑 Shutting down gracefully...");

    // Dispose agent if available
    if (agentState.instance && typeof agentState.instance === "object") {
      if ("dispose" in agentState.instance) {
        try {
          await (agentState.instance as any).dispose();
          console.log("✓ Agent disposed");
        } catch (e) {
          console.error("Error disposing agent:", e);
        }
      }
    }

    // Close server if provided
    if (server && typeof server.close === "function") {
      server.close(() => {
        console.log("✓ Server closed");
        process.exit(0);
      });

      // Force exit after timeout
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

/**
 * ─── EXAMPLE MAIN.TS ───
 *
 * import express from 'express';
 * import { createAgentRouter, errorHandler, setupGracefulShutdown }
 *   from './27-express-middleware.ts';
 *
 * async function main() {
 *   const app = express();
 *   const port = 3000;
 *
 *   // Middleware
 *   app.use(express.json());
 *   app.use(express.urlencoded({ extended: true }));
 *
 *   // Health check
 *   app.get('/health', (req, res) => {
 *     res.json({ status: 'ok', service: 'express-agent-api' });
 *   });
 *
 *   // Mount agent router
 *   const agentRouter = await createAgentRouter();
 *   app.use('/api', agentRouter);
 *
 *   // Error handler (last middleware)
 *   app.use(errorHandler);
 *
 *   // Start server
 *   const server = app.listen(port, () => {
 *     console.log(`🚀 Server listening on http://localhost:${port}`);
 *   });
 *
 *   // Graceful shutdown
 *   setupGracefulShutdown(server);
 * }
 *
 * main().catch(console.error);
 */

/**
 * ─── USAGE EXAMPLES ───
 *
 * 1. Health check:
 *    GET /api/agent/health
 *    Response: { status: "ok", service: "agent-api", timestamp: "..." }
 *
 * 2. Run agent (non-streaming):
 *    POST /api/agent/run
 *    Content-Type: application/json
 *    { "prompt": "What is 2 + 2?" }
 *
 *    Response:
 *    {
 *      "success": true,
 *      "output": "The answer is 4.",
 *      "metadata": { "tokens": 150, "duration": 1234 },
 *      "debrief": { "summary": "..." }
 *    }
 *
 * 3. Stream agent output:
 *    POST /api/agent/stream
 *    { "prompt": "Hello" }
 *
 *    Response: Server-Sent Events (text/event-stream)
 *    data: {"_tag":"TextDelta","text":"Hi"}
 *    data: {"_tag":"TextDelta","text":" there"}
 *    data: {"_tag":"StreamCompleted","tokens":50}
 */

/**
 * ─── TESTING WITH CURL ───
 *
 * curl http://localhost:3000/api/agent/health
 *
 * curl -X POST http://localhost:3000/api/agent/run \
 *   -H "Content-Type: application/json" \
 *   -d '{"prompt":"What is 2+2?"}'
 *
 * curl -X POST http://localhost:3000/api/agent/stream \
 *   -H "Content-Type: application/json" \
 *   -d '{"prompt":"Hello"}'
 */

/**
 * ─── DEPLOYMENT NOTES ───
 *
 * 1. Agent Singleton: The agent is created once and reused across
 *    all requests. For higher concurrency, consider:
 *    - Agent pool (circular array of agents)
 *    - Request queue (serialize long-running agents)
 *    - Worker processes (Node.js cluster or Bull queue)
 *
 * 2. Request Validation: Use express-validator or zod for more
 *    robust input validation.
 *
 * 3. Rate Limiting: Add express-rate-limit to prevent abuse:
 *    import rateLimit from 'express-rate-limit';
 *    const limiter = rateLimit({
 *      windowMs: 15 * 60 * 1000,
 *      max: 100 // 100 requests per 15 minutes
 *    });
 *    app.use('/api', limiter);
 *
 * 4. Logging: Use morgan or Winston for structured logging.
 *
 * 5. CORS: If serving frontend from different origin:
 *    import cors from 'cors';
 *    app.use(cors());
 */
