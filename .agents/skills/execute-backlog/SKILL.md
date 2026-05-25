---
name: execute-backlog
description: Use when ready to attack the GitHub issue backlog with discipline. Scans open issues, bundles related work into an efficient execution plan, executes the bundle with verification, then closes issues + writes a retrospective that includes self-improvement notes for this skill. Trigger phrases — "execute backlog", "work the backlog", "knock down P1 issues", "ship a bundle", "/execute-backlog".
user-invocable: true
---

# Execute Backlog

**Purpose:** turn the GitHub issue backlog into shipped work using a deterministic loop: SCAN → BUNDLE → PLAN → EXECUTE → VERIFY → UPDATE → RETRO. Each pass closes a coherent bundle of issues, leaves the repo greener than it found it, and writes a retro that improves the skill itself.

**Operating principle (Extreme Ownership):** every issue in the bundle is "owned" by the executing agent for the duration of the pass. No half-finished issues. No "punted" verification. If a bundle can't ship clean, the bundle gets descoped — not the verification.

---

## When to Use

- Backlog has ≥5 open issues with `priority:p1` or higher
- A sprint / release-gate moment: pick the next high-impact bundle
- User says "let's work the backlog", "execute audit-2026-05-21", "knock down the killswitch issues"
- Agentic team handoff: spawn one of these per worker, each owning a label-scoped bundle

**Don't use for:**
- One-off bug fixes (use `agent-tdd` directly)
- Backlog audit / re-prioritization (use `architecture-audit`)
- New feature work (use `reactive-feature-dev`)

---

## Inputs (declared by caller)

The skill MUST be invoked with at least one filter — never run unfiltered.

```yaml
filter:
  labels:       # optional: ["area:providers", "audit-2026-05-21"]
  priority:     # optional: "p0" | "p1" | "p2"
  phase:        # optional: "phase:C" | "phase:E"
  max_bundle_size: 5  # default 5; cap on issues per execution pass
  budget_minutes: 90  # default 90; abort if exceeded, descope cleanly
```

Caller examples:
- `/execute-backlog labels=audit-2026-05-21 priority=p1`
- `/execute-backlog labels=area:providers,phase:E`
- `/execute-backlog labels=health-sweep,priority:p1 max_bundle_size=3`

---

## Phase 1 — SCAN

Query GitHub for candidate issues matching the filter.

```bash
rtk gh issue list \
  --state open \
  --label "<comma-joined labels>" \
  --json number,title,labels,body,createdAt,updatedAt \
  --limit 100
```

For each candidate, parse:
- Issue number, title
- All labels (especially `area:*`, `priority:*`, `verified`)
- Primary file/location (regex from body: `**Location:**` line)
- Verified-by present? (boolean — `**Verified-by:**` block in body)

**Filter rules:**
1. Drop any issue without `verified-by:` evidence — file a comment asking for verification; do not execute on unverified claims (the 2026-05-21 inflation pattern is the reason this rule exists)
2. Drop `phase:` mismatches if `phase:` filter was provided
3. Drop issues with the `blocked` label
4. Drop issues assigned to someone else

**Drift check (added 2026-05-21):** for any candidate carrying a verified-by command with file:line references, re-run the command. If the emitted line numbers differ from the issue body's claimed lines by **>5** on any row, mark the candidate `🟡 drift detected` and re-read the cited spans to confirm the semantic cast/pattern still matches. Counts can match while locations move 25+ lines — that means the surrounding logic refactored and the fix shape may no longer apply. Acceptable to proceed; not acceptable to skip the check.

**Drift check addendum (added 2026-05-21 v3): semantic-equivalent pattern grep.** When the issue body claims N sites but the primary grep returns fewer, the gap may be a *syntactic variant of the same anti-pattern*, not real drift. Before declaring `🟡 drift detected`, additionally grep the known equivalence classes:

| Primary pattern | Semantic equivalents to also grep |
|-----------------|-----------------------------------|
| `(x as any)` | `(x as unknown as {…})`, `(x as unknown as Record<…>)` |
| `: any` | `: unknown` (intentional widening), `: Record<string, any>`, untyped function-type `Function` |
| `as Function` | `(...args: any[]) => any`, `Callable` aliases |

If the **sum** of equivalence-class matches reproduces the claimed count, proceed (no drift — issue author counted across both forms). If the sum still falls short, mark drift and re-read the cited spans. (Reason: 2026-05-21 #71 spawn — issue claimed 7 sites; primary grep `(state as any)` returned 3; the other 4 lived under `as unknown as { … }` narrowings. Including both forms recovered the exact 7.)

Output: candidate set, sorted by `priority:p0` > `p1` > `p2` > `p3`, then by `verified` label (verified issues rank higher), then drift-clean before drift-detected.

**Cross-package consistency probe (added 2026-05-22 v9).** When the issue touches per-framework / per-platform packages providing equivalent APIs (e.g., `@reactive-agents/react` + `@reactive-agents/svelte` + `@reactive-agents/vue` all exporting `useAgentStream`-style hooks/factories), briefly diff the impl shape across siblings:

```bash
# Side-by-side compare of equivalent files
diff packages/<sibling-a>/src/<file>.ts packages/<sibling-b>/src/<file>.ts | head -40
```

Same name + equivalent signature + **divergent behavior** = latent defect. Surface in the plan's "Adjacent improvement found" section. Fix opportunistically per the test+fix combo rule (Phase 4 v9). (Reason: 2026-05-22 #82 closeout — vue's `useAgentStream.StreamError` branch threw + was caught by inner try/catch; svelte's equivalent branch used direct `next.error = …; next.status = "error"` and worked correctly. Sibling diff would have flagged the divergence before the test had to.)

---

## Phase 2 — BUNDLE

Group candidates into one **bundle** (max `max_bundle_size`) that ships together. A bundle is *coherent* when ≥1 of these holds:

| Cohesion signal | Example |
|-----------------|---------|
| Same `area:*` label across all members | All `area:providers` |
| Primary files overlap (same dir, same package) | All under `packages/runtime/src/builder/` |
| Root-cause cluster | HS-06/07/08 all share "untyped state shape" |
| Cross-cutting fix shape | "Remove `as any` from N hook surfaces" |
| Untyped schema field needs structured access in callers | Local widening type + boundary helper inside the consuming package — see "default fix shape" below |

**Default fix shape for typing issues (added 2026-05-21 v5).** When the cited `as any` casts all narrow the same schema-typed-`unknown` field, default to:
1. Create `<domain>-context.ts` (or `-state.ts`) in the consuming dir.
2. Define `<Domain>Context = ExecutionContext & { <field>: <ConcreteShape> }` (interface mirroring runtime usage, NOT the schema source-of-truth).
3. Export `as<Domain>Context(c)` boundary helper — single named cast.
4. Migrate each cited site through the helper; delete the cast at sources where the field was already typed (dead-cast sweep — see Phase 4).

Three shipped precedents to copy from: #71 `HandlerState` (`packages/reactive-intelligence/src/controller/handler-state.ts`), #72 typed `BuilderState` option groups (`packages/runtime/src/builder/to-config.ts`), #73 `ThinkContext` (`packages/runtime/src/engine/phases/agent-loop/think-context.ts`). The pattern keeps each fix inside its consuming package (cross-package descope gate satisfied automatically).

**Bundling algorithm:**
1. Take the highest-priority candidate as seed
2. Greedily add candidates that share ≥1 cohesion signal with the bundle
3. Stop at `max_bundle_size` OR when no remaining candidate has cohesion ≥1 with the bundle
4. If the bundle has <2 issues after greedy growth → still proceed (singleton bundles are fine)

**Hard gate (added 2026-05-21): cross-package descope.** Before locking the bundle, re-grep each candidate's verified-by command and inspect the file paths it emits. If those paths span **≥2 packages** (`packages/<a>/…` vs `packages/<b>/…`), descope to a per-package bundle even if the issue body's "Fix direction" suggests otherwise. The body lies; the grep doesn't. (Reason: 2026-05-21 #73 spawn — body said "type properly in the think phase" but the actual `as any` targets resolved to types owned by `@reactive-agents/llm-service` and the kernel-context shape, both other packages.)

**Multi-package test-infra split (added 2026-05-22 v7).** The cross-package gate isn't only for typing/refactor issues — it applies the same way when an issue cites adding tests / infra / docs to N packages. Ship N bundles (one per package), each with its own PR. Name the follow-up bundles in the seed bundle's PR description so the queue is explicit. (Reason: 2026-05-22 #82 spawn — issue cited zero tests across `packages/react/`, `packages/svelte/`, `packages/vue/`. Shipped `bundle/react-smoke-tests` first; named `bundle/svelte-smoke-tests` and `bundle/vue-smoke-tests` as follow-ups in the PR body. Disjoint scopes, independent CI, no cross-package merge conflicts.)

**Output:** named bundle. Pattern: `<area>-<theme>` (e.g., `providers-untyped-hooks`, `runtime-builder-as-any-sweep`).

Open a new GH issue or use an existing tracker as the *bundle parent* — link it to all members via `Tracks: #N` lines. Apply the `tracking` label.

---

## Phase 3 — PLAN

For the bundle, write a concrete execution plan to `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<bundle-name>.md`.

**Plan must contain:**

```markdown
# Bundle: <name>
Date: YYYY-MM-DD
Budget: <budget_minutes> min
Issues: #N, #N, #N

## Acceptance criteria (per issue)
- #N: <one-sentence done definition tied to the verified-by claim>

## Execution units (ordered)
1. **Unit 1:** <one or two issues, ≤45 min, files touched, tests touched>
2. **Unit 2:** ...

## Risk register
- <risk> → <mitigation>

## Verification protocol (cross-cutting)
- `bun test packages/<changed>/` — full pass
- `bun run build` — green
- `bunx turbo run typecheck --filter=<changed>` — green
- Sample replay or trace test if behavior change

## Out-of-scope (explicit)
- <thing> — punt to next bundle
```

**Plan gates:**
- If total estimated effort > `budget_minutes` → descope to fit; do NOT skip verification
- If any unit depends on infra not in the repo → mark `blocked` on that issue, drop from bundle
- If two units conflict (same file, conflicting changes) → sequence them, never parallelize

**Substrate-aware test strategy (added 2026-05-22 v8).** When the bundle adds tests to a new framework/package, identify the test substrate up front. Three classes:

| Substrate | Examples | Default coverage |
|-----------|----------|------------------|
| **Render-bound** | React hooks, Vue `setup()`, web components | Public-surface smoke + type contracts. Behavioral via render = follow-up bundle (justify the `@testing-library/X` + happy-dom investment separately). |
| **Framework-agnostic** | Svelte stores (`writable`), Solid signals, Effect.Effect | Behavioral coverage with mocked I/O (e.g., `globalThis.fetch = async () => new Response(...)`). No DOM/render needed. |
| **Pure** | Plain JS factories, helpers, parsers | Behavioral coverage directly. No mocking infrastructure beyond stub inputs. |

Picking the wrong default = scope creep (render-bound bundle pulled into the test-infra rabbit hole) or coverage gap (framework-agnostic bundle capped at smoke when behavioral was cheap). (Reason: 2026-05-22 #82 spawn — react bundle (#100) capped at 6 smoke cases due to render-context requirement; svelte bundle (#101) shipped 13 cases including 9 behavioral because stores work in any runtime. Coverage gap would have been ~half if both bundles defaulted to "smoke only".)

When in doubt, write one case at the framework-agnostic tier and see if it runs under bare `bun:test`. If yes, proceed behavioral. If "Invalid hook call" / setup errors → drop to smoke + name the follow-up bundle.

Read the `superpowers:writing-plans` skill conventions (location override: `wiki/Planning/Implementation-Plans/`).

**Fire-site reachability check (added 2026-05-21 v4):** before designing integration-style tests for any unit, grep the call graph to verify the test scenario will actually exercise the code under fix. A hook/handler/wrapper can be **registered** without being **fired** if the test scenario routes through an alternate code path (e.g., `withTestScenario` short-circuits the reactive loop and bypasses `runner.ts:683` `runPhaseHooks`). Quick check:

```bash
# 1. Locate where the unit under fix gets invoked
rtk grep -rn "<wrapper-or-helper-name>\|<registered-fn-pattern>" packages/

# 2. Confirm at least one fire site is reached by the planned test config
#    (provider, reasoning, strategy, test scenario, etc.)
```

If reachability is uncertain, **default to direct-invocation tests** (instantiate the helper / pull from registry / call wrapper directly) rather than full-stack `agent.run()` tests. Reason: 2026-05-21 #74 spawn — initial test design called `agent.run()` with `withTestScenario` + `withReasoning()`, expecting the harness `before('think')` wrapper to fire. It never did. Probes confirmed the wrapper was registered but the kernel-loop fire site was bypassed. Direct invocation via `RegistrationHarness._collected` pinned the unit in 6 tests, 0 flakes.

---

## Phase 3.5 — BRANCH (mandatory)

Before any code edits land, create a dedicated feature branch off `main` for the bundle:

```bash
rtk git fetch origin main
rtk git checkout -B bundle/<bundle-name> origin/main
```

Naming pattern: `bundle/<area>-<theme>` (e.g., `bundle/runtime-builder-state-typing`). The branch is the unit-of-work for the entire bundle. All commits in Phase 4 land here; the Phase 6 PR ships them together.

If the working tree is dirty when this skill is invoked, **stop** and surface the dirt — do not stash silently. The caller decides: commit, discard, or move out of the way. (Reason: per `feedback_commit_before_branch.md`, exploratory state must not get mixed into bundle commits.)

**Baseline capture (added 2026-05-21):** immediately after branching, pin the pre-EXECUTE state:

```bash
rtk bun run build 2>&1 | tail -3   # → record "Tasks: N/N successful"
rtk bun test 2>&1 | tail -3        # → record pass/fail/skip counts
```

Stash the numbers in the plan doc under a `## Baseline` heading. Phase 5 compares against these; pre-existing reds get filed as follow-up issues (see #93 pattern) rather than blocking the bundle. Without this baseline, a pre-existing failure surfaced by your edits looks like a regression and you'll burn budget chasing it.

---

## Phase 4 — EXECUTE

For each execution unit, follow `agent-tdd` discipline:

```
RED   → write/find failing test demonstrating the issue
GREEN → minimum fix that turns the test
REVIEW → run review-patterns; address findings
COMMIT → conventional commit, citing GH issue numbers
```

**RED authority check (added 2026-05-25 v10).** Before relying on a RED test to pin a missing type or field, check **two harness conditions** that can silently mask the RED:

1. **Tests excluded from typecheck.** Run `rtk grep -A2 '"exclude"' packages/<X>/tsconfig.json` — if `"tests/**/*"` is excluded, missing-type errors in the RED test will NOT fail typecheck. The "RED" passes against pre-fix state at type level.
2. **TaggedError / structural-type leniency.** Effect's `Data.TaggedError` stores any field passed to its constructor, even if the payload type doesn't declare it. `expect(err.newField).toBeDefined()` will pass against pre-fix state if the test constructs the error with `newField`. Same for plain TS structural types — passing extra properties to a struct constructor is accepted at runtime.

When either holds, the RED is post-hoc regression coverage only — it doesn't prove the pre-fix state was broken. Acceptable; just note in the plan's risk register and don't claim "test failed before fix, passes after" in the retro unless you confirmed it. To strengthen RED authority for type fields: write a temporary `src/.test-types.ts` smoke file that imports and destructures the new field, run `tsc --noEmit` on src/, then delete the smoke file before commit. Overkill for most fixes; flag only when the pre-fix RED must be authoritative.

(Reason: 2026-05-25 #75 spawn — RED test `parse-error-attempts.test.ts` was written expecting typecheck failure on `ParseAttemptError` not-yet-exported and `LLMParseError.attempts` not-yet-declared. Both conditions held: `packages/llm-provider/tsconfig.json` excludes tests; `Data.TaggedError` stored `attempts` field at runtime regardless of type declaration. The "RED" passed against pre-fix state. Fix still landed clean; lesson is to not over-claim RED→GREEN narrative in retros when these conditions hold.)

**Single-area mechanical-scaffold bundle template (added 2026-05-25 v10).** When N sites in **one package** share an identical scaffold (same imports, same control flow, same fix shape), prefer **mechanical in-place edit** over helper extraction. Heuristic:

| Condition | Action |
|-----------|--------|
| N ≤ 10 sites, same package, identical scaffold | Mechanical push/edit at each site. Verified-by = `grep -c '<new-pattern>'` returns N. |
| N > 10 sites, OR scaffold spans packages, OR scaffold has 3+ divergent variants | Extract helper. Test helper directly with mocked inputs. |

Mechanical edit wins on review surface (one shape to verify N times) and ships faster. Helper extraction trades that for de-duplication; only worth it when the dup cost exceeds the abstraction cost. (Reason: 2026-05-25 #75 — 5 providers × ~50 LOC identical retry loop. In-place push of 2 lines per provider beat extracting `parseStructuredWithRetry` helper on budget AND eliminated SDK-mock test complexity. Verified-by `grep -c parseAttempts.push` → 10 caught all sites in one check.)

**Dead-cast sweep (added 2026-05-21 v5).** Before migrating each cited `as any` site through a new helper, check whether the underlying type already supports the access pattern (the schema may have been tightened since the cast was added; the cast was historic). Delete dead casts outright — lighter diff, no helper indirection, less maintenance. Procedure for each site:

```bash
# Read the cited line's surrounding context
# Check the field's type in the schema (e.g., `packages/runtime/src/types.ts`)
# If the type already covers the access → delete the cast
# If `unknown` / `any` / missing field → migrate via the boundary helper
```

(Reason: 2026-05-21 #73 spawn — 2 of 9 cited `(c as any).selectedStrategy` casts were dead because `selectedStrategy` was already `Schema.optional(Schema.String)` on the schema. The casts were historic from a pre-typing era and could be deleted without any helper plumbing.)

**Same-session multi-bundle protocol (added 2026-05-21 v5).** When chaining bundles in one session, **each subsequent branch MUST be created from `origin/main`, not from the previous bundle's branch.** Stacking bundles undermines the verified-by gate — a subtle regression in bundle 1 would mask in bundle 2's tests (or worse: cause bundle 2 to attribute its failures incorrectly). Each bundle:

1. branches off `origin/main` clean (`git checkout -B bundle/<name> origin/main`)
2. ships its own PR
3. is merged independently — never auto-merged

This session (2026-05-21 night+1) shipped #97 + #98 disjoint via this protocol; total ~1h45m. Worth pinning.

**Commit message template:**
```
fix(<package>): <short description>

Closes #N (bundle: <bundle-name>)
<one line on what changed>
<one line on what verified it>
```

**Test-path fallback (added 2026-05-21 v4):** if a planned RED integration test cannot reach the unit under fix after one debug round (e.g., wrapper registers but never fires), **stop debugging the test scaffold and switch to direct invocation**. Pull the registered handler/wrapper/helper from its registry (e.g., `RegistrationHarness._collected`, `LifecycleHookRegistry.list()`) and call it directly. Direct-invocation tests:

- pin the unit faster (sub-second runs vs full agent.run loops)
- isolate the fix from orthogonal config (provider, reasoning, scenario)
- match the cohesion signal: if the issue cites a *single file:line*, the test should hit *that line* without depending on a deep call chain

When in doubt, write the direct-invocation test first; expand to integration coverage only if multi-component interaction is actually under fix.

**Path-aware verified-by (added 2026-05-21 v4):** when a single file:line cited by an issue is fired from **multiple call-graph paths** (e.g., engine `LifecycleHookRegistry` AND harness `HarnessPipeline` both invoke the same hook handler), the issue's symptom may already be partially fixed by one path while the other still has the bug. Before locking the bundle scope, grep callers of the cited site and document in the plan which paths actually exhibit the symptom. The fix may be narrower than the verified-by suggests. (Reason: 2026-05-21 #74 — the engine path already escalated sync throws as defects through `Effect.catchAll`, surfacing them to `reactive-agent.ts:549` and firing `_errorHandler`. Only the harness duplicate-fire path was truly silent. A naive fix targeting "all hook error paths" would have overscoped.)

**Dead-code sweep (added 2026-05-22 v6).** Before applying the issue's prescribed fix, check whether the cited code is **dead in the current codebase state**. Deletion is preferable to migration/replacement when the original purpose is already satisfied elsewhere. The check applies broadly:

| Cited surface | Dead-code check |
|---------------|------------------|
| `as any` cast | does the underlying type already cover the access? → delete cast |
| `test.skip("RED…")` placeholder | did the targeted mechanism ship ✅ KEEP per phase-1/health-sweep evidence? → delete block |
| Helper function only referenced by deleted code | grep for inbound refs → delete |
| Interface/type only used inside a deleted span | same — delete |
| `TODO` on live code path | does the followup issue exist OR is the work obsolete? → wire or remove per HS-23 pattern |

When deletion is the right action, also confirm the issue's verified-by points at a stable external artifact (phase-1 evidence, MEMORY.md verdict, audit report) — that's what makes "delete" safe vs "replace with TBD". (Reason: 2026-05-22 #80 spawn — `m1-dispatcher-validation.test.ts:65` `test.skip("RED phase…")` was 110 LOC of placeholder. M1 had already shipped ✅ KEEP per `harness-reports/phase-1-mechanism-validation-2026-05-04.md`. Pure deletion was correct; replacement would have invented coverage that doesn't exist.)

**Pure-deletion verified-by (added 2026-05-22 v6).** When the bundle is purely deletion (no new helper, no migration, no replacement), the standard "grep target → 0" recheck is structurally weaker than for typing/refactor bundles. Strengthen by also asserting:

1. **Test count delta matches expectation.** If you deleted `test.skip(...)`, the package test runner's `skip` count should drop by exactly that number. Capture in retro alongside pass/fail.
2. **No inbound references remain.** For any symbol deleted (helper fn, interface, type), grep workspace-wide for references and confirm zero matches outside the touched file itself: `grep -rn "<DeletedSymbol>" packages/ | grep -v "<touched-file>"` → 0. If any inbound ref survives, your deletion shipped a compile-time break.
3. **No dangling imports.** `grep -n "import.*<DeletedSymbol>" packages/` → 0.

Failing any of these means the deletion missed adjacent dead-code; either expand scope or undo and re-bundle.

**Pause conditions (descope rather than skip):**
- Build goes red → revert unit, reopen issue with new failure mode, continue with remaining units
- Test suite gains net-new failures → same as above
- Effort blows past unit estimate by 2× → mark issue `over-budget` label, defer, continue

**Test+fix combo bundles (added 2026-05-22 v9).** When a behavioral RED test surfaces an impl bug during a test-coverage bundle, the fix lands in the same PR. The PR title combines verbs: `test(X): add coverage; fix Y`. Allowed when **all** apply:

1. The fix is ≤10 lines.
2. The fix mirrors an existing-working pattern in a sibling package, OR passes a code-reviewer agent for correctness.
3. The fix is covered by the same test that surfaced it (test serves as regression check).

If any of those fail, **descope**: file the bug as a separate issue and ship the bundle with the test marked `test.skip` / `xfail` referencing the new issue. (Reason: 2026-05-22 #82 vue portion — behavioral SSE-error test failed because `use-agent-stream.ts:76-78` threw inside an inner `JSON.parse try/catch` that swallowed it. Svelte sibling used direct assignment, no throw. 2-line mirror fix landed in PR #102 alongside the regression test. Defended over "test-only PR + separate fix PR" because the swallow is invisible to types and would have stayed latent.)

**Do NOT:**
- Skip tests for time pressure
- Use `as any` to silence types from the very issues you're closing
- Mix unrelated changes into a single commit (test+fix combo is NOT mixed — it's one observably-correct concern)

---

## Phase 5 — VERIFY (cross-cutting, after all units commit)

Run the bundle-wide verification gate:

```bash
rtk bun run build           # all packages green
rtk bun test                # full suite, no net-new failures vs pre-bundle baseline
rtk bun run typecheck       # workspace-wide
```

For each issue in the bundle, re-check the original verified-by claim against the new code state:

```
issue #N verified-by said: `grep -c "as any" packages/X/Y.ts` → 5
new check:                  `grep -c "as any" packages/X/Y.ts` → 0
✅ resolved
```

If a verified-by check fails to come down → the fix didn't actually address the claim. Reopen the issue with the new count + commit ref.

**Workspace-test-flake protocol (added 2026-05-22 v7).** When `bun test` (workspace, run from repo root) shows failures but per-package isolation runs clean, treat as test-order / fixture-state flake. Verification is acceptable when:

1. The bundle's touched package suite passes in isolation: `rtk bun test packages/<touched>/` → 0 fail.
2. The failing tests live in packages NOT touched by the bundle. (`rtk bun test packages/<failing-pkg>/` → 0 fail confirms it's flake, not real.)
3. The failing tests are not the verified-by recheck for any bundle issue.

Document the flake in the PR body (test name + isolation evidence). Do NOT block the bundle. CI may surface the same flake; if so, rerun the failed job. (Reason: 2026-05-22 #82 spawn — workspace `bun test` showed 2 fails in `packages/diagnose/`; `rtk bun test packages/diagnose/` → 35/0. Pre-existing test-order issue, unrelated to the react smoke bundle. CI on #100 will rerun cleanly. Same pattern surfaced on #99 — `httpbin.org` external-network flake resolved on rerun.)

Track flakes that recur across ≥2 bundles in their own follow-up issue (e.g., "test-order flake in packages/diagnose under workspace `bun test`") — separately from any active bundle.

---

## Phase 6 — UPDATE

**6a — Open the PR (mandatory).** Every execution session ships its bundle as one PR. No direct-to-main pushes.

```bash
rtk git push -u origin bundle/<bundle-name>
rtk gh pr create \
  --base main \
  --head bundle/<bundle-name> \
  --title "<bundle-name>: <one-line summary>" \
  --body "$(cat <<'EOF'
## Bundle: <name>

Closes #N
Closes #N

## Summary
<2-3 lines on what changed>

## Verification
- `bun run build` ✅
- `bun test` ✅ (delta: +X / -Y vs baseline)
- `bunx turbo run typecheck --filter=<changed>` ✅
- Verified-by rechecks (per issue):
  - #N: `<command>` → <new result> (was <old>)

## Plan + Retro
- Plan: wiki/Planning/Implementation-Plans/YYYY-MM-DD-<bundle>.md
- Retro: wiki/Research/Debriefs/YYYY-MM-DD-<bundle>-execution-debrief.md
EOF
)"
```

PR body MUST include `Closes #N` for every issue in the bundle — GitHub auto-closes them on merge, no manual `gh issue close` needed. If a bundle issue was descoped mid-EXECUTE, drop its `Closes #N` line and explain in the PR body.

The skill's job ends at PR open. **Merge is a human decision** — do not auto-merge.

**6b — Project board + knowledge sync.** Move bundle issues to **In Review** column (not Done — done happens on merge). Then:

Sync local knowledge:
- `wiki/Hot.md` — append session note (bundle name, issues closed, key learnings)
- `.agents/MEMORY.md` — if a pattern emerged worth remembering, add a one-line entry under the relevant section
- `wiki/Issues/Running Issues Log.md` — if any HS-NN items closed, mark them in the migration table

---

## Phase 7 — RETRO (mandatory, self-improving)

Write a retrospective to `wiki/Research/Debriefs/YYYY-MM-DD-<bundle>-execution-debrief.md`:

```markdown
# Execution Retro: <bundle-name>
Date: YYYY-MM-DD
Budget: <budget_minutes> min | Actual: <actual> min

## Outcomes
- Issues closed: #N, #N, ...
- Issues descoped: #N (reason)
- Net test delta: +X / -Y
- Net LOC delta: +X / -Y

## What worked
- <one-line wins; reference commits>

## What didn't
- <friction points; missed estimates; surprises>

## Skill improvements (apply on next pass)
- <concrete change to SKILL.md — phase wording, gate, bundling heuristic, verification command>
- <e.g., "Bundling missed that HS-07 and HS-08 share a root cause — add 'shared untyped shape' as cohesion signal">

## Process inflation guard (HS-18/22/31 lesson)
- Did any unit's verified-by claim turn out to be inflated? If yes, document the inflation shape so the audit-finding template can catch it next time.
```

**Self-improvement loop:** the `Skill improvements` section gets applied to this very file before the retro is committed. Read this SKILL.md, find the section the retro says to amend, make the edit, commit alongside the retro.

This is non-negotiable. A bundle without a retro is not finished. A retro without a SKILL.md amendment leaves regression risk on the table.

---

## Anti-patterns to Reject

| Anti-pattern | Why it's banned |
|--------------|-----------------|
| "Just commit and we'll verify later" | Verification IS the deliverable; deferred = skipped |
| Closing an issue without re-running its verified-by | Pattern that produced HS-18/22/31 inflation |
| Bundling >5 issues for "efficiency" | Token + attention cost grows superlinearly; correlation between bundle-size and bug-introduction is documented |
| Cross-package bundles | Higher diff conflict risk; descope to per-package bundles |
| Retro that says "everything went great, no improvements" | Either (a) untrue (b) skill is at local maximum and needs harder scope — challenge the next run |

---

## Inputs This Skill Reads

- GH issues — `rtk gh issue list ...`
- GH labels — existing taxonomy (`area:*`, `phase:*`, `priority:*`, `health-sweep`, `architecture-debt`, `verified`, `audit-2026-05-21`)
- `wiki/Hot.md` — recent state to avoid stepping on in-flight work
- `wiki/Issues/Running Issues Log.md` — historical context for HS-NN items
- AGENTS.md, CODING_STANDARDS.md — patterns the fixes must conform to
- Skill: `agent-tdd` — TDD discipline during EXECUTE
- Skill: `review-patterns` — gate before COMMIT
- Skill: `writing-plans` (with `wiki/Planning/Implementation-Plans/` override)
- Skill: `codebase-health-sweep` — for any opportunistic finding flagged during EXECUTE that wasn't in the bundle

## Outputs This Skill Writes

- Commits per execution unit (conventional format, citing GH #N)
- One bundle plan at `wiki/Planning/Implementation-Plans/`
- One execution retro at `wiki/Research/Debriefs/`
- GH issue closes + comments
- Project-board column moves
- Self-amendment to this SKILL.md (only the "Skill improvements" section can drive this; never silent edits)

---

## Recommended Invocation Patterns

**Solo run:**
```
/execute-backlog labels=audit-2026-05-21 priority=p1
```

**Parallel agent team (Extreme Ownership):**
Spawn one agent per `area:*` label with disjoint bundle scopes — each owns its area end-to-end. Coordinate via the tracker parent issue.

```
agent-providers:   /execute-backlog labels=audit-2026-05-21,area:providers
agent-reasoning:   /execute-backlog labels=audit-2026-05-21,area:reasoning
agent-harness:     /execute-backlog labels=audit-2026-05-21,area:harness
```

**Daily/weekly cadence:**
Schedule via `/loop` — `/loop 1d /execute-backlog labels=priority:p1 max_bundle_size=3` — but ONLY if budget + verification rigor is non-negotiable in the loop body.

---

## Quick Reference Card

```
SCAN     gh issue list --label … --json
BUNDLE   greedy cohesion grow, cap at max_bundle_size
PLAN     wiki/Planning/Implementation-Plans/YYYY-MM-DD-<bundle>.md
BRANCH   git checkout -B bundle/<bundle-name> origin/main (clean tree only)
EXECUTE  TDD per unit, conventional commits cite #N
VERIFY   build + test + typecheck + re-run each verified-by
UPDATE   gh pr create with Closes #N (auto-close on merge), board → In Review, Hot.md note
RETRO    wiki/Research/Debriefs/, AMEND THIS SKILL.md
```

If any phase output is missing → the bundle is not finished. There is no "good enough."
