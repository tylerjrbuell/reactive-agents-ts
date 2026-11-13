import { describe, expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import type { ChannelAdapter } from "../../src/adapter.js";
import { TelegramChannelAdapter } from "../../src/adapters/telegram.js";
import { channelError } from "../../src/errors.js";
import { pickAckText, resolveAck } from "../../src/routing/ack.js";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { makeRouteMeter } from "../../src/routing/meter.js";
import { createChannelRouter, type ChannelRouterOptions } from "../../src/routing/router.js";
import type { AgentResolver, RouteSpecInput } from "../../src/routing/types.js";
import { validateRoutes } from "../../src/routing/validate.js";
import { FAKE_TOKEN, makeFakeTelegram } from "../conformance/telegram.fake.js";
import { env, makeScriptedAdapter } from "./scripted.js";

/** Let forked fibers run: the TestClock never advances on its own. */
const settle = Effect.repeatN(Effect.yieldNow(), 40);
const advance = (ms: number) => Effect.zipRight(TestClock.adjust(ms), settle);

const route = (over: Partial<RouteSpecInput> = {}): RouteSpecInput => ({
  id: "r1",
  match: { channelId: "chan" },
  target: { agentId: "agent" },
  allow: ["scripted:alice"],
  ...over,
});

/** An agent whose turn takes `ms` of (test) time, then answers "final". */
const slowAgent = (ms: number): AgentResolver => ({
  open: () =>
    Effect.succeed({
      send: () => Effect.zipRight(Effect.sleep(ms), Effect.succeed({ text: "final" })),
      close: Effect.void,
    }),
});

/** A scripted adapter with a typing capability, optionally failing a given outbound text. */
const withTyping = (failText?: string) => {
  const inner = makeScriptedAdapter({ id: "chan" });
  const pulses: string[] = [];
  const adapter: ChannelAdapter = {
    ...inner,
    sendTyping: (c) => Effect.sync(() => void pulses.push(c.channelId)),
    send: (m) =>
      failText !== undefined && m.text === failText
        ? Effect.fail(channelError("chan", "network", { message: "ack send failed" }))
        : inner.send(m),
  };
  return { inner, adapter, pulses, texts: () => inner.sends.map((s) => s.text) };
};

const runRouter = <A>(
  opts: Omit<ChannelRouterOptions, "leases">,
  body: Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(
      Effect.zipRight(createChannelRouter({ ...opts, leases: makeMemoryLeases() }), body),
    ).pipe(Effect.provide(TestContext.TestContext)),
  );

describe("route ack", () => {
  test("a quick turn gets no ack message; typing started at once", async () => {
    const t = withTyping();
    await runRouter(
      { channels: [t.adapter], routes: [route({ ack: {} })], agents: slowAgent(1000) },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* settle;
        expect(t.pulses.length).toBe(1);
        yield* advance(1000);
        expect(t.texts()).toEqual(["final"]);
        yield* advance(20_000);
        expect(t.texts()).toEqual(["final"]);
        expect(t.pulses.length).toBe(1);
      }),
    );
  });

  test("a slow turn sends exactly one ack, then the final reply, in order; typing repeats then stops", async () => {
    const t = withTyping();
    const events: AgentEvent[] = [];
    await runRouter(
      {
        channels: [t.adapter],
        routes: [route({ ack: {} })],
        agents: slowAgent(10_000),
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* settle;
        expect(t.pulses.length).toBe(1);
        yield* advance(3999);
        expect(t.texts()).toEqual([]);
        yield* advance(1);
        expect(t.texts()).toEqual(["On it..."]);
        expect(t.pulses.length).toBe(2);
        yield* advance(6000);
        expect(t.texts()).toEqual(["On it...", "final"]);
        const pulsesAtReply = t.pulses.length;
        yield* advance(30_000);
        expect(t.pulses.length).toBe(pulsesAtReply);
        expect(t.texts()).toEqual(["On it...", "final"]);
        expect(events.filter((e) => e._tag === "ChannelTurnAcknowledged").length).toBe(1);
      }),
    );
  });

  test("afterMs and text are configurable; typing:false skips the indicator", async () => {
    const t = withTyping();
    await runRouter(
      {
        channels: [t.adapter],
        routes: [route({ ack: { afterMs: 500, text: "Working", typing: false } })],
        agents: slowAgent(5000),
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(500);
        expect(t.texts()).toEqual(["Working"]);
        expect(t.pulses.length).toBe(0);
      }),
    );
  });

  test("a failing ack send never fails the turn", async () => {
    const t = withTyping("On it...");
    await runRouter(
      { channels: [t.adapter], routes: [route({ ack: {} })], agents: slowAgent(8000) },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(4000);
        expect(t.texts()).toEqual([]);
        yield* advance(4000);
        expect(t.texts()).toEqual(["final"]);
      }),
    );
  });

  test("ack:false and an absent ack do nothing", async () => {
    for (const ack of [false as const, undefined]) {
      const t = withTyping();
      await runRouter(
        { channels: [t.adapter], routes: [route(ack === undefined ? {} : { ack })], agents: slowAgent(9000) },
        Effect.gen(function* () {
          t.inner.push(env());
          yield* advance(8000);
          expect(t.texts()).toEqual([]);
          expect(t.pulses.length).toBe(0);
          yield* advance(1000);
          expect(t.texts()).toEqual(["final"]);
        }),
      );
    }
  });

  test("a denied sender gets no ack and no typing", async () => {
    const t = withTyping();
    await runRouter(
      { channels: [t.adapter], routes: [route({ ack: {} })], agents: slowAgent(9000) },
      Effect.gen(function* () {
        t.inner.push(env({ userId: "mallory" }));
        yield* advance(10_000);
        expect(t.texts()).toEqual([]);
        expect(t.pulses.length).toBe(0);
      }),
    );
  });

  test("a meter-refused turn gets no ack and no typing", async () => {
    const t = withTyping();
    await runRouter(
      {
        channels: [t.adapter],
        routes: [route({ ack: {}, maxCostPerDayUsd: 1 })],
        agents: slowAgent(9000),
        meter: makeRouteMeter({ reserveUsd: 5 }),
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(10_000);
        expect(t.texts()).toEqual([]);
        expect(t.pulses.length).toBe(0);
      }),
    );
  });

  test("an adapter without sendTyping still gets the ack message", async () => {
    const inner = makeScriptedAdapter({ id: "chan" });
    await runRouter(
      { channels: [inner], routes: [route({ ack: {} })], agents: slowAgent(6000) },
      Effect.gen(function* () {
        inner.push(env());
        yield* advance(4000);
        expect(inner.sends.map((s) => s.text)).toEqual(["On it..."]);
      }),
    );
  });
});

describe("route ack: Telegram typing", () => {
  test("sendTyping calls sendChatAction typing in the chat, with the thread when numeric", async () => {
    const fake = makeFakeTelegram();
    const bot = new TelegramChannelAdapter({ id: "tg", token: FAKE_TOKEN, fetch: fake.fetch });
    await Effect.runPromise(bot.sendTyping({ channelId: "42", threadId: "7" }));
    await Effect.runPromise(bot.sendTyping({ channelId: "42", threadId: "not-numeric" }));
    expect(fake.actions.map((a) => a.params)).toEqual([
      { chat_id: 42, action: "typing", message_thread_id: 7 },
      { chat_id: 42, action: "typing" },
    ]);
  });
});

describe("route ack: config", () => {
  const platformOf = () => "scripted";
  const check = (ack: unknown) =>
    Effect.runPromiseExit(validateRoutes([route({ ack: ack as RouteSpecInput["ack"] })], platformOf));

  test("defaults and rotation are deterministic", () => {
    expect(resolveAck(undefined)).toBeUndefined();
    expect(resolveAck(false)).toBeUndefined();
    expect(resolveAck({})).toEqual({ afterMs: 4000, texts: ["On it..."], typing: true });
    expect(pickAckText(["a", "b", "c"], "m1")).toBe(pickAckText(["a", "b", "c"], "m1"));
  });

  test("valid and invalid ack shapes", async () => {
    expect((await check({}))._tag).toBe("Success");
    expect((await check(false))._tag).toBe("Success");
    expect((await check({ afterMs: 1500, text: ["One", "Two"] }))._tag).toBe("Success");
    for (const bad of [
      { afterMs: -1 },
      { afterMs: 1.5 },
      { afterMs: 999_999 },
      { text: "" },
      { text: [] },
      { text: "x".repeat(201) },
      { text: Array.from({ length: 11 }, () => "x") },
    ]) {
      expect((await check(bad))._tag).toBe("Failure");
    }
  });

  test("webhook routes reject ack", async () => {
    const exit = await Effect.runPromiseExit(validateRoutes([route({ ack: {}, allow: [] })], () => "webhook"));
    expect(exit._tag).toBe("Failure");
  });
});
