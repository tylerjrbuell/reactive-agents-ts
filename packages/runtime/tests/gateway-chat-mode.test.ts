import { describe, test, expect } from "bun:test";
import { GatewayChatManager } from "../src/gateway-chat.js";
import type { ChatMessage } from "../src/chat.js";

describe("GatewayChatManager multi-turn history", () => {
  test("second turn includes first turn in windowed history passed to executeEvent", async () => {
    const instructions: string[] = [];

    const deps = {
      agentId: "test",
      sessionTtlDays: 30,
      executeEvent: async (_e: unknown, _s: string, instruction: string) => {
        instructions.push(instruction);
      },
      logEpisode: async () => {},
      saveSession: async () => {},
      findById: async () => null,
      getRecentEpisodes: async () => [],
      cleanup: async () => 0,
    };

    const mgr = new GatewayChatManager(deps);

    await mgr.handleMessage("+155", "what are my PRs?", "signal", "signal", {});
    await mgr.handleMessage("+155", "and the commits?", "signal", "signal", {});

    expect(instructions).toHaveLength(2);
    expect(instructions[1]).toContain("what are my PRs?");
    expect(instructions[1]).toContain("Conversation history");
    expect(instructions[1]).toContain("and the commits?");
  });

  test("separate senders have independent histories", async () => {
    const deps = {
      agentId: "test",
      sessionTtlDays: 30,
      executeEvent: async () => {},
      logEpisode: async () => {},
      saveSession: async () => {},
      findById: async () => null,
      getRecentEpisodes: async () => [],
      cleanup: async () => 0,
    };

    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+111", "message from sender A", "signal", "signal", {});
    await mgr.handleMessage("+222", "message from sender B", "signal", "signal", {});

    const histA = await mgr.getOrLoadHistory("+111");
    const histB = await mgr.getOrLoadHistory("+222");

    expect(histA.some((m: ChatMessage) => m.content === "message from sender A")).toBe(true);
    expect(histA.some((m: ChatMessage) => m.content === "message from sender B")).toBe(false);
    expect(histB.some((m: ChatMessage) => m.content === "message from sender B")).toBe(true);
    expect(histB.some((m: ChatMessage) => m.content === "message from sender A")).toBe(false);
  });

  test("history loaded from store appears in second-turn instruction", async () => {
    const storedHistory: ChatMessage[] = [
      { role: "user", content: "old message from store", timestamp: 1000 },
      { role: "assistant", content: "old reply from store", timestamp: 1001 },
    ];
    const instructions: string[] = [];

    const deps = {
      agentId: "test",
      sessionTtlDays: 30,
      executeEvent: async (_e: unknown, _s: string, instruction: string) => {
        instructions.push(instruction);
      },
      logEpisode: async () => {},
      saveSession: async () => {},
      findById: async (_id: string) => ({ messages: storedHistory }),
      getRecentEpisodes: async () => [],
      cleanup: async () => 0,
    };

    const mgr = new GatewayChatManager(deps);
    await mgr.handleMessage("+155", "new question", "signal", "signal", {});

    expect(instructions[0]).toContain("old message from store");
    expect(instructions[0]).toContain("old reply from store");
  });
});

describe("GatewayOptions type acceptance", () => {
  test("builder accepts channels.mode task to preserve original behavior", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const builder = ReactiveAgents.create()
      .withName("test-task-mode")
      .withProvider("test")
      .withGateway({
        channels: {
          accessPolicy: "allowlist",
          allowedSenders: ["+15551234567"],
          mode: "task",
        },
      });
    expect(builder).toBeDefined();
  });
});
