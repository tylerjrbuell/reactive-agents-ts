import { describe, it, expect } from "bun:test";
import { activateSkillTool, buildSkillContentXml } from "../src/skills/activate-skill.js";

describe("activate_skill tool", () => {
  it("tool definition has correct name and parameters", () => {
    expect(activateSkillTool.name).toBe("activate-skill");
    expect(activateSkillTool.parameters).toHaveLength(1);
    expect(activateSkillTool.parameters[0]!.name).toBe("name");
    expect(activateSkillTool.parameters[0]!.required).toBe(true);
  });

  it("buildSkillContentXml produces correct XML wrapper", () => {
    const xml = buildSkillContentXml({
      name: "github-review",
      version: 3,
      source: "installed",
      instructions: "# Steps\n1. Fetch PR\n2. Review",
    });
    expect(xml).toContain('<skill_content name="github-review" version="3" source="installed">');
    expect(xml).toContain("# Steps");
    expect(xml).toContain("</skill_content>");
  });

  it("buildSkillContentXml includes resources when present", () => {
    const xml = buildSkillContentXml({
      name: "my-skill",
      version: 1,
      source: "learned",
      instructions: "Do things",
      resources: { scripts: ["check.py"], references: ["guide.md"] },
    });
    expect(xml).toContain("<skill_resources>");
    expect(xml).toContain("<file>scripts/check.py</file>");
    expect(xml).toContain("<file>references/guide.md</file>");
    expect(xml).toContain("</skill_resources>");
  });

  it("buildSkillContentXml omits resources block when empty", () => {
    const xml = buildSkillContentXml({
      name: "simple",
      version: 1,
      source: "learned",
      instructions: "Simple instructions",
    });
    expect(xml).not.toContain("<skill_resources>");
  });
});
