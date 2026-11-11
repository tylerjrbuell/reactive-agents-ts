/**
 * The versions Settings · About shows.
 *
 * Workspace packages keep a frozen baseline version in package.json (the release
 * stamps the real one at tag time), so in a source checkout package.json says
 * `0.10.6` while the repo is at, say, `0.18.0`. Rules:
 * - Source checkout (a monorepo root with `VERSION` and the `reactive-agents`
 *   workspace package.json above the Cortex package): Cortex and framework both read
 *   `VERSION`, plus the git short sha when git answers.
 * - Published package: Cortex reads its own (stamped) package.json; the framework
 *   version is `@reactive-agents/runtime`'s stamped package.json.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** What `GET /api/health` reports about versions. */
export interface CortexVersionInfo {
  /** Cortex version (e.g. `0.18.0`). */
  readonly cortexVersion: string;
  /** Framework (`@reactive-agents/runtime`) version, or null when it cannot be found. */
  readonly frameworkVersion: string | null;
  /** Git short sha of a source checkout, else null. */
  readonly commit: string | null;
  /** `workspace` = running from the monorepo; `package` = an installed package. */
  readonly origin: "workspace" | "package";
}

/** Injectable file and git access (tests). */
export interface VersionDeps {
  readonly readText: (path: string) => string | undefined;
  readonly gitShortSha: (cwd: string) => string | null;
  /** Path of `@reactive-agents/runtime`'s entry file, or undefined. */
  readonly runtimeEntry: () => string | undefined;
}

const readJson = (deps: VersionDeps, path: string): Record<string, unknown> | undefined => {
  const raw = deps.readText(path);
  if (raw === undefined) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
};

const versionField = (pkg: Record<string, unknown> | undefined): string | undefined =>
  typeof pkg?.version === "string" && pkg.version.trim() ? pkg.version.trim() : undefined;

/** The monorepo root above `from` (has `VERSION` and the `reactive-agents` workspace package.json). */
export function findWorkspaceRoot(from: string, deps: VersionDeps): string | undefined {
  let dir = from;
  for (let i = 0; i < 8; i++) {
    const pkg = readJson(deps, join(dir, "package.json"));
    if (pkg?.name === "reactive-agents" && Array.isArray(pkg.workspaces) && deps.readText(join(dir, "VERSION")) !== undefined) {
      return dir;
    }
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
}

/** Nearest `@reactive-agents/runtime` package.json version above its entry file. */
function runtimePackageVersion(deps: VersionDeps): string | undefined {
  const entry = deps.runtimeEntry();
  if (!entry) return undefined;
  let dir = dirname(entry);
  for (let i = 0; i < 6; i++) {
    const pkg = readJson(deps, join(dir, "package.json"));
    if (pkg?.name === "@reactive-agents/runtime") return versionField(pkg);
    const up = dirname(dir);
    if (up === dir) return undefined;
    dir = up;
  }
  return undefined;
}

/**
 * Resolve the versions for the Cortex package rooted at `cortexRoot`
 * (the directory holding Cortex's package.json).
 */
export function resolveCortexVersion(cortexRoot: string, deps: VersionDeps = defaultVersionDeps): CortexVersionInfo {
  const own = versionField(readJson(deps, join(cortexRoot, "package.json"))) ?? "0.0.0";
  const root = findWorkspaceRoot(dirname(cortexRoot), deps);
  if (root) {
    const v = deps.readText(join(root, "VERSION"))?.trim() || own;
    return { cortexVersion: v, frameworkVersion: v, commit: deps.gitShortSha(root), origin: "workspace" };
  }
  return { cortexVersion: own, frameworkVersion: runtimePackageVersion(deps) ?? null, commit: null, origin: "package" };
}

/** Real file system, git and module resolution. */
export const defaultVersionDeps: VersionDeps = {
  readText: (path) => {
    try {
      return existsSync(path) ? readFileSync(path, "utf8") : undefined;
    } catch {
      return undefined;
    }
  },
  gitShortSha: (cwd) => {
    try {
      const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2_000,
      }).trim();
      return /^[0-9a-f]{4,40}$/.test(sha) ? sha : null;
    } catch {
      return null;
    }
  },
  runtimeEntry: () => {
    try {
      return fileURLToPath(import.meta.resolve("@reactive-agents/runtime"));
    } catch {
      return undefined;
    }
  },
};

/** The Cortex package root: two levels above this file (`server/services/` in source, `dist/` + one when bundled). */
export function cortexPackageRoot(deps: VersionDeps = defaultVersionDeps): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    const pkg = readJson(deps, join(dir, "package.json"));
    if (pkg?.name === "@reactive-agents/cortex") return dir;
    dir = dirname(dir);
  }
  return dirname(dirname(dirname(fileURLToPath(import.meta.url))));
}

let cached: CortexVersionInfo | null = null;

/** Versions of the running server (resolved once). */
export function cortexVersionInfo(): CortexVersionInfo {
  if (!cached) cached = resolveCortexVersion(cortexPackageRoot());
  return cached;
}
