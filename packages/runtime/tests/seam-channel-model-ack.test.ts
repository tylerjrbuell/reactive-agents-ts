// Run: bun test packages/runtime/tests/seam-channel-model-ack.test.ts
//
// Seam pin: model-written channel acks. The runtime resolver forwards pre-tool narration to
// turn.onProgress and offers an `acknowledge` port that is a side completion: it never touches the
// session (history) and never waits on the running turn.
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { OpenSessionRequest, RoutedSession, RoutedTurn } from "@reactive-agents/channels";
import { makeChannelAgentResolver, type ChannelAgentHandle } from "../src/agent/channel-router-resolver.js";
import { drainWithNarration, toChannelHandle } from "../src/agent/channel-ack-ports.js";
import type { AgentStreamEvent } from "../src/stream-types.js";
import { ReactiveAgents } from "../src/builder.js";

const req: OpenSessionRequest = {
  routeId: "r1",
  role: "owner",
  target: { agentId: "a" },
  toolExposure: { _tag: "AgentDefault" },
  conversationKey: "chat-1",
  stateless: false,
};

type Loose = { readonly _tag: AgentStreamEvent["_tag"] } & Readonly<Record<string, unknown>>;
const ev = (e: Loose): AgentStreamEvent => e as AgentStreamEvent;
const text = (t: string): AgentStreamEvent => ev({ _tag: "TextDelta", text: t });
const tool = (): AgentStreamEvent => ev({ _tag: "ToolCallStarted", toolName: "grep", callId: "c1" });
const completed = (output: string): AgentStreamEvent =>
  ev({ _tag: "StreamCompleted", output, metadata: { tokensUsed: 7, cost: 0.5 } });

async function* events(list: ReadonlyArray<AgentStreamEvent>): AsyncGenerator<AgentStreamEvent> {
  for (const e of list) yield e;
}

const turn = (extra: { readonly onProgress?: (t: string) => void } = {}): RoutedTurn => {
  return {
    text: "fix the bug",
    parts: [],
    taskId: "t1",
    sender: { platform: "telegram", userId: "1" },
    approval: { request: () => Effect.succeed("denied" as const) },
    message: {
      id: "m1",
      platform: "telegram",
      channelId: "chat-1",
      senderId: "1",
      content: "fix the bug",
      metadata: {},
      timestamp: new Date(0),
    },
    ...extra,
  };
};

interface Spy {
  chats: string[];
  completes: Array<{ messages: ReadonlyArray<{ role: string; content: string }>; budgetTokens: number }>;
  releaseChat: () => void;
}

/** Open a session over a double handle and run `body` inside the resolver's scope. */
const withSession = async <A>(
  stream: ReadonlyArray<AgentStreamEvent>,
  completeImpl: ChannelAgentHandle["complete"] | undefined,
  body: (session: RoutedSession, spy: Spy) => Promise<A>,
): Promise<A> => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((r) => (release = r));
  const spy: Spy = { chats: [], completes: [], releaseChat: () => release() };
  const handle: ChannelAgentHandle = {
    agentId: "a",
    dispose: async () => undefined,
    session: () => ({
      chat: async (t) => {
        spy.chats.push(t);
        await gate;
        return { message: "chat-reply" };
      },
      end: async () => undefined,
      runStream: () => events(stream),
    }),
    run: async () => ({ output: "x", agentId: "a", taskId: "t", metadata: { tokensUsed: 0, cost: 0 } }),
    complete:
      completeImpl ??
      (async (p) => {
        spy.completes.push({ messages: p.messages, budgetTokens: p.budgetTokens });
        return { message: "  On it, taking a look.  " };
      }),
  };
  const resolver = makeChannelAgentResolver({ agents: { a: () => ReactiveAgents.create() }, build: async () => handle });
  return Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const session = yield* resolver.open(req);
        return yield* Effect.promise(() => body(session, spy));
      }),
    ),
  );
};

describe("channel model ack ports", () => {
  test("narration before the first tool call is forwarded to onProgress", async () => {
    await withSession(
      [text("Checking "), text("the repo"), tool(), text("later text"), completed("final")],
      undefined,
      async (session) => {
        const seen: string[] = [];
        const reply = await Effect.runPromise(session.send(turn({ onProgress: (t) => seen.push(t) })));
        expect(seen).toEqual(["Checking the repo"]);
        expect(reply.text).toBe("final");
        expect(reply.tokens).toBe(7);
        expect(reply.costUsd).toBe(0.5);
      },
    );
  });

  test("without onProgress the turn takes the plain chat path", async () => {
    await withSession([completed("streamed")], undefined, async (session, spy) => {
      spy.releaseChat();
      const reply = await Effect.runPromise(session.send(turn()));
      expect(reply.text).toBe("chat-reply");
      expect(spy.chats).toEqual(["fix the bug"]);
    });
  });

  test("a final answer is not narration; a throwing onProgress never fails the turn", async () => {
    await withSession([text("just the answer"), completed("just the answer")], undefined, async (session) => {
      const seen: string[] = [];
      const reply = await Effect.runPromise(session.send(turn({ onProgress: (t) => seen.push(t) })));
      expect(seen).toEqual([]);
      expect(reply.text).toBe("just the answer");
    });
    const result = await drainWithNarration(events([text("hi"), tool(), completed("ok")]), () => {
      throw "boom";
    });
    expect(result.text).toBe("ok");
  });

  test("a stream error rejects the turn as turn_failed", async () => {
    await withSession([ev({ _tag: "StreamError", cause: "model down" })], undefined, async (session) => {
      const outcome = await Effect.runPromise(Effect.either(session.send(turn({ onProgress: () => undefined }))));
      expect(outcome._tag).toBe("Left");
      if (outcome._tag === "Left") expect(outcome.left.reason).toBe("turn_failed");
    });
  });

  test("acknowledge is a side completion: no history, no turn gate, trimmed, short budget", async () => {
    await withSession([completed("x")], undefined, async (session, spy) => {
      // A plain-chat turn is parked on its gate; acknowledge must still resolve.
      const running = Effect.runPromise(session.send(turn()));
      const ack = await Effect.runPromise(session.acknowledge!(turn()));
      expect(ack).toEqual({ text: "On it, taking a look." });
      expect(spy.chats).toEqual(["fix the bug"]); // acknowledge did not call session.chat
      expect(spy.completes).toHaveLength(1);
      expect(spy.completes[0]!.budgetTokens).toBeLessThanOrEqual(100);
      expect(spy.completes[0]!.messages).toEqual([{ role: "user", content: "fix the bug" }]);
      spy.releaseChat();
      expect((await running).text).toBe("chat-reply");
    });
  });

  test("acknowledge fails soft to empty text with an error reason", async () => {
    await withSession([completed("x")], () => Promise.reject("provider down"), async (session) => {
      expect(await Effect.runPromise(session.acknowledge!(turn()))).toEqual({ text: "", fallbackReason: "error" });
    });
  });

  test("a handle without complete offers no acknowledge port", async () => {
    const handle: ChannelAgentHandle = {
      agentId: "a",
      dispose: async () => undefined,
      session: () => ({ chat: async () => ({ message: "m" }), end: async () => undefined }),
      run: async () => ({ output: "x", agentId: "a", taskId: "t", metadata: { tokensUsed: 0, cost: 0 } }),
    };
    const resolver = makeChannelAgentResolver({ agents: { a: () => ReactiveAgents.create() }, build: async () => handle });
    const session = await Effect.runPromise(Effect.scoped(resolver.open(req)));
    expect(session.acknowledge).toBeUndefined();
  });

  test("a real agent's handle completes without touching session history", async () => {
    const agent = await ReactiveAgents.create()
      .withName("ack-real")
      .withProvider("test")
      .withTestScenario([{ text: "Starting now." }])
      .build();
    const handle = toChannelHandle(agent);
    const session = agent.session({ id: "ack-real-1", persist: false });
    const reply = await handle.complete!({
      systemPrompt: "one short sentence",
      messages: [{ role: "user", content: "hello" }],
      budgetTokens: 60,
    });
    expect(typeof reply.message).toBe("string");
    expect(session.history()).toEqual([]);
    await agent.dispose();
  });
});
