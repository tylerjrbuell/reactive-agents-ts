import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Effect } from "effect";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";

describe("WebhookChannelAdapter", () => {
  test("no secret configured → signature check skipped", async () => {
    const w = new WebhookChannelAdapter({ platform: "telegram-bot" });
    const received: string[] = [];
    await Effect.runPromise(
      w.onMessage((msg) =>
        Effect.sync(() => {
          received.push(msg.content);
        }),
      ),
    );
    await Effect.runPromise(
      w.handleRequest({
        body: JSON.stringify({
          id: "1",
          content: "hi",
          channelId: "c",
          senderId: "u",
        }),
        headers: {},
      }),
    );
    expect(received).toEqual(["hi"]);
  });

  test("valid HMAC signature → message accepted", async () => {
    const secret = "test-secret";
    const body = JSON.stringify({ id: "2", content: "x", channelId: "c", senderId: "u" });
    const sig = createHmac("sha256", secret).update(body).digest("hex");
    const w = new WebhookChannelAdapter({ secret, platform: "telegram-bot" });
    const received: string[] = [];
    await Effect.runPromise(
      w.onMessage((msg) =>
        Effect.sync(() => {
          received.push(msg.content);
        }),
      ),
    );
    await Effect.runPromise(
      w.handleRequest({
        body,
        headers: { "x-channels-signature": sig },
      }),
    );
    expect(received).toEqual(["x"]);
  });

  test("invalid signature → connection error", async () => {
    const w = new WebhookChannelAdapter({ secret: "s", platform: "p" });
    await Effect.runPromise(w.onMessage(() => Effect.void));
    let threw = false;
    try {
      await Effect.runPromise(
        w.handleRequest({
          body: "{}",
          headers: { "x-channels-signature": "deadbeef" },
        }),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });

  test("sendMessage uses onResponse callback", async () => {
    const out: string[] = [];
    const w = new WebhookChannelAdapter({
      onResponse: async (_t, c) => {
        out.push(c.text);
      },
    });
    const r = await Effect.runPromise(
      w.sendMessage({ channelId: "c" }, { text: "reply" }),
    );
    expect(out).toEqual(["reply"]);
    expect(r.messageId.startsWith("wh-")).toBe(true);
  });
});
