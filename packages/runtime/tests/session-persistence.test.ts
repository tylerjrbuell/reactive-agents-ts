import { describe, test, expect } from "bun:test";
import { AgentSession, type ChatMessage, type ChatReply } from "../src/chat";

describe("AgentSession persistence", () => {
  test("session with onSave calls save on end()", async () => {
    let saved = false;
    const session = new AgentSession(
      async (_msg, _hist) => ({ message: "reply" } as ChatReply),
      undefined,
      async (_history) => { saved = true; },
    );
    await session.chat("hi");
    await session.end();
    expect(saved).toBe(true);
  });

  test("session with initialHistory starts with prior messages", async () => {
    const prior: ChatMessage[] = [
      { role: "user", content: "old msg", timestamp: 1 },
      { role: "assistant", content: "old reply", timestamp: 2 },
    ];
    const session = new AgentSession(
      async (_msg, _hist) => ({ message: "new reply" } as ChatReply),
      undefined,
      undefined,
      prior,
    );
    expect(session.history()).toHaveLength(2);
    expect(session.history()[0].content).toBe("old msg");
  });

  test("session without onSave does not throw on end()", async () => {
    const session = new AgentSession(
      async (_msg, _hist) => ({ message: "reply" } as ChatReply),
    );
    await session.chat("hi");
    await expect(session.end()).resolves.toBeUndefined();
  });

  test("onSave receives full conversation history", async () => {
    let savedHistory: ChatMessage[] = [];
    const session = new AgentSession(
      async (_msg, _hist) => ({ message: "reply" } as ChatReply),
      undefined,
      async (history) => { savedHistory = [...history]; },
    );
    await session.chat("hello");
    await session.chat("world");
    await session.end();
    expect(savedHistory).toHaveLength(4); // 2 user + 2 assistant
  });
});
