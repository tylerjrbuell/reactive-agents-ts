// Run: bun test packages/ui-core/tests/skill-evolution.test.ts --timeout 15000
import { describe, expect, it } from "bun:test";
import {
  skillConfidenceLabel,
  skillDiffStats,
  skillLifecycleEntryOf,
  skillLineDiff,
} from "../src/index.js";

describe("skillConfidenceLabel", () => {
  it("names the tiers and passes unknown values through", () => {
    expect(skillConfidenceLabel("tentative")).toBe("Tentative");
    expect(skillConfidenceLabel("expert")).toBe("Expert");
    expect(skillConfidenceLabel("unrated")).toBe("unrated");
  });
});

describe("skillLineDiff", () => {
  it("keeps common lines and marks removed before added", () => {
    const diff = skillLineDiff("a\nb\nc", "a\nB\nc\nd");
    expect(diff).toEqual([
      { kind: "same", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "same", text: "c" },
      { kind: "add", text: "d" },
    ]);
    expect(skillDiffStats(diff)).toEqual({ added: 2, removed: 1 });
  });

  it("an identical text is all same lines", () => {
    expect(skillLineDiff("x\ny", "x\ny").every((l) => l.kind === "same")).toBe(true);
  });

  it("a huge text diffs as a full replace", () => {
    const big = Array.from({ length: 2001 }, (_, i) => `l${i}`).join("\n");
    const diff = skillLineDiff(big, "new");
    expect(skillDiffStats(diff)).toEqual({ added: 1, removed: 2001 });
  });
});

describe("skillLifecycleEntryOf", () => {
  it("reads each lifecycle event with its run", () => {
    expect(skillLifecycleEntryOf({ _tag: "SkillPromoted", skillName: "s", fromConfidence: "tentative", toConfidence: "trusted", taskId: "t1" })).toEqual({
      kind: "promoted",
      skillName: "s",
      label: "Promoted Tentative → Trusted",
      taskId: "t1",
    });
    expect(skillLifecycleEntryOf({ _tag: "SkillRolledBack", skillName: "s", fromVersion: 3, toVersion: 2, reason: "regression" })?.label).toBe(
      "Rolled back v3 → v2 (success rate fell)",
    );
    expect(skillLifecycleEntryOf({ _tag: "SkillRefined", skillName: "s", previousVersion: 1, newVersion: 2 })?.label).toBe("Refined v1 → v2");
    expect(skillLifecycleEntryOf({ _tag: "SkillActivated", skillName: "s", version: 2, trigger: "model" })?.label).toBe("Used v2, loaded by the agent");
  });

  it("ignores other events and nameless ones", () => {
    expect(skillLifecycleEntryOf({ _tag: "AgentStarted" })).toBeUndefined();
    expect(skillLifecycleEntryOf({ _tag: "SkillRefined" })).toBeUndefined();
  });
});
