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

---

## Phase 2 — BUNDLE

Group candidates into one **bundle** (max `max_bundle_size`) that ships together. A bundle is *coherent* when ≥1 of these holds:

| Cohesion signal | Example |
|-----------------|---------|
| Same `area:*` label across all members | All `area:providers` |
| Primary files overlap (same dir, same package) | All under `packages/runtime/src/builder/` |
| Root-cause cluster | HS-06/07/08 all share "untyped state shape" |
| Cross-cutting fix shape | "Remove `as any` from N hook surfaces" |

**Bundling algorithm:**
1. Take the highest-priority candidate as seed
2. Greedily add candidates that share ≥1 cohesion signal with the bundle
3. Stop at `max_bundle_size` OR when no remaining candidate has cohesion ≥1 with the bundle
4. If the bundle has <2 issues after greedy growth → still proceed (singleton bundles are fine)

**Hard gate (added 2026-05-21): cross-package descope.** Before locking the bundle, re-grep each candidate's verified-by command and inspect the file paths it emits. If those paths span **≥2 packages** (`packages/<a>/…` vs `packages/<b>/…`), descope to a per-package bundle even if the issue body's "Fix direction" suggests otherwise. The body lies; the grep doesn't. (Reason: 2026-05-21 #73 spawn — body said "type properly in the think phase" but the actual `as any` targets resolved to types owned by `@reactive-agents/llm-service` and the kernel-context shape, both other packages.)

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

Read the `superpowers:writing-plans` skill conventions (location override: `wiki/Planning/Implementation-Plans/`).

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

**Commit message template:**
```
fix(<package>): <short description>

Closes #N (bundle: <bundle-name>)
<one line on what changed>
<one line on what verified it>
```

**Pause conditions (descope rather than skip):**
- Build goes red → revert unit, reopen issue with new failure mode, continue with remaining units
- Test suite gains net-new failures → same as above
- Effort blows past unit estimate by 2× → mark issue `over-budget` label, defer, continue

**Do NOT:**
- Skip tests for time pressure
- Use `as any` to silence types from the very issues you're closing
- Mix unrelated changes into a single commit

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
