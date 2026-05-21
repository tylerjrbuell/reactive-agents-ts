# Execution Retro: runtime-builder-state-typing
Date: 2026-05-21
Budget: 90 min | Actual: ~55 min

## Outcomes
- Issues closed: #72 (HS-07)
- Issues descoped from initial seed: #73 HS-08 (cross-package — advisor caught pre-EXECUTE; spawns into `kernel-context-typing` next pass)
- Issues blocked on verified-by: #83 HS-27 (commented requesting evidence)
- Issues opportunistically filed: #93 (pre-existing `focusedTools` typecheck red unmasked by tightening `_toolsOptions`)
- Net test delta: +0 / -0 (5321 pass / 0 fail steady; 26 skip steady)
- Net LOC delta: to-config.ts +23 / -14 (interface + 7 narrowed reads)
- Commits: 2 on `bundle/runtime-builder-state-typing` (skill amendment + plan; code fix)

## What worked
- **Advisor caught the cross-package descope before code.** Initial bundle was #72 + #73; advisor read the grep output and recognized #73's targets (`LLMResponse.model`, kernel context shape) live in other packages. Saved a likely 30 min rabbit hole + diff-conflict cleanup.
- **Singleton bundles are fine.** Anti-pattern penalty for cross-package was real — descoping to singleton produced a clean, narrowly-scoped PR.
- **Existing option-type interfaces were already canonical** at `packages/runtime/src/builder/types.ts` + `packages/runtime/src/types.ts`. No type-design needed — purely a wiring fix. This is the cheapest possible class of `as any` cleanup.
- **`grep -c 'as any' …to-config.ts` → 0** matched the verified-by claim exactly. Audit accuracy 7/7 on this issue.

## What didn't
- **Audit line-number drift on #73** (audit said 83/94/105/218/248/285; current 85/96/107/220/273/310, up to 25-line offset). Advisor flagged this too. Even though counts matched, drift this large is a smell that file refactored since audit; the fix shape may also have moved.
- **Pre-existing typecheck red on main:** runtime-construction.ts:337 already broken — was hidden by upstream `as any` widening but tsc surfaces it independent of this PR. We don't have a "main is green" baseline check before EXECUTE; we should.
- **No regression test added** for to-config.ts narrowing — relied on existing `serializeBuilder` round-trip in the test suite. Acceptable for type-only refactor but worth flagging.

## Skill improvements (apply on next pass)

Three concrete amendments. **Applied to SKILL.md in this same retro commit.**

1. **Phase 1 SCAN: warn when audit line numbers drift >5 lines.** Cheap to script: re-grep the verified-by command, compare emitted line numbers against the issue body's claimed lines. If max offset >5, append a `🟡 drift detected — re-verify semantics` flag to the candidate row. The audit is still a starting point, but the agent should eyeball before assuming the fix shape is unchanged.

2. **Phase 5 VERIFY: capture pre-EXECUTE baseline.** Right after BRANCH (Phase 3.5), run `bun run build && bun test 2>&1 | tail -3` and pin the pass/fail counts as the baseline. Phase 5 then compares; pre-existing reds get filed as follow-up issues (as we did for #93) rather than blocking the bundle.

3. **Bundling heuristic: cross-package descope is a HARD rule.** Current SKILL has it as an anti-pattern; promote to an explicit bundling gate. Add: "If any candidate's verified-by command points to files in ≥2 packages, descope to a per-package bundle even if the issue body claims otherwise — the body lies, the grep doesn't."

## Process inflation guard (HS-18/22/31 lesson)

- Did any unit's verified-by claim turn out to be inflated? **No on #72** — claim was 7 `as any`, file had 7, fix collapsed all 7. Clean.
- Did the audit line numbers tell the truth on #73 (descoped)? **Counts true, locations drifted** — see "Skill improvements #1" for the catch.
