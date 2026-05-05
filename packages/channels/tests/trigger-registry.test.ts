import { describe, expect, test } from "bun:test";
import { TriggerRegistry } from "../src/services/trigger-registry.js";
import type { InboundMessage, TriggerDefinition } from "../src/types.js";

const makeMsg = (overrides: Partial<InboundMessage> = {}): InboundMessage => ({
  id: "msg-1",
  platform: "telegram-bot",
  channelId: "ch-1",
  senderId: "user-1",
  content: "hello",
  metadata: {},
  timestamp: new Date(),
  ...overrides,
});

describe("TriggerRegistry", () => {
  test("keyword match fires on matching content", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "k1",
      name: "kw",
      match: { type: "keyword", patterns: ["hello"] },
      agent: {},
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "HELLO world" }))).toEqual(t);
  });

  test("slash_command match fires on /command prefix", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "s1",
      name: "slash",
      match: { type: "slash_command", command: "start" },
      agent: {},
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "/start here" }))).toEqual(t);
    expect(r.evaluate(makeMsg({ content: "no slash" }))).toBeNull();
  });

  test("mention match fires when content mentions bot", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "m1",
      name: "mention",
      match: { type: "mention" },
      agent: {},
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "hi @bot" }))).toEqual(t);
    expect(r.evaluate(makeMsg({ content: "hi bot" }))).toBeNull();
  });

  test("custom evaluator fires when function returns true", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "c1",
      name: "custom",
      match: { type: "custom", evaluate: (m) => m.content.includes("x") },
      agent: {},
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "abcx" }))).toEqual(t);
  });

  test("no match returns null", () => {
    const r = new TriggerRegistry();
    r.register({
      id: "k1",
      name: "kw",
      match: { type: "keyword", patterns: ["nope"] },
      agent: {},
    });
    expect(r.evaluate(makeMsg())).toBeNull();
  });

  test("permissions deny blocked users", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "p1",
      name: "perm",
      match: { type: "keyword", patterns: ["hi"] },
      agent: {},
      permissions: { deniedUsers: ["user-1"] },
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "hi", senderId: "user-1" }))).toBeNull();
    expect(r.evaluate(makeMsg({ content: "hi", senderId: "user-2" }))).toEqual(t);
  });

  test("allowedUsers restricts to listed senders", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "a1",
      name: "allow",
      match: { type: "keyword", patterns: ["x"] },
      agent: {},
      permissions: { allowedUsers: ["a"] },
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "x", senderId: "b" }))).toBeNull();
    expect(r.evaluate(makeMsg({ content: "x", senderId: "a" }))).toEqual(t);
  });

  test("default agent returned via accessor", () => {
    const r = new TriggerRegistry();
    r.setDefaultAgent({ systemPrompt: "default" });
    expect(r.getDefaultAgent()?.systemPrompt).toBe("default");
  });

  test("register and unregister work", () => {
    const r = new TriggerRegistry();
    const t: TriggerDefinition = {
      id: "t1",
      name: "t",
      match: { type: "keyword", patterns: ["z"] },
      agent: {},
    };
    r.register(t);
    expect(r.evaluate(makeMsg({ content: "z" }))).toEqual(t);
    r.unregister("t1");
    expect(r.evaluate(makeMsg({ content: "z" }))).toBeNull();
  });
});
