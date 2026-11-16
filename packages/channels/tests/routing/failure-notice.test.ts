import { describe, expect, test } from "bun:test";
import { Effect, Either, Schema } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { createChannelRouter, type ChannelRouterOptions } from "../../src/routing/router.js";
import { RouteSpec, RoutingError, type AgentResolver, type RouteSpecInput } from "../../src/routing/types.js";
import { validateRoutes } from "../../src/routing/validate.js";
import { env, makeScriptedAdapter, waitFor } from "./scripted.js";

const route = (over: Partial<RouteSpecInput> = {}): RouteSpecInput => ({
  id: "r1",
  match: { channelId: "chan" },
  target: { agentId: "agent" },
  allow: ["scripted:alice"],
  ...over,
});

const hangingAgent: AgentResolver = {
  open: () => Effect.succeed({ send: () => Effect.never, close: Effect.void }),
};

const failingAgent: AgentResolver = {
  open: () =>
    Effect.succeed({
      send: () => Effect.fail(new RoutingError({ reason: "turn_failed", message: "secret internal detail" })),
      close: Effect.void,
    }),
};

const run = <A>(
  opts: Omit<ChannelRouterOptions, "leases">,
  body: (router: Effect.Effect.Success<ReturnType<typeof createChannelRouter>>) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(Effect.scoped(Effect.flatMap(createChannelRouter({ ...opts, leases: makeMemoryLeases() }), body)));

describe("failed-turn user notice", () => {
  test("timeout sends one notice with the limit in seconds; ChannelTurnCompleted ok:false unchanged", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const events: AgentEvent[] = [];
    await run(
      {
        channels: [chan],
        routes: [route({ turnTimeoutMs: 50 })],
        agents: hangingAgent,
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      () =>
        Effect.gen(function* () {
          chan.push(env());
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
          expect(chan.sends.map((s) => s.text)).toEqual([
            "That took longer than the 1-second turn limit, so I stopped. Send it again, or ask me to continue.",
          ]);
          const done = events.filter((e) => e._tag === "ChannelTurnCompleted");
          expect(done.length).toBe(1);
          expect(done[0]).toMatchObject({ ok: false, reason: "turn_timeout" });
        }),
    );
  });

  test("a non-timeout failure sends a generic notice without the error detail", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    await run({ channels: [chan], routes: [route()], agents: failingAgent }, () =>
      Effect.gen(function* () {
        chan.push(env());
        yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
        const text = chan.sends[0]?.text ?? "";
        expect(text).toContain("Something went wrong");
        expect(text).not.toContain("secret");
      }),
    );
  });

  test("failureNotice: false sends nothing", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const events: AgentEvent[] = [];
    await run(
      {
        channels: [chan],
        routes: [route({ failureNotice: false })],
        agents: failingAgent,
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      () =>
        Effect.gen(function* () {
          chan.push(env());
          yield* Effect.promise(() => waitFor(() => events.some((e) => e._tag === "ChannelTurnCompleted")));
          yield* Effect.sleep(30);
          expect(chan.sends).toEqual([]);
        }),
    );
  });

  test("simulated failed turn sends nothing; denied sender gets no failure notice", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    await run({ channels: [chan], routes: [route()], agents: failingAgent }, (router) =>
      Effect.gen(function* () {
        const outcome = yield* router.simulate(env(), "chan");
        expect(outcome._tag).toBe("Failed");
        const denied = yield* router.simulate(env({ userId: "mallory" }), "chan");
        expect(denied._tag).toBe("Denied");
        expect(chan.sends).toEqual([]);
      }),
    );
  });

  test("a failing notice send is swallowed; the outcome stays Failed", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const failing = { ...chan, send: () => Effect.die("send down") } as typeof chan;
    const events: AgentEvent[] = [];
    await run(
      {
        channels: [failing],
        routes: [route()],
        agents: failingAgent,
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      () =>
        Effect.gen(function* () {
          failing.push(env());
          yield* Effect.promise(() => waitFor(() => events.some((e) => e._tag === "ChannelTurnCompleted")));
          expect(events.find((e) => e._tag === "ChannelTurnCompleted")).toMatchObject({ ok: false });
        }),
    );
  });

  test("failureNotice defaults to true and rejects non-boolean", async () => {
    const ok = await Effect.runPromise(validateRoutes([route()], () => "scripted"));
    expect(ok[0]?.failureNotice).toBe(true);
    const loose: Record<string, unknown> = { ...route(), failureNotice: "no" };
    expect(Either.isLeft(Schema.decodeUnknownEither(RouteSpec)(loose))).toBe(true);
  });
});
