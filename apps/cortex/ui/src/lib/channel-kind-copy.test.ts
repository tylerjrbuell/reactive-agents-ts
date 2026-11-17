import { describe, expect, test } from "bun:test";
import { CHANNEL_KIND_COPY, CHANNEL_KIND_ORDER, WEBHOOK_COPY, channelKindCopy, webhookCopyStrings } from "./channel-kind-copy.js";
import { ROUTE_CAPABILITIES, routeCapabilities } from "./channel-route-capabilities.js";
import { CHANNEL_KINDS } from "./channels.js";

import { MESSAGING_WORDS } from "./messaging-words.js";

describe("channel kind copy", () => {
  test("every kind defines every copy key", () => {
    const keys = Object.keys(CHANNEL_KIND_COPY.telegram).sort();
    for (const kind of CHANNEL_KIND_ORDER) {
      expect(Object.keys(CHANNEL_KIND_COPY[kind]).sort()).toEqual(keys);
      for (const [k, v] of Object.entries(CHANNEL_KIND_COPY[kind])) {
        if (k === "accessNote") continue; // empty for a messaging channel: its access is the sender lists
        expect(v, `${kind}.${k}`).toBeTruthy();
      }
    }
  });

  test("webhook copy (kind, fields and connection panel) contains no messaging word", () => {
    const offenders = webhookCopyStrings().filter((s) => MESSAGING_WORDS.test(s));
    expect(offenders).toEqual([]);
    expect(WEBHOOK_COPY.listenPort.label.length).toBeGreaterThan(0);
  });

  test("the editor's kind list is built from the copy, in order", () => {
    expect(CHANNEL_KINDS.map((k) => k.kind)).toEqual([...CHANNEL_KIND_ORDER]);
    expect(CHANNEL_KINDS.find((k) => k.kind === "webhook")?.blurb).toBe(CHANNEL_KIND_COPY.webhook.blurb);
  });

  test("an unknown platform reads as a messaging channel", () => {
    expect(channelKindCopy(undefined)).toBe(CHANNEL_KIND_COPY.telegram);
    expect(channelKindCopy("webhook").turnsPerHourLabel).toBe("Runs per hour");
  });
});

describe("route capabilities", () => {
  test("a webhook has no sender, conversation, trigger, ack, batching, reset or per-sender cap, but keeps the run limit", () => {
    expect(ROUTE_CAPABILITIES.webhook).toEqual({
      conversation: false,
      trigger: false,
      senderAccess: false,
      ack: false,
      batching: false,
      reset: false,
      turnLimit: true,
      failureNotice: false,
      perSenderCap: false,
    });
  });

  test("messaging channels and an unknown platform have all of them", () => {
    for (const p of ["telegram", "signal", undefined, "other"]) expect(Object.values(routeCapabilities(p)).every(Boolean)).toBe(true);
  });
});
