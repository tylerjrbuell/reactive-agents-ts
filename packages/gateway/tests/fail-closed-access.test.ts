// Run: bun run repo test packages/gateway/tests/fail-closed-access.test.ts
// Security audit M7: no accessControl => unknown channel senders are denied; allow-all is explicit.
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import crypto from "crypto";
import { GatewayService, GatewayServiceLive } from "../src/services/gateway-service.js";
import { createGitHubAdapter } from "../src/adapters/github-adapter.js";
import type { GatewayConfig, GatewayEvent } from "../src/types.js";
import type { WebhookRequest } from "../src/adapters/webhook-adapter.js";

const channelEvent: GatewayEvent = {
  id: "ch-1",
  source: "channel",
  timestamp: new Date(),
  priority: "normal",
  payload: "hi",
  metadata: { sender: "123", platform: "telegram" },
};

const decide = (config: Partial<GatewayConfig>) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const gw = yield* GatewayService;
      return yield* gw.processEvent(channelEvent);
    }).pipe(Effect.provide(GatewayServiceLive(config))),
  );

describe("gateway channel access fails closed", () => {
  test("RED-ON-CUT: no accessControl denies an unknown sender with a how-to-allow reason", async () => {
    const d = await decide({});
    expect(d.action).toBe("skip");
    expect(JSON.stringify(d)).toContain("telegram:123");
    expect(JSON.stringify(d)).toContain("open");
  });

  test("RED-ON-CUT: explicit accessPolicy open allows everyone", async () => {
    const d = await decide({
      accessControl: { accessPolicy: "open", unknownSenderAction: "skip", mode: "chat", sessionTtlDays: 30 },
    });
    expect(d.action).toBe("execute");
  });

  test("allowlist still admits listed senders", async () => {
    const d = await decide({
      accessControl: {
        accessPolicy: "allowlist",
        allowedSenders: ["telegram:123"],
        unknownSenderAction: "skip",
        mode: "chat",
        sessionTtlDays: 30,
      },
    });
    expect(d.action).toBe("execute");
  });

  test("non-channel events are not affected by the default deny", async () => {
    const d = await Effect.runPromise(
      Effect.gen(function* () {
        const gw = yield* GatewayService;
        return yield* gw.processEvent({ ...channelEvent, id: "w1", source: "webhook", metadata: {} });
      }).pipe(Effect.provide(GatewayServiceLive({}))),
    );
    expect(d.action).toBe("execute");
  });
});

describe("GitHub adapter drops replayed deliveries", () => {
  const secret = "s";
  const req = (delivery: string | undefined): WebhookRequest => {
    const body = JSON.stringify({ action: "opened" });
    const headers: Record<string, string> = {
      "x-github-event": "issues",
      "x-hub-signature-256": `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`,
    };
    if (delivery) headers["x-github-delivery"] = delivery;
    return { body, headers };
  };

  test("RED-ON-CUT: same x-github-delivery twice -> second transform fails", async () => {
    const adapter = createGitHubAdapter();
    const first = await Effect.runPromise(Effect.either(adapter.transform(req("d-1"))));
    const second = await Effect.runPromise(Effect.either(adapter.transform(req("d-1"))));
    expect(first._tag).toBe("Right");
    expect(second._tag).toBe("Left");
  });

  test("distinct ids and id-less requests pass; cache is per adapter", async () => {
    const a = createGitHubAdapter();
    const b = createGitHubAdapter();
    const tag = async (ad: ReturnType<typeof createGitHubAdapter>, id: string | undefined) =>
      (await Effect.runPromise(Effect.either(ad.transform(req(id)))))._tag;
    expect(await tag(a, "d-a")).toBe("Right");
    expect(await tag(a, "d-b")).toBe("Right");
    expect(await tag(b, "d-a")).toBe("Right");
    expect(await tag(a, undefined)).toBe("Right");
    expect(await tag(a, undefined)).toBe("Right");
  });

  test("cache is bounded: an evicted id is accepted again", async () => {
    const a = createGitHubAdapter();
    await Effect.runPromise(Effect.either(a.transform(req("first"))));
    for (let i = 0; i < 1100; i++) await Effect.runPromise(Effect.either(a.transform(req(`n-${i}`))));
    expect((await Effect.runPromise(Effect.either(a.transform(req("first")))))._tag).toBe("Right");
  });
});
