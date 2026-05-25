# Example 25 — Next.js App Router streaming

Demonstrates integrating Reactive Agents with Next.js App Router:

- Create a `POST /api/agent` route handler
- Use `agent.runStream()` to get an async generator
- Convert to Server-Sent Events (SSE) via `AgentStream.toSSE()`
- Return a streaming response to the client
- Browser `EventSource` client snippet

## Dependencies

Install in your Next.js project:

```bash
npm install reactive-agents @reactive-agents/runtime
```

## File: `app/api/agent/route.ts`

```ts
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
    const body = await request.json();
    const { prompt } = body as { prompt: string };

    if (!prompt || typeof prompt !== "string") {
      return new Response(
        JSON.stringify({
          error: "Missing or invalid 'prompt' field in request body",
        }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const agent = await getOrCreateAgent();
    const stream = agent.runStream(prompt);
    const sseStream = AgentStream.toSSE(stream);

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
        error: error instanceof Error ? error.message : "Unknown error occurred",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

// ─── Optional: GET health check ───
export async function GET() {
  return new Response(
    JSON.stringify({ status: "ok", service: "agent-api" }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}
```

## Browser client (`components/AgentChat.tsx`)

```tsx
import * as React from "react";

export function AgentChat() {
  const [messages, setMessages] = React.useState<string[]>([]);

  const handleSubmit = (prompt: string) => {
    const source = new EventSource(
      `/api/agent?prompt=${encodeURIComponent(prompt)}`,
    );

    source.onmessage = (event) => {
      if (event.data) {
        try {
          const data = JSON.parse(event.data);
          if (data._tag === "TextDelta") {
            setMessages((prev) => [...prev, data.text]);
          }
        } catch (e) {
          console.error("Parse error:", e);
        }
      }
    };

    source.onerror = () => {
      console.log("Stream completed");
      source.close();
    };
  };

  return (
    <div>
      <input
        type="text"
        placeholder="Ask the agent..."
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            handleSubmit(e.currentTarget.value);
            e.currentTarget.value = "";
          }
        }}
      />
      <div>{messages.join("")}</div>
    </div>
  );
}
```

## Usage

```
POST /api/agent
Content-Type: application/json
{"prompt": "What is 2 + 2?"}
```

Browser:

```js
const source = new EventSource("/api/agent?prompt=hello");
source.onmessage = (e) => console.log(e.data);
source.onerror = () => source.close();
```

## Deployment notes

1. **API Routes** — Next.js 13+ (App Router) handles streaming responses natively. The `Response` object with `text/event-stream` MIME works seamlessly.
2. **Concurrency** — each `POST` request gets its own `agent.run()` call. For concurrent load consider a request queue or worker threads.
3. **Memory management** — the agent singleton persists across requests. For long-running agents add a periodic cleanup or timeout.
4. **Error handling** — errors caught at top level; the SSE stream is interrupted on throw. Add client-side recovery.
5. **Timeouts** — long-running agents may hit Next.js serverless function timeouts (typically 30s). For longer tasks use a background job queue (Inngest, Bull).
