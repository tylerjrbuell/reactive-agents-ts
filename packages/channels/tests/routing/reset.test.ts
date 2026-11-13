import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { AgentEvent } from "@reactive-agents/core";
import { makeMemoryLeases } from "../../src/routing/lease.js";
import { createChannelRouter, type ChannelRouter, type ChannelRouterOptions } from "../../src/routing/router.js";
import { RoutingError, type AgentResolver, type RouteSpecInput } from "../../src/routing/types.js";
import { validateRoutes } from "../../src/routing/validate.js";
import { env, makeScriptedAdapter, waitFor } from "./scripted.js";

const route = (over: Partial<RouteSpecInput> = {}): RouteSpecInput => ({
  id: "r1",
  match: { channelId: "chan" },
  target: { agentId: "agent" },
  allow: ["scripted:bob"],
  owners: ["scripted:alice"],
  ...over,
});

/** A resolver whose history lives OUTSIDE the session (like a persisted chat store keyed by conversation). */
const persistedHistoryAgents = (opts: { failReset?: boolean } = {}) => {
  const store = new Map<string, string[]>();
  const seen: string[] = [];
  const opens: string[] = [];
  const closes: string[] = [];
  let resets = 0;
  const resolver: AgentResolver = {
    open: (req) =>
      Effect.gen(function* () {
        opens.push(req.conversationKey);
        yield* Effect.addFinalizer(() => Effect.sync(() => void closes.push(req.conversationKey)));
        return {
          send: (turn) =>
            Effect.sync(() => {
              seen.push(turn.text);
              const history = store.get(req.conversationKey) ?? [];
              store.set(req.conversationKey, history);
              history.push(turn.text);
              return { text: `history:${history.length}` };
            }),
          reset: opts.failReset
            ? Effect.fail(new RoutingError({ reason: "turn_failed", message: "store down" }))
            : Effect.sync(() => {
                resets += 1;
                store.delete(req.conversationKey);
              }),
          close: Effect.void,
        };
      }),
  };
  return { resolver, seen, opens, closes, resets: () => resets };
};

const withRouter = <A>(
  opts: Omit<ChannelRouterOptions, "leases">,
  body: (router: ChannelRouter) => Effect.Effect<A>,
): Promise<A> =>
  Effect.runPromise(
    Effect.scoped(Effect.flatMap(createChannelRouter({ ...opts, leases: makeMemoryLeases() }), body)),
  );

const texts = (chan: ReturnType<typeof makeScriptedAdapter>) => chan.sends.map((s) => s.text);

describe("owner reset command", () => {
  test("owner /new starts a fresh session; the agent never sees the command; history restarts", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents();
    const events: AgentEvent[] = [];
    await withRouter(
      {
        channels: [chan],
        routes: [route()],
        agents: agents.resolver,
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      () =>
        Effect.gen(function* () {
          chan.push(env({ text: "one" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
          chan.push(env({ text: "two" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 2));
          expect(texts(chan)).toEqual(["history:1", "history:2"]);
          chan.push(env({ text: "/new" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 3));
          expect(texts(chan)[2]).toBe("Started a new conversation.");
          chan.push(env({ text: "three" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 4));
          expect(texts(chan)[3]).toBe("history:1"); // fresh history, not history:3
          expect(agents.seen).toEqual(["one", "two", "three"]); // "/new" never reached the agent
          expect(agents.opens.length).toBe(2); // new session opened for the next message
          expect(agents.closes.length).toBe(1);
          expect(agents.resets()).toBe(1);
          expect(events.some((e) => e._tag === "ChannelConversationReset" && e.ok && e.routeId === "r1")).toBe(true);
        }),
    );
  });

  test("/reset and Telegram-style /new@bot work; extra words do not reset", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents();
    await withRouter({ channels: [chan], routes: [route()], agents: agents.resolver }, () =>
      Effect.gen(function* () {
        chan.push(env({ text: "/RESET" }));
        yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
        chan.push(env({ text: "/new@my_bot" }));
        yield* Effect.promise(() => waitFor(() => chan.sends.length === 2));
        expect(agents.resets()).toBe(2);
        chan.push(env({ text: "/new please" }));
        yield* Effect.promise(() => waitFor(() => chan.sends.length === 3));
        expect(agents.resets()).toBe(2);
        expect(agents.seen).toEqual(["/new please"]);
      }),
    );
  });

  test("a non-owner /new is plain text: no reset, the agent sees it", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents();
    await withRouter({ channels: [chan], routes: [route()], agents: agents.resolver }, () =>
      Effect.gen(function* () {
        chan.push(env({ userId: "bob", text: "hi" }));
        yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
        chan.push(env({ userId: "bob", text: "/new" }));
        yield* Effect.promise(() => waitFor(() => chan.sends.length === 2));
        expect(agents.resets()).toBe(0);
        expect(agents.closes.length).toBe(0);
        expect(agents.seen).toEqual(["hi", "/new"]);
        expect(texts(chan)).toEqual(["history:1", "history:2"]);
      }),
    );
  });

  test("resetCommands [] disables the command for the owner too", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents();
    await withRouter(
      { channels: [chan], routes: [route({ resetCommands: [] })], agents: agents.resolver },
      () =>
        Effect.gen(function* () {
          chan.push(env({ text: "/new" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
          expect(agents.resets()).toBe(0);
          expect(agents.seen).toEqual(["/new"]);
        }),
    );
  });

  test("a custom command list replaces the defaults", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents();
    await withRouter(
      { channels: [chan], routes: [route({ resetCommands: ["/fresh"] })], agents: agents.resolver },
      () =>
        Effect.gen(function* () {
          chan.push(env({ text: "/new" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
          chan.push(env({ text: "/fresh" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 2));
          expect(agents.resets()).toBe(1);
          expect(agents.seen).toEqual(["/new"]);
        }),
    );
  });

  test("a failed resolver reset is reported to the owner and the session is kept", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents({ failReset: true });
    const events: AgentEvent[] = [];
    await withRouter(
      {
        channels: [chan],
        routes: [route()],
        agents: agents.resolver,
        eventBus: { publish: (e) => Effect.sync(() => void events.push(e)) },
      },
      () =>
        Effect.gen(function* () {
          chan.push(env({ text: "one" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 1));
          chan.push(env({ text: "/new" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 2));
          expect(texts(chan)[1]).toBe("Could not start a new conversation.");
          chan.push(env({ text: "two" }));
          yield* Effect.promise(() => waitFor(() => chan.sends.length === 3));
          expect(texts(chan)[2]).toBe("history:2");
          expect(agents.opens.length).toBe(1);
          expect(events.some((e) => e._tag === "ChannelConversationReset" && !e.ok)).toBe(true);
        }),
    );
  });

  test("simulate does not reset anything", async () => {
    const chan = makeScriptedAdapter({ id: "chan" });
    const agents = persistedHistoryAgents();
    await withRouter({ channels: [chan], routes: [route()], agents: agents.resolver }, (router) =>
      Effect.gen(function* () {
        const outcome = yield* router.simulate(env({ text: "/new" }), "chan");
        expect(outcome._tag).toBe("Answered");
        expect(agents.resets()).toBe(0);
        expect(agents.opens.length).toBe(0);
        expect(chan.sends.length).toBe(0);
      }),
    );
  });

  test("validation: default commands, and malformed commands are rejected", async () => {
    const [ok] = await Effect.runPromise(validateRoutes([route()], () => undefined));
    expect(ok?.resetCommands).toEqual(["/new", "/reset"]);
    for (const bad of [["new"], ["/two words"], ["/"], ["/a", "/b", "/c", "/d", "/e", "/f"]]) {
      const result = await Effect.runPromise(Effect.either(validateRoutes([route({ resetCommands: bad })], () => undefined)));
      expect(result._tag).toBe("Left");
    }
  });
});
