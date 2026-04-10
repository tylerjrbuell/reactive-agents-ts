// File: tests/strategies/kernel/utils/task-intent.test.ts
import { describe, it, expect } from "bun:test";
import {
  extractOutputFormat,
  type OutputFormat,
} from "../../../../src/strategies/kernel/utils/task-intent.js";

describe("extractOutputFormat", () => {
  // ── Markdown detection ──

  it("detects explicit 'markdown table' request", () => {
    const result = extractOutputFormat(
      "what is the current price of xrp, bitcoin, BONK and ETH, then generate a markdown table with the prices",
    );
    expect(result.format).toBe("markdown");
    expect(result.cues.length).toBeGreaterThan(0);
  });

  it("detects 'generate a table' as markdown", () => {
    const result = extractOutputFormat("fetch the data and generate a table of results");
    expect(result.format).toBe("markdown");
  });

  it("detects 'create a table' as markdown", () => {
    const result = extractOutputFormat("create a table comparing the options");
    expect(result.format).toBe("markdown");
  });

  it("detects 'output as a table' as markdown", () => {
    const result = extractOutputFormat("list all users and output as a table");
    expect(result.format).toBe("markdown");
  });

  it("detects 'format using markdown' as markdown", () => {
    const result = extractOutputFormat("summarize the findings using markdown");
    expect(result.format).toBe("markdown");
  });

  it("detects 'output in markdown' as markdown", () => {
    const result = extractOutputFormat("write the report in markdown");
    expect(result.format).toBe("markdown");
  });

  // ── JSON detection ──

  it("detects 'output as JSON' request", () => {
    const result = extractOutputFormat("get the user data and output as JSON");
    expect(result.format).toBe("json");
  });

  it("detects 'return JSON' request", () => {
    const result = extractOutputFormat("return JSON with the results");
    expect(result.format).toBe("json");
  });

  it("detects 'format as json' case-insensitively", () => {
    const result = extractOutputFormat("format the results as json");
    expect(result.format).toBe("json");
  });

  // ── CSV detection ──

  it("detects 'CSV' format request", () => {
    const result = extractOutputFormat("export the data as CSV");
    expect(result.format).toBe("csv");
  });

  it("detects 'comma-separated' as CSV", () => {
    const result = extractOutputFormat("output the list in comma-separated format");
    expect(result.format).toBe("csv");
  });

  // ── HTML detection ──

  it("detects 'HTML' format request", () => {
    const result = extractOutputFormat("generate an HTML page with the results");
    expect(result.format).toBe("html");
  });

  // ── Code detection ──

  it("detects 'write a function' as code", () => {
    const result = extractOutputFormat("write a Python function to sort the list");
    expect(result.format).toBe("code");
  });

  it("detects 'write a script' as code", () => {
    const result = extractOutputFormat("write a bash script to deploy the app");
    expect(result.format).toBe("code");
  });

  it("detects 'code snippet' as code", () => {
    const result = extractOutputFormat("give me a code snippet for bubble sort");
    expect(result.format).toBe("code");
  });

  // ── List detection ──

  it("detects 'bullet list' request", () => {
    const result = extractOutputFormat("give me a bullet list of the top 10 frameworks");
    expect(result.format).toBe("list");
  });

  it("detects 'numbered list' request", () => {
    const result = extractOutputFormat("provide a numbered list of steps");
    expect(result.format).toBe("list");
  });

  it("detects 'list the' as list format", () => {
    const result = extractOutputFormat("list the top 5 programming languages");
    expect(result.format).toBe("list");
  });

  // ── Prose / null detection ──

  it("returns null format for generic questions", () => {
    const result = extractOutputFormat("what is the capital of France?");
    expect(result.format).toBeNull();
  });

  it("returns null for ambiguous requests", () => {
    const result = extractOutputFormat("tell me about React hooks");
    expect(result.format).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = extractOutputFormat("");
    expect(result.format).toBeNull();
  });

  // ── Cues extraction ──

  it("extracts matching cue strings", () => {
    const result = extractOutputFormat("generate a markdown table with prices and volumes");
    expect(result.cues).toContain("markdown table");
  });

  it("extracts multiple cues when present", () => {
    const result = extractOutputFormat("create a numbered list in JSON format");
    // Should detect the first matching format but capture all cues
    expect(result.cues.length).toBeGreaterThan(0);
  });

  // ── Expected content detection ──

  it("extracts expected column/field hints from 'with the X' phrases", () => {
    const result = extractOutputFormat(
      "generate a markdown table with the prices, names, and market caps",
    );
    expect(result.expectedContent.length).toBeGreaterThan(0);
  });

  it("returns empty expectedContent when no hints found", () => {
    const result = extractOutputFormat("what is 2 + 2?");
    expect(result.expectedContent).toEqual([]);
  });

  // ── Priority: first strong match wins ──

  it("prefers markdown over list when both 'table' and 'list' appear", () => {
    const result = extractOutputFormat("create a table that lists all the items");
    expect(result.format).toBe("markdown");
  });

  it("prefers json over list when both appear", () => {
    const result = extractOutputFormat("return JSON with a list of users");
    expect(result.format).toBe("json");
  });
});
