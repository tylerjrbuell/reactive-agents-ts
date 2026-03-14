import { describe, expect, it } from "bun:test";
import { ReactiveAgents } from "reactive-agents";

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
});
