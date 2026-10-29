// Run: bun test packages/runtime/tests/chat-history-shaped-reply.test.ts --timeout 15000
import { describe, it, expect } from "bun:test";
import { ChatEngine } from "../src/chat/engine.js";
import { formatHistoryBlock } from "../src/gateway-context-formatting.js";
import { withHistoryBlock } from "../src/reactive-agent.js";
import { healShapedAssistantTurns } from "../src/chat/history-hygiene.js";
import type { ChatMessage } from "../src/chat.js";

const SHAPED = '{"name":"web-search","arguments":{"query":"x"}}';

describe("shaped assistant replies never poison history (F3)", () => {
  it("engine history(): shaped reply drops the whole exchange (nothing recorded)", async () => {
    const engine = new ChatEngine({ complete: async () => ({ message: SHAPED }) }, { sessionId: "s" });
    await engine.turn("find x");
    const h = engine.history();
    expect(h).toEqual([]);
  });

  it("shaped final exchange after a good one: only the good pair remains", async () => {
    const replies = ["fine", SHAPED];
    const engine = new ChatEngine({ complete: async () => ({ message: replies.shift()! }) }, { sessionId: "s" });
    await engine.turn("hi");
    await engine.turn("find x");
    expect(engine.history().map((m) => m.content)).toEqual(["hi", "fine"]);
  });

  it("legit JSON answers and prose are recorded untouched", async () => {
    for (const reply of ['{"result":180}', "The answer is 180."]) {
      const engine = new ChatEngine({ complete: async () => ({ message: reply }) }, { sessionId: "s" });
      await engine.turn("q");
      expect(engine.history()[1]!.content).toBe(reply);
    }
  });

  const contaminated: ChatMessage[] = [
    { role: "user", content: "find x", timestamp: 1 },
    { role: "assistant", content: SHAPED, timestamp: 2 },
    { role: "user", content: "sum?", timestamp: 3 },
    { role: "assistant", content: '{"result":180}', timestamp: 4 },
  ];

  it("formatHistoryBlock / withHistoryBlock heal contaminated history on replay", () => {
    for (const out of [formatHistoryBlock(contaminated), withHistoryBlock("next", contaminated)]) {
      expect(out).not.toContain("web-search");
      expect(out).not.toContain("find x");
      expect(out).not.toContain("omitted");
      expect(out).toContain('Assistant: {"result":180}');
      expect(out).toContain("User: sum?");
    }
  });

  it("healShapedAssistantTurns removes the pair, keeps alternation, leaves legit JSON", () => {
    const healed = healShapedAssistantTurns(contaminated);
    expect(healed.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(healed.map((m) => m.content)).toEqual(["sum?", '{"result":180}']);
    expect(healShapedAssistantTurns(healed)).toBe(healed);
  });
});
