import { describe, it, expect } from "bun:test";
import { compressSkillContent, getDefaultCompressionStage, estimateTokens } from "../../src/skills/skill-compression.js";

const fullBody = `# Overview
This skill helps with data analysis tasks. It provides comprehensive guidance for loading, processing, and analyzing datasets.

## Steps
1. Load the dataset.
Make sure to validate format first. Check encoding and column types.
2. Run analysis.
Apply standard statistical methods. Consider outliers.
3. Output results.

## Examples
Example 1: Load a CSV file.
\`\`\`
import pandas as pd
df = pd.read_csv("data.csv")
\`\`\`

Example 2: Load JSON data.
\`\`\`
import json
with open("data.json") as f:
    data = json.load(f)
\`\`\`

## References
See data-guide.md for comprehensive documentation.
Also check the API reference at api-docs.md.

## See Also
Related skill: data-visualization.
`;

describe("compressSkillContent", () => {
  it("stage 0: returns body unchanged", () => {
    const result = compressSkillContent(fullBody, 0);
    expect(result).toBe(fullBody);
  });

  it("stage 1: strips examples section", () => {
    const result = compressSkillContent(fullBody, 1);
    expect(result).not.toContain("Example 1");
    expect(result).not.toContain("pandas");
    expect(result).toContain("## Steps");
    expect(result).toContain("## References");
  });

  it("stage 2: strips examples + references + see also", () => {
    const result = compressSkillContent(fullBody, 2);
    expect(result).not.toContain("Example 1");
    expect(result).not.toContain("data-guide.md");
    expect(result).not.toContain("See Also");
    expect(result).toContain("## Steps");
  });

  it("stage 3: condenses paragraphs to first sentence", () => {
    const result = compressSkillContent(fullBody, 3);
    expect(result).toContain("Load the dataset.");
    expect(result).not.toContain("Check encoding");
    // List items should still be present
    expect(result).toContain("1. Load the dataset.");
  });

  it("stage 4: keeps only imperative sentences", () => {
    const result = compressSkillContent(fullBody, 4);
    expect(result).toContain("Load the dataset");
    expect(result).toContain("Run analysis");
    expect(result).toContain("Output results");
    // Non-imperative prose should be removed
    expect(result).not.toContain("This skill helps");
  });

  it("stage 5: returns empty string (catalog-only)", () => {
    const result = compressSkillContent(fullBody, 5);
    expect(result).toBe("");
  });

  it("handles body with no sections gracefully", () => {
    const simple = "Just do the thing.\nThen do the other thing.";
    const result = compressSkillContent(simple, 1);
    expect(result).toBe(simple);
  });
});

describe("getDefaultCompressionStage", () => {
  it("returns 0 for frontier", () => {
    expect(getDefaultCompressionStage("frontier")).toBe(0);
  });

  it("returns 1 for large", () => {
    expect(getDefaultCompressionStage("large")).toBe(1);
  });

  it("returns 2 for mid", () => {
    expect(getDefaultCompressionStage("mid")).toBe(2);
  });

  it("returns 4 for local", () => {
    expect(getDefaultCompressionStage("local")).toBe(4);
  });

  it("defaults to 2 for unknown tier", () => {
    expect(getDefaultCompressionStage("unknown")).toBe(2);
  });
});

describe("estimateTokens", () => {
  it("estimates approximately 1 token per 4 chars", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("12345678")).toBe(2);
    expect(estimateTokens("")).toBe(0);
  });
});
