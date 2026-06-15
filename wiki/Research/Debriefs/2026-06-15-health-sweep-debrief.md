---
type: debrief
status: complete
created: 2026-06-15
tags: [health-sweep, maintenance, type-safety, dead-code]
---

# Health Sweep Debrief — 2026-06-15

**Sweep cadence:** Weekly scheduled run  
**Branch:** `main` (v0.11.2, detached HEAD after fix commit)  
**Executor:** Scheduled Claude Code routine

---

## Baseline vs Final

| Metric | Baseline | Final |
|--------|----------|-------|
| Build | GREEN (38/38) | GREEN (38/38) |
| Tests pass | 6199 | 6199 |
| Tests skip | 38 | 38 |
| Tests fail | 2 (pre-existing) | 2 (pre-existing) |
| New regressions | — | **0** |

Pre-existing failures: (1) benchmarks env tests without API key, (2) Docker shell-execution test (`tools/tests/skills/shell-execution.test.ts:991`) — Docker not available in container.

---

## What Was Fixed

| ID | Description | Commit |
|----|-------------|--------|
| HS-32 | Stale file path banner in `quality-utils.ts:1` — updated from `src/strategies/kernel/quality-utils.ts` to `src/kernel/capabilities/verify/quality-utils.ts` (Stage-5 kernel reorganisation drift) | `8286543` |

---

## Status Updates (no code change)

| ID | Update |
|----|--------|
| HS-24 | Confirmed ✅ FIXED: `test.skip` block deleted from `packages/reactive-intelligence/tests/m1-dispatcher-validation.test.ts` since 2026-05-20 sweep. |

---

## What Was Filed

4 new items added to [[wiki/Issues/Running Issues Log#Health Sweep 2026-06-15]]:

| ID | Sev | Description |
|----|-----|-------------|
| HS-33 | P2 | `patchStrategy` YAGNI field in `PlanExecuteConfigSchema` — declared + exported but zero source consumers. Needs minor version bump (exported type). |
| HS-34 | P1 | `packages/reactive-intelligence/src/runtime.ts` has 4 `Layer.merge(...) as any` sites — same root cause as existing HS-03 but not previously counted in its scope. |
| HS-35 | P2 | 2 remaining `as any` casts in `reactive-observer.ts` (lines 95, 154) — last two in all of reasoning src. In AGENTS.md debt table as Open. |

---

## Verified Non-Issues

- All 14 `process.exit` sites are CLI entrypoints, templates, or previously-fixed library exits (HS-11/HS-12 comments confirm prior fix). No new library-mode exits.
- All `Effect.runPromise` sites reviewed: fire-and-forget infallible Effects, top-level runners, or have `.catch`/`catchAll`. No unhandled promise rejections.
- Skipped test grep produced 3 false positives (2 asserting `.skip!` method, 1 conditional E2E OLLAMA gate). No orphaned `.skip` blocks.
- `compose/`, `trace/`, `scenarios/` all have test directories (non-standard conventions `test/` and `__tests__/`).

---

## Top 3 P2 Opportunities for Next Sprint

1. **HS-34** — Extend HS-03 (Layer.merge-as-any fix) to `packages/reactive-intelligence/src/runtime.ts` (4 sites). Small add-on to any HS-03 PR; same pattern, same `ComposableLayer` solution.
2. **HS-33** — Remove `patchStrategy` from `PlanExecuteConfigSchema` in v0.12.0 minor bump. Zero consumers in source; clean-up reduces schema surface.
3. **HS-35** — Fix 2 remaining `as any` casts in `reactive-observer.ts` via kernel-warden. Closes the reasoning-package clean-types gap entirely (0 `as any` in reasoning src).

---

## Surprising Patterns

- **Test count grew significantly since last sweep:** 6199 (today) vs 5317 (2026-05-20 baseline) — +882 tests added across 579 more files. No regressions introduced.
- **Hook infrastructure issue:** PostToolUse:Edit hook for AGENTS.md/Hot.md/Running Issues Log.md has a shell syntax error (`/bin/sh: Syntax error: redirection unexpected`). The `jq` pipeline uses a brace-grouped compound command that fails under `/bin/sh`. Not a blocker but should be fixed in `.claude/settings.json` hook script (use `/bin/bash` or rewrite as a standalone script).

---

## Links

- [[wiki/Issues/Running Issues Log#Health Sweep 2026-06-15]]
- Prior sweep: [[wiki/Research/Debriefs/2026-05-20-health-sweep-debrief.md]] (if exists)
