# CI Cleanup Spike — Audit + Tiered Revamp

> **Date:** 2026-04-25
> **Branch:** `feat/phase-1-capability-port`
> **Trigger:** Phase 0 close-out exposed CI inefficiencies — every job re-installs Bun, re-builds the workspace, and rebuilds docs separately. The `BASELINE-UPDATE:` convention from the Test Gate has no CI enforcement. Eval suite doesn't gate main. This spike audits the surface, identifies high-ROI fixes, and ships Tier 1 in the same session.

---

## 1. Audit — current pipeline (5 workflows, 356 lines)

| Workflow | Trigger | Jobs | Wall time (est) | Pain points |
|----------|---------|------|-----------------|-------------|
| `ci.yml` | push to main, PR to main | typecheck, test, docs-links | ~6-8 min | 3× install, 3× build, no cache, no concurrency cancel |
| `eval.yml` | PR to main, manual | eval | ~2-3 min | Doesn't run on push to main → main can silently break eval suite |
| `docs.yml` | (separate file) | deploy-pages | ~1-2 min | Redundant astro build vs `ci.yml` docs-links |
| `publish.yml` | push to main | release | ~3-4 min | `rm -rf .turbo` defeats cache; build+test in one step (hard to debug) |
| `backfill-releases.yml` | manual | backfill | n/a | Standalone tool, fine as-is |

### 1.1 Top 10 issues found

1. **No concurrency cancellation.** A PR pushed 5× in 10 min runs 5 full CI suites to completion. Lost ~15 min of CI per redundant run.
2. **No Bun install cache.** `bun install` runs from cold ~5× per PR (typecheck + test + docs-links + eval + publish on merge). Each takes ~30s.
3. **Build runs ≥3× per PR with `rm -rf .turbo` in publish.yml.** Turbo's local cache is wiped on the release path; `ci.yml` jobs don't share build outputs across jobs.
4. **Test job double-builds docs.** Lines 37-38 of `ci.yml` run `bun run build --filter='!docs'` immediately followed by a separate docs build. One `bun run build` would do.
5. **`eval.yml` skips push to main.** A merged PR can break the eval suite and no one notices until the next PR.
6. **`BASELINE-UPDATE:` trailer is documented but unenforced.** Test Gate baseline can be silently mutated.
7. **No GitHub Actions step summary.** Failure messages bury the gate's actionable output. The `formatFailure()` text never reaches the PR conversation.
8. **Capabilities check only runs in `test` job.** A typecheck-only re-run won't catch drift in `scripts/check-capabilities.ts` invariants.
9. **No artifact uploads.** Microbench baseline + gate outputs are written to `harness-reports/` but lost when the runner is destroyed. No cross-PR comparability.
10. **Setup steps duplicated in every job.** `actions/checkout@v4` + `actions/setup-node@v4` + `oven-sh/setup-bun@v2` + `bun install --frozen-lockfile` appears 5 times across workflows. Reusable workflow would collapse this.

### 1.2 Pain quantified

Per-PR CI cost (approximate):
- 3 jobs in `ci.yml` × ~30s install = 90s wasted to install (5 max if eval runs)
- 3 jobs × ~60s build = 180s wasted on duplicate builds
- No concurrency cancel: every push past the first wastes ~6 min per push
- **Total: ~5 min wasted per PR** baseline; ~6 min wasted per re-push

Annualized cost (assume 10 PRs/week, 3 pushes each): ~90 min/week of GitHub Actions minutes saved by Tier 1 alone.

---

## 2. Tiered fix plan

### Tier 1 — quick wins, ship this session

| Fix | Where | Estimated impact |
|-----|-------|------------------|
| **T1.1** Add concurrency cancellation to all PR-triggered workflows | `ci.yml`, `eval.yml`, `docs.yml` | Saves ~6 min per redundant push |
| **T1.2** Add Bun install cache | `ci.yml`, `eval.yml`, `publish.yml`, `docs.yml` | ~25s saved per job × ~5 jobs = ~2 min/PR |
| **T1.3** Collapse double docs build in test job | `ci.yml` test job lines 37-38 | ~30s saved per PR |
| **T1.4** Add `BASELINE-UPDATE:` trailer enforcement | new step in `ci.yml` test job | Prevents silent baseline mutation |
| **T1.5** Add gate failure to GitHub step summary | `ci.yml` test job | Better PR feedback (no infra change) |
| **T1.6** Add eval to push-to-main trigger | `eval.yml` | Catches eval regressions on merge |
| **T1.7** Remove `rm -rf .turbo` from publish.yml | `publish.yml` line 36 | Lets local turbo cache persist; faster releases |

### Tier 2 — medium-term, separate PR

- **T2.1** Reusable workflow `_setup-bun.yml` consumed by all workflows via `uses: ./.github/workflows/_setup-bun.yml`
- **T2.2** Turborepo remote cache (Vercel free tier or S3-backed) — share build outputs across jobs and runs
- **T2.3** Job dependencies: `test` depends on `typecheck` artifact; build is shared not redundant
- **T2.4** Artifact uploads: microbench JSON, gate baseline diffs, eval results
- **T2.5** PR check status badges in README

### Tier 3 — infrastructure, backlog

- **T3.1** Self-hosted runner for Tier 2 gate (real-LLM Ollama on developer GPU machine — Option B from Test Gate spec §3.5)
- **T3.2** Branch protection ruleset committed as `.github/rulesets/main.json` (declared, not clicked)
- **T3.3** Release dry-run workflow for vetting CHANGELOG entries before tagging
- **T3.4** Performance regression gate (microbench diff fails CI when ops/sec drops > 20%)

---

## 3. Tier 1 implementation plan

### T1.1 — Concurrency cancellation

Add to top of every PR-triggered workflow:

```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Effect: pushing a new commit to an open PR cancels any in-flight runs of the same workflow on the same ref.

### T1.2 — Bun install cache

Replace each install with:

```yaml
- name: Cache Bun install
  uses: actions/cache@v4
  with:
    path: ~/.bun/install/cache
    key: bun-${{ runner.os }}-${{ hashFiles('bun.lock') }}
    restore-keys: |
      bun-${{ runner.os }}-

- run: bun install --frozen-lockfile
```

Bun 1.3+ uses `~/.bun/install/cache` by default. Cache key invalidates when `bun.lock` changes; `restore-keys` accepts partial-key fallback to seed the cache when lock changes.

### T1.3 — Single build invocation

Replace `ci.yml` test job lines 37-38:

```yaml
# Before
- run: rm -rf .turbo && bun run build --filter='!@reactive-agents/docs'
- run: cd apps/docs && bun run build

# After
- run: bun run build
```

Turbo handles the dep order; `bun run build` is `turbo run build` per the root `package.json`. The exclude+separate pattern was meaningful only when docs build was failing for unrelated reasons — that's resolved.

### T1.4 — `BASELINE-UPDATE:` trailer enforcement

Add a step that fails the test job when the gate baseline file changed AND no `BASELINE-UPDATE:` trailer is found in any commit on the branch:

```yaml
- name: Enforce BASELINE-UPDATE trailer when gate baseline changes
  if: github.event_name == 'pull_request'
  env:
    BASE_SHA: ${{ github.event.pull_request.base.sha }}
    HEAD_SHA: ${{ github.event.pull_request.head.sha }}
  run: |
    if git diff --name-only "$BASE_SHA" "$HEAD_SHA" | grep -qE '^harness-reports/integration-control-flow-baseline\.json$'; then
      if ! git log "$BASE_SHA".."$HEAD_SHA" --pretty=%B | grep -q '^BASELINE-UPDATE:'; then
        echo "::error::Gate baseline changed but no BASELINE-UPDATE: trailer found in any commit." >&2
        echo "Run \`bun run gate:update\` and include the prompted reason as the trailer." >&2
        exit 1
      fi
      echo "✓ Baseline change has BASELINE-UPDATE: trailer"
    fi
```

Effect: silently mutating the baseline (intentional or accidental) is no longer possible without an explicit trailer that's visible in PR review.

### T1.5 — Step summary on gate failure

Wrap `bun run gate:check` so the formatted failure lands in `$GITHUB_STEP_SUMMARY`:

```yaml
- name: North Star Test Gate (Tier 1)
  run: |
    if ! bun run gate:check 2> >(tee gate-stderr.log >&2); then
      {
        echo "## ❌ North Star Test Gate failed"
        echo ''
        echo '```'
        cat gate-stderr.log
        echo '```'
      } >> "$GITHUB_STEP_SUMMARY"
      exit 1
    fi
```

Effect: gate's formatted failure (weakness ID, closing commit, recovery commands) becomes a first-class part of the PR check page, not buried in raw logs.

### T1.6 — Eval on push to main

Change `eval.yml`:

```yaml
on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  workflow_dispatch:
```

Effect: eval suite runs on every merge to main, not just on PRs. Catches regressions introduced by direct pushes or merges that bypassed PR review.

### T1.7 — Remove `rm -rf .turbo` from publish

Delete `publish.yml` line 36 and the surrounding step. Turborepo's content-addressed cache is safe to reuse; force-clearing it makes every release ~30-60s slower with no correctness benefit.

If a specific release needs a clean cache, that's an explicit `workflow_dispatch` input, not an always-on behavior.

---

## 4. Verification plan

After Tier 1 lands:

1. **Local sanity:** verify all workflow YAMLs are valid via `gh workflow list` after push
2. **Behavioral:** open a draft PR with the changes; observe:
   - Concurrency cancel works (push twice, watch first run abort)
   - Cache hits on second run (look for "Cache restored from key" in step logs)
   - Test job no longer double-builds docs
   - `BASELINE-UPDATE:` enforcement works (intentionally edit baseline without trailer → red gate)
   - Step summary renders gate failure
3. **No regression:** all 4,422 tests still pass; gate stays green; docs still deploy

If any verification step fails, revert the offending change, document the gap, and queue it for Tier 2 with the failure mode noted.

---

## 5. Out of scope for this spike

- Reusable workflows (`_setup-bun.yml` etc) — Tier 2
- Turbo remote cache integration — Tier 2 (requires account/token decision)
- Self-hosted runner for Tier 2 gate — Tier 3
- Performance regression gate from microbench — Tier 3
- README badge updates — separate doc PR

---

## 6. After this spike, the next CI work is...

Tier 2 lands as a separate PR after Phase 1 Sprint 1 closes. Slot it before Sprint 2 starts so the new ContextCurator + trustLevel + Task primitive work benefits from faster CI feedback.
