// File: apps/cli/src/runtime.ts
//
// Runtime detection for rax. The CLI ships with a Node shebang and runs on
// Node.js 22.5+ or Bun. A few commands need Bun itself (they run TypeScript
// sources directly or start the Bun-only Cortex server); those call
// `ensureBunRuntime`, which re-runs the same invocation under Bun when it is
// installed and otherwise prints one clear line instead of a stack trace.

import { spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { PackageManager } from "create-reactive-agent";
import { fail } from "./ui.js";

/** True when this process is running on the Bun runtime. */
export function isBunRuntime(): boolean {
  return typeof process.versions.bun === "string";
}

/** True when a `bun` executable is on PATH (probes `bun --version`). */
export function hasBunOnPath(): boolean {
  const probe = spawnSync("bun", ["--version"], { stdio: "ignore" });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Portable "is this module the process entrypoint?". Uses `import.meta.main`
 * when the runtime provides it (Bun, Node 24.2+); otherwise compares real
 * paths, so npm's `node_modules/.bin/rax` symlink still counts as the entry.
 */
export function isEntrypoint(moduleUrl: string, mainFlag: boolean | undefined): boolean {
  if (typeof mainFlag === "boolean") return mainFlag;
  const argv1 = process.argv[1];
  if (!argv1) return false;
  try {
    return realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}

/**
 * Package manager for generated next steps and install hints: bun under the
 * Bun runtime, else the one that launched rax (`npm_config_user_agent`, the
 * same rule as the create-reactive-agent CLI), else npm. `bun run rax` and
 * `bunx rax` honor rax's Node shebang, so the user agent is what still
 * identifies a Bun user there.
 */
export function detectPackageManager(
  env: Readonly<Record<string, string | undefined>> = process.env,
  bunRuntime: boolean = isBunRuntime(),
): PackageManager {
  if (bunRuntime) return "bun";
  const ua = env.npm_config_user_agent ?? "";
  if (ua.startsWith("bun")) return "bun";
  if (ua.startsWith("pnpm")) return "pnpm";
  if (ua.startsWith("yarn")) return "yarn";
  return "npm";
}

/** The install command for `pkg` in the given package manager. */
export function installCommand(pm: PackageManager, pkg: string): string {
  return pm === "npm" ? `npm install ${pkg}` : `${pm} add ${pkg}`;
}

/**
 * Gate for commands that need the Bun runtime. Returns when already on Bun.
 * On Node with Bun installed, re-runs this exact invocation under Bun and
 * exits with its status. Without Bun, prints one line and exits 1.
 */
export function ensureBunRuntime(command: string, reason: string): void {
  if (isBunRuntime()) return;
  const script = process.argv[1];
  if (script && hasBunOnPath()) {
    const child = spawnSync("bun", [script, ...process.argv.slice(2)], { stdio: "inherit" });
    process.exit(child.status ?? 1);
  }
  console.error(fail(`rax ${command} needs Bun (${reason}). Install it from https://bun.sh, then re-run.`));
  process.exit(1);
}
