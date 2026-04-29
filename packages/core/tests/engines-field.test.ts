// FIX-11 / W12 — engines field guard.
//
// Packages with direct `bun:sqlite` imports or `Bun.*` runtime calls in
// their src/ MUST declare `engines: { bun: ">=1.1.0" }` so npm install
// fails fast on Node consumers (rather than blowing up at runtime with
// `ReferenceError: Bun is not defined` or `Cannot find module 'bun:sqlite'`).
//
// This test pins the contract: each affected package.json declares the
// engines field. If a future commit introduces direct Bun usage in a new
// package, add it to BUN_DEPENDENT_PACKAGES; if a package retires its
// Bun dependency (e.g. switches to better-sqlite3), remove it.
//
// Node fallback (lazy-load `bun:sqlite` vs `better-sqlite3` per audit
// FIX-11 part b / T14) is deferred to v0.11. Until then, fail-fast at
// install time is the right shape for the Bun-only release.

import { describe, it, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Packages that have direct `bun:sqlite` imports OR `Bun.*` runtime calls
// in their src/. Verified by grep at audit time (2026-04-29). `benchmarks`
// uses Bun.serve in src but is `private: true` (workspace-internal,
// not published), so npm consumers never see it — excluded.
//
// `runtime` references Bun.* in JSDoc comments only — no runtime calls,
// so excluded.
const BUN_DEPENDENT_PACKAGES = [
  "a2a",
  "cost",
  "eval",
  "health",
  "llm-provider",
  "memory",
  "reactive-intelligence",
  "tools",
  "reactive-agents", // umbrella — re-exports from all the above
] as const;

const REQUIRED_BUN_VERSION = ">=1.1.0";

const repoRoot = join(import.meta.dir, "..", "..", "..");

describe("FIX-11 / W12 — engines.bun guard for Bun-dependent packages", () => {
  for (const pkgName of BUN_DEPENDENT_PACKAGES) {
    it(`${pkgName} declares engines.bun ${REQUIRED_BUN_VERSION}`, () => {
      const pkgPath = join(repoRoot, "packages", pkgName, "package.json");
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as {
        engines?: { bun?: string };
        private?: boolean;
      };

      expect(pkg.engines?.bun).toBe(REQUIRED_BUN_VERSION);
    });
  }
});
