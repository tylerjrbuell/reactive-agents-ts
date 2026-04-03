import { describe, it, expect } from "bun:test";
import {
  buildBriefResponse,
  briefTool,
  computeEntropyGrade,
  mergeBriefAvailableSkills,
} from "../src/skills/brief.js";
import type { BriefInput } from "../src/skills/brief.js";

const baseInput: BriefInput = {
  section: undefined,
  availableTools: [
    { name: "web-search", description: "Search the web", parameters: [] },
    { name: "rag-search", description: "Search docs", parameters: [] },
  ],
  indexedDocuments: [
    { source: "./.agents/MEMORY.md", chunkCount: 12, format: "markdown" },
  ],
  availableSkills: [{ name: "build-package", purpose: "Scaffold a new package" }],
  memoryBootstrap: { semanticLines: 16, episodicEntries: 2 },
  recallKeys: ["findings", "_tool_result_1"],
  tokens: 1200,
  tokenBudget: 8000,
  entropy: undefined,
  controllerDecisionLog: [],
};

describe("mergeBriefAvailableSkills", () => {
  it("returns static only when resolved is empty", () => {
    const staticSkills = [{ name: "a", purpose: "static" }];
    expect(mergeBriefAvailableSkills(staticSkills, undefined)).toEqual(staticSkills);
    expect(mergeBriefAvailableSkills(staticSkills, [])).toEqual(staticSkills);
  });

  it("returns resolved only when static is empty", () => {
    const resolved = [{ name: "x", purpose: "from resolver" }];
    expect(mergeBriefAvailableSkills(undefined, resolved)).toEqual(resolved);
    expect(mergeBriefAvailableSkills([], resolved)).toEqual(resolved);
  });

  it("dedupes by name with resolved winning over static", () => {
    expect(
      mergeBriefAvailableSkills(
        [{ name: "skill-a", purpose: "build-time" }],
        [{ name: "skill-a", purpose: "runtime" }],
      ),
    ).toEqual([{ name: "skill-a", purpose: "runtime" }]);
  });

  it("keeps static order for non-colliding names then adds resolved-only entries", () => {
    const merged = mergeBriefAvailableSkills(
      [{ name: "first", purpose: "1" }, { name: "second", purpose: "2" }],
      [{ name: "third", purpose: "3" }],
    );
    expect(merged.map((s) => s.name)).toEqual(["first", "second", "third"]);
  });
});

describe("briefTool definition", () => {
  it("has name 'brief'", () => expect(briefTool.name).toBe("brief"));
  it("has section parameter", () => {
    const names = briefTool.parameters.map(p => p.name);
    expect(names).toContain("section");
  });
});

describe("computeEntropyGrade", () => {
  it("returns A for low entropy", () => expect(computeEntropyGrade(0.2)).toBe("A"));
  it("returns B for 0.40", () => expect(computeEntropyGrade(0.40)).toBe("B"));
  it("returns C for 0.55", () => expect(computeEntropyGrade(0.55)).toBe("C"));
  it("returns D for 0.70", () => expect(computeEntropyGrade(0.70)).toBe("D"));
  it("returns F for 0.80", () => expect(computeEntropyGrade(0.80)).toBe("F"));
  it("returns unknown for undefined", () => expect(computeEntropyGrade(undefined)).toBe("unknown"));

  describe("short-run bypass", () => {
    it("returns A for high-entropy run with 1 iteration (success)", () =>
      expect(computeEntropyGrade(0.6, { iterationCount: 1, success: true })).toBe("A"));
    it("returns A for high-entropy run with 2 iterations (success)", () =>
      expect(computeEntropyGrade(0.5, { iterationCount: 2, success: true })).toBe("A"));
    it("returns A for short run when success is undefined (default safe)", () =>
      expect(computeEntropyGrade(0.6, { iterationCount: 1 })).toBe("A"));
    it("does NOT bypass for short run when success is explicitly false", () =>
      expect(computeEntropyGrade(0.6, { iterationCount: 1, success: false })).toBe("C"));
    it("does NOT bypass for longer runs — normal grading applies", () =>
      expect(computeEntropyGrade(0.6, { iterationCount: 5 })).toBe("C"));
    it("normal grading still works for low-entropy longer runs", () =>
      expect(computeEntropyGrade(0.3, { iterationCount: 5 })).toBe("A"));
    it("threshold exactly 2 iterations triggers bypass", () =>
      expect(computeEntropyGrade(0.75, { iterationCount: 2, success: true })).toBe("A"));
    it("threshold 3 iterations does NOT trigger bypass", () =>
      expect(computeEntropyGrade(0.75, { iterationCount: 3, success: true })).toBe("D"));
  });
});

describe("buildBriefResponse — compact (no section)", () => {
  it("includes tool count", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("2");
    expect(result).toContain("tools");
  });

  it("includes document source", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("MEMORY.md");
  });

  it("includes skill name", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("build-package");
  });

  it("includes memory stats", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("16");
    expect(result).toContain("semantic");
  });

  it("includes recall keys", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).toContain("findings");
  });

  it("omits signal line when entropy is undefined", () => {
    const result = buildBriefResponse(baseInput);
    expect(result).not.toContain("Grade");
  });

  it("includes signal line when entropy is present", () => {
    const input: BriefInput = {
      ...baseInput,
      entropy: { composite: 0.65, shape: "flat", momentum: 0 },
    };
    const result = buildBriefResponse(input);
    expect(result).toContain("Grade C");
  });
});

describe("buildBriefResponse — signal section", () => {
  it("returns not-available when entropy is absent", () => {
    const result = buildBriefResponse({ ...baseInput, section: "signal" });
    expect(result).toContain("not available");
  });

  it("returns entropy details when present", () => {
    const input: BriefInput = {
      ...baseInput,
      section: "signal",
      entropy: { composite: 0.72, shape: "oscillating", momentum: 0.05 },
      controllerDecisionLog: ["compress: context at 0.91"],
    };
    const result = buildBriefResponse(input);
    expect(result).toContain("oscillating");
    expect(result).toContain("compress");
  });
});

describe("buildBriefResponse — documents section", () => {
  it("lists documents with chunk counts", () => {
    const result = buildBriefResponse({ ...baseInput, section: "documents" });
    expect(result).toContain("MEMORY.md");
    expect(result).toContain("12");
    expect(result).toContain("markdown");
  });
});
