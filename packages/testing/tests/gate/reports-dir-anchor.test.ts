// Run: bun test packages/testing/tests/gate/reports-dir-anchor.test.ts --timeout 15000
//
// GH #230 — the North Star gate must resolve its baseline/health/traces and any
// repo files against the REPOSITORY, not `process.cwd()`. A cwd-relative path
// made `bun test packages/testing` (repo-root cwd) and `bun run test` (turbo,
// cwd = package dir) read different baselines and fail repo-file lookups.
//
// These tests pin the resolution independent of cwd AND of module build depth
// (`src/gate/repo-root.ts` is 4 levels under the root; bundled `dist/index.js`
// is 3).

import { describe, it, expect } from "bun:test";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import {
  REPORTS_DIR,
  BASELINE_PATH,
  HEALTH_PATH,
  REGRESSIONS_DIR,
  TRACES_DIR,
} from "../../src/gate/runner.js";
import { REPO_ROOT, findRepoRoot } from "../../src/gate/repo-root.js";

// packages/testing/tests/gate -> repo root.
const REPO_ROOT_FROM_TEST = resolve(import.meta.dir, "../../../..");

describe("North Star gate repo-path anchoring (GH #230)", () => {
  it("REPO_ROOT resolves to the workspace root (turbo.json + wiki)", () => {
    expect(REPO_ROOT).toBe(REPO_ROOT_FROM_TEST);
    expect(existsSync(join(REPO_ROOT, "turbo.json"))).toBe(true);
    expect(existsSync(join(REPO_ROOT, "wiki"))).toBe(true);
  });

  it("REPORTS_DIR is absolute and hangs off REPO_ROOT", () => {
    expect(isAbsolute(REPORTS_DIR)).toBe(true);
    expect(REPORTS_DIR).toBe(join(REPO_ROOT, "wiki", "Research", "Harness-Reports"));
  });

  it("derived paths hang off REPORTS_DIR and the committed baseline exists", () => {
    expect(BASELINE_PATH).toBe(
      join(REPORTS_DIR, "integration-control-flow-baseline.json"),
    );
    expect(HEALTH_PATH).toBe(
      join(REPORTS_DIR, "integration-control-flow-scenario-health.json"),
    );
    expect(REGRESSIONS_DIR).toBe(join(REPORTS_DIR, "regressions"));
    expect(TRACES_DIR).toBe(join(REPORTS_DIR, "gate-traces"));
    expect(existsSync(BASELINE_PATH)).toBe(true);
  });

  it("resolves the same root from src depth and dist depth", () => {
    // src depth (4 levels under root).
    expect(findRepoRoot(join(REPO_ROOT, "packages/testing/src/gate"))).toBe(REPO_ROOT);
    // bundled dist depth (3 levels under root) — the case a fixed relative
    // depth would get wrong.
    expect(findRepoRoot(join(REPO_ROOT, "packages/testing/dist"))).toBe(REPO_ROOT);
    // The repo root itself.
    expect(findRepoRoot(REPO_ROOT)).toBe(REPO_ROOT);
  });

  it("skips a stale gitignored packages/testing/wiki snapshot", () => {
    // A stale `packages/testing/wiki/Research/Harness-Reports` would otherwise
    // match a reports-dir walk; the `turbo.json` workspace marker must make the
    // search skip it and continue to the real root.
    const fromPkgDir = findRepoRoot(join(REPO_ROOT, "packages/testing"));
    expect(fromPkgDir).toBe(REPO_ROOT);
    expect(REPORTS_DIR.startsWith(join(REPO_ROOT, "packages", "testing"))).toBe(false);
  });
});
