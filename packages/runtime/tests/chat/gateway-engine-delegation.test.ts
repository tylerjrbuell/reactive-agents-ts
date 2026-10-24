import { describe, test, expect } from "bun:test";
import {
  GatewayChatManager,
  buildEnrichedInstruction,
} from "../../src/gateway-context-formatting.js";
import type { ChatMessage } from "../../src/chat.js";

const GOLDEN_INSTRUCTION = `--- Recent gateway activity ---
[task-completed] done

--- Conversation history ---
User: hi

You are in a live conversation with +15551234567 on signal.

User: what did you find?

You MUST deliver your reply on this channel by calling a tool that sends an outbound message. Choose a tool whose name starts with "signal/" and whose documented purpose is to send, post, DM, or reply to a user or chat. Pass "+15551234567" as the argument value that identifies this conversation partner (recipient, chat id, user id, peer, thread, etc. — use the parameter name required by that tool). Do not end your turn without such a tool call. If you need multiple steps, call it first with a brief acknowledgement, then again with your final answer.`;

function makeStubDeps(overrides: Partial<{
  agentId: string;
  findById: (id: string) => Promise<{ messages: ChatMessage[] } | null>;
  executeEvent: (event: unknown, source: string, instruction: string) => Promise<string | undefined>;
  logEpisode: (entry: unknown) => Promise<void>;
  saveSession: (input: { sessionId: string; agentId: string; messages: ChatMessage[] }) => Promise<void>;
  getRecentEpisodes: (agentId: string, limit: number) => Promise<{ eventType?: string; content?: string }[]>;
  cleanup: (ttlDays: number) => Promise<number>;
  publishTurn: (turn: { sessionId: string; [k: string]: unknown }) => Promise<void>;
}> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    deps: {
      agentId: overrides.agentId ?? "test-agent",
      sessionTtlDays: 30,
      executeEvent: overrides.executeEvent ?? (async (_e: unknown, s: string, i: string) => { calls.push({ method: "executeEvent", args: [s, i] }); return undefined; }),
      logEpisode: overrides.logEpisode ?? (async (entry: unknown) => { calls.push({ method: "logEpisode", args: [entry] }); }),
      saveSession: overrides.saveSession ?? (async (input: unknown) => { calls.push({ method: "saveSession", args: [input] }); }),
      findById: overrides.findById ?? (async (_id: string) => null),
      getRecentEpisodes: overrides.getRecentEpisodes ?? (async (_agentId: string, _limit: number) => []),
      cleanup: overrides.cleanup ?? (async (_ttlDays: number) => 0),
      publishTurn: overrides.publishTurn,
    },
  };
}

describe("gateway engine delegation golden pin", () => {
  test("buildEnrichedInstruction golden", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+15551234567",
      platform: "signal",
      mcpServer: "signal",
      message: "what did you find?",
      historyBlock: "--- Conversation history ---\nUser: hi",
      episodicBlock: "--- Recent gateway activity ---\n[task-completed] done",
    });
    expect(instruction).toBe(GOLDEN_INSTRUCTION);
  });
});

describe("gateway engine delegation red pins", () => {
  test("legacy key resolves turns", async () => {
    const stored: ChatMessage[] = [
      { role: "user", content: "old user", timestamp: 1 },
      { role: "assistant", content: "old assistant", timestamp: 2 },
    ];
    const instructions: string[] = [];
    const { deps } = makeStubDeps({
      findById: async (id: string) =>
        id === "gateway-chat-test-agent-sender" ? { messages: stored } : null,
      executeEvent: async (_e: unknown, _s: string, instruction: string) => {
        instructions.push(instruction);
        return "Done.";
      },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("sender", "new msg", "signal", "signal", {});
    expect(instructions).toHaveLength(1);
    expect(instructions[0]).toContain("old user");
    expect(instructions[0]).toContain("old assistant");
  });

  test("new save writes canonical sessionId", async () => {
    const saves: { sessionId: string }[] = [];
    const { deps } = makeStubDeps({
      saveSession: async (input) => { saves.push(input); },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("sender", "hi", "signal", "signal", {});
    expect(saves).toHaveLength(1);
    expect(saves[0]!.sessionId).toMatch(/^sess_gateway_/);
    expect(saves[0]!.sessionId).toContain("test-agent");
    expect(saves[0]!.sessionId).toContain("sender");
  });

  test("ChatTurn publish uses canonical id", async () => {
    const published: { sessionId: string }[] = [];
    const { deps } = makeStubDeps({
      publishTurn: async (turn) => { published.push(turn as { sessionId: string }); },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("sender", "hi", "signal", "signal", {});
    expect(published).toHaveLength(2);
    expect(published[0]!.sessionId).toMatch(/^sess_gateway_/);
    expect(published[0]!.sessionId).toBe(published[1]!.sessionId);
  });

  test("raw user message recorded", async () => {
    const saves: { messages: ChatMessage[] }[] = [];
    const { deps } = makeStubDeps({
      saveSession: async (input) => { saves.push(input); },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("sender", "raw hello", "signal", "signal", {});
    const msgs = saves[0]!.messages;
    expect(msgs.some((m) => m.role === "user" && m.content === "raw hello")).toBe(true);
    expect(msgs.some((m) => m.content.includes("You MUST deliver"))).toBe(false);
  });

  test("episodic block + outbound guidance present", async () => {
    const instructions: string[] = [];
    const { deps } = makeStubDeps({
      getRecentEpisodes: async () => [{ eventType: "task-completed", content: "morning brief sent" }],
      executeEvent: async (_e: unknown, _s: string, instruction: string) => {
        instructions.push(instruction);
        return "Done.";
      },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("sender", "hello", "signal", "signal", {});
    const instr = instructions[0]!;
    expect(instr).toContain("morning brief sent");
    expect(instr).toContain("signal/");
    expect(instr).toContain("outbound message");
  });
});