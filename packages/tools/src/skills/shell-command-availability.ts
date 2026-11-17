/**
 * Deterministic PATH availability for the commands a shell tool may run.
 *
 * A planner should never spend a step (or a model turn) on `gh --version` just
 * to learn whether an allowed executable exists. This scans PATH directly,
 * with no process spawn and no model, and caches each answer per
 * (PATH, command) so repeated plan builds cost nothing.
 *
 * Host-shell only: with `sandbox: "docker"` the commands run in a container
 * whose PATH is not this process's PATH, so callers must not use it there.
 */
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, join } from "node:path";

import type { ShellCommandPolicy } from "../types.js";

/** Which allowed executables exist on PATH, split for direct rendering. */
export interface ShellCommandAvailability {
  readonly available: ReadonlyArray<string>;
  readonly missing: ReadonlyArray<string>;
}

const cache = new Map<string, boolean>();

const isExecutableFile = (path: string): boolean => {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** True when `command` resolves to an executable file on `pathEnv` (default: process PATH). Cached. */
export function isCommandOnPath(command: string, pathEnv: string = process.env.PATH ?? ""): boolean {
  const key = `${pathEnv}\u0000${command}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const exts =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter(Boolean)]
      : [""];
  const found = pathEnv
    .split(delimiter)
    .filter((dir) => dir !== "")
    .some((dir) => exts.some((ext) => isExecutableFile(join(dir, command + ext))));
  cache.set(key, found);
  return found;
}

/**
 * Split a shell tool's allowed commands by PATH presence. Reads
 * `definition.commandPolicy.allowedCommands`, so there is no second list.
 * Returns empty lists for a tool with no command policy.
 */
export function shellCommandAvailability(
  policy: Pick<ShellCommandPolicy, "allowedCommands"> | undefined,
  pathEnv?: string,
): ShellCommandAvailability {
  const available: string[] = [];
  const missing: string[] = [];
  for (const c of policy?.allowedCommands ?? []) {
    (isCommandOnPath(c, pathEnv) ? available : missing).push(c);
  }
  return { available, missing };
}

/** Drop the memoized answers (tests, or after the host installs a tool mid-process). */
export function clearCommandAvailabilityCache(): void {
  cache.clear();
}
