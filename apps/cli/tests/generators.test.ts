import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateAgent } from "../src/generators/agent-generator.js";

const TEST_DIR = join(import.meta.dir, ".test-output");

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

// The "Project Generator" suite was removed with W0.6 scaffolder unification:
// `rax init` now delegates to the create-reactive-agent engine, and its
// delegation pin lives in tests/init-delegates-engine.test.ts.

describe("Agent Generator", () => {
  it("should generate a basic agent file", () => {
    const result = generateAgent({
      name: "my-test-agent",
      recipe: "basic",
      targetDir: TEST_DIR,
    });

    expect(existsSync(result.filePath)).toBe(true);
    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("my-test-agent");
    expect(content).toContain("ReactiveAgents");
  });

  it("should generate a researcher agent", () => {
    const result = generateAgent({
      name: "research-bot",
      recipe: "researcher",
      targetDir: TEST_DIR,
    });

    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("research assistant");
    expect(content).toContain("withMemory");
    expect(content).toContain("withReasoning");
  });

  it("should generate a coder agent", () => {
    const result = generateAgent({
      name: "code-bot",
      recipe: "coder",
      targetDir: TEST_DIR,
    });

    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("coding assistant");
  });

  it("threads the provider through to generated agent code", () => {
    const result = generateAgent({
      name: "prov-bot",
      recipe: "basic",
      targetDir: TEST_DIR,
      provider: "anthropic",
    });

    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain('.withProvider("anthropic")');
  });

  it("should generate an orchestrator agent", () => {
    const result = generateAgent({
      name: "orchestrator-bot",
      recipe: "orchestrator",
      targetDir: TEST_DIR,
    });

    const content = readFileSync(result.filePath, "utf-8");
    expect(content).toContain("orchestrator agent");
    expect(content).toContain("withMemory");
  });
});
