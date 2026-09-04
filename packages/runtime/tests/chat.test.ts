import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "../src/index.js";
import type { AgentEvent } from "@reactive-agents/core";

describe("agent.chat()", () => {
  it("chat() method exists on ReactiveAgent", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-shape-test")
      .withProvider("test")
      .build();
    expect(typeof agent.chat).toBe("function");
    await agent.dispose();
  });

  it("session() method exists on ReactiveAgent", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-shape-test")
      .withProvider("test")
      .build();
    expect(typeof agent.session).toBe("function");
    await agent.dispose();
  });

  it("chat() returns a ChatReply with a message string", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-reply-test")
      .withTestScenario([{ text: "FINAL ANSWER: 4" }])
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const reply = await agent.chat("What is 2 + 2?");
    expect(typeof reply.message).toBe("string");
    expect(reply.message.length).toBeGreaterThan(0);
    await agent.dispose();
  });

  it("session() returns an object with chat() and end() methods", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-struct-test")
      .withProvider("test")
      .build();

    const session = agent.session();
    expect(typeof session.chat).toBe("function");
    expect(typeof session.end).toBe("function");
    expect(typeof session.history).toBe("function");
    await agent.dispose();
  });

  it("session.chat() returns a ChatReply", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-chat-test")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const session = agent.session();
    const reply = await session.chat("Hello");
    expect(typeof reply.message).toBe("string");

    const history = session.history();
    expect(history.length).toBe(2); // user + assistant
    await session.end();
    await agent.dispose();
  });

  it("session preserves history across turns for multi-turn context", async () => {
    const agent = await ReactiveAgents.create()
      .withName("multi-turn-test")
      .withProvider("test")
      .withReasoning({ defaultStrategy: "reactive" })
      .build();

    const session = agent.session();
    await session.chat("Turn 1");
    await session.chat("Turn 2");

    const history = session.history();
    expect(history.length).toBe(4); // 2 user + 2 assistant
    expect(history[0].role).toBe("user");
    expect(history[1].role).toBe("assistant");
    await session.end();
    // history cleared after end
    expect(session.history().length).toBe(0);
    await agent.dispose();
  });

  it("emits ChatTurn events for user and assistant turns", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-turn-events")
      .withTestScenario([{ text: "Hello back!" }])
      .build();

    const events: AgentEvent[] = [];
    const unsubscribe = await agent.subscribe((event) => {
      events.push(event);
    });

    await agent.chat("Hello");

    unsubscribe();
    await agent.dispose();

    const chatTurnEvents = events.filter((event) => event._tag === "ChatTurn");
    expect(chatTurnEvents).toHaveLength(2);
    expect(chatTurnEvents[0]?._tag).toBe("ChatTurn");
    expect(chatTurnEvents[1]?._tag).toBe("ChatTurn");
  });

  it("emits direct-llm ChatTurn events with assistant tokensUsed", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-turn-direct-fields")
      .withTestScenario([{ text: "direct reply", usage: { totalTokens: 123 } as any } as any])
      .build();

    const events: AgentEvent[] = [];
    const unsubscribe = await agent.subscribe((event) => {
      events.push(event);
    });

    await agent.chat("Hello direct");

    unsubscribe();
    await agent.dispose();

    const chatTurnEvents = events.filter(
      (event): event is Extract<AgentEvent, { _tag: "ChatTurn" }> => event._tag === "ChatTurn",
    );
    expect(chatTurnEvents).toHaveLength(2);
    expect(chatTurnEvents[0]?.routedVia).toBe("direct-llm");
    expect(chatTurnEvents[0]?.role).toBe("user");
    expect(chatTurnEvents[1]?.routedVia).toBe("direct-llm");
    expect(chatTurnEvents[1]?.role).toBe("assistant");
    expect(typeof chatTurnEvents[1]?.tokensUsed).toBe("number");
    expect((chatTurnEvents[1]?.tokensUsed ?? 0) > 0).toBe(true);
  });

  describe("AgentSession onOverflow", () => {
    const msg = (role: "user" | "assistant", content: string, timestamp = 0) =>
      ({ role, content, timestamp }) as import("../src/chat.js").ChatMessage;

    it("no onOverflow: chatFn receives the raw, unwindowed history (regression)", async () => {
      const { AgentSession } = await import("../src/chat.js");
      let receivedRef: unknown;
      let receivedLengthAtCallTime = -1;
      const seedHistory = Array.from({ length: 50 }, (_, i) =>
        msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`, i),
      );
      const session = new AgentSession(
        async (_message, history) => {
          receivedRef = history;
          receivedLengthAtCallTime = history.length;
          return { message: "reply" };
        },
        undefined,
        undefined,
        seedHistory,
        undefined,
        undefined,
      );

      await session.chat("hi");
      // Unset onOverflow: chatFn sees the exact same (unwindowed) history array
      // reference internal to the session (same identity as this._history — asserted
      // via the shared-mutation side effect below), 50 turns at call time.
      expect(receivedLengthAtCallTime).toBe(50);
      expect((receivedRef as unknown[]).length).toBe(52); // same reference, mutated by later push
    });

    it("onOverflow provided, overflow occurs: handler called with exactly the dropped turns, summary appears as a leading turn in chatFn's history", async () => {
      const { AgentSession } = await import("../src/chat.js");
      const seedHistory = Array.from({ length: 50 }, (_, i) =>
        msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`, i),
      );
      let receivedDropped: readonly { content: string }[] | undefined;
      const onOverflow = async (dropped: readonly { content: string }[]) => {
        receivedDropped = dropped;
        return "condensed summary";
      };
      const received: unknown[] = [];
      const session = new AgentSession(
        async (_message, history) => {
          received.push(history);
          return { message: "reply" };
        },
        undefined,
        undefined,
        seedHistory,
        undefined,
        onOverflow,
      );

      await session.chat("hi");

      expect(receivedDropped).toHaveLength(10);
      expect(receivedDropped![0]!.content).toBe("msg 0");

      const historySeenByChatFn = received[0] as { role: string; content: string }[];
      expect(historySeenByChatFn).toHaveLength(41);
      expect(historySeenByChatFn[0]!.content).toBe("Summary of earlier conversation: condensed summary");
      expect(historySeenByChatFn[1]!.content).toBe("msg 10");

      // Full accumulated history is NOT truncated — only the copy handed to chatFn is windowed.
      expect(session.history().length).toBe(52); // 50 seeded + user + assistant turn just added
    });

    it("onOverflow provided but no overflow occurs: handler is never called", async () => {
      const { AgentSession } = await import("../src/chat.js");
      const seedHistory = [msg("user", "hello"), msg("assistant", "hi")];
      let calls = 0;
      const onOverflow = async (_dropped: readonly { content: string }[]) => {
        calls++;
        return "should not run";
      };
      const received: unknown[] = [];
      const session = new AgentSession(
        async (_message, history) => {
          received.push(history);
          return { message: "reply" };
        },
        undefined,
        undefined,
        seedHistory,
        undefined,
        onOverflow,
      );

      await session.chat("hi");

      expect(calls).toBe(0);
      expect(received[0]).toEqual(seedHistory);
    });
  });

  describe("directChat extraContext", () => {
    it("prepends extraContext to system prompt when provided", async () => {
      const { directChat } = await import("../src/chat.js");
      const { TestLLMServiceLayer } = await import("@reactive-agents/llm-provider");
      const { Effect } = await import("effect");

      const layer = TestLLMServiceLayer([
        { match: "gateway-activity-marker", text: "seen the extra context" },
      ]);

      const reply = await Effect.runPromise(
        directChat(
          "hello",
          [],
          "base context",
          "--- Recent gateway activity ---\ngateway-activity-marker",
        ).pipe(Effect.provide(layer)),
      );
      expect(reply.message).toBe("seen the extra context");
    });

    it("works normally when extraContext is undefined", async () => {
      const { directChat } = await import("../src/chat.js");
      const { TestLLMServiceLayer } = await import("@reactive-agents/llm-provider");
      const { Effect } = await import("effect");

      const layer = TestLLMServiceLayer([
        { match: "hello", text: "hi there" },
      ]);

      const reply = await Effect.runPromise(
        directChat("hello", [], "", undefined).pipe(Effect.provide(layer)),
      );
      expect(reply.message).toBe("hi there");
    });
  });
});
