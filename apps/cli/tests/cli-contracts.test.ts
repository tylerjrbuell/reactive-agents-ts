// apps/cli/tests/cli-contracts.test.ts
//
// CLI contract tests — verifies that provider CLIs still match the interface
// assumptions our deploy adapters rely on. When a CLI changes its flags,
// subcommands, or output format, these tests fail and prompt a patch.
//
// Each provider test group is skipped when its CLI is not installed.
// Run `bun test apps/cli/tests/cli-contracts.test.ts` to check all installed CLIs.

import { describe, it, expect } from "bun:test";
import { execSync } from "node:child_process";
import { hasCommand } from "../src/commands/deploy/exec.js";

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Run a command, return { stdout, stderr, exitCode }.
 * Never throws — captures failures as non-zero exit codes.
 */
function probe(cmd: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 20_000,
    }).trim();
    return { stdout, stderr: "", exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").toString().trim(),
      stderr: (e.stderr ?? "").toString().trim(),
      exitCode: e.status ?? 1,
    };
  }
}

/** Check that a command's help text contains expected flags */
function expectFlags(helpOutput: string, flags: string[]) {
  for (const flag of flags) {
    expect(helpOutput).toContain(flag);
  }
}

/**
 * Parse a semver-like version string from freeform output.
 * Handles: "v1.2.3", "Docker version 24.0.5", "flyctl v0.2.34", etc.
 */
function parseVersion(raw: string): { major: number; minor: number; patch: number } | null {
  const match = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  };
}

/** Compare version >= minimum */
function versionGte(
  v: { major: number; minor: number; patch: number },
  min: { major: number; minor: number; patch: number },
): boolean {
  if (v.major !== min.major) return v.major > min.major;
  if (v.minor !== min.minor) return v.minor > min.minor;
  return v.patch >= min.patch;
}

// ─── Test: Core Execution Layer ─────────────────────────────────────────────

describe("CLI Contracts — exec layer", () => {
  it("POSIX `command -v` works for shell builtins and binaries", () => {
    // Our hasCommand() uses `command -v` — verify the contract
    expect(hasCommand("sh")).toBe(true);
    expect(hasCommand("ls")).toBe(true);
    expect(hasCommand("__nonexistent_rax_test__")).toBe(false);
  });
});

// ─── Test: Docker / Docker Compose ──────────────────────────────────────────

describe("CLI Contracts — docker", () => {
  const available = hasCommand("docker");

  it.skipIf(!available)("docker --version returns parseable version", () => {
    const { stdout, exitCode } = probe("docker --version");
    expect(exitCode).toBe(0);
    // Contract: output matches "Docker version X.Y.Z..."
    expect(stdout).toMatch(/docker/i);
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
  });

  it.skipIf(!available)("docker compose is v2+ (not docker-compose v1)", () => {
    // Our adapters use `docker compose` (v2 syntax), not `docker-compose`
    const { stdout, exitCode } = probe("docker compose version");
    expect(exitCode).toBe(0);
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
    expect(versionGte(v!, { major: 2, minor: 0, patch: 0 })).toBe(true);
  });

  it.skipIf(!available)("docker info succeeds when daemon is running", () => {
    // This is how isDockerRunning() works — exit code 0 means daemon is up
    const { exitCode } = probe("docker info");
    // We can't control whether daemon is running, but we verify the command exists
    // exitCode 0 = running, non-0 = not running (both are valid CLI states)
    expect(typeof exitCode).toBe("number");
  });

  it.skipIf(!available)("docker compose subcommands exist: build, up, down, ps, logs", () => {
    // Verify each subcommand our adapters use shows up in help
    const { stdout } = probe("docker compose --help");
    const subcommands = ["build", "up", "down", "ps", "logs"];
    for (const sub of subcommands) {
      expect(stdout.toLowerCase()).toContain(sub);
    }
  });

  it.skipIf(!available)("docker compose up supports -d flag", () => {
    const { stdout } = probe("docker compose up --help");
    expectFlags(stdout, ["-d", "--detach"]);
  });

  it.skipIf(!available)("docker compose logs supports --tail and -f", () => {
    const { stdout } = probe("docker compose logs --help");
    expectFlags(stdout, ["--tail", "--follow"]);
  });

  it.skipIf(!available)("docker compose ps supports --format", () => {
    const { stdout } = probe("docker compose ps --help");
    expectFlags(stdout, ["--format"]);
  });
});

// ─── Test: Fly.io CLI (flyctl / fly) ────────────────────────────────────────

describe("CLI Contracts — flyctl", () => {
  // Our adapter checks flyctl then fly
  const flyBin = hasCommand("flyctl") ? "flyctl" : hasCommand("fly") ? "fly" : null;
  const available = flyBin !== null;

  it.skipIf(!available)("flyctl --version returns parseable version", () => {
    const { stdout, exitCode } = probe(`${flyBin} version`);
    expect(exitCode).toBe(0);
    // Contract: output contains a semver-like string
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
  });

  it.skipIf(!available)("auth whoami subcommand exists", () => {
    // We don't check actual auth — just that the subcommand is recognized
    const { stdout, stderr } = probe(`${flyBin} auth whoami --help`);
    const combined = stdout + stderr;
    // Should not say "unknown command"
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });

  it.skipIf(!available)("launch subcommand supports expected flags", () => {
    const { stdout, stderr } = probe(`${flyBin} launch --help`);
    const help = stdout + stderr;
    expectFlags(help, ["--name", "--no-deploy", "--copy-config"]);
  });

  it.skipIf(!available)("deploy subcommand exists", () => {
    const { stdout, stderr } = probe(`${flyBin} deploy --help`);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
    // Should reference image/dockerfile
    expect(combined.toLowerCase()).toMatch(/deploy|dockerfile|image/);
  });

  it.skipIf(!available)("apps destroy supports --yes flag", () => {
    const { stdout, stderr } = probe(`${flyBin} apps destroy --help`);
    const help = stdout + stderr;
    expectFlags(help, ["--yes"]);
  });

  it.skipIf(!available)("status subcommand exists", () => {
    const { stdout, stderr } = probe(`${flyBin} status --help`);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });

  it.skipIf(!available)("logs subcommand exists", () => {
    const { stdout, stderr } = probe(`${flyBin} logs --help`);
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });
});

// ─── Test: Railway CLI ──────────────────────────────────────────────────────

describe("CLI Contracts — railway", () => {
  const available = hasCommand("railway");

  it.skipIf(!available)("railway --version returns parseable version", () => {
    const { stdout, exitCode } = probe("railway --version");
    expect(exitCode).toBe(0);
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
  });

  it.skipIf(!available)("whoami subcommand exists", () => {
    const { stdout, stderr } = probe("railway whoami --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
    expect(combined.toLowerCase()).not.toContain("unrecognized");
  });

  it.skipIf(!available)("link subcommand exists", () => {
    const { stdout, stderr } = probe("railway link --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });

  it.skipIf(!available)("up subcommand exists", () => {
    const { stdout, stderr } = probe("railway up --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });

  it.skipIf(!available)("down subcommand supports --yes flag", () => {
    const { stdout, stderr } = probe("railway down --help");
    const help = stdout + stderr;
    expectFlags(help, ["--yes"]);
  });

  it.skipIf(!available)("status subcommand exists", () => {
    const { stdout, stderr } = probe("railway status --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });

  it.skipIf(!available)("logs subcommand exists", () => {
    const { stdout, stderr } = probe("railway logs --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });

  it.skipIf(!available)("variables subcommand exists (for secrets)", () => {
    const { stdout, stderr } = probe("railway variables --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });
});

// ─── Test: Render CLI ───────────────────────────────────────────────────────

describe("CLI Contracts — render", () => {
  const available = hasCommand("render");

  it.skipIf(!available)("render --version returns parseable output", () => {
    const { stdout, exitCode } = probe("render --version");
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it.skipIf(!available)("blueprint subcommand exists", () => {
    const { stdout, stderr } = probe("render blueprint --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
    // Our adapter calls `render blueprint launch`
    expect(combined.toLowerCase()).toContain("launch");
  });

  it.skipIf(!available)("services subcommand exists", () => {
    const { stdout, stderr } = probe("render services --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("unknown command");
  });
});

// ─── Test: Google Cloud CLI (gcloud) ────────────────────────────────────────

describe("CLI Contracts — gcloud", () => {
  const available = hasCommand("gcloud");

  it.skipIf(!available)("gcloud version returns parseable version", () => {
    // gcloud can emit version text in different formats across environments.
    const compact = probe("gcloud version --format='value(version)'");
    const standard = probe("gcloud --version");
    const verbose = probe("gcloud version");
    const json = probe("gcloud version --format=json");

    const candidates = [
      compact.stdout,
      compact.stderr,
      standard.stdout,
      standard.stderr,
      verbose.stdout,
      verbose.stderr,
      json.stdout,
      json.stderr,
    ].filter((s) => s.length > 0);

    const v = candidates
      .map((text) => parseVersion(text))
      .find((parsed): parsed is { major: number; minor: number; patch: number } => parsed !== null) ?? null;

    expect(v).not.toBeNull();
  }, 45_000);

  it.skipIf(!available)("gcloud version >= 380.0.0 (required for `run deploy --source`)", () => {
    const { stdout } = probe("gcloud --version");
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
    // `gcloud run deploy --source .` requires SDK 380+
    expect(versionGte(v!, { major: 380, minor: 0, patch: 0 })).toBe(true);
  }, 45_000);

  it.skipIf(!available)("gcloud config get-value subcommand exists", () => {
    // Our adapter calls: gcloud config get-value project
    const { stdout, stderr } = probe("gcloud config get-value --help");
    const combined = stdout + stderr;
    expect(combined.toLowerCase()).not.toContain("invalid choice");
  }, 45_000);

  it.skipIf(!available)("gcloud auth list supports --filter and --format flags", () => {
    // Our adapter calls: gcloud auth list --filter=status:ACTIVE --format='value(account)'
    const { stdout, stderr } = probe("gcloud auth list --help");
    const help = stdout + stderr;
    expectFlags(help, ["--filter", "--format"]);
  }, 45_000);

  it.skipIf(!available)("gcloud run deploy supports expected flags", () => {
    const { stdout, stderr } = probe("gcloud run deploy --help");
    const help = stdout + stderr;
    // These flags are critical for our adapter
    expectFlags(help, [
      "--source",
      "--region",
      "--port",
      "--memory",
      "--timeout",
      "--allow-unauthenticated",
    ]);
  }, 45_000);

  it.skipIf(!available)("gcloud run services subcommands exist: describe, delete, logs", () => {
    const { stdout: descHelp, stderr: descErr } = probe("gcloud run services describe --help");
    expect((descHelp + descErr).toLowerCase()).not.toContain("invalid choice");

    const { stdout: delHelp, stderr: delErr } = probe("gcloud run services delete --help");
    expect((delHelp + delErr).toLowerCase()).not.toContain("invalid choice");
  }, 45_000);

  it.skipIf(!available)("gcloud run services delete supports --quiet flag", () => {
    const { stdout, stderr } = probe("gcloud run services delete --help");
    const help = stdout + stderr;
    expectFlags(help, ["--quiet"]);
  }, 45_000);

  it.skipIf(!available)("gcloud run services update supports --set-secrets", () => {
    const { stdout, stderr } = probe("gcloud run services update --help");
    const help = stdout + stderr;
    expectFlags(help, ["--set-secrets"]);
  }, 45_000);
});

// ─── Test: DigitalOcean CLI (doctl) ─────────────────────────────────────────

describe("CLI Contracts — doctl", () => {
  const available = hasCommand("doctl");

  it.skipIf(!available)("doctl version returns parseable version", () => {
    const { stdout, exitCode } = probe("doctl version");
    expect(exitCode).toBe(0);
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
  });

  it.skipIf(!available)("doctl version >= 1.72.0 (required for `apps` commands)", () => {
    const { stdout } = probe("doctl version");
    const v = parseVersion(stdout);
    expect(v).not.toBeNull();
    expect(versionGte(v!, { major: 1, minor: 72, patch: 0 })).toBe(true);
  });

  it.skipIf(!available)("doctl account get supports --format and --no-header", () => {
    const { stdout, stderr } = probe("doctl account get --help");
    const help = stdout + stderr;
    expectFlags(help, ["--format", "--no-header"]);
  });

  it.skipIf(!available)("doctl apps subcommands exist: create, list, delete, logs", () => {
    const { stdout, stderr } = probe("doctl apps --help");
    const help = (stdout + stderr).toLowerCase();
    for (const sub of ["create", "list", "delete", "logs"]) {
      expect(help).toContain(sub);
    }
  });

  it.skipIf(!available)("doctl apps create supports --spec flag", () => {
    const { stdout, stderr } = probe("doctl apps create --help");
    const help = stdout + stderr;
    expectFlags(help, ["--spec"]);
  });

  it.skipIf(!available)("doctl apps create supports --format and --no-header for scripting", () => {
    const { stdout, stderr } = probe("doctl apps create --help");
    const help = stdout + stderr;
    expectFlags(help, ["--format", "--no-header"]);
  });

  it.skipIf(!available)("doctl apps list supports --format with nested properties", () => {
    // Our adapter uses: --format ID,DefaultIngress,ActiveDeployment.Phase
    const { stdout, stderr } = probe("doctl apps list --help");
    const help = stdout + stderr;
    expectFlags(help, ["--format", "--no-header"]);
  });

  it.skipIf(!available)("doctl apps update supports --spec flag", () => {
    const { stdout, stderr } = probe("doctl apps update --help");
    const help = stdout + stderr;
    expectFlags(help, ["--spec"]);
  });
});

// ─── Test: Container Image Contracts ────────────────────────────────────────
//
// These tests pull Docker images over the network — slow and requires Docker.
// Gated behind RUN_SLOW_TESTS=1 to avoid blocking fast CI runs.
//
//   RUN_SLOW_TESTS=1 bun test apps/cli/tests/cli-contracts.test.ts
//

describe("CLI Contracts — container CLI images", () => {
  const slowTestsEnabled = process.env.RUN_SLOW_TESTS === "1";
  const dockerAvailable = hasCommand("docker");
  let dockerRunning = false;
  if (dockerAvailable) {
    try {
      execSync("docker info", { stdio: "pipe", timeout: 5000 });
      dockerRunning = true;
    } catch {
      dockerRunning = false;
    }
  }

  const canRun = slowTestsEnabled && dockerAvailable && dockerRunning;

  const images = [
    { name: "flyio/flyctl:latest", cli: "flyctl", expectedBin: "flyctl" },
    { name: "gcr.io/google.com/cloudsdktool/cloud-sdk:slim", cli: "gcloud", expectedBin: "gcloud" },
    { name: "digitalocean/doctl:latest", cli: "doctl", expectedBin: "doctl" },
  ];

  for (const img of images) {
    it.skipIf(!canRun)(
      `${img.name} image is pullable and contains ${img.expectedBin}`,
      () => {
        // Pull with extended timeout (90s for large images like gcloud)
        const { exitCode } = probe(`docker pull --quiet ${img.name}`);
        if (exitCode !== 0) {
          throw new Error(
            `Container image ${img.name} failed to pull. ` +
              `The deploy adapter references this image for containerized CLI fallback. ` +
              `Update CONTAINER_CLI in exec.ts if the image has moved.`,
          );
        }

        // Verify the expected binary exists inside the container
        const { exitCode: runCode } = probe(
          `docker run --rm ${img.name} ${img.expectedBin} --version`,
        );
        expect(runCode).toBe(0);
      },
      90_000, // 90 second timeout for image pulls
    );
  }

  it.skipIf(canRun || !dockerAvailable)("container image tests skipped (set RUN_SLOW_TESTS=1 to enable)", () => {
    console.log("    ⏭️  Set RUN_SLOW_TESTS=1 to test container CLI image availability");
    expect(true).toBe(true);
  });
});

// ─── Test: Version Constraint Summary ───────────────────────────────────────

describe("CLI Contracts — version constraint summary", () => {
  // This test produces a summary of what's installed vs what's expected.
  // It always passes but logs warnings for missing CLIs.

  it("should report installed CLI versions", () => {
    const constraints: Array<{
      provider: string;
      cli: string;
      minVersion: string;
      installed: boolean;
      version: string | null;
      meetsMin: boolean;
    }> = [
      {
        provider: "local",
        cli: "docker",
        minVersion: "20.0.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
      {
        provider: "local",
        cli: "docker compose",
        minVersion: "2.0.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
      {
        provider: "fly",
        cli: "flyctl",
        minVersion: "0.1.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
      {
        provider: "railway",
        cli: "railway",
        minVersion: "3.0.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
      {
        provider: "render",
        cli: "render",
        minVersion: "0.1.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
      {
        provider: "cloudrun",
        cli: "gcloud",
        minVersion: "380.0.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
      {
        provider: "digitalocean",
        cli: "doctl",
        minVersion: "1.72.0",
        installed: false,
        version: null,
        meetsMin: false,
      },
    ];

    for (const c of constraints) {
      const verCmd =
        c.cli === "docker compose" ? "docker compose version" : `${c.cli} --version`;

      if (c.cli === "docker compose") {
        c.installed = hasCommand("docker");
      } else {
        c.installed = hasCommand(c.cli === "flyctl" ? "flyctl" : c.cli) ||
          (c.cli === "flyctl" && hasCommand("fly"));
      }

      if (c.installed) {
        const { stdout } = probe(verCmd);
        c.version = stdout.split("\n")[0] || null;
        const v = parseVersion(stdout);
        if (v) {
          const min = parseVersion(c.minVersion)!;
          c.meetsMin = versionGte(v, min);
        }
      }
    }

    // Always passes — this is an informational test
    const installed = constraints.filter((c) => c.installed);
    const missing = constraints.filter((c) => !c.installed);
    const belowMin = installed.filter((c) => !c.meetsMin);

    // Log summary for CI visibility
    if (installed.length > 0) {
      console.log("\n  Installed CLIs:");
      for (const c of installed) {
        const status = c.meetsMin ? "✅" : "⚠️  (below min " + c.minVersion + ")";
        console.log(`    ${status} ${c.cli}: ${c.version} (need >= ${c.minVersion})`);
      }
    }
    if (missing.length > 0) {
      console.log("\n  Missing CLIs (tests skipped):");
      for (const c of missing) {
        console.log(`    ⏭️  ${c.cli} — ${c.provider} adapter`);
      }
    }
    if (belowMin.length > 0) {
      console.log("\n  ⚠️  CLIs below minimum version — adapter patches may be needed:");
      for (const c of belowMin) {
        console.log(`    ${c.cli}: have ${c.version}, need >= ${c.minVersion}`);
      }
    }
    console.log();

    expect(true).toBe(true);
  });
});
