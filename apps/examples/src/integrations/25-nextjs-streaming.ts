// @ts-nocheck
/**
 * Example 25: Next.js App Router Streaming
 *
 * Demonstrates integrating Reactive Agents with Next.js App Router:
 * - Create a POST /api/agent route handler
 * - Use agent.runStream() to get an async generator
 * - Convert to Server-Sent Events (SSE) via AgentStream.toSSE()
 * - Return a streaming response to the client
 * - Example browser EventSource client code
 *
 * This example shows how to deploy a reactive agent as a real-time
 * streaming endpoint in a Next.js application.
 *
 * Dependencies (install in your Next.js project):
 *   - npm install reactive-agents @reactive-agents/runtime
 *
 * File path: app/api/agent/route.ts
 *
 * Usage:
 *   POST /api/agent
 *   Content-Type: application/json
 *   {"prompt": "What is 2 + 2?"}
 *
 * Browser client (EventSource):
 *   const source = new EventSource('/api/agent?prompt=hello');
 *   source.onmessage = (e) => console.log(e.data);
 *   source.onerror = () => source.close();
 */

import { ReactiveAgents, AgentStream } from "reactive-agents";

// ─── Module-level singleton agent ───
// Create once per server, reuse across requests
let agentInstance: Awaited<ReturnType<typeof ReactiveAgents.create>> | null =
  null;

async function getOrCreateAgent() {
  if (!agentInstance) {
    agentInstance = await ReactiveAgents.create()
      .withName("nextjs-streaming-agent")
      .withProvider("anthropic")
      .withReasoning()
      .withTools()
      .build();
  }
  return agentInstance;
}

// ─── Next.js POST handler ───
export async function POST(request: Request) {
  try {
    // 1. Parse request body
    const body = await request.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({
          error: "Missing or invalid 'prompt' field in request body",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Get agent instance
    const agent = await getOrCreateAgent();

    // 3. Create streaming response via generator
    const stream = agent.runStream(prompt);

    // 4. Convert to SSE format using AgentStream helper
    const sseStream = AgentStream.toSSE(stream);

    // 5. Return Response with SSE headers
    return new Response(sseStream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST",
      },
    });
  } catch (error) {
    console.error("Agent API error:", error);
    return new Response(
      JSON.stringify({
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

// ─── Optional: GET health check ───
export async function GET() {
  return new Response(JSON.stringify({ status: "ok", service: "agent-api" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * ─── BROWSER CLIENT EXAMPLE ───
 *
 * // File: components/AgentChat.tsx
 *
 * export function AgentChat() {
 *   const [messages, setMessages] = React.useState<string[]>([]);
 *
 *   const handleSubmit = (prompt: string) => {
 *     // Open SSE connection
 *     const source = new EventSource(
 *       `/api/agent?prompt=${encodeURIComponent(prompt)}`
 *     );
 *
 *     source.onmessage = (event) => {
 *       // Handle streaming text deltas
 *       if (event.data) {
 *         try {
 *           const data = JSON.parse(event.data);
 *           if (data._tag === "TextDelta") {
 *             setMessages((prev) => [...prev, data.text]);
 *           }
 *         } catch (e) {
 *           console.error("Parse error:", e);
 *         }
 *       }
 *     };
 *
 *     source.onerror = () => {
 *       console.log("Stream completed");
 *       source.close();
 *     };
 *   };
 *
 *   return (
 *     <div>
 *       <input
 *         type="text"
 *         placeholder="Ask the agent..."
 *         onKeyDown={(e) => {
 *           if (e.key === "Enter") {
 *             handleSubmit(e.currentTarget.value);
 *             e.currentTarget.value = "";
 *           }
 *         }}
 *       />
 *       <div>{messages.join("")}</div>
 *     </div>
 *   );
 * }
 */

/**
 * ─── DEPLOYMENT NOTES ───
 *
 * 1. API Routes: Next.js 13+ (App Router) automatically handles streaming
 *    responses. The Response object with event-stream MIME type works
 *    seamlessly.
 *
 * 2. Concurrency: Each POST request gets its own agent.run() call.
 *    For concurrent requests, consider using a request queue or
 *    worker threads to avoid blocking.
 *
 * 3. Memory Management: The agent singleton persists across requests.
 *    For long-running agents, consider adding a timeout or periodic
 *    cleanup.
 *
 * 4. Error Handling: Errors are caught at the top level. The SSE stream
 *    will be interrupted if the agent throws an error. Consider adding
 *    error-recovery logic on the client side.
 *
 * 5. Timeouts: Long-running agents may hit Next.js's serverless function
 *    timeout (typically 30s). For longer tasks, use a background job
 *    queue (e.g., Inngest, Bull) instead.
 */
