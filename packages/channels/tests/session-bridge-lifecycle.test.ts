import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { SessionBridge } from "../src/services/session-bridge.js";
import type { AgentLifecycle, TriggerAgentConfig } from "../src/types.js";

/** A factory whose "persisted history" lives outside the agent, keyed by session id (as the runtime does). */
const makeHarness = (bridgeOpts: { idleTimeoutMs?: number; maxSessions?: number } = {}) => {
  let clock = 1_000;
  const builds: string[] = [];
  const closes: string[] = [];
  const history = new Map<string, string[]>();
  const failClose = { value: false };
  const factory = async (_cfg: TriggerAgentConfig | undefined, id: string) => {
    builds.push(id);
    return {
      chat: async (message: string) => {
        const h = history.get(id) ?? [];
        h.push(message);
        history.set(id, h);
        return { message: `seen:${h.join("|")}` };
      },
      close: async () => {
        closes.push(id);
        if (failClose.value) throw new Error("close boom");
      },
    };
  };
  const bridge = new SessionBridge({ agentFactory: factory, now: () => clock, ...bridgeOpts });
  const params = (lifecycle?: AgentLifecycle) => ({
    identity: { platform: "telegram", userId: "u1" },
    channelId: "c1",
    ...(lifecycle ? { lifecycle } : {}),
  });
  return {
    bridge,
    builds,
    closes,
    history,
    failClose,
    params,
    advance: (ms: number) => void (clock += ms),
    turn: (text: string, lifecycle?: AgentLifecycle) => Effect.runPromise(bridge.runChatTurn(params(lifecycle), text)),
  };
};

describe("SessionBridge lifecycle", () => {
  test("conversation: idle teardown, then rebuild resumes persisted history", async () => {
    const h = makeHarness();
    const lc: AgentLifecycle = { type: "conversation", idleTimeoutMs: 1000 };
    const first = await h.turn("one", lc);
    expect(first.reply).toBe("seen:one");
    h.advance(999);
    expect((await h.turn("two", lc)).reply).toBe("seen:one|two");
    expect(h.builds.length).toBe(1);
    expect(h.closes.length).toBe(0);

    h.advance(1000); // idle for the full timeout
    const third = await h.turn("three", lc);
    expect(h.closes).toEqual([first.sessionId]);
    expect(h.builds.length).toBe(2);
    expect(third.sessionId).toBe(first.sessionId); // same id, so history resumes
    expect(third.reply).toBe("seen:one|two|three");
  });

  test("conversation uses the bridge idle default (30 minutes) when the lifecycle sets none", async () => {
    const h = makeHarness();
    const lc: AgentLifecycle = { type: "conversation" };
    await h.turn("a", lc);
    h.advance(30 * 60_000 - 1);
    await h.turn("b", lc);
    expect(h.builds.length).toBe(1);
    h.advance(30 * 60_000);
    await h.turn("c", lc);
    expect(h.builds.length).toBe(2);
  });

  test("a turn in flight is never torn down by idleness", async () => {
    const h = makeHarness();
    const lc: AgentLifecycle = { type: "conversation", idleTimeoutMs: 10 };
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const slow = new SessionBridge({
      now: () => 0,
      agentFactory: async () => ({
        chat: async () => {
          await gate;
          return { message: "slow" };
        },
        close: async () => void h.closes.push("slow"),
      }),
    });
    const params = { identity: { platform: "p", userId: "u" }, channelId: "c", lifecycle: lc };
    const running = Effect.runPromise(slow.runChatTurn(params, "x"));
    await new Promise((r) => setTimeout(r, 5));
    expect(await Effect.runPromise(slow.sweep())).toBe(0);
    release();
    await running;
    expect(h.closes.length).toBe(0);
  });

  test("single_response: torn down after the turn, fresh session id every time", async () => {
    const h = makeHarness();
    const lc: AgentLifecycle = { type: "single_response" };
    const a = await h.turn("one", lc);
    const b = await h.turn("two", lc);
    expect(h.builds.length).toBe(2);
    expect(h.closes.length).toBe(2);
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(b.reply).toBe("seen:two"); // no memory of "one"
    expect(h.bridge.size()).toBe(0);
  });

  test("ttl: torn down after durationMs from build, not from last activity", async () => {
    const h = makeHarness();
    const lc: AgentLifecycle = { type: "ttl", durationMs: 1000 };
    const first = await h.turn("one", lc);
    h.advance(600);
    await h.turn("two", lc); // activity does not extend a ttl
    h.advance(400);
    const third = await h.turn("three", lc);
    expect(h.builds.length).toBe(2);
    expect(h.closes).toEqual([first.sessionId]);
    expect(third.reply).toBe("seen:one|two|three");
  });

  test("persistent and no lifecycle are never torn down by time", async () => {
    const h = makeHarness();
    await h.turn("a", { type: "persistent" });
    h.advance(10 * 24 * 3_600_000);
    await h.turn("b", { type: "persistent" });
    await h.turn("c");
    expect(h.builds.length).toBe(1);
    expect(h.closes.length).toBe(0);
  });

  test("sweep closes idle sessions without a new turn", async () => {
    const h = makeHarness();
    await h.turn("a", { type: "conversation", idleTimeoutMs: 100 });
    h.advance(100);
    expect(await Effect.runPromise(h.bridge.sweep())).toBe(1);
    expect(h.bridge.size()).toBe(0);
    expect(h.closes.length).toBe(1);
  });

  test("release and LRU eviction close the agent; a failing close is swallowed", async () => {
    const h = makeHarness({ maxSessions: 1 });
    h.failClose.value = true;
    await Effect.runPromise(h.bridge.ensureSession({ identity: { platform: "p", userId: "a" }, channelId: "c" }));
    await Effect.runPromise(h.bridge.ensureSession({ identity: { platform: "p", userId: "b" }, channelId: "c" }));
    expect(h.closes.length).toBe(1); // "a" evicted
    await Effect.runPromise(h.bridge.release({ platform: "p", userId: "b" }, "c"));
    expect(h.closes.length).toBe(2);
  });
});
