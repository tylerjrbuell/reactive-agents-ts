---
type: debrief
status: completed
created: 2026-09-28
tags: [execute-backlog, bundle, testing-gate-cwd-anchor, testing, gate, north-star, cwd, retro]
---

# Execution Retro: testing-gate-cwd-anchor

Date: 2026-09-28
Budget: 60 min | Actual: ~55 min
Branch: `bundle/testing-gate-cwd-anchor` → merged to local `dev`
Commit: `17e83fe9` (code+test)
Warden: none — `packages/testing/**` is not in the AGENTS.md warden table, and `harness-warden` hard-refuses `packages/**/src/**`. Parent executed.

## Outcomes

- Issues closed: **#230**
- Issues descoped: none
- Net test delta: testing **+5 tests** (53 → 58 pass; 0 fail both cwds)
- Net LOC delta: +131 / −2 (40-line `repo-root.ts`, 24-line test, small runner/cf-10 edits)
- Side finding: full `bun run test` now fails only on `@reactive-agents/runtime#test` (pre-existing **#214** cast ceiling), because fixing the testing gate de-cached the run and exposed it.

## What worked

- **The RED was reproduced deterministically before fixing.** `cd packages/testing && bun test` → 52 pass / 1 fail (14 phantom regressions); repo-root `bun test packages/testing` → 53/0. That pair is the exact #230 signature and the regression test's reference.
- **The "fix at the root" instruction paid off twice.** After anchoring `REPORTS_DIR`, the pkg-cwd suite STILL failed — a second site of the same bug class: `cf-10` resolved `WIRING_TEST_PATH = "packages/runtime/tests/error-swallowed-wiring.test.ts"` relative to cwd. A narrower "fix REPORTS_DIR" would have shipped a half-fix that still broke under turbo.
- **Walk-up resolution was required, not a fixed relative depth.** `src/gate/runner.ts` is 4 levels under the repo root; the bundled `dist/index.js` is 3. Centralizing into `repo-root.ts` made the depth-independence testable (`findRepoRoot(src-depth) === findRepoRoot(dist-depth) === REPO_ROOT`).
- **The `turbo.json` marker guarded against a real trap.** A stale `packages/testing/wiki/Research/Harness-Reports` exists locally and would match a naive "find the reports dir" walk from `dist/`; requiring the workspace marker skips it. Deleted the stale artifact after.

## What didn't

- **First fix attempt was incomplete by exactly one site.** The initial plan's root-cause sweep looked at `REPORTS_DIR` + its derived constants, not at scenario-local file paths. The pkg-cwd re-run caught it. Cost: one extra verify cycle.
- **Fixing the cached-red exposed a different pre-existing red.** `bun run test` had been reporting only `@reactive-agents/testing` because turbo cached the `runtime` test task; once the testing task changed, `runtime#test` re-ran and failed on the 2 pre-existing `#214` cast-ceiling assertions. Full workspace green is therefore still blocked by `#214`, not by this bundle.

## Skill improvements (apply on next pass)

1. **Cwd-relative path bug sweep (Phase 4).** When a fix is "anchor a path to the repo root", do not stop at the obvious constant. Grep the **whole package** for every relative-path assumption and fix them in the same bundle: bare `"wiki/`, `"packages/`, `"src/`, `"tests/` string literals; `existsSync`/`readFileSync`/`writeFileSync` on non-`import.meta`-derived paths; `process.cwd()`. One leaked site (cf-10) kept the bug alive under a different invocation.
2. **Centralize workspace-root resolution in one module.** Do not duplicate a walk-up across runner + scenario + script files; export `REPO_ROOT` / `findRepoRoot` once and import it. Makes depth/cwd-independence unit-testable in one place.
3. **Verification for path fixes = run the consumer from ≥2 cwds.** "End to end" for a gate/path bug means the real package suite from BOTH the repo root and the package directory (the two turbo-visited cwds), not just `bun test packages/X` from root.
4. **After fixing a turbo-cached red, expect a different pre-existing red to surface.** The cache was hiding it; re-run the full workspace and attribute each remaining failure against a fresh baseline before claiming green.

## Process inflation guard (HS-18/22/31 lesson)

No inflation. The issue's diagnosis (cwd-relative `REPORTS_DIR`) was correct but **incomplete** — it named one of two sites. The bundle closed both, proven by the dual-cwd suite passing. The "14 regressions" figure from #230 was itself an artifact of the bug (stale nested baseline), not a real regression count; the corrected failure surface was a single scenario (cf-10), which is what the fix addressed.
