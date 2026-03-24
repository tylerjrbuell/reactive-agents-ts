import { describe, test, expect } from "bun:test";
import { Schema } from "effect";
import { DailyLogEntrySchema, MemoryBootstrapResultSchema } from "../types.js";

describe("DailyLogEntrySchema provider field", () => {
  test("accepts optional provider field", () => {
    const entry = Schema.decodeUnknownSync(DailyLogEntrySchema)({
      id: "mem-1",
      agentId: "agent-1",
      date: "2026-03-23",
      content: "Did a thing",
      eventType: "task-completed",
      createdAt: new Date(),
      provider: "anthropic",
    });
    expect(entry.provider).toBe("anthropic");
  });

  test("provider field is optional — entry without provider is valid", () => {
    const entry = Schema.decodeUnknownSync(DailyLogEntrySchema)({
      id: "mem-2",
      agentId: "agent-1",
      date: "2026-03-23",
      content: "Did another thing",
      eventType: "observation",
      createdAt: new Date(),
    });
    expect(entry.provider).toBeUndefined();
  });

  test("provider accepts test provider values", () => {
    const entry = Schema.decodeUnknownSync(DailyLogEntrySchema)({
      id: "mem-3",
      agentId: "agent-1",
      date: "2026-03-23",
      content: "Test run",
      eventType: "task-completed",
      createdAt: new Date(),
      provider: "test",
    });
    expect(entry.provider).toBe("test");
  });
});

describe("MemoryBootstrapResult activeSkills field", () => {
  test("defaults to empty array when not provided", () => {
    const result = Schema.decodeUnknownSync(MemoryBootstrapResultSchema)({
      agentId: "agent-1",
      semanticContext: "",
      recentEpisodes: [],
      activeWorkflows: [],
      workingMemory: [],
      bootstrappedAt: new Date(),
      tier: "1",
    });
    expect(result.activeSkills).toEqual([]);
  });

  test("accepts activeSkills when provided", () => {
    const result = Schema.decodeUnknownSync(MemoryBootstrapResultSchema)({
      agentId: "agent-1",
      semanticContext: "",
      recentEpisodes: [],
      activeWorkflows: [],
      workingMemory: [],
      activeSkills: [{ name: "test-skill" }],
      bootstrappedAt: new Date(),
      tier: "2",
    });
    expect(result.activeSkills).toHaveLength(1);
  });
});
