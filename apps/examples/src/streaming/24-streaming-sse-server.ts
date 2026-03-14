/**
 * Example 24: Streaming SSE HTTP Endpoint
 *
 * Demonstrates AgentStream.toSSE() — turn agent.runStream() into a standard
 * Server-Sent Events Response in a single line. Works with Bun.serve, Next.js
 * App Router, Hono, Fastify, or any framework that accepts a Response object.
 *
 * The SSE stream emits JSON-encoded AgentStreamEvent objects:
 *   data: {"_tag":"TextDelta","text":"Hello"}
 *   data: {"_tag":"StreamCompleted","output":"...","metadata":{...}}
 *
 * Clients consume it with the browser EventSource API or any SSE client.
 *
 * In TEST mode this example validates the SSE response headers and collects
 * the stream without starting a real HTTP server. In LIVE mode it starts a
 * Bun HTTP server on port 3001 (Ctrl+C to stop).
 *
 * Usage (live):
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/streaming/24-streaming-sse-server.ts
 *
 * Usage (test — no API key):
 *   bun run apps/examples/src/streaming/24-streaming-sse-server.ts
 *
 * Test the running server:
 *   curl -N "http://localhost:3001/stream?q=Write+a+haiku"
 */

import { ReactiveAgents, AgentStream } from "reactive-agents";
import type { AgentStreamEvent } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

// ─── Agent factory ────────────────────────────────────────────────────────────
//
// Build a fresh agent per request so each stream is isolated.

type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";

async function buildAgent(provider: PN, model?: string) {
  let b = ReactiveAgents.create()
    .withName("sse-agent")
    .withProvider(provider);
  if (model) b = b.withModel(model);
  return b
    .withReasoning()
    .withStreaming()
    .withTestScenario([
      { match: "haiku", text: "FINAL ANSWER: Data in the stream\nBytes flow one by one to you\nOutput is complete" },
      { text: "FINAL ANSWER: SSE stream delivered successfully." },
    ])
    .withMaxIterations(3)
    .build();
}

// ─── SSE handler ─────────────────────────────────────────────────────────────
//
// AgentStream.toSSE() accepts agent.runStream() directly and returns a
// standards-compliant SSE Response. No manual ReadableStream setup needed.

async function handleStream(input: string, provider: PN, model?: string): Promise<Response> {
  const agent = await buildAgent(provider, model);

  // Wrap the agent stream so we can dispose the agent when the stream ends.
  async function* managedStream(): AsyncGenerator<AgentStreamEvent> {
    try {
      yield* agent.runStream(input);
    } finally {
      await agent.dispose();
    }
  }

  return AgentStream.toSSE(managedStream());
}

// ─── Test-mode validation ─────────────────────────────────────────────────────

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Streaming SSE Server Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Part 1: Validate the SSE Response object ─────────────────────────────────

  console.log("Part 1: Validate SSE Response headers\n");

  const response = await handleStream("Write a haiku about data streaming", provider, opts?.model);

  console.log(`  Status : ${response.status}`);
  console.log(`  Content-Type : ${response.headers.get("Content-Type")}`);
  console.log(`  Cache-Control: ${response.headers.get("Cache-Control")}`);

  const isSSE = response.headers.get("Content-Type")?.includes("text/event-stream") ?? false;
  console.log(`  Valid SSE response: ${isSSE ? "✅" : "❌"}`);

  // ─── Part 2: Collect the SSE stream and verify output ─────────────────────────

  console.log("\nPart 2: Collect SSE events from the stream\n");

  const events: AgentStreamEvent[] = [];
  const decoder = new TextDecoder();

  if (response.body) {
    const reader = response.body.getReader();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          try {
            const event = JSON.parse(line.slice(6)) as AgentStreamEvent;
            events.push(event);
            console.log(`  ← ${event._tag}${event._tag === "TextDelta" ? `: "${(event as { text: string }).text}"` : ""}`);
            if (event._tag === "StreamCompleted" || event._tag === "StreamError") break;
          } catch {
            // skip malformed line
          }
        }
      }

      const last = events[events.length - 1];
      if (last?._tag === "StreamCompleted" || last?._tag === "StreamError") break;
    }
  }

  const completed = events.find((e) => e._tag === "StreamCompleted");
  const output = completed ? (completed as { output: string }).output : "";

  if (completed) {
    const meta = (completed as { metadata: { duration: number; stepsCount: number } }).metadata;
    console.log(`\n  ✅ Stream completed — ${meta.duration}ms, ${meta.stepsCount} step(s)`);
    console.log(`  Output: ${output.slice(0, 80)}`);
  }

  // ─── Production server pattern ────────────────────────────────────────────────
  //
  // In a real app, replace the test block above with this Bun.serve setup.
  // The entire SSE endpoint is three lines of application code:

  console.log("\nProduction server pattern (not started in test mode):");
  console.log("  Bun.serve({");
  console.log("    port: 3001,");
  console.log("    async fetch(req) {");
  console.log("      const q = new URL(req.url).searchParams.get(\"q\") ?? \"Hello!\";");
  console.log("      const agent = await ReactiveAgents.create()..withProvider(\"anthropic\").build();");
  console.log("      return AgentStream.toSSE(agent.runStream(q));");
  console.log("    },");
  console.log("  });");

  const passed = isSSE && events.length > 0 && !!completed;

  return {
    passed,
    output: output.slice(0, 100),
    steps: events.filter((e) => e._tag === "PhaseCompleted").length,
    tokens: events.filter((e) => e._tag === "TextDelta").length,
    durationMs: Date.now() - start,
  };
}

// ─── Standalone: start real HTTP server ───────────────────────────────────────

if (import.meta.main) {
  const provider = (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test") as PN;

  if (provider === "test") {
    // No API key — run validation only
    const r = await run();
    console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
    process.exit(r.passed ? 0 : 1);
  } else {
    // API key present — start the real server
    const PORT = 3001;
    console.log(`\n=== SSE Server starting on http://localhost:${PORT} ===`);
    console.log(`Test with: curl -N "http://localhost:${PORT}/stream?q=Write+a+haiku"\n`);

    Bun.serve({
      port: PORT,
      async fetch(req) {
        const url = new URL(req.url);

        if (url.pathname === "/stream") {
          const q = url.searchParams.get("q") ?? "Hello! Give me a brief greeting.";
          console.log(`  → Streaming: "${q.slice(0, 60)}"`);
          return handleStream(q, provider);
        }

        if (url.pathname === "/") {
          return new Response(
            `<!DOCTYPE html>
<html>
<head><title>Reactive Agents SSE Demo</title></head>
<body>
<h1>Reactive Agents — SSE Demo</h1>
<pre id="output">Connecting...</pre>
<script>
  const pre = document.getElementById('output');
  pre.textContent = '';
  const es = new EventSource('/stream?q=Write+a+haiku+about+AI+agents');
  es.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event._tag === 'TextDelta') pre.textContent += event.text;
    if (event._tag === 'StreamCompleted') { pre.textContent += '\\n\\n[Done]'; es.close(); }
    if (event._tag === 'StreamError') { pre.textContent += '\\n[Error: ' + event.cause + ']'; es.close(); }
  };
</script>
</body>
</html>`,
            { headers: { "Content-Type": "text/html" } },
          );
        }

        return new Response("Not found", { status: 404 });
      },
    });
  }
}
