---
type: debrief
status: completed
created: 2026-09-25
tags: [execute-backlog, bundle, reasoning-silent-failure, kernel, error-swallowed, retro]
---

# Execution Retro: reasoning-silent-failure

Date: 2026-09-25
Budget: 90 min | Actual: ~75 min
Branch: `bundle/reasoning-silent-failure` → merged to local `dev`
Commit: `ad8427f6` (code+test)

## Outcomes

- Issues closed: **#223**
- Issues descoped: none (singleton bundle)
- Follow-up filed: **#230** (North Star gate resolves baseline relative to cwd)
- Net test delta: reasoning **+2 tests** (2888 → 2890 pass; 0 fail both)
- Net LOC delta: +185 / −8 across 2 files (1 fix + 1 new test); test dominates
- Cast-ceiling delta: **0** (see "What didn't")

## What worked

- **SCAN drift check paid off immediately.** #223's verified-by was the rare exact match — all 8 lines (135/169/214/328/434/485/562/615) and the count held. Contrast with sibling P1s #216 (function name gone from openai.ts), #214 (title 80 / body 79 / actual 86, test-count claim 265 vs ~266), which the same pass grounded and deferred. Filtering on grounded-verified-by kept the bundle high-confidence.
- **kernel-warden routing was the right call.** One warden dispatch + typed test fixture; parent verifier caught the one issue. Authority bounds kept the edit inside `kernel/**` + the named test file.
- **Authoritative RED via file-swap, not stash.** Copying the wired src to `/tmp`, `git checkout --` the file, running the new test (2 fail / 0 events), then copying back gave a clean, reversible pre-fix proof — no stash-pop risk. The skill's RED-authority warning did not apply: the test asserts an emitted event, which the pre-fix codegen cannot produce.
- **Escalating anchors to actual lines** on the second warden pass made the diagnostic `site` strings accurate rather than +1 stale.

## What didn't

- **Warden pass 1 added 3 `as unknown as` casts to `packages/*/tests`, an already-red ratchet gate.** The tests-scope ceiling (`packages/runtime/test/as-unknown-as-ceiling.test.ts`, `TESTS_CEILING = 237`) is distinct from the src ceiling; pristine count was 266, pass 1 made it 269. Caught by parent verifier, corrected via typed fixtures (`initialKernelState` + `transitionState`, typed `EntropySensorService` double) → back to 266, contributing zero. This was invisible to the warden's own success criteria because it only ran the reasoning suite + typecheck.
- **A full-workspace `bun run test` red was not caused by the bundle.** The `@reactive-agents/testing` North Star gate reported 14 regressions under turbo but passed 53/0 from root cwd. Root cause: `REPORTS_DIR = "wiki/Research/Harness-Reports"` is cwd-relative, so turbo (cwd = package dir) read a **stale gitignored** `packages/testing/wiki/...` baseline (2026-06-16) instead of the committed root one (2026-09-19). Turbo cache had masked it until our change invalidated the testing package's cache. Cost ~15 min to attribute. Filed #230.

## Skill improvements (apply on next pass)

1. **New SCAN/PLAN guard — cast-ceiling impact of new test files.** When a bundle adds a test under `packages/*/tests/`, require it to contribute **zero** `as unknown as` sites, and add `bun test packages/runtime/test/as-unknown-as-ceiling.test.ts` to the verification protocol. The two ceilings (src `CEILING=78`, tests `TESTS_CEILING=237`) are separate gates; a package suite + typecheck does not see them.
2. **New VERIFY rule — turbo-cache masking / cwd-relative-fixture triage.** Before attributing a full-suite red to the bundle, (a) re-run the failing package from repo-root cwd, and (b) grep the failing test for cwd-relative paths (`REPORTS_DIR`, `process.cwd()`, relative `join(...)`). Uniform divergences across many cases (same field, identical delta) are a stale-baseline signature, not a code regression.
3. **New EXECUTE note — file-swap RED technique** as the safe alternative to `git stash` when proving a behavior-additive test fails pre-fix.

## Process inflation guard (HS-18/22/31 lesson)

No inflation in this bundle. The opposite happened twice: the issue's *supporting* claim (`emitErrorSwallowed` in 60 reasoning files) was stale (actual 18), and a sibling issue's evidence (#214) was internally inconsistent — both caught at SCAN and either noted or deferred rather than executed. The verified-by site count/lines for #223 were exact, so the executed claim was sound.
