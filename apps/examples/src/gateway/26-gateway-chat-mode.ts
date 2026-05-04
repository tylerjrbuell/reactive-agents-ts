/**
 * Example 26: Gateway Chat Mode
 *
 * Shows how to configure the gateway for persistent per-sender conversations
 * via a messaging channel (Signal, Telegram, etc.).
 *
 * Key concepts:
 * - channels.mode: "chat" — each incoming message maintains per-sender history
 * - channels.sessionTtlDays — SQLite sessions pruned after N days of inactivity
 * - persistMemoryAcrossRuns — stable agent ID so episodic context spans ticks
 * - withMemory() — required for SQLite session persistence and episodic injection
 *
 * What happens per chat turn:
 *   1. Sender's session history loaded from SQLite (or in-memory cache)
 *   2. History windowed to last 40 turns / 8,000 chars before injection
 *   3. Recent gateway activity injected as episodic context (chat-turn events filtered)
 *   4. Enriched instruction → execution engine: episodic → history → message → tool directive
 *   5. User + assistant messages appended to session and persisted
 *   6. GatewaySummary.chatTurns incremented
 *
 * Production setup (requires Signal MCP Docker container):
 *   SIGNAL_PHONE_NUMBER=+1... bun run apps/examples/src/gateway/26-gateway-chat-mode.ts
 *
 * Test mode (this file):
 *   Verifies the channels config is accepted and the gateway starts cleanly.
 *   Channel messages are not simulated — requires a real MCP server in production.
 *
 * Usage:
 *   bun run apps/examples/src/gateway/26-gateway-chat-mode.ts
 */

import { ReactiveAgents } from "reactive-agents";

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
  const provider = (opts?.provider ?? "test") as PN;

  console.log("\n=== Gateway Chat Mode Example ===");
  console.log(`Mode: ${provider !== "test" ? `LIVE (${provider})` : "TEST (config validation only)"}\n`);

  // ─── Build the chat-mode gateway agent ───────────────────────────────────────
  //
  // channels.mode: "chat" is the default. Each incoming message from an allowed
  // sender triggers a GatewayChatManager turn — per-sender history is loaded,
  // windowed, and injected into the enriched instruction alongside episodic context.
  //
  // For production, add .withMCP([{ name: "signal", transport: "stdio", ... }])
  // and set SIGNAL_PHONE_NUMBER. The agent must call signal/send_message_to_user
  // to deliver its reply — it cannot return text directly to the sender.

  let b = ReactiveAgents.create()
    .withName("chat-gateway-agent")
    .withAgentId("chat-gateway-agent")  // stable ID for memory continuity across restarts
    .withProvider(provider);
  if (opts?.model) b = b.withModel(opts.model);

  const agent = await b
    .withReasoning({ defaultStrategy: "reactive" })
    .withTools()
    .withMemory({ tier: "enhanced", dbPath: ":memory:" })  // in-memory SQLite for this example
    .withGateway({
      // With persistMemoryAcrossRuns, heartbeats and channel replies share the same
      // task ID so episodic memory accumulates across ticks and chat turns.
      persistMemoryAcrossRuns: true,
      timezone: "America/New_York",

      // ── Channel access control + chat mode ──────────────────────────────────
      accessControl: {
        accessPolicy: "allowlist",
        allowedSenders: [process.env.RECIPIENT ?? "+15551234567"],
        unknownSenderAction: "skip",
        mode: "chat",          // "chat" (default) or "task" (stateless one-shot)
        sessionTtlDays: 30,    // prune sessions inactive for 30+ days
      },

      // ── Optional: heartbeat and cron still work alongside chat mode ─────────
      // heartbeat: { intervalMs: 1_800_000, policy: "adaptive",
      //   instruction: "Check for any pending items." },

      policies: {
        dailyTokenBudget: 100_000,
        maxActionsPerHour: 50,
      },
    })
    .withTestScenario([
      { match: "heartbeat", text: "FINAL ANSWER: Heartbeat acknowledged. Nothing to do." },
      { text: "FINAL ANSWER: Done." },
    ])
    .withMaxIterations(3)
    .build();

  console.log(`Agent ID      : ${agent.agentId}`);
  console.log("Chat mode     : enabled");
  console.log("Session TTL   : 30 days");
  console.log("Starting gateway...\n");

  const handle = agent.start();

  // In test mode: just verify the gateway starts and stops cleanly.
  // In production: the process stays alive, handling incoming Signal messages.
  await new Promise((r) => setTimeout(r, 150));

  const summary = await handle.stop();

  console.log("\n─── Gateway Summary ───");
  console.log(`  Total agent runs : ${summary.totalRuns}`);
  console.log(`  Heartbeats fired : ${summary.heartbeatsFired}`);
  console.log(`  Cron checks      : ${summary.cronChecks}`);
  console.log(`  Chat turns       : ${summary.chatTurns ?? 0}`);
  if (summary.error) {
    console.log(`  Error            : ${summary.error}`);
  }

  await agent.dispose();
  console.log("\nDone.");

  const passed = typeof summary.totalRuns === "number" && !summary.error;

  return {
    passed,
    output: `runs=${summary.totalRuns} hb=${summary.heartbeatsFired} chatTurns=${summary.chatTurns ?? 0}`,
    steps: summary.totalRuns,
    tokens: 0,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n✅ PASS" : "\n❌ FAIL", r.output);
  process.exit(r.passed ? 0 : 1);
}
