// packages/testing/src/gate/repo-root.ts
//
// Repository-root discovery for test-infrastructure paths.
//
// Test infra must anchor its paths to the WORKSPACE ROOT, never to
// `process.cwd()`. Turbo runs each test task with cwd = package directory, so a
// cwd-relative path resolves differently between `bun test packages/X` (repo
// root) and `bun run test` (turbo) — and turbo caches the task, hiding the
// divergence until another change invalidates the cache. See GH #230.
//
// The root is identified by BOTH a root `turbo.json` (the workspace marker) and
// a `wiki/` directory. Requiring `turbo.json` is load-bearing: stale gitignored
// `packages/<pkg>/wiki/` dirs exist and must not shadow the real root when
// walking up.

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Walk up from `startDir` to the workspace root.
 *
 * @param startDir - Directory to begin the upward search from.
 * @returns Absolute path to the workspace root, or `startDir` if none is found
 *   (filesystem root reached).
 */
export function findRepoRoot(startDir: string): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, "turbo.json")) && existsSync(join(dir, "wiki"))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return dir;
    dir = parent;
  }
}

/** Absolute path to the workspace root, resolved from this module's location. */
export const REPO_ROOT = findRepoRoot(dirname(fileURLToPath(import.meta.url)));
