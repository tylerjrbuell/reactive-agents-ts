import { describe, it, expect, afterEach } from "bun:test";
import { rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { generateProject } from "../src/generators/project-generator.js";
import { generateAgent } from "../src/generators/agent-generator.js";

const TEST_DIR = join(import.meta.dir, ".test-output");

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("Project Generator", () => {
  it("should generate a minimal project", () => {
    const result = generateProject({
      name: "test-project",
      template: "minimal",
      targetDir: TEST_DIR,
    });

    expect(result.files.length).toBeGreaterThanOrEqual(4);
    expect(existsSync(join(TEST_DIR, "package.json"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "tsconfig.json"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "src", "index.ts"))).toBe(true);

    const pkg = JSON.parse(readFileSync(join(TEST_DIR, "package.json"), "utf-8"));
    expect(pkg.name).toBe("test-project");
    // All templates now use the unified "reactive-agents" package
    expect(pkg.dependencies["reactive-agents"]).toBe("latest");
    expect(pkg.dependencies["@reactive-agents/core"]).toBeUndefined();
  });

  it("should generate a standard project with more deps", () => {
    const result = generateProject({
      name: "standard-project",
      template: "standard",
      targetDir: TEST_DIR,
    });

    const pkg = JSON.parse(readFileSync(join(TEST_DIR, "package.json"), "utf-8"));
    // Unified package — no granular deps
    expect(pkg.dependencies["reactive-agents"]).toBe("latest");
    expect(pkg.dependencies["@reactive-agents/memory"]).toBeUndefined();

    const entryCode = readFileSync(join(TEST_DIR, "src", "index.ts"), "utf-8");
    expect(entryCode).toContain(".withReasoning(");
    expect(entryCode).toContain(".withTools(");
    expect(entryCode).toContain("reactive-agents");
  });

  it("should generate a full project with all deps", () => {
    generateProject({
      name: "full-project",
      template: "full",
      targetDir: TEST_DIR,
    });

    const pkg = JSON.parse(readFileSync(join(TEST_DIR, "package.json"), "utf-8"));
    expect(pkg.dependencies["reactive-agents"]).toBe("latest");
    expect(pkg.dependencies["@reactive-agents/orchestration"]).toBeUndefined();

    const entryCode = readFileSync(join(TEST_DIR, "src", "index.ts"), "utf-8");
    expect(entryCode).toContain(".withGuardrails()");
    expect(entryCode).toContain(".withHealthCheck()");
  });
});

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
