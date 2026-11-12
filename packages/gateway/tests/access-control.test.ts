import { describe, test, expect } from "bun:test";
import { Effect } from "effect";
import { createAccessControlPolicy } from "../src/policies/access-control.js";
import { initialGatewayState } from "../src/types.js";
import type { GatewayEvent } from "../src/types.js";

describe("AccessControlPolicy", () => {
  const makeChannelEvent = (sender: string): GatewayEvent => ({
    id: "ch-test-1",
    source: "channel",
    timestamp: new Date(),
    agentId: "test-agent",
    priority: "normal",
    payload: {},
    metadata: { sender, platform: "signal" },
  });

  test("allowlist: allows listed sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["signal:+15551234567"],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15551234567"), initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("allowlist: blocks unlisted sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["signal:+15551234567"],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision).not.toBeNull();
    expect(decision!.action).toBe("skip");
  });

  test("blocklist: blocks listed sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "blocklist",
      blockedSenders: ["signal:+15559999999"],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision!.action).toBe("skip");
  });

  test("blocklist: allows unlisted sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "blocklist",
      blockedSenders: ["signal:+15559999999"],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15551234567"), initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("open: allows all senders", async () => {
    const policy = createAccessControlPolicy({ policy: "open" });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("ignores non-channel events", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["signal:+15551234567"],
    });
    const hbEvent: GatewayEvent = {
      id: "hb-1",
      source: "heartbeat",
      timestamp: new Date(),
      priority: "low",
      payload: {},
      metadata: {},
    };
    const decision = await Effect.runPromise(
      policy.evaluate(hbEvent, initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("escalate for unknown sender when configured", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["signal:+15551234567"],
      unknownSenderAction: "escalate",
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision!.action).toBe("escalate");
  });

  test("G8: same id on another platform does not match (no cross-platform collision)", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["signal:12345"],
    });
    const mk = (platform: string): GatewayEvent => ({
      ...makeChannelEvent("12345"),
      metadata: { sender: "12345", platform },
    });
    const ok = await Effect.runPromise(policy.evaluate(mk("signal"), initialGatewayState()));
    const other = await Effect.runPromise(policy.evaluate(mk("telegram"), initialGatewayState()));
    expect(ok).toBeNull();
    expect(other!.action).toBe("skip");
    expect(other).toMatchObject({ code: "unknown-sender" });
  });

  test("G8: bare allowlist entry no longer matches a platform-tagged sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["+15551234567"],
    });
    const d = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15551234567"), initialGatewayState()),
    );
    expect(d!.action).toBe("skip");
  });

  test("G8: empty sender is denied even under open and blocklist (fail closed)", async () => {
    for (const cfg of [
      { policy: "open" as const },
      { policy: "blocklist" as const, blockedSenders: ["signal:x"] },
      { policy: "allowlist" as const, allowedSenders: ["signal:"] },
    ]) {
      const policy = createAccessControlPolicy(cfg);
      const d = await Effect.runPromise(
        policy.evaluate(makeChannelEvent(""), initialGatewayState()),
      );
      expect(d!.action).toBe("skip");
    }
  });

  test("G8: blocklist is namespaced too", async () => {
    const policy = createAccessControlPolicy({
      policy: "blocklist",
      blockedSenders: ["telegram:+15559999999"],
    });
    const d = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(d).toBeNull(); // signal sender, telegram entry
  });
});
