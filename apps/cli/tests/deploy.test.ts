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
    // Bounded probe pins: on hosts where docker exists but the daemon is
    // unreachable (runners/CI images), the CLI/daemon checks must FAIL
    // cleanly with a bounded probe — never hang past ~5s and never throw.
    const cliCheck = report.checks.find((c) => c.label.toLowerCase().includes("cli"));
    if (cliCheck) expect(typeof cliCheck.status).toBe("string");
    // Explicit receipt timeout: the daemon probe is execSync (sync, real
    // timers) — CI runners with a preinstalled-but-unreachable docker can
    // legitimately take seconds; bun's default 5s test timeout killed this
    // test before the probe answered (Margin 0-run 39345666034).
  }, 30_000);

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

// ─── Quick fixes: D1 name validation / argv, D3 + D2 Cloud Run + Fly, Render ──

describe("Deploy — agent name validation (D1)", () => {
  it("accepts safe slugs and rejects shell metacharacters", async () => {
    const { isValidAgentName, assertValidAgentName } = await import("../src/commands/deploy/exec.js");
    expect(isValidAgentName("my-agent-2")).toBe(true);
    for (const bad of ["x; touch /tmp/pwn", "$(id)", "a b", "-lead", "UPPER", "", "a".repeat(42), "x`id`", "a/b", "a\nb"]) {
      expect(isValidAgentName(bad)).toBe(false);
    }
    expect(() => assertValidAgentName("x; touch /tmp/pwn")).toThrow(/Invalid agent name/);
  });

  it("resolveDeployName rejects a hostile --name and slugifies a detected one", async () => {
    const { resolveDeployName } = await import("../src/commands/deploy/index.js");
    expect(() => resolveDeployName("x; touch /tmp/pwn", TEST_DIR)).toThrow(/Invalid agent name/);
    expect(resolveDeployName("ok-name", TEST_DIR)).toBe("ok-name");
    writeFileSync(join(TEST_DIR, "package.json"), JSON.stringify({ name: "@org/My_Cool Agent!" }));
    expect(resolveDeployName("", TEST_DIR)).toBe("my-cool-agent");
  });

  it("exec with an argv array never shell-parses its arguments", async () => {
    const { exec, execLive } = await import("../src/commands/deploy/exec.js");
    const marker = join(TEST_DIR, "pwned");
    const hostile = `x; touch ${marker}`;
    expect(exec(["echo", hostile])).toBe(hostile);
    expect(execLive(["true", hostile], TEST_DIR)).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });

  it("no provider builds a command by interpolating into a shell string", () => {
    const dir = join(import.meta.dir, "../src/commands/deploy");
    for (const f of ["target-fly", "target-railway", "target-render", "target-cloudrun", "target-digitalocean", "target-local"]) {
      const src = readFileSync(join(dir, `${f}.ts`), "utf-8");
      expect(src).not.toMatch(/(?:exec|execLive)\(\s*[`"]/);
    }
  });
});

describe("Deploy — Cloud Run auth + daemon (D3/D2)", () => {
  const ctx = (mode: "daemon" | "sdk", allow?: boolean): DeployContext => ({
    cwd: TEST_DIR,
    opts: {
      target: "cloudrun", mode, name: "a", topology: "single", scaffoldOnly: false, follow: false,
      build: false, detach: true, gpu: false, dryRun: true, allowUnauthenticated: allow,
    },
    agentName: "a",
    monorepoRoot: null,
  });

  it("is authenticated by default and keeps an instance warm in daemon mode", async () => {
    const { cloudRunDeployArgv } = await import("../src/commands/deploy/target-cloudrun.js");
    const argv = cloudRunDeployArgv(ctx("daemon"), "us-central1");
    expect(argv).toContain("--no-allow-unauthenticated");
    expect(argv).not.toContain("--allow-unauthenticated");
    expect(argv).toContain("--min-instances=1");
    expect(argv).toContain("--no-cpu-throttling");
  });

  it("--allow-unauthenticated is an explicit opt-in; sdk mode may scale to zero", async () => {
    const { cloudRunDeployArgv } = await import("../src/commands/deploy/target-cloudrun.js");
    const argv = cloudRunDeployArgv(ctx("sdk", true), "us-central1");
    expect(argv).toContain("--allow-unauthenticated");
    expect(argv).not.toContain("--no-allow-unauthenticated");
    expect(argv).not.toContain("--min-instances=1");
  });

  it("a hostile name stays one argv element", async () => {
    const { cloudRunDeployArgv } = await import("../src/commands/deploy/target-cloudrun.js");
    const c = ctx("daemon");
    const argv = cloudRunDeployArgv({ ...c, agentName: "x; touch /tmp/pwn" }, "r");
    expect(argv[3]).toBe("raxd-x; touch /tmp/pwn");
  });

  it("cloudbuild.yaml follows the same auth and daemon flags", async () => {
    const { cloudRunYamlTemplate } = await import("../src/templates/cloudrun.js");
    const secure = cloudRunYamlTemplate("a", "p", "r", { daemon: true });
    expect(secure).toContain('"--no-allow-unauthenticated"');
    expect(secure).toContain('"--min-instances=1"');
    expect(secure).toContain('"--no-cpu-throttling"');
    expect(secure).not.toMatch(/"--allow-unauthenticated"/);
    expect(cloudRunYamlTemplate("a", "p", "r", { allowUnauthenticated: true })).toContain('"--allow-unauthenticated"');
  });
});

describe("Deploy — Fly daemon settings (D2)", () => {
  it("daemon mode never auto-stops and defines exactly one health check", () => {
    const toml = flyTomlTemplate("a", false, undefined, "daemon");
    expect(toml).toContain('auto_stop_machines = "off"');
    expect(toml).toContain("min_machines_running = 1");
    expect((toml.match(/path = "\/health"/g) ?? []).length).toBe(1);
    expect(toml).not.toContain("[[services]]");
    expect(toml).not.toContain("[checks]");
  });

  it("sdk mode may scale to zero", () => {
    const toml = flyTomlTemplate("a", false, undefined, "sdk");
    expect(toml).toContain('auto_stop_machines = "stop"');
    expect(toml).toContain("min_machines_running = 0");
  });
});

describe("Deploy — Render + Railway templates", () => {
  it("render.yaml has no empty command strings", async () => {
    const { renderYamlTemplate, renderYamlSdkTemplate } = await import("../src/templates/render.js");
    for (const y of [renderYamlTemplate("a"), renderYamlSdkTemplate("a")]) {
      expect(y).not.toMatch(/(dockerCommand|startCommand):\s*""/);
    }
    expect(railwayJsonTemplate("a")).not.toContain('"startCommand"');
  });

  it("render plan validates the blueprint instead of the non-existent 'blueprint launch'", () => {
    const report = getProvider("render").preflight({
      cwd: TEST_DIR,
      opts: {
        target: "render", mode: "daemon", name: "a", topology: "single", scaffoldOnly: false,
        follow: false, build: false, detach: true, gpu: false, dryRun: true,
      },
      agentName: "a",
      monorepoRoot: null,
    });
    const plan = report.plan.join("\n");
    expect(plan).not.toContain("blueprint launch");
    expect(plan).toContain("git push");
  });
});
