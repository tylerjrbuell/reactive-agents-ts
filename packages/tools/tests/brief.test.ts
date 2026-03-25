import { describe, it, expect } from "bun:test";
import { buildBriefResponse, briefTool, computeEntropyGrade } from "../src/skills/brief.js";
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
