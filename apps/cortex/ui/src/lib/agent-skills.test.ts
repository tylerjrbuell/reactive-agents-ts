import { describe, expect, it } from "bun:test";
import {
  canRollBack,
  confidenceTone,
  evolutionModeLabel,
  exportPathOf,
  lockActionOf,
  MOVE_MODE_OPTIONS,
  moveLibrarySkill,
  previousVersion,
  setAgentSkillMode,
  timelineOriginOf,
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

describe("skill controls", () => {
  it("lock action: locked unlocks to auto, anything else locks", () => {
    expect(lockActionOf(skill({ evolutionMode: "locked" }))).toMatchObject({ mode: "auto", label: "Unlock" });
    expect(lockActionOf(skill({ evolutionMode: "auto" }))).toMatchObject({ mode: "locked", label: "Lock" });
    expect(lockActionOf(skill({ evolutionMode: "suggest" }))).toMatchObject({ mode: "locked", label: "Lock" });
  });

  it("move offers every mode, evolving first", () => {
    expect(MOVE_MODE_OPTIONS.map((o) => o.value)).toEqual(["auto", "suggest", "locked"]);
  });

  it("a timeline entry with no run came from a Cortex action", () => {
    expect(timelineOriginOf({ runId: "" })).toEqual({ kind: "cortex" });
    expect(timelineOriginOf({ runId: "r1" })).toEqual({ kind: "run", runId: "r1" });
    const items = skillTimeline([
      { id: 3, ts: 30, runId: "", event: { _tag: "SkillRolledBack", skillName: "s", fromVersion: 2, toVersion: 1, reason: "manual" } },
    ]);
    expect(items[0]).toMatchObject({ runId: "", kind: "rolled-back" });
    expect(items[0]!.label).toContain("by hand");
  });
});

/** A fetch that records its calls and answers with `body` / `status`. */
function recorder(body: unknown, status = 200) {
  const calls: { url: string; body: unknown }[] = [];
  const fetchFn: typeof fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status });
    },
    { preconnect: fetch.preconnect },
  );
  return { calls, fetchFn };
}

describe("api", () => {
  it("throws the server's error", async () => {
    const fetchFn: typeof fetch = Object.assign(async () => new Response(JSON.stringify({ error: "No model known" }), { status: 400 }), {
      preconnect: fetch.preconnect,
    });
    await expect(refineAgentSkills("a", fetchFn)).rejects.toThrow("No model known");
  });

  it("setAgentSkillMode posts the mode", async () => {
    const r = recorder(skill({ evolutionMode: "locked" }));
    const after = await setAgentSkillMode("a", "deploy notes", "locked", r.fetchFn);
    expect(after.evolutionMode).toBe("locked");
    expect(r.calls).toEqual([{ url: expect.stringMatching(/\/api\/agent-skills\/a\/skills\/deploy%20notes\/mode$/), body: { mode: "locked" } }]);
  });

  it("moveLibrarySkill sends mode and update; a 409 is a conflict result", async () => {
    const ok = recorder(skill());
    expect(await moveLibrarySkill("a", "7", { evolutionMode: "auto" }, ok.fetchFn)).toMatchObject({ ok: true, skill: { name: "deploy-notes" } });
    expect(ok.calls[0]!.body).toEqual({ evolutionMode: "auto" });
    const clash = recorder({ error: "already has a skill" }, 409);
    expect(await moveLibrarySkill("a", "7", {}, clash.fetchFn)).toEqual({ ok: false, conflict: "already has a skill" });
    const broken = recorder({ error: "boom" }, 500);
    await expect(moveLibrarySkill("a", "7", { update: true }, broken.fetchFn)).rejects.toThrow("boom");
  });
});
