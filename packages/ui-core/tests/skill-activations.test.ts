import { describe, expect, test } from "bun:test";
import { foldRunSkills, runSkillsOf, skillActivationVia, skillViaLabel } from "../src/index.js";

const started = (skills?: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  _tag: "AgentStarted",
  taskId: "t1",
  agentId: "a",
  ...(skills ? { config: { skills } } : { config: {} }),
  ...extra,
});

describe("skillActivationVia", () => {
  test("bootstrap of a pinned name is pinned, any other bootstrap is relevant", () => {
    expect(skillActivationVia("bootstrap", "Release-Notes", ["release-notes"])).toBe("pinned");
    expect(skillActivationVia("bootstrap", "other", ["release-notes"])).toBe("relevant");
  });
  test("model is the agent, harness is the user", () => {
    expect(skillActivationVia("model", "x", ["x"])).toBe("agent");
    expect(skillActivationVia("harness", "x", [])).toBe("user");
  });
  test("labels", () => {
    expect(skillViaLabel("relevant")).toBe("matched the task");
    expect(skillViaLabel("agent")).toBe("loaded by the agent");
  });
});

describe("runSkillsOf", () => {
  test("first activation per name wins and keeps version and sha", () => {
    const view = runSkillsOf({
      record: { pinned: ["a"], catalog: [{ name: "a" }, { name: "b" }], roots: ["/w/.agents/skills"] },
      activations: [
        { skillName: "a", trigger: "bootstrap", version: 2, sha256: "abc", iteration: 0 },
        { skillName: "b", trigger: "model", iteration: 3 },
        { skillName: "A", trigger: "model", iteration: 4 },
      ],
    });
    expect(view.activations).toEqual([
      { name: "a", via: "pinned", version: 2, sha256: "abc", iteration: 0 },
      { name: "b", via: "agent", iteration: 3 },
    ]);
    expect(view.available).toBe(2);
    expect(view.roots).toEqual(["/w/.agents/skills"]);
  });
  test("catalogTotal wins over a capped catalog", () => {
    expect(runSkillsOf({ record: { catalog: [{ name: "a" }], catalogTotal: 40 }, activations: [] }).available).toBe(40);
  });
});

describe("foldRunSkills", () => {
  test("undefined when the run had no skills and activated none", () => {
    expect(foldRunSkills([started(), { _tag: "TextDelta", text: "hi" }])).toBeUndefined();
  });
  test("reads the record and the activations of this run only", () => {
    const view = foldRunSkills([
      { _tag: "SkillActivated", skillName: "pin", trigger: "bootstrap", version: 1, iteration: 0, confidence: "unrated", taskId: "t1" },
      started({ roots: ["/w/.agents/skills"], catalog: [{ name: "pin", sha256: "s" }, { name: "x" }], pinned: ["pin"] }),
      { _tag: "SkillActivated", skillName: "other-run", trigger: "model", version: 1, iteration: 1, confidence: "unrated", taskId: "t9" },
      { _tag: "SkillActivated", skillName: "x", trigger: "model", version: 1, iteration: 2, confidence: "unrated" },
    ]);
    expect(view?.activations.map((a) => [a.name, a.via])).toEqual([
      ["pin", "pinned"],
      ["x", "agent"],
    ]);
    expect(view?.available).toBe(2);
    expect(view?.pinned).toEqual(["pin"]);
  });
  test("a sub-agent's AgentStarted does not replace the run's record", () => {
    const view = foldRunSkills([
      started({ catalog: [{ name: "a" }], pinned: [] }),
      started({ catalog: [], pinned: [] }, { taskId: "child", parentAgentId: "a" }),
    ]);
    expect(view?.available).toBe(1);
  });
});
