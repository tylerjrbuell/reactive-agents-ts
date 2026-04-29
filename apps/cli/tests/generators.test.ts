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

  // ── FIX-13 / W16 — provider neutrality ──────────────────────────────────
  // The generator must produce provider-correct scaffolds for each detected
  // provider: the entry file's `.withProvider()` + `.withModel()` lines, the
  // README setup blurb, and `.env.example`'s active env-var line all agree
  // with the `provider` argument. Stale "ANTHROPIC_API_KEY first regardless
  // of detected provider" was the audit finding.

  it("scaffolds an ollama project with no API-key requirement", () => {
    generateProject({
      name: "ollama-proj",
      template: "minimal",
      targetDir: TEST_DIR,
      provider: "ollama",
    });

    const entry = readFileSync(join(TEST_DIR, "src", "index.ts"), "utf-8");
    expect(entry).toContain('.withProvider("ollama")');
    expect(entry).toContain('.withModel("qwen3.5")');

    const env = readFileSync(join(TEST_DIR, ".env.example"), "utf-8");
    // Active OLLAMA hint (commented because localhost is the default)
    expect(env).toContain("OLLAMA_HOST");
    // Anthropic / OpenAI / Gemini keys appear ONLY as commented alternatives
    expect(env).toContain("# ANTHROPIC_API_KEY=");
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=/m);

    const readme = readFileSync(join(TEST_DIR, "README.md"), "utf-8");
    expect(readme).toContain("Ollama");
    expect(readme).toContain("ollama pull qwen3.5");
  });

  it("scaffolds an anthropic project with the Anthropic env var as the active line", () => {
    generateProject({
      name: "anthropic-proj",
      template: "minimal",
      targetDir: TEST_DIR,
      provider: "anthropic",
    });

    const entry = readFileSync(join(TEST_DIR, "src", "index.ts"), "utf-8");
    expect(entry).toContain('.withProvider("anthropic")');
    expect(entry).toContain('.withModel("claude-haiku-4-5-20251001")');

    const env = readFileSync(join(TEST_DIR, ".env.example"), "utf-8");
    // ANTHROPIC_API_KEY is the active uncommented line
    expect(env).toMatch(/^ANTHROPIC_API_KEY=sk-ant-/m);
    // OpenAI / Gemini appear only as commented alternatives
    expect(env).toContain("# OPENAI_API_KEY=");
    expect(env).not.toMatch(/^OPENAI_API_KEY=/m);
    // No stale W10-superseded sonnet SHA pin
    expect(env).not.toContain("claude-sonnet-4-20250514");
  });

  it("scaffolds an openai project with the OpenAI env var as the active line", () => {
    generateProject({
      name: "openai-proj",
      template: "minimal",
      targetDir: TEST_DIR,
      provider: "openai",
    });

    const entry = readFileSync(join(TEST_DIR, "src", "index.ts"), "utf-8");
    expect(entry).toContain('.withProvider("openai")');
    expect(entry).toContain('.withModel("gpt-4o-mini")');

    const env = readFileSync(join(TEST_DIR, ".env.example"), "utf-8");
    expect(env).toMatch(/^OPENAI_API_KEY=sk-/m);
    expect(env).toContain("# ANTHROPIC_API_KEY=");
    expect(env).not.toMatch(/^ANTHROPIC_API_KEY=/m);
  });

  it("scaffolds a gemini project with the Google env var as the active line", () => {
    generateProject({
      name: "gemini-proj",
      template: "minimal",
      targetDir: TEST_DIR,
      provider: "gemini",
    });

    const entry = readFileSync(join(TEST_DIR, "src", "index.ts"), "utf-8");
    expect(entry).toContain('.withProvider("gemini")');
    expect(entry).toContain('.withModel("gemini-2.0-flash")');

    const env = readFileSync(join(TEST_DIR, ".env.example"), "utf-8");
    expect(env).toMatch(/^GOOGLE_API_KEY=AIza/m);
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
