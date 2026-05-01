import { describe, test, expect } from "bun:test";
import {
  applyHistoryWindow,
  formatHistoryBlock,
  formatEpisodicContext,
  buildEnrichedInstruction,
} from "../src/gateway-chat.js";
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
    expect(instruction).toContain("send_message_to_user");
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
    expect(instruction).toContain("send_message_to_user");
  });
});
