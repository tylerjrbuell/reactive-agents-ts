---
type: debrief
status: shipped
created: 2026-10-20
tags: [runtime, decomposition, execute-backlog, warden, ci]
---

# Debrief — runtime-reactive-agent-decomp (GH #217 / HS-247)

**Bundle:** `execute-backlog` singleton pass on #217 (narrow-seam oversized file, health-sweep 2026-09-23).
**Merged:** PR #256 → `dev`, merge commit `b72b302f9` (2026-10-20). Followed PR #255 (regression-gate fix, merged `a12f876b9`) per plan.

## What shipped

| Cluster → module | Contents | LOC |
|---|---|---|
| `agent/judgment-facade.ts` | judge / listJudgmentModels / judgeRank + canonical `JudgeInput` | 350 |
| `agent/skills-facade.ts` | skills / exportSkill / loadSkill / refineSkills | 181 |
| `agent/durable-facade.ts` | resumeRun / fork / listRuns / approve(describe/interactions)/denyRun / listPendingApprovals / getDurableInfo / respondToInteraction | 459 |
| `agent/run-task-effect.ts` | buildRunTaskEffect (~400-LOC largest method) + parseJsonLoose (sole caller moved with it) | 547 |

- `packages/runtime/src/reactive-agent.ts`: **3,303 → 2,338 LOC** (-965); top-level exports still exactly 4; `index.ts` surface bit-identical. Legacy class methods became thin delegates constructing an explicit deps object per call (live-read of mutable class state preserved). Bodies moved verbatim, JSDoc carried.
- Basis note: the issue cited 3,112 LOC; the file had regrown to 3,303 by bundle time.

## Process

- Warden dispatch: **runtime-warden via general subagent** (this harness has no native warden agent types — same deviation as #238/#251, recorded in the pilot log). MissionBrief with verbatim-move mandate embedded; upward-report block required; warden confidence 0.92.
- Live-peer protocol: the user's main checkout was switched to `dev` (2026-10-19 20:23); all bundle work ran in isolated worktrees (`/tmp/opencode/bundle-217`), main checkout never touched. Worktrees needed root + per-package `node_modules` symlinks for turbo.
- Review pass (parent, `review-patterns` + `effect-ts-patterns`): **7/9 applicable categories pass** (2 N/A). One violation-class found and fixed in-bundle: the facade type-imported `JudgeInput` back from `reactive-agent.ts` (type-only intra-package cycle). `JudgeInput` now hosts canonically on `agent/judgment-facade.ts` (`f8b1e604f`); missing `JudgeContextConfig` import in the moved type had also silently broken the union's discriminant narrowing (both tsc errors collapsed once fixed). Re-export keeps the public surface unchanged.

## Verification (parent, all three times — pre-commit, post-review, CI)

- Typecheck: 24/24 workspace tasks green.
- Runtime suite: **1,677 pass / 7 skip / 0 fail across 309 files = exact pre-bundle baseline**, re-run after every change.
- Cast ceiling: green, both ceilings untouched, `as unknown as` flat at 39; 0 new `as any` (2 hits pre-existing in `chat-manager-factory.ts`).
- Scope: 1 modified + 4 new files only.
- Final PR CI green 5/5 (Test 4m20s after the flake fix below).

## Known micro-debt (documented, non-blocking)

- `safeParseJson` duplicated ~15 LOC in `durable-facade.ts` + `run-task-effect.ts` to avoid widening the public export surface. Consolidate when the agent/* module set stabilizes.
- `decideAndResumeRun` removed from the class (private; only approve/deny called it — bodies folded into the two callers).
- `buildSchemaSteering` / `runDurable` stayed on the class (shared internal usage; splitting was not verbatim-safe).
- Async/Promise style inside moved bodies is carried verbatim; the whole ReactiveAgent class facade is pre-Effect-pattern architecture. Pattern-modernization is a separate epic and explicitly out of scope (per plan).

## CI saga (two bundle blockers, both fixed)

1. **Regression Gate phantom runs (PR #255).** Every push triggered a phantom `Regression Gate` run failing on secrets-context errors. Root cause: GitHub Actions rejects the `secrets` context in *any* `if:` (job-level and step-level — runs 39347272779 / 39356471098); YAML-side guards can't see it. Rewritten `regression-gate.yml` with a bash env guard and a consolidated benchmark step. Merged first, so all subsequent dev pushes are free of phantoms.
2. **HTTP 503-retry retry-test flake (3 CI datapoints, 0 local).** A CI-only phantom double-invocation of the mocked `fetchJsonTool` handler consumed inconsistent hit spans across runs: even (calls=4, runs 39341793990/39347275662) then odd (hits=3 — a floater that started and never completed, run 39359903979), before finally being silenced. Fix (`f8b1e604f` follow-up `888f4026a`): the shared-mock test keeps only phantom-safe outcome assertions (`result.ok`, `result.calls >= 2` — structurally guaranteed since the only 503 slot is hit 1), and the **exact one-retry contract** (requests `[1,1]`) is pinned by a new deterministic `node:http` live-server test sharing no global state. Lesson: never pin counts/parity on shared mock closures in CI — pin exact contracts on real in-process servers; keep mocks at the outcome layer only.

## Next seeds

#218 `builder.ts` (3,081 LOC) · #219 `think.ts` (2,135) · #221 `execution-engine.ts` (1,807) — same warden flow, same verifier bar.

## Artifacts

- Plan: `wiki/Planning/Implementation-Plans/2026-10-20-runtime-reactive-agent-decomp.md`
- Commits: `9b8a2885d` (docs snapshot) · `8421d1d5c` (refactor) · `f8b1e604f` (JudgeInput canonicalization) · `888f4026a` (parity-pin drop) · merge `b72b302f9`
- Pilot log entry: `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md` (2026-10-20 runtime-warden)
