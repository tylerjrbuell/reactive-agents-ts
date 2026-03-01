/**
 * Example: Signal + Telegram Messaging Hub
 *
 * Demonstrates a persistent autonomous agent that monitors Signal and Telegram
 * for incoming messages, responds intelligently, and respects rate/budget limits.
 *
 * The agent uses existing MCP servers running in Docker containers — no custom
 * adapter code needed. The gateway heartbeat drives message polling, and the
 * agent uses MCP tools (signal/receive_message, telegram/send_message, etc.)
 * to interact with both platforms.
 *
 * Prerequisites:
 *   1. Docker installed and running
 *   2. Signal registered: ./scripts/signal-register.sh +1234567890
 *   3. Telegram session: ./scripts/telegram-session.sh
 *   4. .env.telegram with TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_SESSION_STRING
 *   5. SIGNAL_PHONE_NUMBER and ANTHROPIC_API_KEY in environment
 *
 * Usage:
 *   ANTHROPIC_API_KEY=sk-ant-... SIGNAL_PHONE_NUMBER=+1234567890 \
 *     bun run apps/examples/src/messaging/signal-telegram-hub.ts
 *
 * Test mode (no Docker, no real accounts):
 *   bun run apps/examples/src/messaging/signal-telegram-hub.ts
 */

import { ReactiveAgents } from "@reactive-agents/runtime";

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
  const useReal = provider !== "test";
  const phoneNumber = process.env.SIGNAL_PHONE_NUMBER ?? "+0000000000";

  console.log("\n=== Signal + Telegram Messaging Hub ===");
  console.log(`Mode: ${useReal ? `LIVE (${provider})` : "TEST (mock)"}\n`);

  // MCP servers only configured in live mode (require Docker)
  const mcpServers = useReal
    ? [
        {
          name: "signal",
          transport: "stdio" as const,
          command: "docker",
          args: [
            "run", "-i", "--rm",
            "--cap-drop", "ALL",
            "--no-new-privileges",
            "--memory", "128m",
            "--pids-limit", "30",
            "--user", "1000:1000",
            "-v", "./signal-data:/data:rw",
            "-e", `SIGNAL_USER_ID=${phoneNumber}`,
            "ghcr.io/reactive-agents/signal-mcp",
          ],
        },
        {
          name: "telegram",
          transport: "stdio" as const,
          command: "docker",
          args: [
            "run", "-i", "--rm",
            "--cap-drop", "ALL",
            "--no-new-privileges",
            "--memory", "128m",
            "--pids-limit", "30",
            "--user", "1000:1000",
            "--env-file", ".env.telegram",
            "ghcr.io/reactive-agents/telegram-mcp",
          ],
        },
      ]
    : [];

  let b = ReactiveAgents.create()
    .withName("messaging-hub")
    .withProvider(useReal ? provider : "test");
  if (useReal && opts?.model) b = b.withModel(opts.model);

  const agent = await b
    .withPersona({
      role: "Personal Messaging Assistant",
      instructions:
        "Respond to messages concisely and helpfully. Never share private information across platforms. Always be respectful.",
      tone: "friendly and professional",
    })
    .withReasoning()
    .withTools()
    .withGuardrails()
    .withKillSwitch()
    .withMCP(mcpServers)
    .withGateway({
      heartbeat: {
        intervalMs: 15_000,
        policy: "adaptive",
        instruction: [
          "Check for new messages on Signal and Telegram.",
          "Use signal/receive_message to check Signal.",
          "Use telegram/get_chats to check Telegram for unread messages.",
          "For each new message: read it, generate a thoughtful response,",
          "and reply using the appropriate send tool for that platform.",
          "If no new messages, report that and take no further action.",
        ].join(" "),
        maxConsecutiveSkips: 4,
      },
      policies: {
        dailyTokenBudget: 100_000,
        maxActionsPerHour: 60,
        heartbeatPolicy: "adaptive",
      },
    })
    .withObservability({ verbosity: "normal" })
    .withTestResponses({
      "": "FINAL ANSWER: No new messages on any platform. All channels quiet.",
    })
    .build();

  // In test mode, run a single check to verify the agent builds and runs
  const result = await agent.run(
    "Check Signal and Telegram for new messages and respond to any that need attention.",
  );

  console.log(`Output: ${result.output.slice(0, 200)}`);
  console.log(`Steps: ${result.metadata.stepsCount}`);

  await agent.dispose();

  const passed = result.success && result.output.length > 10;
  return {
    passed,
    output: result.output.slice(0, 300),
    steps: result.metadata.stepsCount,
    tokens: result.metadata.tokensUsed,
    durationMs: Date.now() - start,
  };
}

if (import.meta.main) {
  const r = await run();
  console.log(r.passed ? "\n PASS" : "\n FAIL", r.output.slice(0, 200));
  process.exit(r.passed ? 0 : 1);
}
