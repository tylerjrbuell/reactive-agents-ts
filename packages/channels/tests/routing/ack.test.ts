import { describe, expect, test } from "bun:test";
import { Effect, TestClock, TestContext } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import type { ChannelAdapter } from "../../src/adapter.js";
import { TelegramChannelAdapter } from "../../src/adapters/telegram.js";
import { channelError } from "../../src/errors.js";
import { MAX_MODEL_ACK_CHARS, pickAckText, resolveAck, sanitizeAckText } from "../../src/routing/ack.js";
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

/** Agent that pushes narration `narrate` ms into a `ms` turn; `acknowledge` is the optional model port. */
const modelAgent = (opts: {
  ms: number;
  narrate?: ReadonlyArray<{ at: number; text: string }>;
  acknowledge?: () => Effect.Effect<string, never>;
  calls?: { ack: number; history: string[] };
}): AgentResolver => ({
  open: () =>
    Effect.succeed({
      send: (turn) =>
        Effect.gen(function* () {
          let at = 0;
          for (const n of opts.narrate ?? []) {
            yield* Effect.sleep(n.at - at);
            at = n.at;
            turn.onProgress?.(n.text);
          }
          yield* Effect.sleep(opts.ms - at);
          opts.calls?.history.push("final");
          return { text: "final" };
        }),
      ...(opts.acknowledge
        ? {
            acknowledge: () => {
              if (opts.calls) opts.calls.ack += 1;
              return opts.acknowledge!();
            },
          }
        : {}),
      close: Effect.void,
    }),
});

describe("route ack: source model", () => {
  const modelRoute = (ack: object = {}) => route({ ack: { source: "model", ...ack } as RouteSpecInput["ack"] });
  const ackEvents = (events: AgentEvent[]) =>
    events.filter((e): e is Extract<AgentEvent, { _tag: "ChannelTurnAcknowledged" }> => e._tag === "ChannelTurnAcknowledged");

  test("narration produced before afterMs is the ack, sent at afterMs, not earlier", async () => {
    const t = withTyping();
    const events: AgentEvent[] = [];
    const calls = { ack: 0, history: [] as string[] };
    await runRouter(
      {
        channels: [t.adapter],
        routes: [modelRoute()],
        agents: modelAgent({
          ms: 10_000,
          narrate: [{ at: 1000, text: "**Looking** up the *weather*" }],
          acknowledge: () => Effect.succeed("port text"),
          calls,
        }),
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(3999);
        expect(t.texts()).toEqual([]);
        yield* advance(1);
        expect(t.texts()).toEqual(["Looking up the weather"]);
        expect(calls.ack).toBe(0);
        yield* advance(6000);
        expect(t.texts()).toEqual(["Looking up the weather", "final"]);
        expect(ackEvents(events).map((e) => e.source)).toEqual(["narration"]);
      }),
    );
  });

  test("no narration: the acknowledge port text is the ack", async () => {
    const t = withTyping();
    const events: AgentEvent[] = [];
    await runRouter(
      {
        channels: [t.adapter],
        routes: [modelRoute()],
        agents: modelAgent({ ms: 10_000, acknowledge: () => Effect.succeed("One moment, checking.") }),
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(4000);
        expect(t.texts()).toEqual(["One moment, checking."]);
        yield* advance(6000);
        expect(t.texts()).toEqual(["One moment, checking.", "final"]);
        expect(ackEvents(events).map((e) => e.source)).toEqual(["model"]);
      }),
    );
  });

  test("port slower than modelTimeoutMs falls back to canned", async () => {
    const t = withTyping();
    const events: AgentEvent[] = [];
    await runRouter(
      {
        channels: [t.adapter],
        routes: [modelRoute({ modelTimeoutMs: 500 })],
        agents: modelAgent({ ms: 10_000, acknowledge: () => Effect.zipRight(Effect.sleep(5000), Effect.succeed("late")) }),
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(4000);
        expect(t.texts()).toEqual([]);
        yield* advance(500);
        expect(t.texts()).toEqual(["On it..."]);
        yield* advance(6000);
        expect(t.texts()).toEqual(["On it...", "final"]);
        expect(ackEvents(events).map((e) => e.source)).toEqual(["canned"]);
      }),
    );
  });

  test("port defect or empty text falls back to canned", async () => {
    for (const acknowledge of [() => Effect.die("boom") as Effect.Effect<string, never>, () => Effect.succeed("  **  ")]) {
      const t = withTyping();
      await runRouter(
        { channels: [t.adapter], routes: [modelRoute()], agents: modelAgent({ ms: 8000, acknowledge }) },
        Effect.gen(function* () {
          t.inner.push(env());
          yield* advance(4000);
          expect(t.texts()).toEqual(["On it..."]);
          yield* advance(4000);
          expect(t.texts()).toEqual(["On it...", "final"]);
        }),
      );
    }
  });

  test("no narration and no port: canned", async () => {
    const t = withTyping();
    await runRouter(
      { channels: [t.adapter], routes: [modelRoute()], agents: slowAgent(8000) },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(4000);
        expect(t.texts()).toEqual(["On it..."]);
      }),
    );
  });

  test("source canned ignores narration and the port", async () => {
    const t = withTyping();
    const calls = { ack: 0, history: [] as string[] };
    await runRouter(
      {
        channels: [t.adapter],
        routes: [route({ ack: {} })],
        agents: modelAgent({ ms: 8000, narrate: [{ at: 100, text: "narrated" }], acknowledge: () => Effect.succeed("port"), calls }),
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(4000);
        expect(t.texts()).toEqual(["On it..."]);
        expect(calls.ack).toBe(0);
      }),
    );
  });

  test("narration after the ack went out is dropped: still exactly one ack; quick turn gets none", async () => {
    const t = withTyping();
    const events: AgentEvent[] = [];
    await runRouter(
      {
        channels: [t.adapter],
        routes: [modelRoute()],
        agents: modelAgent({ ms: 10_000, narrate: [{ at: 6000, text: "too late" }] }),
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(4000);
        yield* advance(6000);
        expect(t.texts()).toEqual(["On it...", "final"]);
        expect(ackEvents(events).length).toBe(1);
      }),
    );
    const quick = withTyping();
    await runRouter(
      {
        channels: [quick.adapter],
        routes: [modelRoute()],
        agents: modelAgent({ ms: 1000, narrate: [{ at: 500, text: "hi" }], acknowledge: () => Effect.succeed("port") }),
      },
      Effect.gen(function* () {
        quick.inner.push(env());
        yield* advance(20_000);
        expect(quick.texts()).toEqual(["final"]);
      }),
    );
  });

  test("a port that outlives the turn is interrupted: no ack after the final reply", async () => {
    const t = withTyping();
    await runRouter(
      {
        channels: [t.adapter],
        routes: [modelRoute({ modelTimeoutMs: 10_000 })],
        agents: modelAgent({ ms: 5000, acknowledge: () => Effect.zipRight(Effect.sleep(8000), Effect.succeed("late")) }),
      },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(5000);
        yield* advance(20_000);
        expect(t.texts()).toEqual(["final"]);
      }),
    );
  });

  test("the ack is not agent history: the router never writes it through the session", async () => {
    const t = withTyping();
    const sent: string[] = [];
    const agents: AgentResolver = {
      open: () =>
        Effect.succeed({
          send: (turn) => Effect.zipRight(Effect.sleep(8000), Effect.sync(() => (sent.push(turn.text), { text: "final" }))),
          acknowledge: () => Effect.succeed("model ack"),
          close: Effect.void,
        }),
    };
    await runRouter(
      { channels: [t.adapter], routes: [modelRoute()], agents },
      Effect.gen(function* () {
        t.inner.push(env());
        yield* advance(8000);
        expect(t.texts()).toEqual(["model ack", "final"]);
        expect(sent.length).toBe(1);
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
    expect(resolveAck({})).toEqual({ afterMs: 4000, texts: ["On it..."], typing: true, source: "canned", modelTimeoutMs: 3000 });
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

  test("source and modelTimeoutMs bounds", async () => {
    expect((await check({ source: "model", modelTimeoutMs: 1 }))._tag).toBe("Success");
    expect((await check({ source: "model", modelTimeoutMs: 10_000 }))._tag).toBe("Success");
    for (const bad of [{ source: "llm" }, { modelTimeoutMs: 0 }, { modelTimeoutMs: 10_001 }, { modelTimeoutMs: 1.5 }]) {
      expect((await check(bad))._tag).toBe("Failure");
    }
  });

  test("sanitizeAckText strips markdown, flattens and caps", () => {
    expect(sanitizeAckText("**Checking** the `repo`\n\n- see [docs](http://x.y)")).toBe("Checking the repo see docs");
    expect(sanitizeAckText("```ts\ncode\n```")).toBeUndefined();
    expect(sanitizeAckText("   ")).toBeUndefined();
    const long = sanitizeAckText("a".repeat(500)) ?? "";
    expect(long.length).toBe(MAX_MODEL_ACK_CHARS);
  });

  test("webhook routes reject ack", async () => {
    const exit = await Effect.runPromiseExit(validateRoutes([route({ ack: {}, allow: [] })], () => "webhook"));
    expect(exit._tag).toBe("Failure");
  });
});
