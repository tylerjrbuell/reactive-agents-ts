import { describe, test, expect } from "bun:test";
import {
  applyHistoryWindow,
  applyHistoryWindowWithOverflow,
  formatHistoryBlock,
  formatEpisodicContext,
  buildEnrichedInstruction,
  channelOutboundToolGuidance,
} from "../src/gateway-context-formatting.js";
import type { ChatMessage } from "../src/chat.js";

const msg = (role: "user" | "assistant", content: string, timestamp = 0): ChatMessage =>
  ({ role, content, timestamp });

describe("applyHistoryWindow", () => {
  test("returns full history when under limits", () => {
    const history = [msg("user", "hello"), msg("assistant", "hi")];
    expect(applyHistoryWindow(history)).toEqual(history);
  });

  test("truncates to last 40 turns", () => {
    const history = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`),
    );
    expect(applyHistoryWindow(history)).toHaveLength(40);
    expect(applyHistoryWindow(history)[0]!.content).toBe("msg 10");
  });

  test("truncates when total chars exceed 8000", () => {
    const history = Array.from({ length: 10 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", "x".repeat(1000)),
    );
    const windowed = applyHistoryWindow(history);
    const totalChars = windowed.reduce((sum, m) => sum + m.content.length, 0);
    expect(totalChars).toBeLessThanOrEqual(8000);
  });

  test("never drops below empty when all messages exceed budget", () => {
    const history = [msg("user", "x".repeat(9000))];
    const windowed = applyHistoryWindow(history);
    expect(windowed).toHaveLength(0);
  });
});

describe("applyHistoryWindowWithOverflow", () => {
  test("no onOverflow, no overflow: identical to applyHistoryWindow (regression)", async () => {
    const history = [msg("user", "hello"), msg("assistant", "hi")];
    const result = await applyHistoryWindowWithOverflow(history);
    expect(result).toEqual(applyHistoryWindow(history));
    expect(result).toEqual(history);
  });

  test("no onOverflow, overflow occurs: pure drop, identical to applyHistoryWindow (regression)", async () => {
    const history = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`),
    );
    const result = await applyHistoryWindowWithOverflow(history);
    expect(result).toEqual(applyHistoryWindow(history));
    expect(result).toHaveLength(40);
    expect(result[0]!.content).toBe("msg 10");
  });

  test("onOverflow provided but nothing overflows: handler never called, output unchanged", async () => {
    const history = [msg("user", "hello"), msg("assistant", "hi")];
    let calls = 0;
    const onOverflow = async (_dropped: readonly ChatMessage[]) => {
      calls++;
      return "should not be called";
    };
    const result = await applyHistoryWindowWithOverflow(history, onOverflow);
    expect(calls).toBe(0);
    expect(result).toEqual(history);
  });

  test("onOverflow provided and turns overflow: called with exactly the dropped turns, summary spliced in as leading turn", async () => {
    const history = Array.from({ length: 50 }, (_, i) =>
      msg(i % 2 === 0 ? "user" : "assistant", `msg ${i}`, i),
    );
    let receivedDropped: readonly ChatMessage[] | undefined;
    const onOverflow = async (dropped: readonly ChatMessage[]) => {
      receivedDropped = dropped;
      return "the story so far";
    };
    const result = await applyHistoryWindowWithOverflow(history, onOverflow);

    // Handler received exactly the dropped prefix (the first 10 turns, msg 0..9)
    expect(receivedDropped).toHaveLength(10);
    expect(receivedDropped![0]!.content).toBe("msg 0");
    expect(receivedDropped![9]!.content).toBe("msg 9");

    // Result: 1 synthetic summary turn + the 40 non-overflowed turns, untouched
    expect(result).toHaveLength(41);
    expect(result[0]!.role).toBe("assistant");
    expect(result[0]!.content).toBe("Summary of earlier conversation: the story so far");
    expect(result[1]!.content).toBe("msg 10");
    expect(result[result.length - 1]!.content).toBe("msg 49");
    // Non-overflowed turns are the exact same objects (untouched)
    expect(result.slice(1)).toEqual(applyHistoryWindow(history));
  });
});

describe("formatHistoryBlock", () => {
  test("returns empty string for empty history", () => {
    expect(formatHistoryBlock([])).toBe("");
  });

  test("formats user and assistant turns with correct labels", () => {
    const history = [
      msg("user", "what are my PRs?"),
      msg("assistant", "You have 3 open PRs."),
    ];
    const block = formatHistoryBlock(history);
    expect(block).toContain("--- Conversation history ---");
    expect(block).toContain("User: what are my PRs?");
    expect(block).toContain("Assistant: You have 3 open PRs.");
  });
});

describe("formatEpisodicContext", () => {
  test("returns empty string for empty episodes", () => {
    expect(formatEpisodicContext([])).toBe("");
  });

  test("formats episodes with event type prefix", () => {
    const episodes = [
      { eventType: "task-completed", content: "Morning brief sent at 09:00." },
      { eventType: "chat-turn", content: "User asked about PRs." },
    ];
    const block = formatEpisodicContext(episodes);
    expect(block).toContain("--- Recent gateway activity ---");
    expect(block).toContain("[task-completed] Morning brief sent at 09:00.");
    expect(block).toContain("[chat-turn] User asked about PRs.");
  });

  test("truncates long content to 300 chars", () => {
    const episodes = [{ eventType: "task-completed", content: "x".repeat(400) }];
    const block = formatEpisodicContext(episodes);
    expect(block).toContain("[task-completed] " + "x".repeat(300));
    expect(block).not.toContain("x".repeat(301));
  });
});

describe("channelOutboundToolGuidance", () => {
  test("uses MCP prefix and sender without naming a vendor tool", () => {
    const g = channelOutboundToolGuidance({ mcpServer: "acme-chat", sender: "user-42" });
    expect(g).toContain("acme-chat/");
    expect(g).toContain("user-42");
    expect(g).toContain("outbound message");
    expect(g).not.toContain("send_message_to_user");
    expect(g).not.toContain("telegram");
  });

  test("falls back when mcpServer is blank", () => {
    const g = channelOutboundToolGuidance({ mcpServer: "  ", sender: "x" });
    expect(g).toContain("messaging/");
  });
});

describe("buildEnrichedInstruction", () => {
  test("includes all blocks when all are provided", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+15551234567",
      platform: "signal",
      mcpServer: "signal",
      message: "what did you find?",
      historyBlock: "--- Conversation history ---\nUser: hi",
      episodicBlock: "--- Recent gateway activity ---\n[task-completed] done",
    });
    expect(instruction).toContain("--- Recent gateway activity ---");
    expect(instruction).toContain("--- Conversation history ---");
    expect(instruction).toContain("signal/");
    expect(instruction).toContain("outbound message");
    expect(instruction).toContain("User: what did you find?");
    expect(instruction).toContain("+15551234567");
  });

  test("omits empty blocks gracefully", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+15551234567",
      platform: "signal",
      mcpServer: "signal",
      message: "hello",
      historyBlock: "",
      episodicBlock: "",
    });
    expect(instruction).not.toContain("Conversation history");
    expect(instruction).not.toContain("Recent gateway activity");
    expect(instruction).toContain("User: hello");
  });

  test("includes long-run nudge", () => {
    const instruction = buildEnrichedInstruction({
      sender: "+1555",
      platform: "signal",
      mcpServer: "signal",
      message: "do something",
      historyBlock: "",
      episodicBlock: "",
    });
    expect(instruction).toContain("multiple steps");
    expect(instruction).toContain("signal/");
  });
});

import { GatewayChatManager } from "../src/gateway-context-formatting.js";

// ─── Stub deps ────────────────────────────────────────────────────────────────

function makeStubDeps(overrides: Partial<{
  findById: (id: string) => Promise<{ messages: { role: "user" | "assistant"; content: string; timestamp: number }[] } | null>;
  executeEvent: (event: unknown, source: string, instruction: string) => Promise<string | undefined>;
  logEpisode: (entry: unknown) => Promise<void>;
  saveSession: (input: unknown) => Promise<void>;
  getRecentEpisodes: (agentId: string, limit: number) => Promise<{ eventType?: string; content?: string }[]>;
  cleanup: (ttlDays: number) => Promise<number>;
}> = {}) {
  const calls: { method: string; args: unknown[] }[] = [];
  return {
    calls,
    deps: {
      agentId: "test-agent",
      sessionTtlDays: 30,
      executeEvent: overrides.executeEvent ?? (async (_e: unknown, s: string, i: string) => { calls.push({ method: "executeEvent", args: [s, i] }); return undefined; }),
      logEpisode: overrides.logEpisode ?? (async (entry: unknown) => { calls.push({ method: "logEpisode", args: [entry] }); }),
      saveSession: overrides.saveSession ?? (async (input: unknown) => { calls.push({ method: "saveSession", args: [input] }); }),
      findById: overrides.findById ?? (async (_id: string) => null),
      getRecentEpisodes: overrides.getRecentEpisodes ?? (async (_agentId: string, _limit: number) => []),
      cleanup: overrides.cleanup ?? (async (_ttlDays: number) => 0),
    },
  };
}

describe("GatewayChatManager", () => {
  test("getOrLoadHistory returns empty array when no prior session exists", async () => {
    const { deps } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    const history = await mgr.getOrLoadHistory("+15551234567");
    expect(history).toEqual([]);
  });

  test("getOrLoadHistory restores history from store on first call", async () => {
    const storedMessages = [
      { role: "user" as const, content: "hello", timestamp: 1000 },
      { role: "assistant" as const, content: "hi", timestamp: 1001 },
    ];
    const { deps } = makeStubDeps({
      findById: async (_id: string) => ({ messages: storedMessages }),
    });
    const mgr = new GatewayChatManager(deps);
    const history = await mgr.getOrLoadHistory("+15551234567");
    expect(history).toEqual(storedMessages);
  });

  test("getOrLoadHistory caches after first load (no second store call)", async () => {
    let callCount = 0;
    const { deps } = makeStubDeps({
      findById: async (_id: string) => { callCount++; return null; },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.getOrLoadHistory("+155");
    await mgr.getOrLoadHistory("+155");
    expect(callCount).toBe(1);
  });

  test("handleMessage appends user+assistant turns to history", async () => {
    const { deps } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "what's up?", "signal", "signal", {});
    const history = await mgr.getOrLoadHistory("+155");
    expect(history.length).toBe(2);
    expect(history[0]!.role).toBe("user");
    expect(history[0]!.content).toBe("what's up?");
    expect(history[1]!.role).toBe("assistant");
  });

  test("handleMessage calls executeEvent with enriched instruction containing sender info", async () => {
    const { deps, calls } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+15551234567", "hello", "signal", "signal", {});
    const execCall = calls.find((c) => c.method === "executeEvent");
    expect(execCall).toBeDefined();
    const instruction = execCall!.args[1] as string;
    expect(instruction).toContain("+15551234567");
    expect(instruction).toContain("signal");
    expect(instruction).toContain("User: hello");
  });

  test("handleMessage calls logEpisode with chat-turn eventType", async () => {
    const { deps, calls } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "test msg", "signal", "signal", {});
    const logCall = calls.find((c) => c.method === "logEpisode");
    expect(logCall).toBeDefined();
    const entry = logCall!.args[0] as { eventType: string; content: string };
    expect(entry.eventType).toBe("chat-turn");
    expect(entry.content).toContain("+155");
    expect(entry.content).toContain("test msg");
  });

  test("handleMessage persists updated history after each turn", async () => {
    const { deps, calls } = makeStubDeps();
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "first", "signal", "signal", {});
    await mgr.handleMessage("+155", "second", "signal", "signal", {});
    const saveCalls = calls.filter((c) => c.method === "saveSession");
    expect(saveCalls.length).toBe(2);
  });

  test("pruneStaleSessions calls cleanup with sessionTtlDays", async () => {
    const cleanupCalls: number[] = [];
    const { deps } = makeStubDeps({
      cleanup: async (ttl: number) => { cleanupCalls.push(ttl); return 0; },
    });
    const mgr = new GatewayChatManager(deps);
    // Force lastPruneAt to be old enough to allow pruning
    (mgr as any).lastPruneAt = 0;
    await mgr.pruneStaleSessions();
    expect(cleanupCalls).toContain(30);
  });

  test("handleMessage excludes chat-turn episodes from the enriched instruction", async () => {
    const { deps, calls } = makeStubDeps({
      getRecentEpisodes: async () => [
        { eventType: "chat-turn", content: "this should be hidden" },
        { eventType: "task-completed", content: "morning brief sent" },
      ],
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "hello", "signal", "signal", {});
    const execCall = calls.find((c) => c.method === "executeEvent");
    const instruction = execCall!.args[1] as string;
    expect(instruction).not.toContain("this should be hidden");
    expect(instruction).toContain("morning brief sent");
  });

  test("handleMessage catches executeEvent errors and still persists history and logs episode", async () => {
    const { deps, calls } = makeStubDeps({
      executeEvent: async () => { throw new Error("Signal unavailable"); },
    });
    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "test error path", "signal", "signal", {});

    const history = await mgr.getOrLoadHistory("+155");
    expect(history.length).toBe(2);
    expect(history[1]!.content).toContain("error");

    expect(calls.some((c) => c.method === "saveSession")).toBe(true);
    expect(calls.some((c) => c.method === "logEpisode")).toBe(true);
  });

  test("pruneStaleSessions is a no-op when called twice within 24h", async () => {
    const cleanupCalls: number[] = [];
    const { deps } = makeStubDeps({
      cleanup: async (ttl: number) => { cleanupCalls.push(ttl); return 0; },
    });
    const mgr = new GatewayChatManager(deps);
    (mgr as any).lastPruneAt = 0;
    await mgr.pruneStaleSessions();
    await mgr.pruneStaleSessions();
    expect(cleanupCalls.length).toBe(1);
  });
});
