import { describe, expect, it } from "bun:test";
import {
  canRollBack,
  confidenceTone,
  evolutionModeLabel,
  exportPathOf,
  previousVersion,
  refineAgentSkills,
  refineModelText,
  refineSummary,
  skillTimeline,
  successRateText,
  versionDiff,
  versionRows,
  type AgentSkill,
} from "./agent-skills.js";

const skill = (over: Partial<AgentSkill> = {}): AgentSkill => ({
  id: "s",
  name: "deploy-notes",
  description: "d",
  source: "learned",
  confidence: "trusted",
  evolutionMode: "auto",
  version: 2,
  instructions: "one\ntwo, refined",
  useCount: 4,
  successRate: 0.75,
  refinementCount: 1,
  taskCategories: [],
  lastActivatedAt: null,
  lastRefinedAt: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  versions: [
    { version: 1, status: "active", instructions: "one\ntwo", refinedAt: "2026-11-01T00:00:00.000Z", successRateAtRefinement: 0.8, useCountAtRefinement: 0 },
    { version: 2, status: "candidate", instructions: "one\ntwo, refined", refinedAt: "2026-11-02T00:00:00.000Z", successRateAtRefinement: 0.8, useCountAtRefinement: 2 },
  ],
  ...over,
});

describe("versionRows", () => {
  it("lists versions newest first and marks the current one", () => {
    const rows = versionRows(skill());
    expect(rows.map((r) => [r.version, r.current, r.status])).toEqual([
      [2, true, "candidate"],
      [1, false, "active"],
    ]);
    expect(previousVersion(rows, 2)).toBe(1);
    expect(previousVersion(rows, 1)).toBeNull();
  });

  it("adds the current version when it is not stored yet (never refined)", () => {
    const rows = versionRows(skill({ version: 1, instructions: "only", versions: [] }));
    expect(rows).toEqual([{ version: 1, current: true, status: "active", instructions: "only", at: null, successRateAtRefinement: null }]);
  });

  it("diffs two versions", () => {
    const d = versionDiff(versionRows(skill()), 1, 2);
    expect(d.filter((l) => l.kind !== "same").map((l) => `${l.kind}:${l.text}`)).toEqual(["del:two", "add:two, refined"]);
    expect(versionDiff(versionRows(skill()), 1, 9)).toEqual([]);
  });
});

describe("rules", () => {
  it("rollback needs the previous version stored", () => {
    expect(canRollBack(skill())).toBe(true);
    expect(canRollBack(skill({ versions: [] }))).toBe(false);
  });

  it("words and tones", () => {
    expect(confidenceTone("expert")).toBe("ok");
    expect(confidenceTone("tentative")).toBe("neutral");
    expect(evolutionModeLabel("locked")).toContain("Locked");
    expect(successRateText(skill({ useCount: 0 }))).toBe("—");
    expect(successRateText(skill())).toBe("75%");
    expect(refineModelText({ provider: "ollama", model: "qwen3" })).toBe("ollama · qwen3");
    expect(refineModelText(null)).toBeNull();
    expect(exportPathOf("/w/", "x")).toBe("/w/.agents/skills/x/SKILL.md");
  });

  it("refine summary names every bucket and explains skips", () => {
    expect(refineSummary({ refined: 1, unchanged: 0, skipped: 0, failed: 0 })).toBe("1 refined · 0 unchanged · 0 skipped · 0 failed");
    expect(refineSummary({ refined: 0, unchanged: 0, skipped: 2, failed: 0 })).toContain("too little new evidence");
  });

  it("timeline keeps lifecycle events with their run", () => {
    const items = skillTimeline([
      { id: 2, ts: 20, runId: "run-1", event: { _tag: "SkillPromoted", skillName: "s", fromConfidence: "tentative", toConfidence: "trusted", taskId: "run-1" } },
      { id: 1, ts: 10, runId: "run-0", event: { _tag: "Other" } },
    ]);
    expect(items).toEqual([{ id: 2, ts: 20, runId: "run-1", kind: "promoted", skillName: "s", label: "Promoted Tentative → Trusted", taskId: "run-1" }]);
  });
});

describe("api", () => {
  it("throws the server's error", async () => {
    const fetchFn: typeof fetch = Object.assign(async () => new Response(JSON.stringify({ error: "No model known" }), { status: 400 }), {
      preconnect: fetch.preconnect,
    });
    await expect(refineAgentSkills("a", fetchFn)).rejects.toThrow("No model known");
  });
});
