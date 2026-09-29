---
type: implementation-plan
status: completed
created: 2026-09-28
completed: 2026-09-28
tags: [execute-backlog, health-sweep, testing, gate, north-star, cwd, bundle]
---

# Bundle: testing-gate-cwd-anchor

Date: 2026-09-28
Budget: 60 min
Issues: #230
Branch: `bundle/testing-gate-cwd-anchor` (off local `dev`)
Warden: none — `packages/testing/**` is not in the AGENTS.md warden table, and
`harness-warden`'s manifest **hard-refuses** `packages/**/src/**` edits. Parent executes
directly under execute-backlog discipline.

## Why this bundle

`packages/testing/src/gate/runner.ts:31` declares
`export const REPORTS_DIR = "wiki/Research/Harness-Reports";` — a **relative** path, so
`BASELINE_PATH` / `HEALTH_PATH` / `REGRESSIONS_DIR` / `TRACES_DIR` resolve against
`process.cwd()`.

Consequence: the North Star Tier-1 gate reads **different baselines** depending on how it is
invoked:
- repo-root cwd (`bun test packages/testing`) → the committed root baseline (2026-09-19) → passes.
- turbo (`cwd = packages/testing`, `bun run test`) → `packages/testing/wiki/Research/Harness-Reports/...`
  — a **gitignored** local snapshot (`.gitignore:50` → `packages/*/wiki/`) → stale (2026-06-16) → 14 phantom regressions.

Turbo caches the `testing` test task, so the red stayed hidden until another package change
invalidated the cache. It has now fired on two consecutive bundles (#223, #216) and masks real
regressions on the default `bun run test` path.

## Fix design

Anchor `REPORTS_DIR` to the repository, not cwd. A fixed relative depth does **not** work:
`src/gate/runner.ts` is 4 levels under the repo root, but the package builds to a single bundled
`dist/index.js` (3 levels). So resolve by **walking up from the module directory** until the
`wiki/Research/Harness-Reports` directory is found:

```ts
const REPORTS_SUBPATH = "wiki/Research/Harness-Reports";

export function resolveReportsDir(startDir: string): string {
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, REPORTS_SUBPATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return candidate; // absolute, deterministic fallback
    dir = parent;
  }
}

export const REPORTS_DIR = resolveReportsDir(dirname(fileURLToPath(import.meta.url)));
```

Mirrors the existing path-anchor precedent at `packages/testing/src/gate/registry.ts:15-18`
(`dirname(fileURLToPath(import.meta.url))`). All derived constants (`BASELINE_PATH`,
`HEALTH_PATH`, `REGRESSIONS_DIR`, `TRACES_DIR`) inherit the fix automatically, as does
`scripts/gate-update.ts` (imports them from the runner).

## Acceptance criteria (per issue)

- **#230:** `REPORTS_DIR` resolves identically regardless of cwd; `bun run test` (turbo) and
  `bun test packages/testing` read the **same committed** baseline; a test pins the resolution.

## Execution units (ordered)

1. **Unit 1 — anchor + pin (parent, ≤40 min).**
   - `packages/testing/src/gate/runner.ts`: add `existsSync` (already imported), `dirname`
     (from `node:path`), `fileURLToPath` (from `node:url`); add `resolveReportsDir`; redefine
     `REPORTS_DIR` absolute.
   - New test `packages/testing/tests/gate/reports-dir-anchor.test.ts`:
     - `isAbsolute(REPORTS_DIR)` is true;
     - `resolveReportsDir(<repo-root>)`, `resolveReportsDir(<.../src/gate>)`, and
       `resolveReportsDir(<.../dist>)` all return the same root reports dir (depth- and
       cwd-independence);
     - `BASELINE_PATH === join(REPORTS_DIR, "integration-control-flow-baseline.json")` and
       `existsSync(BASELINE_PATH)` (points at the committed baseline).
   - Delete the stale gitignored `packages/testing/wiki/` snapshot after the fix (local
     artifact, not committed).

## Risk register

- **Upward walk finds the wrong dir** (e.g. a nested `wiki/...` in a fixture) → search
  specifically for `wiki/Research/Harness-Reports`, which only the repo root has; the stale
  nested snapshot is `packages/testing/wiki/...` (also a candidate!). Mitigation: the walk
  starts at `src/gate` or `dist` and finds `packages/testing/wiki/...` **only if** that stale
  dir exists at package level — wait: `packages/testing/wiki/Research/Harness-Reports` *would*
  match. So the walk from `packages/testing/dist` would ascend to `packages/testing` and find
  the stale nested dir before reaching the root. **Mitigation:** delete the stale
  `packages/testing/wiki/` snapshot (part of this unit) and add the walk-order guarantee that
  the repo-root `turbo.json` marker also be required. **Chosen form:** require BOTH
  `wiki/Research/Harness-Reports` AND a root `turbo.json` at the candidate root.
- **Build output changes import.meta.url depth** → covered by walking up, not fixed depth.
- **First-run bootstrap writes a fresh baseline** → after the fix a fresh clone with no root
  baseline still bootstraps at the repo root; unchanged semantics.
- **Cast ceiling** → new test must add 0 `as unknown as` sites.

## Verification protocol (cross-cutting)

- `bun test packages/testing` from repo root → 53 pass / 0 fail
- `cd packages/testing && bun test` → 53 pass / 0 fail (was 52/1 — the RED)
- new test green; `bunx turbo run typecheck --filter=@reactive-agents/testing` green
- `bun run build` — 38/38
- **`bun run test` (full turbo workspace) → now GREEN** (was red on #230)
- `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` — new test contributes 0

## Baseline

- `bun test packages/testing` (root cwd) → 53 pass / 0 fail
- `cd packages/testing && bun test` (package cwd, reproduces #230) → **52 pass / 1 fail**
  (North Star gate, 14 regressions)
- `bun run test` (turbo) → **red**, only `@reactive-agents/testing` (same 14 regressions)

## Out-of-scope (explicit)

- Regenerating or editing the committed baseline content (this is a path fix, not a scenario change)
- `#214` cast ceiling
- Any behavior change to the gate's scenario execution/diff logic

## Outcome

- Commit `17e83fe9` (anchor + tests) merged to local `dev`.
- **Two** sites fixed, not one: `runner.ts` `REPORTS_DIR` (+ all derived constants) **and**
  `cf-10`'s `WIRING_TEST_PATH`; root resolution centralized in new
  `packages/testing/src/gate/repo-root.ts`.
- `bun test packages/testing` → **58 pass / 0 fail from BOTH repo root and package cwd**
  (package-cwd was 52 pass / 1 fail before).
- `@reactive-agents/testing` now **passes under `bun run test`** (turbo) — the #230 symptom is gone.
- New anchor test adds 0 `as unknown as` sites (tests-scope ratchet unchanged at 266).
- Remaining `bun run test` red = `@reactive-agents/runtime#test`, the pre-existing **#214**
  cast ceiling (reproducible on the untouched base) — unrelated to this bundle.
- Stale gitignored `packages/testing/wiki/` snapshot deleted.
- Retro: [[Research/Debriefs/2026-09-28-testing-gate-cwd-anchor-execution-debrief]]
