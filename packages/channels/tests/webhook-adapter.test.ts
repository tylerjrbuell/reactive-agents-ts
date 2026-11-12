import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { Effect, Exit, Redacted } from "effect";
import { WebhookChannelAdapter } from "../src/adapters/webhook.js";

const sign = (secret: string, ts: string, body: string): string =>
  createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");

const nowSec = (): string => String(Math.floor(Date.now() / 1000));

const collect = async (w: WebhookChannelAdapter): Promise<string[]> => {
  const received: string[] = [];
  await Effect.runPromise(
    w.onMessage((msg) =>
      Effect.sync(() => {
        received.push(msg.content);
      }),
    ),
  );
  return received;
};

const reasonOf = async (p: Effect.Effect<void, { reason: string }>): Promise<string | undefined> => {
  const exit = await Effect.runPromiseExit(p);
  return Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error.reason : undefined;
};

describe("WebhookChannelAdapter", () => {
  test("no secret and no allowUnsigned -> fail closed", async () => {
    const w = new WebhookChannelAdapter({ platform: "telegram-bot" });
    const received = await collect(w);
    const reason = await reasonOf(
      w.handleRequest({ body: JSON.stringify({ id: "1", content: "hi" }), headers: {} }),
    );
    expect(reason).toBe("missing_secret");
    expect(received).toEqual([]);
  });

  test("allowUnsigned opt-in accepts unsigned requests", async () => {
    const w = new WebhookChannelAdapter({ platform: "telegram-bot", allowUnsigned: true });
    const received = await collect(w);
    await Effect.runPromise(
      w.handleRequest({ body: JSON.stringify({ id: "1", content: "hi", channelId: "c", senderId: "u" }), headers: {} }),
    );
    expect(received).toEqual(["hi"]);
  });

  test("valid timestamped HMAC -> accepted; Redacted secret works", async () => {
    const secret = "test-secret";
    const body = JSON.stringify({ id: "2", content: "x", channelId: "c", senderId: "u" });
    const ts = nowSec();
    const w = new WebhookChannelAdapter({ secret: Redacted.make(secret), platform: "telegram-bot" });
    const received = await collect(w);
    await Effect.runPromise(
      w.handleRequest({ body, headers: { "X-Channels-Signature": sign(secret, ts, body), "x-channels-timestamp": ts } }),
    );
    expect(received).toEqual(["x"]);
  });

  test("invalid signature rejected", async () => {
    const w = new WebhookChannelAdapter({ secret: "s", platform: "p" });
    await collect(w);
    const reason = await reasonOf(
      w.handleRequest({ body: "{}", headers: { "x-channels-signature": "deadbeef", "x-channels-timestamp": nowSec() } }),
    );
    expect(reason).toBe("invalid_signature");
  });

  test("body-only (untimestamped) signature rejected: no replay protection to fall back to", async () => {
    const secret = "s";
    const body = "{}";
    const w = new WebhookChannelAdapter({ secret });
    await collect(w);
    const legacySig = createHmac("sha256", secret).update(body).digest("hex");
    expect(await reasonOf(w.handleRequest({ body, headers: { "x-channels-signature": legacySig } }))).toBe(
      "missing_timestamp",
    );
  });

  test("stale timestamp rejected even with a valid signature", async () => {
    const secret = "s";
    const body = JSON.stringify({ id: "old", content: "x" });
    const ts = String(Math.floor(Date.now() / 1000) - 3600);
    const w = new WebhookChannelAdapter({ secret });
    const received = await collect(w);
    const reason = await reasonOf(
      w.handleRequest({ body, headers: { "x-channels-signature": sign(secret, ts, body), "x-channels-timestamp": ts } }),
    );
    expect(reason).toBe("stale_timestamp");
    expect(received).toEqual([]);
  });

  test("request before anything consumes inbound fails with not_started, not a silent drop", async () => {
    const w = new WebhookChannelAdapter({ allowUnsigned: true });
    expect(await reasonOf(w.handleRequest({ body: JSON.stringify({ id: "1" }), headers: {} }))).toBe("not_started");
  });

  test("sendMessage (legacy) uses onResponse and maps typed failures to a real reason", async () => {
    const out: string[] = [];
    const w = new WebhookChannelAdapter({
      onResponse: async (_t, c) => {
        out.push(c.text);
      },
    });
    const r = await Effect.runPromise(w.sendMessage({ channelId: "c" }, { text: "reply" }));
    expect(out).toEqual(["reply"]);
    expect(r.messageId.startsWith("wh-")).toBe(true);

    const limited = new WebhookChannelAdapter({
      onResponse: async () => {
        throw Object.assign(new Error("slow down"), { status: 429, retryAfterMs: 1500 });
      },
    });
    const exit = await Effect.runPromiseExit(limited.sendMessage({ channelId: "c" }, { text: "x" }));
    expect(Exit.isFailure(exit) && exit.cause._tag === "Fail" ? exit.cause.error.reason : "none").toBe("rate_limited");
  });
});
