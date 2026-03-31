import { describe, expect, it } from "bun:test";
import type { AgentEvent } from "../src/services/event-bus.js";
import type { AgentDebrief } from "@reactive-agents/runtime";

describe("Cortex AgentEvent tags", () => {
  it("should have MemorySnapshot tag assignable to AgentEvent", () => {
    const event = {
      _tag: "MemorySnapshot" as const,
      taskId: "t1",
      iteration: 1,
      working: [],
      episodicCount: 0,
      semanticCount: 0,
      skillsActive: [],
    };

    const typedEvent: AgentEvent = event;
    expect(typedEvent._tag).toBe("MemorySnapshot");
  });

  it("should have DebriefCompleted tag assignable to AgentEvent", () => {
    const event = {
      _tag: "DebriefCompleted" as const,
      taskId: "t1",
      agentId: "a1",
      debrief: {} as AgentDebrief,
    };

    const typedEvent: AgentEvent = event;
    expect(typedEvent._tag).toBe("DebriefCompleted");
  });
});
