/**
 * Example: Telegram bot behind a channel router (`.withChannels({ routes })`)
 *
 * One bot, one route. The owner gets the agent's full tools; every other allowed
 * sender gets the read-only subset (the router narrows tools before the agent is built).
 *
 * Prerequisites:
 *   1. A bot token from @BotFather in TELEGRAM_BOT_TOKEN (see .env.example).
 *   2. Your numeric Telegram user id in TELEGRAM_OWNER_ID (message @userinfobot to find it).
 *   3. Optional: TELEGRAM_ALLOWED_IDS="111,222" for read-only senders (a second account).
 *   4. A provider key, e.g. ANTHROPIC_API_KEY.
 *
 * Usage:
 *   bun run apps/examples/src/messaging/telegram-routes.ts
 *
 * Then DM your bot. As the owner, ask it to write a file; as an allowed non-owner,
 * ask the same and it will have no write tool. Ctrl+C stops the router.
 */

import { Redacted } from "effect";
import { ReactiveAgents } from "reactive-agents";
import { TelegramChannelAdapter } from "@reactive-agents/channels";

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
  console.error("Set TELEGRAM_BOT_TOKEN (token from @BotFather). See .env.example.");
  process.exit(1);
}

const ids = (raw: string | undefined): string[] =>
  (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^\d+$/.test(s))
    .map((s) => `telegram:${s}`);

const owners = ids(process.env.TELEGRAM_OWNER_ID);
const allow = ids(process.env.TELEGRAM_ALLOWED_IDS);
if (owners.length === 0) {
  console.warn("TELEGRAM_OWNER_ID is not set: nobody is an owner, so every sender is limited to read-only tools.");
}

const telegram = new TelegramChannelAdapter({ token: Redacted.make(token) });

const provider = process.env.ANTHROPIC_API_KEY ? "anthropic" : process.env.OPENAI_API_KEY ? "openai" : "ollama";

const host = await ReactiveAgents.create()
  .withName("telegram-router-host")
  .withProvider(provider)
  .withGateway()
  .withChannels({
    adapters: [telegram],
    routes: [
      {
        id: "dm-assistant",
        match: { channelId: telegram.id, conversation: "dm" },
        target: { agentId: "assistant" },
        owners,
        allow,
      },
    ],
    agents: {
      // A fresh builder per (route, role): the router narrows non-owner tools before build().
      assistant: () =>
        ReactiveAgents.create()
          .withProvider(provider)
          .withSystemPrompt("You are a concise assistant answering over Telegram.")
          .withTools({ builtins: ["web-search", "file-write"] }),
    },
    meter: { reserveUsd: 0.05, maxMessagesPerDay: 200 },
  })
  .build();

const handle = host.start();
console.log(`Router running on ${telegram.id} (provider: ${provider}). DM your bot. Ctrl+C to stop.`);

process.on("SIGINT", () => {
  void (async () => {
    console.log("\nRouter status:", JSON.stringify(await host.channelRouterStatus(), null, 2));
    await handle.stop();
  })();
});

await handle.done;
