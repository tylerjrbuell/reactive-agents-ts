import { describe, test, expect } from "bun:test";
import { Effect } from "effect";

// ─── MCP Config Types (mirrors what Docker MCP servers expect) ───────────────

interface MCPServerConfig {
  readonly command: string;
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
}

/**
 * Build a Signal MCP Docker config.
 * Security: phone number passed via env var, no secrets in args.
 */
const buildSignalMCPConfig = (phoneEnvVar: string): MCPServerConfig => ({
  command: "docker",
  args: [
    "run",
    "--rm",
    "-i",
    "--network=host",
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "-v",
    "signal-data:/data",
    "-e",
    `SIGNAL_PHONE=${phoneEnvVar}`,
    "reactive-agents/signal-mcp:latest",
  ],
  env: { SIGNAL_PHONE: phoneEnvVar },
});

/**
 * Build a Telegram MCP Docker config.
 * Security: uses --env-file, no inline secrets in args.
 */
const buildTelegramMCPConfig = (envFilePath: string): MCPServerConfig => ({
  command: "docker",
  args: [
    "run",
    "--rm",
    "-i",
    "--network=host",
    "--security-opt=no-new-privileges",
    "--cap-drop=ALL",
    "--env-file",
    envFilePath,
    "-v",
    "telegram-data:/data",
    "reactive-agents/telegram-mcp:latest",
  ],
});

/**
 * Build a heartbeat instruction that references messaging MCP tools.
 */
const buildMessagingHeartbeatInstruction = (): string =>
  [
    "Heartbeat: check for new messages across messaging channels.",
    "Use signal/receive_message to poll Signal for new messages.",
    "Use telegram/get_chats to check Telegram for unread conversations.",
    "If any messages found, process them and respond appropriately.",
  ].join(" ");

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("Messaging MCP Integration", () => {
  test("heartbeat instruction includes receive_message tool reference", () => {
    const instruction = buildMessagingHeartbeatInstruction();
    expect(instruction).toContain("signal/receive_message");
    expect(instruction).toContain("telegram/get_chats");
    expect(instruction).toContain("Heartbeat");
  });

  test("MCP config for Signal produces valid Docker args", () => {
    const config = buildSignalMCPConfig("+15551234567");
    expect(config.command).toBe("docker");
    // Security flags present
    expect(config.args).toContain("--security-opt=no-new-privileges");
    expect(config.args).toContain("--cap-drop=ALL");
    expect(config.args).toContain("--rm");
    // Phone passed via env var, not baked into image args
    expect(config.env?.SIGNAL_PHONE).toBe("+15551234567");
    // No secrets leaked directly in args array (phone is via -e env injection)
    const argsStr = config.args.join(" ");
    expect(argsStr).not.toContain("API_KEY");
    expect(argsStr).not.toContain("SECRET");
  });

  test("MCP config for Telegram uses --env-file for secrets", () => {
    const config = buildTelegramMCPConfig("/run/secrets/telegram.env");
    expect(config.command).toBe("docker");
    // Uses --env-file, not inline -e secrets
    expect(config.args).toContain("--env-file");
    expect(config.args).toContain("/run/secrets/telegram.env");
    // No inline secrets
    const argsStr = config.args.join(" ");
    expect(argsStr).not.toContain("BOT_TOKEN=");
    expect(argsStr).not.toContain("API_ID=");
    expect(argsStr).not.toContain("API_HASH=");
    // Security flags still present
    expect(config.args).toContain("--security-opt=no-new-privileges");
    expect(config.args).toContain("--cap-drop=ALL");
  });

  test("channel events route through gateway policy engine", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        const decision = yield* gw.processEvent({
          id: "ch-signal-1",
          source: "channel",
          timestamp: new Date(),
          priority: "normal",
          payload: { channel: "signal", from: "+15551234567", body: "Hello agent" },
          metadata: { adapter: "signal-mcp" },
        });
        const status = yield* gw.status();
        return { decision, stats: status.stats };
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: {
              dailyTokenBudget: 100000,
              maxActionsPerHour: 50,
            },
          }),
        ),
      ),
    );

    expect(result.decision.action).toBe("execute");
    expect(result.stats.channelMessages).toBe(1);
  });

  test("budget policy blocks channel messages when exhausted", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        // Exhaust the daily token budget
        yield* gw.updateTokensUsed(60000);
        // Now send a channel message — should be blocked
        return yield* gw.processEvent({
          id: "ch-telegram-1",
          source: "channel",
          timestamp: new Date(),
          priority: "normal",
          payload: { channel: "telegram", chatId: 12345, body: "Hi" },
          metadata: { adapter: "telegram-mcp" },
        });
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );

    // Budget exhausted → default onExhausted action is "queue"
    expect(result.action).not.toBe("execute");
    expect(result.action).toBe("queue");
  });

  test("critical messages bypass budget when exhausted", async () => {
    const { GatewayService, GatewayServiceLive } = await import(
      "../src/services/gateway-service.js"
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        // Exhaust the daily token budget
        yield* gw.updateTokensUsed(999999);
        // Critical channel message should bypass budget
        return yield* gw.processEvent({
          id: "ch-critical-1",
          source: "channel",
          timestamp: new Date(),
          priority: "critical",
          payload: { channel: "signal", from: "+15559999999", body: "URGENT: server down" },
          metadata: { adapter: "signal-mcp", escalation: true },
        });
      }).pipe(
        Effect.provide(
          GatewayServiceLive({
            policies: { dailyTokenBudget: 50000 },
          }),
        ),
      ),
    );

    expect(result.action).toBe("execute");
  });
});
