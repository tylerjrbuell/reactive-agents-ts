// Run: bun test packages/runtime/tests/chat-engine-initial-history.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../src/chat/engine.js";
import type { ChatMessage } from "../src/chat.js";

/**
 * A two-turn seed conversation (user asks, assistant answers), oldest first.
 */
function seedTurns(): ChatMessage[] {
  return [
    { role: "user", content: "what is rust?", timestamp: 1 },
    { role: "assistant", content: "a systems language", timestamp: 2 },
  ];
}

describe("ChatEngine initialHistory option (cortex chat overhaul Task 1)", () => {
  it("constructor seed: history() returns exactly that snapshot before any turn", () => {
    const engine = new ChatEngine(
      { complete: async () => ({ message: "unused" }) },
      {
        sessionId: "sess_session_seed",
        initialHistory: seedTurns(),
      },
    );
    expect(engine.history()).toEqual(seedTurns());
  });

  it("first turn(): the seeded turns ride ahead of the incoming message to `complete`", async () => {
    const seen: { role: string; content: string }[][] = [];
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => {
          seen.push(messages.map((m) => ({ role: m.role, content: m.content })));
          return { message: "echo" };
        },
      },
      {
        sessionId: "sess_session_seed2",
        initialHistory: seedTurns(),
      },
    );
    await engine.turn("and go?");
    expect(seen).toHaveLength(1);
    expect(seen[0]).toHaveLength(3);
    expect(seen[0]![0]!.content).toBe("what is rust?");
    expect(seen[0]![1]!.content).toBe("a systems language");
    expect(seen[0]![2]).toEqual({ role: "user", content: "and go?" });
  });

  it("non-empty initialHistory + wired loadHistory: loader NEVER called, seed stands", async () => {
    let loads = 0;
    const saves: ChatMessage[][] = [];
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => ({
          message: `echo:${messages[messages.length - 1]!.content}`,
        }),
        loadHistory: async () => {
          loads += 1;
          return [
            { role: "user" as const, content: "LOADED", timestamp: 0 },
          ];
        },
        saveHistory: async (_sessionId, messages) => {
          saves.push([...messages]);
        },
      },
      {
        sessionId: "sess_session_seed3",
        initialHistory: seedTurns(),
      },
    );
    await engine.turn("hi");
    expect(loads).toBe(0);
    // Seed is authoritative: no LOADED turn anywhere in state.
    expect(engine.history().map((m) => m.content)).toEqual([
      "what is rust?",
      "a systems language",
      "hi",
      "echo:hi",
    ]);
    // Persistence still runs on the full post-turn state (seed + new turn).
    expect(saves).toHaveLength(1);
    expect(saves[0]).toHaveLength(4);
  });

  it("empty-array initialHistory does NOT latch: loadHistory still resolves on first turn", async () => {
    let loads = 0;
    const engine = new ChatEngine(
      {
        complete: async ({ messages }) => ({
          message: `echo:${messages[messages.length - 1]!.content}`,
        }),
        loadHistory: async () => {
          loads += 1;
          return seedTurns();
        },
      },
      {
        sessionId: "sess_session_seed4",
        initialHistory: [],
      },
    );
    await engine.turn("one");
    expect(loads).toBe(1);
    // Loaded turns seeded exactly as the load-once path does.
    expect(engine.history().map((m) => m.content)).toEqual([
      "what is rust?",
      "a systems language",
      "one",
      "echo:one",
    ]);
  });
});
