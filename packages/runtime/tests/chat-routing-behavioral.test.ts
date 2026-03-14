/**
 * Behavioral tests for agent.chat() routing logic.
 *
 * The routing heuristic in requiresTools() is a keyword-based classifier —
 * NOT an AI decision. These tests verify the heuristic's observable behavior:
 * which inputs hit the "direct LLM" path vs the "tool-capable" path, and
 * what the ChatReply shape looks like in each case.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { requiresTools } from "../src/chat.js";

// ─── Helper: minimal tool definition ─────────────────────────────────────────

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

function makeToolHandler(name: string) {
  return (args: Record<string, unknown>) =>
    Effect.succeed(`${name} result: ${args.input}`);
}

// ─── Unit tests for requiresTools() heuristic ────────────────────────────────

describe("requiresTools() heuristic", () => {
  it("returns false for simple conversational questions", () => {
    expect(requiresTools("What is 2 + 2?")).toBe(false);
    expect(requiresTools("Tell me a joke")).toBe(false);
    expect(requiresTools("How are you?")).toBe(false);
    expect(requiresTools("What does REST mean?")).toBe(false);
  });

  it("returns true for 'search for' imperative", () => {
    expect(requiresTools("Search for the latest news on AI")).toBe(true);
    expect(requiresTools("search for restaurants nearby")).toBe(true);
  });

  it("returns true for 'fetch' and 'look up' imperatives", () => {
    expect(requiresTools("fetch the current weather")).toBe(true);
    expect(requiresTools("look up the price of AAPL")).toBe(true);
  });

  it("returns true for 'create a' and 'write to' imperatives", () => {
    expect(requiresTools("create a new file called notes.txt")).toBe(true);
    expect(requiresTools("write to the database")).toBe(true);
  });

  it("returns false for override patterns even with tool words present", () => {
    // "tell me about" and "what did you" are CHAT_OVERRIDE_PATTERNS — take priority
    expect(requiresTools("tell me about the search results")).toBe(false);
    expect(requiresTools("what did you search for earlier?")).toBe(false);
    expect(requiresTools("summarize what you found")).toBe(false);
    expect(requiresTools("explain what the fetch returned")).toBe(false);
  });

  it("returns false for past-tense / reflective messages", () => {
    expect(requiresTools("in the last run, what happened?")).toBe(false);
    expect(requiresTools("what did you do earlier?")).toBe(false);
  });
});

// ─── Integration tests: agent.chat() reply shape ─────────────────────────────

describe("agent.chat() reply shape", () => {
  it("returns a ChatReply with a non-empty message string on direct path", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-shape-direct")
      .withTestScenario([{ text: "Hello from the test LLM" }])
      .build();

    let reply;
    try {
      reply = await agent.chat("How are you today?");
    } finally {
      await agent.dispose();
    }

    expect(typeof reply.message).toBe("string");
    expect(reply.message.length).toBeGreaterThan(0);
  });

  it("direct path does NOT populate toolsUsed or steps", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-direct-no-tools-used")
      .withTestScenario([{ text: "Sure, happy to help!" }])
      .build();

    let reply;
    try {
      // Conversational question — will hit direct LLM path
      reply = await agent.chat("What does TypeScript do?");
    } finally {
      await agent.dispose();
    }

    // Direct path returns no toolsUsed / steps metadata
    expect(reply.toolsUsed).toBeUndefined();
    expect(reply.steps).toBeUndefined();
  });
});

// ─── Integration tests: session history ──────────────────────────────────────

describe("session.history() accumulates turns", () => {
  it("history is empty before first chat turn", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-empty-history")
      .withTestScenario([{ text: "OK" }])
      .build();

    try {
      const session = agent.session();
      expect(session.history().length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("each turn adds user + assistant messages to history", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-history-turns")
      .withTestScenario([{ text: "Got it" }])
      .build();

    try {
      const session = agent.session();

      await session.chat("First message");
      expect(session.history().length).toBe(2); // user + assistant

      await session.chat("Second message");
      expect(session.history().length).toBe(4); // 2 more

      const history = session.history();
      expect(history[0].role).toBe("user");
      expect(history[0].content).toBe("First message");
      expect(history[1].role).toBe("assistant");
      expect(history[2].role).toBe("user");
      expect(history[2].content).toBe("Second message");
      expect(history[3].role).toBe("assistant");

      await session.end();
    } finally {
      await agent.dispose();
    }
  });

  it("session.end() clears history", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-end-clears")
      .withTestScenario([{ text: "OK" }])
      .build();

    try {
      const session = agent.session();
      await session.chat("Hello");
      expect(session.history().length).toBe(2);
      await session.end();
      expect(session.history().length).toBe(0);
    } finally {
      await agent.dispose();
    }
  });

  it("history() returns a copy — mutations do not affect internal state", async () => {
    const agent = await ReactiveAgents.create()
      .withName("session-history-copy")
      .withTestScenario([{ text: "Noted" }])
      .build();

    try {
      const session = agent.session();
      await session.chat("Hello");

      const snap1 = session.history();
      snap1.push({ role: "user", content: "injected", timestamp: 0 });

      // Internal state should still be 2 (not 3)
      expect(session.history().length).toBe(2);
    } finally {
      await agent.dispose();
    }
  });
});

// ─── Integration test: useTools override ─────────────────────────────────────

describe("ChatOptions.useTools override", () => {
  it("useTools: false forces direct path even for tool-intent phrasing", async () => {
    const agent = await ReactiveAgents.create()
      .withName("chat-override-direct")
      .withTestScenario([{ text: "Forced direct reply" }])
      .withTools({
        tools: [
          { definition: makeToolDef("noop"), handler: makeToolHandler("noop") },
        ],
      })
      .build();

    let reply;
    try {
      // "search for" would normally trigger tool path, but useTools:false forces direct
      reply = await agent.chat("search for something", { useTools: false });
    } finally {
      await agent.dispose();
    }

    expect(typeof reply.message).toBe("string");
    expect(reply.message.length).toBeGreaterThan(0);
    // Direct path never sets toolsUsed
    expect(reply.toolsUsed).toBeUndefined();
  });
});
