// W0.6 - Scaffolder unification: `rax init` must DELEGATE to the
// create-reactive-agent engine instead of apps/cli's own (divergent)
// project-generator. These tests are the delegation pin: they go RED if the
// old generator is ever rewired, because the old generator emitted
// `"reactive-agents": "latest"` (no W0.1 version pin), no W0.2 env guard,
// accepted the private `minimal|standard|full` name set, and detected the
// Gemini provider as `"gemini"` (not the engine's `"google"`).
import { describe, it, expect, afterEach } from "bun:test";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { listTemplates } from "create-reactive-agent";
import {
  createProject,
  detectPackageManager,
  detectProviderFromEnv,
  parseInitArgs,
} from "../src/commands/init.js";

const TEST_DIR = join(import.meta.dir, ".test-output-init");

// The engine reads its OWN package.json version to derive the scaffolded
// `reactive-agents` range (W0.1: lib/own-version.ts). Reading the same file
// here keeps the assertion honest: it pins delegation to the engine's truth,
// not a second hardcoded literal.
interface OwnPackageJson {
  readonly version: string;
}
const enginePkgPath = join(
  import.meta.dir,
  "../../../packages/create-reactive-agent/package.json",
);
const engineVersion: string = (
  JSON.parse(readFileSync(enginePkgPath, "utf-8")) as OwnPackageJson
).version;

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("rax init parseInitArgs (engine template names)", () => {
  it("defaults to the engine's non-interactive default template", () => {
    // create-reactive-agent's CLI defaults to "minimal" when it does not
    // prompt; rax init must match, NOT the old generator's "standard".
    const parsed = parseInitArgs(["my-agent"]);
    expect(parsed.projectName).toBe("my-agent");
    expect(parsed.template).toBe("minimal");
  });

  it("accepts every template name the engine reports", () => {
    for (const tpl of listTemplates()) {
      expect(parseInitArgs(["p", "--template", tpl.name]).template).toBe(tpl.name);
    }
  });

  it("rejects the old generator's private names and lists the engine's real ones", () => {
    for (const stale of ["standard", "full"]) {
      expect(() => parseInitArgs(["p", "--template", stale])).toThrow(/Invalid template/);
    }
    let message = "";
    try {
      parseInitArgs(["p", "--template", "bogus"]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    // Error must name the real options (ruling 1), e.g. with-tools/streaming.
    expect(message).toContain("with-tools");
    expect(message).toContain("cloudflare-worker");
    expect(message).not.toContain("standard,");
    expect(message).not.toContain("full,");
  });

  it("requires a project name", () => {
    expect(() => parseInitArgs([])).toThrow(/rax init/);
  });
});

describe("rax init env detection (engine Provider names)", () => {
  it("maps API keys to engine Provider values", () => {
    expect(detectProviderFromEnv({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe("anthropic");
    expect(detectProviderFromEnv({ OPENAI_API_KEY: "sk-x" })).toBe("openai");
    expect(detectProviderFromEnv({ GROQ_API_KEY: "g-x" })).toBe("groq");
    expect(detectProviderFromEnv({ XAI_API_KEY: "x-x" })).toBe("xai");
  });

  it("maps Gemini keys to the engine's 'google' (old detector said 'gemini')", () => {
    expect(detectProviderFromEnv({ GOOGLE_API_KEY: "AIza-x" })).toBe("google");
    expect(detectProviderFromEnv({ GEMINI_API_KEY: "AIza-x" })).toBe("google");
  });

  it("falls back to ollama with no keys", () => {
    expect(detectProviderFromEnv({})).toBe("ollama");
  });

  it("prefers bun under Bun, npm otherwise (matches engine CLI defaulting)", () => {
    const pm = detectPackageManager();
    expect(pm).toBe(typeof Bun !== "undefined" ? "bun" : "npm");
  });
});

describe("rax init delegates scaffolding to create-reactive-agent", () => {
  it("inherits the W0.1 own-version pin: reactive-agents === ^<engine version>", async () => {
    const result = await createProject({
      projectName: "delegated-proj",
      template: "minimal",
      provider: "anthropic",
      packageManager: "bun",
      cwd: TEST_DIR,
    });

    expect(result.files.length).toBeGreaterThan(0);
    const pkg = JSON.parse(
      readFileSync(join(result.dir, "package.json"), "utf-8"),
    ) as { dependencies: Record<string, string> };
    // RED against the old generator, which emitted "latest".
    expect(pkg.dependencies["reactive-agents"]).toBe(`^${engineVersion}`);
  });

  it("inherits the W0.2 env guard in the generated entry", async () => {
    const result = await createProject({
      projectName: "guarded-proj",
      template: "minimal",
      provider: "anthropic",
      packageManager: "bun",
      cwd: TEST_DIR,
    });
    const entry = readFileSync(join(result.dir, "src", "index.ts"), "utf-8");
    // RED against the old generator, which emitted no guard marker.
    expect(entry).toContain("Missing ANTHROPIC_API_KEY");
  });

  it("pins cloudflare-worker to OpenAI (mirrors the engine CLI rule)", async () => {
    const result = await createProject({
      projectName: "edge-proj",
      template: "cloudflare-worker",
      provider: "ollama",
      packageManager: "bun",
      cwd: TEST_DIR,
    });
    const entry = readFileSync(join(result.dir, "src", "index.ts"), "utf-8");
    expect(entry).toContain('.withProvider("openai"');
  });

  it("refuses to scaffold into a non-empty directory (engine check, surfaced)", async () => {
    await createProject({
      projectName: "first",
      template: "minimal",
      provider: "ollama",
      packageManager: "bun",
      cwd: TEST_DIR,
    });
    await expect(
      createProject({
        projectName: "first",
        template: "minimal",
        provider: "ollama",
        packageManager: "bun",
        cwd: TEST_DIR,
      }),
    ).rejects.toThrow(/not empty/);
  });
});
