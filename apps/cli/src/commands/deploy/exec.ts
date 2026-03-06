// apps/cli/src/commands/deploy/exec.ts
import { execSync, spawnSync, type SpawnSyncReturns } from "node:child_process";

/** Run a command and return stdout. Throws on failure. */
export function exec(cmd: string, cwd?: string): string {
  return execSync(cmd, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

/** Run a command with inherited stdio (user sees output). Returns exit code. */
export function execLive(cmd: string, cwd?: string): number {
  const result = spawnSync("sh", ["-c", cmd], {
    cwd,
    stdio: "inherit",
  });
  return result.status ?? 1;
}

/** Check if a CLI tool is available on PATH */
export function hasCommand(name: string): boolean {
  try {
    execSync(`command -v ${name}`, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Check if Docker daemon is running */
export function isDockerRunning(): boolean {
  try {
    execSync("docker info", { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Get container status via docker compose ps */
export function getComposeStatus(cwd: string): string {
  try {
    return exec("docker compose ps --format table", cwd);
  } catch {
    return "";
  }
}

/** Wait for a health endpoint to respond, with timeout */
export async function waitForHealth(
  url: string,
  timeoutMs: number = 30_000,
  intervalMs: number = 2_000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {
      // not ready yet
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

// ─── CLI Resolution ─────────────────────────────────────────────────────────

/** Containerized CLI images for providers that support Docker-based fallback */
const CONTAINER_CLI: Record<string, { image: string; credMounts: string[] }> = {
  flyctl: {
    image: "flyio/flyctl:latest",
    credMounts: ["~/.fly:/root/.fly"],
  },
  gcloud: {
    image: "gcr.io/google.com/cloudsdktool/cloud-sdk:slim",
    credMounts: ["~/.config/gcloud:/root/.config/gcloud"],
  },
  doctl: {
    image: "digitalocean/doctl:latest",
    credMounts: ["~/.config/doctl:/root/.config/doctl"],
  },
};

export interface ResolvedCli {
  /** How to invoke the CLI ("flyctl" or "docker run ...") */
  command: string;
  /** "local" if native binary, "container" if Docker wrapper */
  source: "local" | "container";
  /** Version string if we could detect it */
  version?: string;
}

/**
 * Resolve a CLI tool: local binary first, Docker container fallback.
 *
 * 1. If the binary is on PATH → use it directly (fastest, already authenticated)
 * 2. If Docker is available and we have a container image → wrap with `docker run`
 * 3. If neither → return null (caller should print install instructions)
 */
export function resolveCli(names: readonly string[]): ResolvedCli | null {
  // Try local first
  for (const name of names) {
    if (hasCommand(name)) {
      let version: string | undefined;
      try {
        version = exec(`${name} --version 2>/dev/null`).split("\n")[0];
      } catch {
        // some CLIs don't support --version
      }
      return { command: name, source: "local", version };
    }
  }

  // Try containerized fallback
  if (hasCommand("docker") && isDockerRunning()) {
    for (const name of names) {
      const container = CONTAINER_CLI[name];
      if (container) {
        const mounts = container.credMounts
          .map((m) => {
            const expanded = m.replace("~", process.env.HOME ?? "/root");
            return `-v ${expanded}`;
          })
          .join(" ");
        return {
          command: `docker run --rm ${mounts} -v "$(pwd)":/work -w /work ${container.image}`,
          source: "container",
        };
      }
    }
  }

  return null;
}
