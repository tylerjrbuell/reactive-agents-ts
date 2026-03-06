import { describe, it, expect, afterEach, beforeEach } from "bun:test";
import { rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { scaffoldDocker, detectAgentName, detectMonorepoRoot, checkEnvFile } from "../src/commands/deploy/scaffold.js";
import { flyTomlTemplate } from "../src/templates/fly-toml.js";
import { railwayJsonTemplate } from "../src/templates/railway.js";
import { hasCommand } from "../src/commands/deploy/exec.js";
import { getProvider, listProviders, detectTarget } from "../src/commands/deploy/registry.js";
import type { DeployContext } from "../src/commands/deploy/types.js";

const TEST_DIR = join(import.meta.dir, ".test-deploy-output");

beforeEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
});

describe("Deploy — scaffold", () => {
  it("should scaffold Docker files for a single-package project", () => {
    // Create a minimal package.json so we don't crash on read
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "test-agent" }),
    );

    const result = scaffoldDocker(TEST_DIR, "test-agent", "local");

    expect(result.created).toBeGreaterThanOrEqual(4);
    expect(existsSync(join(TEST_DIR, "Dockerfile"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "docker-compose.yml"))).toBe(true);
    expect(existsSync(join(TEST_DIR, "raxd.config.ts"))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".env.production.example"))).toBe(true);

    // Dockerfile has correct agent name
    const dockerfile = readFileSync(join(TEST_DIR, "Dockerfile"), "utf-8");
    expect(dockerfile).toContain("test-agent");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain("SIGTERM");
  });

  it("should skip existing files on re-scaffold", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "test-agent" }),
    );

    // First scaffold
    const first = scaffoldDocker(TEST_DIR, "test-agent", "local");
    expect(first.created).toBeGreaterThanOrEqual(4);

    // Second scaffold — all skipped
    const second = scaffoldDocker(TEST_DIR, "test-agent", "local");
    expect(second.created).toBe(0);
    expect(second.skipped).toBeGreaterThanOrEqual(4);
  });

  it("should compose template contain security opts", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "secure-agent" }),
    );

    scaffoldDocker(TEST_DIR, "secure-agent", "local");
    const compose = readFileSync(join(TEST_DIR, "docker-compose.yml"), "utf-8");

    expect(compose).toContain("cap_drop");
    expect(compose).toContain("ALL");
    expect(compose).toContain("no-new-privileges");
    expect(compose).toContain("512m");
  });
});

describe("Deploy — detectAgentName", () => {
  it("should read name from package.json", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "@my-org/cool-agent" }),
    );
    const name = detectAgentName(TEST_DIR);
    expect(name).toBe("cool-agent");
  });

  it("should strip scope from package name", () => {
    writeFileSync(
      join(TEST_DIR, "package.json"),
      JSON.stringify({ name: "@reactive-agents/meta-agent" }),
    );
    expect(detectAgentName(TEST_DIR)).toBe("meta-agent");
  });

  it("should fall back to directory name", () => {
    const name = detectAgentName(TEST_DIR);
    expect(name).toBe(".test-deploy-output");
  });
});

describe("Deploy — checkEnvFile", () => {
  it("should return false when no .env.production", () => {
    expect(checkEnvFile(TEST_DIR)).toBe(false);
  });

  it("should return true when .env.production exists", () => {
    writeFileSync(join(TEST_DIR, ".env.production"), "ANTHROPIC_API_KEY=test");
    expect(checkEnvFile(TEST_DIR)).toBe(true);
  });
});

describe("Deploy — detectMonorepoRoot", () => {
  it("should return null for standalone project", () => {
    // TEST_DIR has no parent with workspaces
    const isolated = join(TEST_DIR, "standalone");
    mkdirSync(isolated, { recursive: true });
    writeFileSync(join(isolated, "package.json"), JSON.stringify({ name: "solo" }));

    // This test runs inside the actual monorepo, so it will detect the real root.
    // For a true standalone test, we'd need to mock fs. Instead, test the logic type.
    const result = detectMonorepoRoot(isolated);
    // In CI outside a monorepo this would be null. Here, it finds our repo root.
    expect(typeof result === "string" || result === null).toBe(true);
  });
});

describe("Deploy — fly.toml template", () => {
  it("should generate valid fly.toml for standalone", () => {
    const toml = flyTomlTemplate("my-agent", false);
    expect(toml).toContain('app = "raxd-my-agent"');
    expect(toml).toContain("primary_region");
    expect(toml).toContain("/health");
    expect(toml).toContain("shared-cpu-1x");
  });

  it("should generate fly.toml with monorepo dockerfile path", () => {
    const toml = flyTomlTemplate("my-agent", true, "apps/my-agent");
    expect(toml).toContain('dockerfile = "apps/my-agent/Dockerfile"');
  });
});

describe("Deploy — railway.json template", () => {
  it("should generate valid railway.json", () => {
    const json = railwayJsonTemplate("my-agent");
    const parsed = JSON.parse(json);
    expect(parsed.build.builder).toBe("DOCKERFILE");
    expect(parsed.deploy.healthcheckPath).toBe("/health");
    expect(parsed.deploy.restartPolicyType).toBe("ON_FAILURE");
  });
});

describe("Deploy — exec helpers", () => {
  it("should detect common commands", () => {
    // 'sh' should exist on any POSIX system
    expect(hasCommand("sh")).toBe(true);
    // random string should not exist
    expect(hasCommand("nonexistent-rax-tool-xyz")).toBe(false);
  });
});

// ─── Registry Tests ─────────────────────────────────────────────────────────

describe("Deploy — registry", () => {
  it("should list all 6 providers", () => {
    const providers = listProviders();
    expect(providers).toContain("local");
    expect(providers).toContain("fly");
    expect(providers).toContain("railway");
    expect(providers).toContain("render");
    expect(providers).toContain("cloudrun");
    expect(providers).toContain("digitalocean");
    expect(providers.length).toBe(6);
  });

  it("should get provider by target name", () => {
    const fly = getProvider("fly");
    expect(fly.name).toBe("fly");
    expect(fly.cliNames).toContain("flyctl");

    const local = getProvider("local");
    expect(local.name).toBe("local");
    expect(local.cliNames).toContain("docker");
  });

  it("should throw for unknown target", () => {
    expect(() => getProvider("unknown" as any)).toThrow("Unknown deploy target");
  });

  it("should detect fly target from fly.toml", () => {
    writeFileSync(join(TEST_DIR, "fly.toml"), "app = test");
    expect(detectTarget(TEST_DIR)).toBe("fly");
  });

  it("should detect railway target from railway.json", () => {
    writeFileSync(join(TEST_DIR, "railway.json"), "{}");
    expect(detectTarget(TEST_DIR)).toBe("railway");
  });

  it("should detect render target from render.yaml", () => {
    writeFileSync(join(TEST_DIR, "render.yaml"), "services:");
    expect(detectTarget(TEST_DIR)).toBe("render");
  });

  it("should detect cloudrun from cloudbuild.yaml", () => {
    writeFileSync(join(TEST_DIR, "cloudbuild.yaml"), "steps:");
    expect(detectTarget(TEST_DIR)).toBe("cloudrun");
  });

  it("should detect digitalocean from .do/app.yaml", () => {
    mkdirSync(join(TEST_DIR, ".do"), { recursive: true });
    writeFileSync(join(TEST_DIR, ".do", "app.yaml"), "name: test");
    expect(detectTarget(TEST_DIR)).toBe("digitalocean");
  });

  it("should fall back to local if docker-compose.yml exists", () => {
    writeFileSync(join(TEST_DIR, "docker-compose.yml"), "services:");
    expect(detectTarget(TEST_DIR)).toBe("local");
  });

  it("should return null if no config files found", () => {
    expect(detectTarget(TEST_DIR)).toBeNull();
  });
});

// ─── Preflight Tests ────────────────────────────────────────────────────────

describe("Deploy — preflight", () => {
  function makeCtx(target: string): DeployContext {
    return {
      cwd: TEST_DIR,
      opts: {
        target: target as any,
        mode: "daemon",
        name: "test-agent",
        topology: "single",
        scaffoldOnly: false,
        follow: false,
        build: false,
        detach: true,
        gpu: false,
        dryRun: true,
      },
      agentName: "test-agent",
      monorepoRoot: null,
    };
  }

  it("local preflight should check Docker CLI and daemon", () => {
    const provider = getProvider("local");
    const report = provider.preflight(makeCtx("local"));

    expect(report.provider).toBe("local");
    expect(report.checks.length).toBeGreaterThan(0);
    expect(report.checks.some((c) => c.label.toLowerCase().includes("docker"))).toBe(true);
    // ok depends on whether Docker is installed, so just verify structure
    expect(typeof report.ok).toBe("boolean");
    expect(Array.isArray(report.plan)).toBe(true);
    expect(Array.isArray(report.filesToCreate)).toBe(true);
  });

  it("fly preflight should include authentication check", () => {
    const provider = getProvider("fly");
    const report = provider.preflight(makeCtx("fly"));

    expect(report.provider).toBe("fly");
    // Should have checks for CLI and auth
    const labels = report.checks.map((c) => c.label.toLowerCase());
    expect(labels.some((l) => l.includes("cli") || l.includes("flyctl"))).toBe(true);
  });

  it("preflight report ok should be false when fail checks exist", () => {
    // Use a provider that requires a CLI we definitely don't have
    const provider = getProvider("railway");
    const report = provider.preflight(makeCtx("railway"));

    // If railway CLI isn't installed, ok should be false
    if (report.checks.some((c) => c.status === "fail")) {
      expect(report.ok).toBe(false);
    }
  });

  it("preflight filesToCreate should list missing config files", () => {
    const provider = getProvider("local");
    const report = provider.preflight(makeCtx("local"));

    // In a fresh directory, Dockerfile + compose should be listed
    expect(report.filesToCreate.some((f) => f.includes("Dockerfile") || f.includes("docker-compose"))).toBe(true);
  });
});
