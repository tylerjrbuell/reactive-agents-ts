// Run: bun test packages/reasoning/tests/context/context-engine.test.ts --timeout 15000
import { describe, test, expect } from "bun:test";
import { buildRules } from "../../src/context/context-engine.js";

describe("buildRules", () => {
  test("omits MCP prefix guidance when no namespaced tools exist", () => {
    const rules = buildRules(
      [{ name: "web-search", description: "", parameters: [] }],
      ["web-search"],
      "mid",
    );
    expect(rules).not.toContain("context7/get-library-docs");
    expect(rules).toContain("Do not invent prefixes or namespaces");
  });

  test("includes MCP prefix guidance when namespaced tools exist", () => {
    const rules = buildRules(
      [{ name: "context7/get-library-docs", description: "", parameters: [] }],
      ["context7/get-library-docs"],
      "mid",
    );
    expect(rules).toContain("MCP tools require the full listed prefix");
    expect(rules).toContain("google:search");
  });

  test("includes required tools rule when required tools provided", () => {
    const rules = buildRules(
      [{ name: "final-answer", description: "", parameters: [] }],
      ["final-answer"],
      "local",
    );
    expect(rules).toContain("REQUIRED tools MUST be called before giving FINAL ANSWER");
  });

  test("omits recall rule for local tier when recall not available", () => {
    const rules = buildRules(
      [{ name: "web-search", description: "", parameters: [] }],
      [],
      "local",
    );
    expect(rules).not.toContain("recall");
  });

  test("includes recall rule for local tier when recall is available", () => {
    const rules = buildRules(
      [
        { name: "web-search", description: "", parameters: [] },
        { name: "recall", description: "", parameters: [] },
      ],
      [],
      "local",
    );
    expect(rules).toContain("recall");
  });

  test("includes spawn-agent delegation rule for large tier", () => {
    const rules = buildRules(
      [{ name: "spawn-agent", description: "", parameters: [] }],
      [],
      "large",
    );
    expect(rules).toContain("DELEGATION");
    expect(rules).toContain("spawn-agent has NO context");
  });
});
