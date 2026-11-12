// apps/cli/src/commands/deploy/exec.ts
import { execFileSync, execSync, spawnSync } from "node:child_process";

/**
 * A command to run: an argv array (program first) or, for legacy fixed strings only,
 * a shell string. Deploy targets MUST pass argv arrays so no value is ever shell-parsed.
 */
export type Command = string | readonly string[];

/** Agent names become app/service names and file contents: keep them to a safe slug. */
export const AGENT_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,40}$/;

/** True when `name` is a safe deploy agent name (`/^[a-z0-9][a-z0-9-]{0,40}$/`). */
export function isValidAgentName(name: string): boolean {
  return AGENT_NAME_PATTERN.test(name);
}

/** Throw a clear error for an unsafe agent name; returns the name when valid. */
export function assertValidAgentName(name: string): string {
  if (!isValidAgentName(name)) {
    throw new Error(
      `Invalid agent name "${name}". Use lowercase letters, digits and "-" only, ` +
        `starting with a letter or digit, at most 41 characters (${AGENT_NAME_PATTERN}).`,
    );
  }
  return name;
}

/** Derive a valid agent name from an arbitrary string (package/dir name). */
export function slugifyAgentName(raw: string): string {
  const slug = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 41)
    .replace(/-+$/g, "");
  return slug || "agent";
}

/** Run a command and return stdout. Throws on failure. */
export function exec(cmd: Command, cwd?: string): string {
  const stdio: ["pipe", "pipe", "pipe"] = ["pipe", "pipe", "pipe"];
  if (typeof cmd === "string") {
    return execSync(cmd, { cwd, encoding: "utf-8", stdio }).trim();
  }
  const [program, ...args] = cmd;
  return execFileSync(program, args, { cwd, encoding: "utf-8", stdio }).trim();
}

/** Run a command with inherited stdio (user sees output). Returns exit code. */
export function execLive(cmd: Command, cwd?: string): number {
  const result =
    typeof cmd === "string"
      ? spawnSync("sh", ["-c", cmd], { cwd, stdio: "inherit" })
      : spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: "inherit" });
  return result.status ?? 1;
}

/** Run an argv command silently (no output). Returns exit code; 1 when it cannot start. */
export function execQuiet(argv: readonly string[], cwd?: string): number {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, stdio: "ignore" });
  return result.status ?? 1;
}

/** Check if a CLI tool is available on PATH */
export function hasCommand(name: string): boolean {
  try {
    // name is a positional parameter ($1), never interpolated into the script.
    execFileSync("sh", ["-c", 'command -v "$1"', "sh", name], { stdio: "pipe", timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

/** Check if Docker daemon is running */
export function isDockerRunning(): boolean {
  try {
    // Bounded probe: hosts where the docker CLI exists but the daemon is
    // unreachable (runner images, locked-down CI) can block this for
    // seconds-to-minutes on socket retries. The preflight must ANSWER, not
    // hang, so a slow/unresponsive daemon reports as not-running.
    execSync("docker info", { stdio: "pipe", timeout: 5_000 });
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
        version = exec([name, "--version"]).split("\n")[0];
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
