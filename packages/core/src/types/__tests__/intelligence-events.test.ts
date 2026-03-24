import { describe, test, expect } from "bun:test";
import type {
  SkillActivated,
  SkillRefined,
  AgentNeedsHuman,
  IntelligenceEvent,
  SkillEvent,
  IntelligenceControlEvent,
} from "../intelligence-events.js";

describe("Intelligence event types", () => {
  test("SkillActivated event can be constructed", () => {
    const event: SkillActivated = { _tag: "SkillActivated", skillName: "data-analysis", version: 1, trigger: "model", iteration: 3, confidence: "trusted" };
    expect(event._tag).toBe("SkillActivated");
  });

  test("SkillRefined event can be constructed", () => {
    const event: SkillRefined = { _tag: "SkillRefined", skillName: "data-analysis", previousVersion: 1, newVersion: 2, taskCategory: "coding" };
    expect(event._tag).toBe("SkillRefined");
  });

  test("AgentNeedsHuman event can be constructed", () => {
    const event: AgentNeedsHuman = { _tag: "AgentNeedsHuman", agentId: "agent-1", taskId: "task-1", reason: "stuck", decisionsExhausted: ["early-stop", "switch-strategy"], context: "tried everything" };
    expect(event._tag).toBe("AgentNeedsHuman");
  });

  test("SkillEvent union accepts all skill event types", () => {
    const events: SkillEvent[] = [
      { _tag: "SkillActivated", skillName: "s", version: 1, trigger: "bootstrap", iteration: 0, confidence: "tentative" },
      { _tag: "SkillRefined", skillName: "s", previousVersion: 1, newVersion: 2, taskCategory: "coding" },
      { _tag: "SkillRefinementSuggested", skillName: "s", newInstructions: "new", reason: "better" },
      { _tag: "SkillRolledBack", skillName: "s", fromVersion: 2, toVersion: 1, reason: "regression" },
      { _tag: "SkillConflictDetected", skillA: "a", skillB: "b", conflictType: "task-overlap" },
      { _tag: "SkillPromoted", skillName: "s", fromConfidence: "tentative", toConfidence: "trusted" },
      { _tag: "SkillSkippedContextFull", skillName: "s", requiredTokens: 500, availableTokens: 100, modelTier: "local" },
      { _tag: "SkillEvicted", skillName: "s", reason: "budget", verbosityAtEviction: "summary" },
    ];
    expect(events).toHaveLength(8);
  });

  test("IntelligenceControlEvent union accepts all control events", () => {
    const events: IntelligenceControlEvent[] = [
      { _tag: "TemperatureAdjusted", delta: -0.1, reason: "diverging", iteration: 4 },
      { _tag: "ToolInjected", toolName: "web-search", reason: "knowledge-gap", iteration: 3 },
      { _tag: "MemoryBoostTriggered", from: "recent", to: "semantic", iteration: 5 },
      { _tag: "AgentNeedsHuman", agentId: "a", taskId: "t", reason: "stuck", decisionsExhausted: [], context: "" },
    ];
    expect(events).toHaveLength(4);
  });
});
