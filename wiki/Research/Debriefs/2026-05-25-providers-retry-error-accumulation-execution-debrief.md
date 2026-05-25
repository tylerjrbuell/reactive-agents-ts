# Execution Retro: providers-retry-error-accumulation

Date: 2026-05-25
Budget: 90 min | Actual: ~55 min
Branch: `bundle/providers-retry-error-accumulation`
Commit: `f3728a90`
PR: [#138](https://github.com/tylerjrbuell/reactive-agents-ts/pull/138)

## Outcomes

- Issues closed: #75 (HS-16 — provider retry error accumulation)
- Issues descoped: none (singleton bundle)
- Issues commented for verification: #84 (re-export claim doesn't hold), #93 (claim drifted to unrelated test-file reds)
- Net test delta: +3 (new `parse-error-attempts.test.ts`) / 0 fail
- Net LOC delta: +162 / -7
- Files touched: 9 (5 providers + errors.ts + index.ts + 1 new test + plan doc)

## What worked

- **Drift report up-front in the plan doc.** All 5 cited lines drifted 58–190; semantic pattern intact. Capturing this in the plan (not silently) made the GREEN edit predictable — I knew exactly what shape to grep for at each site.
- **Single-package single-area bundle.** Cross-package descope gate held; no temptation to bundle in #84 (different fix shape — `exports`-map gating, not retry-loop fix) or #93 (different package + drifted claim).
- **Mechanical pattern × 5 with greppable verified-by.** `grep -c parseAttempts.push` → 10 is a single boolean check that the fix landed at every site. Faster than per-file diff inspection.
- **Back-compat preservation.** Keeping `rawOutput: String(lastError)` alongside the new `attempts` field meant zero downstream caller migration burden — no test changes outside the new test file.
- **Verified-by comments on #84 / #93 instead of silently dropping.** Surfaced inflation patterns to the issue authors; lets them either reframe or close. Matches HS-18/22/31 lesson.

## What didn't

- **RED test was structurally weak.** Wrote `parse-error-attempts.test.ts` BEFORE editing `errors.ts`; expected typecheck red. But: tests are excluded from `tsc --noEmit` (`tsconfig.json: "exclude": ["tests/**/*"]`) **and** Effect's `Data.TaggedError` is lenient — it stores arbitrary fields passed to its constructor even if not declared. So the "RED" test passed against pre-fix state. The test still works as a regression net for post-fix state, but it didn't pin the missing-field state. **Lesson: when the target package excludes tests from typecheck, RED tests should run typecheck on a src-side file (e.g., a smoke ts-file that imports the type) — OR use `expectTypeOf`-style assertions in a way that fails at runtime if the field is absent. For TaggedError specifically: assert via `JSON.stringify(err)` includes the new key, OR cast `err as { attempts: unknown }` and check for `undefined`. The current `err.attempts!.length === 3` actually does this implicitly (would throw on pre-fix state if `attempts` truly weren't stored), but TaggedError's permissiveness made it pass anyway.**
- **No behavioral integration test of the retry loop.** Would have required mocking 5 different SDK `fetch` shapes. Punted to follow-up. The mechanical uniformity of the fix + greppable verified-by makes this acceptable risk, but it IS a coverage gap.
- **Two reminder pings about TaskCreate.** The harness reminded me twice mid-execution that TaskList was idle. I created tasks early but didn't update statuses fast enough. Minor friction; not load-bearing.

## Skill improvements (apply on next pass)

1. **Add explicit "test-substrate excluded from typecheck" check to Phase 4 EXECUTE.** Before relying on a RED test to pin missing type fields, run `grep -l "exclude.*tests" packages/<X>/tsconfig.json` — if tests are excluded from typecheck, the RED test will NOT fail at type level even when the field is missing. In that case, either (a) write the RED test in `src/` as a temporary `.test-types.ts` smoke file (deleted before commit), (b) use a runtime assertion that fails on the *absence* of the field via `Object.keys(err).includes("attempts")`, OR (c) note the limitation in the plan's risk register and accept that RED is post-hoc regression coverage only.

2. **Add "TaggedError leniency" caveat to the fix-shape table.** When extending an Effect `Data.TaggedError` payload type with a new optional field, the runtime accepts the field even if the type doesn't declare it — `expect(err.newField).toBeDefined()` will pass against pre-fix state if the test constructs with the field. **Strengthen the RED test by asserting type-level absence in a way that survives runtime tolerance** (e.g., delete the field declaration in errors.ts temporarily, run typecheck on a *src* consumer that destructures the field). For most fixes, this is overhead; flag it only when the pre-fix RED needs to be authoritative.

3. **Single-area-cleanup bundle template.** When 5 sites in one package share an identical scaffold (this case: provider retry loops), the *minimum-diff push* approach beats *helper extraction* for budget AND review surface. Encode as: "If N sites × identical scaffold, do mechanical edit unless N>10 or the scaffold lives across packages — then extract helper." Add to "default fix shape" table in Phase 2.

## Process inflation guard (HS-18/22/31 lesson)

- #75: verified-by claim **partially inflated** by line-number drift (58–190 lines), but semantic pattern intact at every site. Re-grep + read-cited-spans confirmed real defect. Not inflation, just drift — handled by Phase 1 drift-check rules.
- #84: verified-by claim **inflated**. Cited "leak through src/index.ts re-export" — checked the barrel, only `OpenAIProviderLive` re-exported. Bare `@internal` symbols at openai.ts:39,117,135,182 are NOT reachable through public surface. Issue body conflates "exported from openai.ts" with "exported from index.ts barrel" — different reachability. Filed comment, recommended close.
- #93: verified-by claim **drifted past validity**. Original `focusedTools` TS2353 error not present today; current typecheck red is in different files with different shape. Filed comment, recommended close or rescope.

**Inflation shape:** two issues today (#84, #93) had verified-by commands that, when re-run, did not reproduce the cited symptom. Pattern: an issue author runs a verified-by once at filing time, then code drifts. Mitigation: drift check (already in skill Phase 1) caught both. The fix was to surface (comment), not silently drop.

## Bundle metadata

- Branched from `origin/main` (commit `9878d36f`)
- Baseline tests: 260 pass / 0 fail in llm-provider
- Post-bundle tests: 263 pass / 0 fail in llm-provider
- Workspace: 5648 pass / 25 skip / 0 fail (no net-new failures vs pre-bundle)
- Build: 38/38 successful
- Typecheck: green for @reactive-agents/llm-provider
