// Run: bun test packages/runtime/tests/chat/engine-history.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ChatEngine, nextSessionId } from "../../src/chat/engine.js";
import type { ChatMessage } from "../../src/chat.js";
import type { AgentResult } from "../../src/builder/types.js";

/**
 * Minimal AgentResult-shaped stub for the tool path (no `any`/`as any`): carries
 * exactly the required `AgentResult` fields the reply assembly reads.
 */
function toolResult(output: string): AgentResult {
  return {
    output,
    success: true,
    taskId: "t1",
    agentId: "agent_test",
    metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0 },
  };
}

/** `count` short persisted turns, oldest first — the loader payload for window pins. */
function persistedTurns(count: number): ChatMessage[] {
  return Array.from({ length: count }, (_v, i): ChatMessage => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i}`,
    timestamp: i,
  }));
}

describe("ChatEngine history resolution (engine plan Task 3)", () => {
  it("nextSessionId: canonical sess_<scope>_<parts>_<12-char random> format", () => {
    const agentId = nextSessionId("agent", ["agent-1"]);
    expect(agentId).toMatch(/^sess_agent_agent-1-/);
    const gatewayId = nextSessionId("gateway", ["gw-agent", "sender@example"]);
    expect(gatewayId).toMatch(/^sess_gateway_/);
    // Unique suffix: exactly 12 characters, compressed randomUUID (no dashes).
    expect(agentId.slice(-12)).toHaveLength(12);
    expect(agentId.slice(-12)).not.toContain("-");
    // Two calls produce distinct ids.
    expect(nextSessionId("agent", ["agent-1"])).not.toBe(agentId);
  });

  it("first empty turn on a loader-less host: normal reply, no history block, no crash", async () => {
    const calls: { systemPrompt: string; messages: string[] }[] = [];
    const engine = new ChatEngine(
      {
        complete: async ({ messages, systemPrompt }) => {
          calls.push({ systemPrompt, messages: messages.map((m) => m.content) });
          return { message: `echo:${messages[messages.length - 1]!.content}` };
        },
      },
      { sessionId: "sess_agent_x" },
    );
    const reply = await engine.turn("hello");
    expect(reply.message).toBe("echo:hello");
    // No history block emitted on the first empty turn.
    expect(calls[0]!.systemPrompt).not.toContain("Conversation history");
    expect(calls[0]!.messages).toEqual(["hello"]);
  });

  it("load-once: loader called exactly once across two turns; loaded turns seed state", async () => {
    let loads = 0;
    const saveSizes: number[] = [];
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => ({
          message: `echo:${messages[messages.length - 1]!.content}`,
        }),
        loadHistory: async (_sessionId) => {
          loads += 1;
          return persistedTurns(2);
        },
        saveHistory: async (_sessionId, messages) => {
          saveSizes.push(messages.length);
        },
      },
      { sessionId: "sess_agent_load1" },
    );
    await engine.turn("one");
    await engine.turn("two");
    expect(loads).toBe(1);
    expect(engine.history()).toHaveLength(6); // 2 loaded + 2 recorded per turn
    expect(saveSizes).toEqual([4, 6]);
  });

  it("per-turn persistence: saveHistory after every turn; last call carries FULL 4-message state", async () => {
    const saveCalls: { sessionId: string; messages: ChatMessage[] }[] = [];
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => ({
          message: `echo:${messages[messages.length - 1]!.content}`,
        }),
        saveHistory: async (sessionId, messages) => {
          saveCalls.push({ sessionId, messages: [...messages] });
        },
      },
      { sessionId: "sess_agent_save" },
    );
    await engine.turn("one");
    await engine.turn("two");
    expect(saveCalls).toHaveLength(2);
    expect(saveCalls[1]!.sessionId).toBe("sess_agent_save");
    expect(saveCalls[1]!.messages).toHaveLength(4);
    expect(saveCalls[1]!.messages.map((m) => m.role)).toEqual([
      "user",
      "assistant",
      "user",
      "assistant",
    ]);
  });

  it("window caps: 45 loaded turns -> exactly last 40 handed to runTask; full state still recorded", async () => {
    const seen: ChatMessage[][] = [];
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        runTask: async (_input, opts) => {
          seen.push([...opts.history]);
          return toolResult("done");
        },
        loadHistory: async () => persistedTurns(45),
        saveHistory: async () => {},
      },
      { sessionId: "sess_agent_win" },
    );
    await engine.turn("ask", { useTools: true });
    // Default 40-turn window: last 40 of m0..m44 are handed over (short contents, no
    // char-cap effect), minus-dropped prefix silently discarded (no onOverflow).
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(40);
    expect(seen[0]![0]!.content).toBe("m5");
    expect(seen[0]![39]!.content).toBe("m44");
    // Recording and persistence run on the FULL unwindowed state: 45 + 2 turns.
    expect(engine.history()).toHaveLength(47);
  });

  it("onOverflow: dropped prefix spliced as ONE synthetic assistant summary turn", async () => {
    const seen: ChatMessage[][] = [];
    const handlerCalls: ChatMessage[][] = [];
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        runTask: async (_input, opts) => {
          seen.push([...opts.history]);
          return toolResult("done");
        },
        loadHistory: async () => persistedTurns(45),
      },
      {
        sessionId: "sess_agent_over",
        onOverflow: async (dropped) => {
          handlerCalls.push([...dropped]);
          return "2 old turns summary";
        },
      },
    );
    await engine.turn("ask", { useTools: true });
    // Handler received the 5 dropped turns (m0..m4), oldest-first.
    expect(handlerCalls).toHaveLength(1);
    expect(handlerCalls[0]).toHaveLength(5);
    expect(handlerCalls[0]![0]!.content).toBe("m0");
    // Splice: one synthetic assistant summary turn leads the windowed copy.
    const handed = seen[0]!;
    expect(handed).toHaveLength(41);
    expect(handed[0]!.role).toBe("assistant");
    expect(handed[0]!.content).toBe("Summary of earlier conversation: 2 old turns summary");
    expect(handed[41 - 1]!.content).toBe("m44");
  });

  it("rejecting onOverflow handler propagates from engine.turn (Review Focus #3)", async () => {
    let runTaskCalled = false;
    const engine = new ChatEngine(
      {
        complete: async () => ({ message: "unused" }),
        runTask: async () => {
          runTaskCalled = true;
          return toolResult("never");
        },
        loadHistory: async () => persistedTurns(45),
      },
      {
        sessionId: "sess_agent_reject",
        onOverflow: async () => {
          throw new Error("summarizer down");
        },
      },
    );
    const caught = await engine.turn("ask", { useTools: true }).then(
      (reply) => reply,
      (err: unknown) => err,
    );
    expect(caught).toBeInstanceOf(Error);
    expect(caught instanceof Error && caught.message).toBe("summarizer down");
    // The path call never ran — the summarizer failure surfaced first.
    expect(runTaskCalled).toBe(false);
  });

  it("load-latch: loader rejection leaves latch unset so a retry reloads (#3)", async () => {
    let loads = 0;
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => ({
          message: `echo:${messages[messages.length - 1]!.content}`,
        }),
        loadHistory: async () => {
          loads += 1;
          if (loads === 1) throw new Error("load failed");
          return persistedTurns(2);
        },
      },
      { sessionId: "sess_agent_latch" },
    );
    // First turn: loader rejects, propagates.
    let caught: unknown;
    try {
      await engine.turn("one");
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof Error && (caught as Error).message).toBe("load failed");
    // Second turn: latch was not set, so loader runs again and succeeds.
    const reply = await engine.turn("two");
    expect(reply.message).toBe("echo:two");
    expect(loads).toBe(2);
  });
});
