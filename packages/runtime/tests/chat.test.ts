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
});
