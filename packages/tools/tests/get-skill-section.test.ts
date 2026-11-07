import { describe, it, expect } from "bun:test";
import { parseSections, getSkillSection } from "../src/skills/get-skill-section.js";
import * as toolsIndex from "../src/index.js";

const sampleInstructions = `# Overview
This skill helps with data analysis.

## Steps
1. Load the dataset.
2. Run analysis.
3. Output results.

## Examples
Example 1: Simple CSV analysis.
Example 2: JSON pipeline.

## References
See data-guide.md for details.
`;

describe("deprecated skill section helpers (get-skill-section tool removed)", () => {
  it("the get-skill-section tool and the queued activate-skill stub are no longer exported", () => {
    const exported = Object.keys(toolsIndex);
    expect(exported).not.toContain("getSkillSectionTool");
    expect(exported).not.toContain("activateSkillHandler");
    expect(exported).toContain("makeActivateSkillHandler");
  });

  it("parseSections splits by heading", () => {
    const sections = parseSections(sampleInstructions);
    expect(Object.keys(sections).length).toBeGreaterThanOrEqual(3);
    expect(sections["steps"]).toContain("Load the dataset");
    expect(sections["examples"]).toContain("Example 1");
  });

  it("getSkillSection returns matching section", () => {
    const result = getSkillSection(sampleInstructions, "examples");
    expect(result).toContain("Example 1");
    expect(result).toContain("Example 2");
  });

  it('getSkillSection returns full body when section is "full"', () => {
    const result = getSkillSection(sampleInstructions, "full");
    expect(result).toBe(sampleInstructions);
  });

  it('getSkillSection returns "section not found" for missing section', () => {
    const result = getSkillSection(sampleInstructions, "nonexistent");
    expect(result).toBe("section not found");
  });

  it("getSkillSection is case-insensitive", () => {
    const result = getSkillSection(sampleInstructions, "EXAMPLES");
    expect(result).toContain("Example 1");
  });

  it("getSkillSection handles partial heading matches", () => {
    const result = getSkillSection(sampleInstructions, "step");
    expect(result).toContain("Load the dataset");
  });
});
