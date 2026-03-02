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
      allowedSenders: ["+15551234567"],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15551234567"), initialGatewayState()),
    );
    expect(decision).toBeNull();
  });

  test("allowlist: blocks unlisted sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "allowlist",
      allowedSenders: ["+15551234567"],
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
      blockedSenders: ["+15559999999"],
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision!.action).toBe("skip");
  });

  test("blocklist: allows unlisted sender", async () => {
    const policy = createAccessControlPolicy({
      policy: "blocklist",
      blockedSenders: ["+15559999999"],
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
      allowedSenders: ["+15551234567"],
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
      allowedSenders: ["+15551234567"],
      unknownSenderAction: "escalate",
    });
    const decision = await Effect.runPromise(
      policy.evaluate(makeChannelEvent("+15559999999"), initialGatewayState()),
    );
    expect(decision!.action).toBe("escalate");
  });
});
