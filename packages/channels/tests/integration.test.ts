import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";
import { alwaysExecutePolicy, ChannelService } from "../src/services/channel-service.js";
import { SessionBridge } from "../src/services/session-bridge.js";
import { TriggerRegistry } from "../src/services/trigger-registry.js";

/**
 * Package-local integration: webhook POST shape → policy → trigger → session → outbound callback.
 * Runtime + `.withChannels()` is covered in `@reactive-agents/runtime` tests.
 */
describe("channels integration (package-local)", () => {
  test("webhook JSON ingress produces outbound reply", async () => {
    const outbound: string[] = [];
    const webhook = new WebhookChannelAdapter({
      id: "int-hook",
      platform: "telegram-bot",
      onResponse: async (_t, c) => {
        outbound.push(c.text);
      },
    });
    const triggers = new TriggerRegistry();
    triggers.setDefaultAgent({ systemPrompt: "be brief" });
    const sessions = new SessionBridge({
      agentFactory: async () => ({
        chat: async (m: string) => ({ message: `ACK:${m}` }),
      }),
    });
    const svc = new ChannelService({
      triggers,
      sessions,
      evaluatePolicy: alwaysExecutePolicy,
      taskId: () => "int-task",
    });
    await Effect.runPromise(svc.registerAdapter(webhook));
    await Effect.runPromise(
      webhook.handleRequest({
        body: JSON.stringify({
          id: "int-1",
          content: "hello world",
          channelId: "c",
          senderId: "u",
        }),
        headers: {},
      }),
    );
    expect(outbound).toEqual(["ACK:hello world"]);
  });
});
