import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { SessionBridge } from "../src/services/session-bridge.js";
import type { TriggerAgentConfig } from "../src/types.js";

describe("SessionBridge", () => {
  test("ensureSession creates then reuses chat handle", async () => {
    let creations = 0;
    const factory = async (_cfg: TriggerAgentConfig | undefined, _id: string) => {
      creations += 1;
      return {
        chat: async (message: string) => ({ message: `echo:${message}` }),
      };
    };
    const bridge = new SessionBridge({ agentFactory: factory });
    const params = {
      identity: { platform: "telegram-bot", userId: "u1" },
      channelId: "c1",
      agentConfig: { systemPrompt: "s" } satisfies TriggerAgentConfig,
    };
    const a = await Effect.runPromise(bridge.ensureSession(params));
    const b = await Effect.runPromise(bridge.ensureSession(params));
    expect(creations).toBe(1);
    expect(a.sessionId).toBe(b.sessionId);
  });

  test("runChatTurn serializes two messages for same key", async () => {
    const order: string[] = [];
    const factory = async () => ({
      chat: async (message: string) => {
        order.push(`start:${message}`);
        await new Promise((r) => setTimeout(r, 5));
        order.push(`end:${message}`);
        return { message: `done:${message}` };
      },
    });
    const bridge = new SessionBridge({ agentFactory: factory });
    const params = {
      identity: { platform: "discord", userId: "u2" },
      channelId: "c2",
    };
    const r1 = await Effect.runPromise(bridge.runChatTurn(params, "a"));
    const r2 = await Effect.runPromise(bridge.runChatTurn(params, "b"));
    expect(r1.reply).toContain("a");
    expect(r2.reply).toContain("b");
    expect(order).toEqual(["start:a", "end:a", "start:b", "end:b"]);
  });

  test("release clears session", async () => {
    let creations = 0;
    const factory = async () => {
      creations += 1;
      return { chat: async (m: string) => ({ message: m }) };
    };
    const bridge = new SessionBridge({ agentFactory: factory });
    const id = { platform: "p", userId: "u" };
    await Effect.runPromise(bridge.ensureSession({ identity: id, channelId: "c" }));
    await Effect.runPromise(bridge.release(id, "c"));
    await Effect.runPromise(bridge.ensureSession({ identity: id, channelId: "c" }));
    expect(creations).toBe(2);
  });
});
