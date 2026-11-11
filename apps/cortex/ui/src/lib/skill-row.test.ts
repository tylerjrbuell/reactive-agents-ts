import { describe, expect, test } from "bun:test";
import { runSkillsFromLive, skillChips, skillsAvailableNote } from "./skill-row.js";
import { fetchSessionSkills, skillDetail, skillSourceLabel } from "./chat-skills.js";

describe("skill row", () => {
  const view = {
    activations: [
      { name: "release-notes", via: "pinned" as const, version: 1, sha256: "abcdef0123456789", iteration: 0 },
      { name: "review", via: "agent" as const, iteration: 3 },
    ],
    pinned: ["release-notes"],
    available: 4,
    roots: [],
  };

  test("one chip per active skill, with why, step, version and short hash", () => {
    expect(skillChips(view)).toEqual([
      { name: "release-notes", why: "pinned", via: "pinned", tooltip: "release-notes: pinned · v1 · sha abcdef01" },
      { name: "review", why: "loaded by the agent", via: "agent", tooltip: "review: loaded by the agent · at step 3" },
    ]);
    expect(skillChips(undefined)).toEqual([]);
  });

  test("how many more the run could have loaded", () => {
    expect(skillsAvailableNote(view)).toBe("2 more available");
    expect(skillsAvailableNote({ ...view, available: 2 })).toBeNull();
    expect(skillsAvailableNote(undefined)).toBeNull();
  });

  test("the run view folds its live messages (AgentStarted config + SkillActivated)", () => {
    const skills = runSkillsFromLive([
      { type: "AgentStarted", payload: { taskId: "t", agentId: "a", config: { skills: { catalog: [{ name: "x" }, { name: "y" }], pinned: [] } } } },
      { type: "TextDelta", payload: {} },
      { type: "SkillActivated", payload: { skillName: "x", trigger: "bootstrap", version: 1, iteration: 0, taskId: "t" } },
    ]);
    expect(skills?.activations).toEqual([{ name: "x", via: "relevant", version: 1, iteration: 0 }]);
    expect(skills?.available).toBe(2);
    expect(runSkillsFromLive([{ type: "TextDelta", payload: {} }])).toBeUndefined();
  });
});

describe("chat skills", () => {
  test("source labels and the row detail", () => {
    expect(skillSourceLabel("claude")).toBe(".claude/skills");
    expect(skillDetail({ name: "a", description: "", source: "global" })).toBe("your home folder");
  });

  test("fetchSessionSkills reads the session listing and degrades to empty", async () => {
    const ok = (async () => new Response(JSON.stringify({ root: "/ws", skills: [{ name: "a", description: "d" }], pinned: ["a"] }))) as unknown as typeof fetch;
    expect(await fetchSessionSkills("http://x", "s 1", ok)).toEqual({ root: "/ws", skills: [{ name: "a", description: "d" }], pinned: ["a"] });
    const bad = (async () => new Response("{}", { status: 404 })) as unknown as typeof fetch;
    expect((await fetchSessionSkills("http://x", "s", bad)).skills).toEqual([]);
    const boom = (async () => {
      throw new Error("net");
    }) as unknown as typeof fetch;
    expect((await fetchSessionSkills("http://x", "s", boom)).skills).toEqual([]);
  });
});
