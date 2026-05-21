---
name: codebase-health-sweep
description: Use when the codebase may have accumulated bugs, failing tests, type errors, dead code, inefficiencies, or drift from known quality standards — before a release, after a large feature merge, or on a recurring maintenance cadence. Also triggers when build is red, `bun test` has unexpected failures, or TypeScript errors spiked after refactors.
user-invocable: true
---

# Codebase Health Sweep

Structured bug-finding, prioritization, and safe-fix loop for the reactive-agents-ts monorepo. Three phases: **SCAN** (parallel agent sweep) → **TRIAGE** (prioritize by severity + risk) → **FIX** (execute bounded safe fixes, file the rest).

**Guiding principle:** Fix what's safe in one pass. File everything else. Never guess at correctness — verify with the build and test suite.

---

## When to Use

- Pre-release: before cutting a version tag
- Post-merge: after a large decomposition or refactor lands
- Periodic maintenance: scheduled sweep (weekly/monthly cadence)
- Build is RED or test count regressed unexpectedly
- `as any`, `@ts-ignore`, or `// TODO` density has grown

**Don't use for:**
- A specific known bug → use `kernel-debug` instead
- Architectural drift only → use `architecture-audit`
- Effect-TS abstraction opportunities only → use `effect-abstraction-audit`

---

## Prerequisites — Orient First

Before launching agents, spend 5 minutes on current state. **Don't skip.**

```bash
# Build baseline
rtk bun run build 2>&1 | tail -30

# Test baseline
rtk bun test 2>&1 | tail -40

# TypeScript errors (authoritative for DTS issues)
rtk bunx turbo run build --filter=... 2>&1 | grep -E "error TS|Type error" | head -30

# Recent changes (last 10 commits)
rtk git log --oneline -10
```

Query the wiki for prior sweep results to avoid re-filing known issues:
```
claude-obsidian:wiki-query "health sweep bugs issues YYYY"
claude-obsidian:wiki-query "running issues log"
```

Read:
- `wiki/Hot.md` — current priorities, in-flight work
- `wiki/Issues/Running Issues Log.md` — known open issues (don't re-file these)

Record the **baseline** before proceeding: build status (GREEN/RED), test count, failure count. You need this to measure "did we improve?"

---

## Phase 1 — SCAN (parallel, ~10 minutes)

Launch four agents concurrently via the Agent tool. Each gets the baseline counts and is told NOT to fix anything — scan only.

### Agent A: Type Safety & Compiler Errors

Scan every package for:
1. **TypeScript errors** — `as any`, `@ts-ignore`, `// @ts-nocheck`, unsafe casts, missing generics on `Effect<unknown>` / `Layer<unknown>`
2. **Dead exports** — public API exports with zero callers inside the monorepo (`grep -r "from '.*package-name'"` across all packages)
3. **Implicit any** — function parameters missing types, untyped return values in public APIs
4. **Type drift** — interfaces that claim `A` but return `B` at runtime (look for `as unknown as X`)

Scope: all `packages/*/src/**/*.ts` and `apps/*/src/**/*.ts`. Skip `*.test.ts` for type-safety scan (test files have intentional loose typing).

Output per finding: `file:line | severity(P0/P1/P2) | one-line description | fix-direction`

### Agent B: Bug Patterns & Runtime Risks

Scan for:
1. **Unhandled promise rejections** — `Promise` calls not wrapped in `Effect.tryPromise`, bare `.catch()` that swallows errors
2. **Null/undefined deref risks** — optional chaining missing where shape is nullable, array access without bounds check in hot paths
3. **Effect error channel leaks** — `Effect.runPromise` without `.catch` at call sites; `pipe(Effect.catch(...))` with empty handler
4. **Race conditions** — shared mutable state mutated across concurrent Effect fibers without `Ref`
5. **Incorrect termination paths** — any site that calls `process.exit` or `throw` outside of top-level runners (kernel loop, CLI entrypoints)
6. **Test–production divergence** — `// for testing only` comments in non-test files; conditional behavior on `process.env.NODE_ENV`

Output per finding: `file:line | severity | description | fix-direction`

### Agent C: Inefficiencies & Dead Weight

Scan for:
1. **Dead code** — functions/classes/types exported but unreferenced; `// disabled`, `// TODO: remove`, `// legacy` comments attached to active code
2. **Redundant rebuilds** — `packages/*/dist` checked into git; build artifacts that should be `.gitignore`d
3. **Duplicate logic** — near-identical blocks (>10 lines) appearing in 2+ files; provider-specific parsing that could share a helper
4. **Over-large files** — files >500 LOC in packages that have a decomposition pattern in play; files >1000 LOC anywhere
5. **Expensive operations in hot paths** — `JSON.parse/stringify` inside tight loops; synchronous file reads in kernel loop phases; `Array.from` on already-array values
6. **Stale dependencies** — `package.json` entries with `^` ranges that resolve to a version known to break (check against `MEMORY.md` `feedback_bun_version_pin.md`)

Output per finding: `file:line | severity | description | effort(S/M/L)`

### Agent D: Test Coverage & Quality Gaps

Scan for:
1. **Test failures** — run `bun test` in each package; surface net-new failures vs baseline
2. **Skipped/xfailed tests** — `.skip`, `.todo`, `it.skip`, `describe.skip` without a tracking comment
3. **Missing coverage for public exports** — exported symbols in `packages/*/src/index.ts` with no corresponding test file
4. **Flaky test signatures** — tests with `setTimeout`, `sleep`, fixed delays, or `Date.now()` comparisons without tolerance
5. **Mock–production divergence** — mocks that don't match current interface signatures (detect via `as unknown as` casts in test setup)

Output per finding: `package | test-name or file:line | severity | description`

---

## Phase 1.5 — VERIFY (MANDATORY before TRIAGE)

**Why this exists:** the 2026-05-21 audit-of-audit found 3/31 prior sweep items shipped with bad framing (HS-18 orthogonal-not-superseded, HS-22 65→9 emit sites, HS-31 74→55 casts). Pattern: agents grepped without semantic verification, then committed bad counts to the register.

**Rule:** every finding from Phase 1 must have a `verified-by:` line BEFORE it can be triaged. No exceptions.

### Verification protocol per finding

For each finding, the sweep-runner re-runs the exact claim with explicit evidence:

```
finding: "Provider retry loops overwrite lastError across 5 providers"
verified-by:
  - grep -n "lastError = " packages/llm-provider/src/providers/{anthropic,openai,gemini,local,litellm}.ts
  - 5 matches, 1 per file, all inside retry loops (lines: anthropic 346, openai 486, gemini 575, local 691, litellm 479)
  - Each loop has no error accumulator — only `lastError = e` reassignment
```

Acceptable evidence shapes:
- `grep -c <pattern> <file>` → exact count
- `wc -l <file>` → exact LOC
- `grep -n <pattern> <file>` → file:line list
- File read of named lines (paste 3-line context if claiming a semantic concern)
- For runtime claims: trace/test that demonstrates the behavior

**Unacceptable:**
- "grep showed about 60 matches" (no exact number, no command)
- "looks like duplication" (no diff'd block, no LOC)
- "should be unused" (no zero-callers proof)
- Counting `grep -rn <pattern> | wc -l` for "occurrences" — that counts MATCH-LINES, which is ≥ occurrences when multiple matches share a line. Use `grep -ro <pattern> | wc -l` for occurrences.

### Inflation guard for common patterns

| Claim shape | Common inflation | Correct check |
|-------------|------------------|---------------|
| "N duplicated lines" | grep counts ALL matches across files | Diff the blocks; count semantically equivalent ones |
| "N `as any` casts" | `grep -c` counts lines, not casts | `grep -ro 'as any' \| wc -l` |
| "@deprecated annotations" | Counts include re-export sites | Check declaration site only |
| "File >1500 LOC" | Includes blank lines + comments | `wc -l` is fine, but note effective code LOC |
| "Zero tests" | Misses tests/ vs test/ vs __tests__/ directory variations | Check all 3 conventions |

### Verified-by carries forward to GH issue

When migrating findings to a GitHub issue (template `audit-finding.yml`), the `verified-by` text becomes a required body field. The template will reject submission without it.

---

## Phase 2 — TRIAGE

Wait for all four agents. Merge findings into a single prioritized register.

### Severity Levels

| Level | Criteria | Action |
|-------|----------|--------|
| **P0** | Build broken, test suite regressed, data corruption risk, process crash | Fix this sweep |
| **P1** | Type error leaks to public API, unhandled runtime error path, test skip with no owner | Fix this sweep if bounded |
| **P2** | Inefficiency, dead code, coverage gap, style drift | File for planning |

### Safe-Fix Criteria (fix now)

A finding is safe to fix THIS sweep if ALL of:
- Change is ≤ 25 lines
- Touches ≤ 2 files
- No behavioral change (type annotation fixes, dead export removal, import cleanup)
- OR the fix is additive-only (add a missing `.catch`, add a type guard)
- Has a test covering the affected path (or fix IS adding the test)

**If ANY criterion fails → file it, don't fix it.**

### Register Format

Append findings to `wiki/Issues/Running Issues Log.md` under a dated section:

```markdown
## Health Sweep — YYYY-MM-DD

| ID | Agent | File | Severity | Description | Status | Fix-Direction |
|----|-------|------|----------|-------------|--------|---------------|
| HS-01 | A | packages/reasoning/src/kernel/loop/runner.ts:423 | P1 | `as any` cast on KernelState.meta | FIX-THIS-SWEEP | Add `Record<string, unknown>` type |
| HS-02 | C | packages/runtime/src/execution-engine/... | P2 | 847 LOC, decomposition candidate | FILE | Plan as W26 decomp |
```

De-duplicate against existing open issues. If a finding already has an entry, update its `Status` rather than adding a duplicate row.

---

## Phase 3 — FIX

Work through the safe-fix list in P0 → P1 order. One fix at a time, verify after each.

### Fix Loop

```
1. Pick next P0/P1 safe fix from register
2. Edit the file(s)
3. Build affected package: cd packages/<name> && bun run build
4. Run affected tests: bun test packages/<name>
5. Net new failures? → revert fix, mark HS-XX as NEEDS-PLANNING
6. Tests pass? → mark HS-XX as FIXED, commit
7. Repeat
```

### Commit Convention

```
fix(<package>): <one-line description>

Health sweep YYYY-MM-DD: HS-XX
<what was wrong, one sentence>
<what changed, one sentence>

Tests: N ran, M fail (= baseline M, zero new regressions)
```

**No `Co-Authored-By` lines.** See user memory.

### What NOT to Do

- Don't batch multiple unrelated fixes in one commit — one finding per commit
- Don't fix P2 items inline with P0/P1 fixes — separate commits or defer
- Don't remove code you're unsure is dead — grep the full monorepo first (`rtk grep -r "functionName" packages/`)
- Don't break a passing test to make the fix work — fix the fix

---

## Output

When sweep is complete, report:

1. **Baseline vs final:** build status, test count before/after
2. **Fixed this sweep:** list of HS-IDs with one-line description
3. **Filed for planning:** count of P1/P2 items added to Issues Log
4. **Top 3 P2 opportunities** worth prioritizing next sprint

Keep the summary under 15 lines. Full detail lives in the Issues Log.

---

## Wiki Integration

After each sweep:
```
claude-obsidian:save  →  wiki/Research/Debriefs/YYYY-MM-DD-health-sweep-debrief.md
```

Include: baseline, findings summary, what was fixed, what was filed, and any surprising patterns (new failure mode? new debt area?). Link to the Issues Log section via `[[wiki/Issues/Running Issues Log#Health Sweep YYYY-MM-DD]]`.

Run lint after if new pages were added:
```
claude-obsidian:wiki-lint
```

---

## Quick Reference

```bash
# Build all
rtk bun run build

# Test all (with output)
rtk bun test 2>&1 | tail -50

# Test single package
cd packages/<name> && rtk bun test

# Find dead exports (example)
rtk grep -r "export.*functionName" packages/ apps/

# TypeScript errors only
rtk bunx turbo run build 2>&1 | grep "error TS"

# Count TODOs/FIXMEs
rtk grep -r "TODO\|FIXME\|HACK\|as any\|@ts-ignore" packages/*/src --include="*.ts" | wc -l
```

## Anti-Patterns

| Anti-pattern | Why bad |
|---|---|
| Fix while scanning | Pollutes the baseline; you lose the before/after signal |
| Fix P2 items in the P0/P1 pass | Scope creep; P2 needs a plan |
| File a finding already in the Issues Log | Creates duplicate tracking debt |
| Commit multiple unrelated fixes together | Makes bisect impossible |
| Remove export without grepping monorepo | "Unused" in one package may be used in another |
| Skip the build verify after each fix | Type-correct ≠ build-correct in a multi-package monorepo |
