/**
 * Example 23: Token Streaming
 *
 * Demonstrates agent.runStream() — receive output token-by-token as the LLM
 * generates it, instead of waiting for the full response.
 *
 * Two density modes are shown:
 *
 *   "tokens" (default) — TextDelta + StreamCompleted + StreamError only.
 *   Minimal overhead. Ideal for piping tokens to a UI or CLI.
 *
 *   "full" — all 8 event types: TextDelta, PhaseStarted, PhaseCompleted,
 *   ThoughtEmitted, ToolCallStarted, ToolCallCompleted, StreamCompleted,
 *   StreamError. Full execution visibility.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... bun run apps/examples/src/streaming/23-token-streaming.ts
 *   bun run apps/examples/src/streaming/23-token-streaming.ts   # test mode
 */

import { ReactiveAgents } from "reactive-agents";
import type { AgentStreamEvent } from "reactive-agents";

export interface ExampleResult {
  passed: boolean;
  output: string;
  steps: number;
  tokens: number;
  durationMs: number;
}

export async function run(opts?: { provider?: string; model?: string }): Promise<ExampleResult> {
  const start = Date.now();

  type PN = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test";
  const provider = (opts?.provider ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "test")) as PN;

  console.log("\n=== Token Streaming Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (deterministic)"}\n`);

  // ─── Part 1: Token-density streaming ──────────────────────────────────────────
  //
  // Write each token to stdout as it arrives.
  // StreamCompleted delivers the final assembled output + metadata.

  console.log("Part 1: Token streaming (density: \"tokens\")\n");

  let b = ReactiveAgents.create()
    .withName("streaming-agent")
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);

  const agent = await b
    .withReasoning()
    .withStreaming({ density: "tokens" }) // explicit — "tokens" is also the default
    .withTestScenario([
      { match: "haiku", text: "FINAL ANSWER: Bytes arrive in flow\nEach token joins the next one\nOutput grows complete" },
      { text: "FINAL ANSWER: Streaming is working." },
    ])
    .withMaxIterations(3)
    .build();

  let deltaCount = 0;
  let output1 = "";

  process.stdout.write("  Output: ");

  for await (const event of agent.runStream("Write a haiku about data streaming")) {
    switch (event._tag) {
      case "TextDelta":
        process.stdout.write(event.text);
        deltaCount++;
        break;
      case "StreamCompleted":
        output1 = event.output;
        console.log(`\n\n  ✅ Done — ${event.metadata.duration}ms, ` +
          `${event.metadata.stepsCount} step(s), $${event.metadata.cost.toFixed(6)}`);
        break;
      case "StreamError":
        console.error(`\n  ❌ Stream error: ${event.cause}`);
        break;
    }
  }

  await agent.dispose();

  // ─── Part 2: Full-density streaming ───────────────────────────────────────────
  //
  // All 8 event types — useful for building progress UIs, audit logs,
  // or live observability dashboards.

  console.log("\nPart 2: Full-density streaming (density: \"full\")\n");

  let b2 = ReactiveAgents.create()
    .withName("full-density-agent")
    .withProvider(provider);
  if (opts?.model) b2 = b2.withModel(opts.model);

  const agent2 = await b2
    .withReasoning()
    .withTools()
    .withStreaming({ density: "full" })
    .withTestScenario([
      { match: "event types", text: "FINAL ANSWER: TextDelta, PhaseStarted, PhaseCompleted, ThoughtEmitted, ToolCallStarted, ToolCallCompleted, StreamCompleted, StreamError." },
      { text: "FINAL ANSWER: Full-density streaming works." },
    ])
    .withMaxIterations(3)
    .build();

  const events: AgentStreamEvent[] = [];
  const seenPhases = new Set<string>();

  for await (const event of agent2.runStream("List the streaming event types", { density: "full" })) {
    events.push(event);
    switch (event._tag) {
      case "PhaseStarted":
        if (!seenPhases.has(event.phase)) {
          console.log(`  ◉ [${event.phase}] started`);
          seenPhases.add(event.phase);
        }
        break;
      case "PhaseCompleted":
        console.log(`    ✓ [${event.phase}] ${event.durationMs}ms`);
        break;
      case "ThoughtEmitted":
        console.log(`  💭 Thought (iter ${event.iteration}): ${event.content.slice(0, 70)}...`);
        break;
      case "ToolCallStarted":
        console.log(`  🔧 Tool: ${event.toolName} started`);
        break;
      case "ToolCallCompleted":
        console.log(`    ✓ Tool: ${event.toolName} ${event.durationMs}ms [${event.success ? "ok" : "err"}]`);
        break;
      case "TextDelta":
        // tokens still arrive in full density — omit here to keep output readable
        break;
      case "StreamCompleted":
        console.log(`\n  ✅ Done — ${event.metadata.duration}ms`);
        break;
      case "StreamError":
        console.error(`  ❌ Error: ${event.cause}`);
        break;
    }
  }

  await agent2.dispose();

  // ─── Summary ─────────────────────────────────────────────────────────────────

  const completed = events.some((e) => e._tag === "StreamCompleted");
  const passed = output1.length > 0 && completed;

  return {
    passed,
    output: output1.slice(0, 100),
    steps: events.filter((e) => e._tag === "PhaseCompleted").length,
    tokens: deltaCount,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
