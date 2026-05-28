---
title: WS-1 — Release-Flow Residual Fixes (REVISED post-warden-audit)
date: 2026-05-28
revised: 2026-05-28 (evening)
status: pending execution
master-plan: 2026-05-28-canonical-refactor.md (§4 RC-5 REVISED)
architecture-model: 2026-05-28-canonical-architecture-model.md
audit-evidence: wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md (release-warden Phase 0)
root-cause-closed: RC-5 (residual fixes only — premise of original framing invalidated)
gh-issues-closed: [#159 (close as invalid), #165 (orphan v0.10.7 draft)]
gh-issues-touched: [F2 typecheck-fix, F3 judge-server-lockstep, F4 release.ts ordering — file as separate issues with `audit-2026-05-28-release-warden` label OR fold into this WS PR]
authoritative-anchor: warden audit findings F2/F3/F4 + first-hand reproduction
owner: claude main thread + user authorization
session-budget: ~30 min execution + verification
risk: LOW (4 small, isolated, well-bounded fixes)
---

# WS-1 — Release-Flow Residual Fixes (REVISED)

## Revision Note

**Original WS-1 thin spec scope was wrong.** Release-warden Phase 0 audit 2026-05-28 invalidated three premises:

1. ❌ "Workspace pkg.jsons at 0.10.6 = drift defect" — ✅ Actually intentional steady-state per `release.ts:205-208` comment ("so `cat VERSION` always matches npm @latest")
2. ❌ "Git tags max at v0.9.0; no v0.10.x/v0.11.x" — ✅ All v0.10.0-v0.11.1 tags exist on origin already, deref'ing to npm gitHead SHAs
3. ❌ "Release flow structurally broken; needs rebuild" — ✅ Works in steady state; 4 small residual issues identified

This revision aligns scope with reality. See master plan §3.4 RC-5 REVISED + §11 amendment 4.

---

## Goal (one sentence)

Fix the 4 residual release-flow issues identified by warden audit (typecheck RED at HEAD, judge-server inconsistency, release.ts auth-before-drift ordering, orphan GH draft) AND close #159 as invalid framing.

## Anchor

- **Master plan §4 RC-5 REVISED:** four small issues, not a structural rebuild
- **Warden audit** `wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md` (F1-F5 findings, gate results)
- **Architecture model §17 mapping:** release-flow is L4 surface concern; hygiene workstream

## Current State (first-hand verified 2026-05-28)

```
✅ Origin tags v0.10.6 + v0.11.1 — present, deref to npm gitHead
✅ Workspace pkg.json lag = intentional design (release.ts:205-208 documents)
✅ Build green (turbo 38/38)
✅ Tests green (5750 pass / 23 skip / 0 fail)
❌ Typecheck RED — @reactive-agents/verification 8 TS2345 errors
❌ judge-server unpublished (npm view 404) + not lockstep (0.9.5 vs 0.10.6 floor)
❌ release.ts:42-66 npm whoami bails before drift inspection
❌ Orphan v0.10.7 GH draft release
```

## Scope IN — 5 small fixes

### Fix 1 — F2 typecheck stubs (the blocker)

**Files touched:** `packages/verification/tests/hallucination-detection.test.ts` + `packages/verification/tests/layers.test.ts`

**Lines:** 145, 162, 176, 192 (hallucination) + 76, 97, 118, 139 (layers) — 8 mock objects total

**Change:** Each mock currently shapes:
```typescript
{ complete: (_req: any) => Effect.succeed({ content: "..." }) }
```
Add the missing `embed` method to match `VerificationLLM` interface:
```typescript
{
  complete: (_req: any) => Effect.succeed({ content: "..." }),
  embed: (_texts: readonly string[], _model?: string) => Effect.succeed([]),
}
```

Pre-verify shape: `grep "interface VerificationLLM" packages/verification/src/` → confirm `embed`'s exact signature. Use matching signature in stubs. Use `Effect.succeed([])` or `Effect.die(new Error("not implemented"))` per test intent.

**Verification:** `cd packages/verification && bun run typecheck` exits 0.

### Fix 2 — F3 judge-server private + lockstep

**Files touched:** `packages/judge-server/package.json`

**Change:**
1. Add `"private": true` field
2. Bump `"version": "0.9.5"` → `"version": "0.10.6"` (lockstep with workspace floor)

**Verification:**
- `grep -E '"(private|version)"' packages/judge-server/package.json` shows both fields correctly set
- Workspace consumers of judge-server (if any) continue to resolve (verify via `grep -r "@reactive-agents/judge-server" packages apps` and confirm workspace:* refs resolve)
- `bun install` runs clean (lockfile regenerates if needed)

### Fix 3 — F4 release.ts ordering (drift check before auth)

**Files touched:** `scripts/release.ts` (~lines 42-66)

**Change:** Move the workspace-version-drift inspection BEFORE the `npm whoami` auth gate so `bun run release:dry <ver>` functions as a drift gate without requiring login.

**Read first:** Confirm current sequence at `scripts/release.ts:42-66`. Likely shape: `auth check → drift check → other gates`. Target: `drift check → auth check (only for non-dry runs) → other gates`. Dry-run path skips auth entirely.

**Verification:**
- `bun run release:dry 0.12.0` exits with a drift-specific message (or "clean — no drift detected") WITHOUT requiring npm login
- `bun run release 0.12.0` (real, NOT dry) still requires `npm whoami` (auth still gated for actual publishing)

### Fix 4 — #165 orphan v0.10.7 draft cleanup

**Command:** `gh release delete v0.10.7 --yes`

**Verification:** `gh release list | grep v0.10.7` returns empty.

### Fix 5 — #159 close as invalid

**Command:** `gh issue close 159 --comment "Closing as invalid framing. Release-warden Phase 0 audit 2026-05-28 (wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md) verified: workspace packages/*/package.json lag at 0.10.6 vs root VERSION 0.11.1 is the intentional steady-state per release.ts:205-208 comment (\"so cat VERSION always matches npm @latest (repo package.json stays unbumped by the tag-driven flow)\"). Git tags v0.10.0-v0.11.1 exist on origin and deref to the correct npm gitHead SHAs. Release flow works as designed. Residual issues (F2 typecheck, F3 judge-server, F4 release.ts ordering, #165 orphan draft) addressed in WS-1 follow-up bundle."`

## Scope OUT (non-goals — flagged for refusal)

- Touching ANY production source code (only test stubs + judge-server config + release script)
- Stamping workspace pkg.jsons to 0.11.1 (premise was wrong — pkg.json lag is intentional)
- Creating v0.10.x or v0.11.x tags (already exist)
- Touching `.github/workflows/publish.yml` (not broken — actually-working flow per audit)
- Touching `scripts/test-clean-install.ts` (premise was wrong — no belt-and-suspenders needed for non-existent drift)
- npm publishing judge-server (user adjudicated: keep internal/private)
- Major release.ts refactor (just move 2 lines — drift check before auth)

## Pre-Conditions

- `main` current with `origin/main` (verified: 8 commits ahead at session entry; pushed via WS-1 prep)
- Build green (verified: 38/38)
- Tests green (verified: 5750 pass / 23 skip)
- Typecheck currently RED (this WS fixes that)
- `gh` CLI authenticated (`gh auth status` returns success)

## Tests (RED → GREEN)

### RED state (current baseline at HEAD)

| Gate | Current |
|---|---|
| `cd packages/verification && bun run typecheck` | ❌ 8 TS2345 errors |
| `npm view @reactive-agents/judge-server version` | ❌ 404 (unpublished) |
| `grep '"private"' packages/judge-server/package.json` | ❌ no match |
| `bun run release:dry 0.12.0` (without npm login) | ❌ bails at `npm whoami` before drift logic |
| `gh release list \| grep v0.10.7` | ❌ orphan present |
| `gh issue view 159 --json state -q .state` | ❌ `OPEN` |

### GREEN state (post-WS-1)

| Gate | Expected |
|---|---|
| `cd packages/verification && bun run typecheck` | ✅ exits 0 |
| `bunx turbo run typecheck` workspace-wide | ✅ exits 0 |
| `grep '"private": true' packages/judge-server/package.json` | ✅ 1 match |
| `grep '"version": "0.10.6"' packages/judge-server/package.json` | ✅ 1 match |
| `bun run release:dry 0.12.0` (without npm login) | ✅ exits with drift-specific output (clean or specific drift); does NOT bail on auth |
| `bun run release 0.12.0` (non-dry, no login) | ✅ bails on auth (expected — actual publish requires login) |
| `gh release list \| grep v0.10.7` | ✅ empty |
| `gh issue view 159 --json state -q .state` | ✅ `CLOSED` |

### Existing tests that MUST still pass

- All 5750+ workspace tests pass (`bun test`)
- Build 38/38 (`bunx turbo run build`)
- No regression in any package's test suite

## Verification Protocol

```bash
# Before (capture RED state)
echo "=== Pre-WS-1 baseline ==="
cd packages/verification && bun run typecheck 2>&1 | grep -c "error TS"     # expect: ≥8
cd ../..
npm view @reactive-agents/judge-server version 2>&1 | grep -c "404"          # expect: ≥1
grep -c '"private"' packages/judge-server/package.json                       # expect: 0
git status -s                                                                # expect: empty (clean)

# Apply Fix 1 (verification test stubs) + Fix 2 (judge-server config)
# Apply Fix 3 (release.ts ordering)
# (commit + push branch)

# After (capture GREEN state)
echo "=== Post-WS-1 ==="
cd packages/verification && bun run typecheck 2>&1 | grep -c "error TS"     # expect: 0
cd ../..
bunx turbo run typecheck 2>&1 | tail -3                                      # expect: success
grep '"private": true' packages/judge-server/package.json                    # expect: 1 match
grep '"version": "0.10.6"' packages/judge-server/package.json                # expect: 1 match
bun run release:dry 0.12.0 2>&1 | head -10                                   # expect: drift output (no whoami bail)

# Apply Fix 4 (#165 cleanup) + Fix 5 (#159 close)
gh release delete v0.10.7 --yes
gh issue close 159 --comment "..." (see Fix 5)
gh release list | grep -c v0.10.7                                            # expect: 0
gh issue view 159 --json state -q .state                                     # expect: CLOSED

# Full gate
bun test 2>&1 | tail -3                                                      # expect: ≥5750 pass / 0 fail
bunx turbo run build 2>&1 | tail -3                                          # expect: 38/38
```

## Done Criteria (falsifiable)

### Fix 1 — F2 typecheck

- [ ] `cd packages/verification && bun run typecheck` exits 0
- [ ] `bunx turbo run typecheck` workspace-wide exits 0
- [ ] No new test logic changed — only `embed` stub added to existing mocks

### Fix 2 — F3 judge-server

- [ ] `packages/judge-server/package.json` has `"private": true`
- [ ] `packages/judge-server/package.json` has `"version": "0.10.6"`
- [ ] No npm publish triggered (since `private: true`)
- [ ] `bun install` runs clean

### Fix 3 — F4 release.ts ordering

- [ ] `bun run release:dry 0.12.0` runs the drift check without requiring `npm whoami`
- [ ] `bun run release 0.12.0` (non-dry) still requires auth (no regression to actual publish gate)

### Fix 4 — #165 cleanup

- [ ] `gh release list` shows no v0.10.7 entry
- [ ] No tag v0.10.7 ever materialized (it was draft-only)

### Fix 5 — #159 close

- [ ] Issue closed with the comment text above
- [ ] Comment cites warden audit report path

### Cross-cutting

- [ ] All 5750+ tests pass
- [ ] Build 38/38
- [ ] Typecheck clean workspace-wide
- [ ] PR body cites before/after for each fix's verification gate
- [ ] No new `as any` or `as unknown as` introduced

## Rollback Plan

Each fix is independent and rollback-isolated:

- **Fix 1 rollback:** revert test file changes; typecheck returns to RED
- **Fix 2 rollback:** unset `private` + restore `0.9.5` version; judge-server returns to prior inconsistent state
- **Fix 3 rollback:** revert release.ts changes; `release:dry` returns to bailing on auth
- **Fix 4 rollback:** `gh release create v0.10.7 --draft` (recreate orphan — unlikely needed)
- **Fix 5 rollback:** `gh issue reopen 159`

Per-fix commits make granular rollback trivial. PR is one logical bundle but commits are atomic per fix.

## Evidence Artifact

`wiki/Research/Refactor-Reports/2026-05-28-ws-1-residual-fixes.md` containing:

- Before/after gate output for each fix
- Confirmation that warden audit findings F2, F3, F4, #165, #159 are addressed
- Reference to the warden audit baseline at `wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md`

## Execution Path

Original WS-1 brief was rejected by release-warden (correctly — outside its authority). This revision routes through claude main thread + user authorization:

1. Claude applies Fix 1 (test stubs — `Edit` tool) and Fix 2 (judge-server config — `Edit`) on branch `refactor/ws-1-residual-fixes`
2. Claude applies Fix 3 (release.ts ordering — `Edit`) carefully — read full release.ts:1-100 first to confirm exact ordering target
3. Claude commits with conventional message
4. Claude runs verification gates locally; captures evidence
5. User authorizes Fix 4 (`gh release delete v0.10.7 --yes`) + Fix 5 (`gh issue close 159 --comment ...`)
6. Claude pushes branch; opens PR with verified-by table; closes #159 + #165 references in PR body

## Cross-Reference

- Master plan: `wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` §3.4 RC-5 REVISED, §4 RC-5 table row, §6.2 WS-1 summary REVISED, §10 #159 mapping
- Architecture model: §17 mapping (L4 surface concern)
- Warden audit: `wiki/Research/Release-Audits/0.11.1-current-drift-2026-05-28.md` (findings F1-F5)
- Related closed: #159 (invalid), #165 (orphan), F2 typecheck-fix, F3 judge-server-lockstep, F4 release.ts-ordering
- Memory: `feedback_npm_version_drift` (refined — workspace lag IS the design)
