---
type: implementation-plan
status: proposed
created: 2026-11-03
updated: 2026-11-03
tags: [agent-efficiency, determinism, tooling, declutter, type-safety]
---

# Repo Tool (Determinism Layer) + Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One deterministic internal CLI, `bun run repo <command>`, answers every "what applies to my change, and did I pass?" question for coding agents. The plan then deletes the prose, scripts, and stale files that the CLI makes redundant, and brings the repo to a normal state of 0 failing tests.

**Architecture:** A private workspace package at `tools/repo/` with a command registry and two data manifests: `checks.json` (every gate) and `ownership.json` (path → owner warden, checks, docs). The existing `scripts/check-*.sh` stay in place and are *registered*, not rewritten. Claude Code hooks, `.githooks/`, and CI call `repo` instead of raw scripts. Prose rules that become checks are deleted from `AGENTS.md`.

**Tech Stack:** Bun ≥1.1 test runner, TypeScript, `node:` built-ins, `yaml` (already in `bun.lock`; declared explicitly).

**Spec:** the design agreed in the 2026-11-03 session, plus the peer handoff `wiki/Development/Agent-Session-Learnings-2026-11-03.md`. The evidence below makes this plan self-contained.

## Evidence (9 transcripts, `~/.claude/projects/-home-tylerbuell-Documents-AIProjects-reactive-agents-ts/`, analyzed 2026-11-03)

- Discovery is not the bottleneck: 1,530 search calls, 4 empty results. Volume and rework are.
- 478 of 491 `bun test` calls were piped to `grep`/`tail` against the AGENTS.md rule.
- 347 scripted `python3 -` `.replace()` edits and 186 `sed -i`, vs 79 `Edit` calls. No-op replacements go unverified.
- Subagents were about 2/3 of token spend: 8,225 subagent turns vs 3,845 main.
- Gates run up to 3× per CI run:
  - once via the glob loop at `.github/workflows/ci.yml:85`
  - again under `bun test` via `packages/reasoning/tests/enforcement-scripts.test.ts`
  - five of them a third time via `scripts/check-cross-cutting.sh:683-768`
- Two permanently failing tests in `packages/runtime/test/as-unknown-as-ceiling.test.ts` (measured 2026-11-03) mask real failures on every run:
  - `packages/*/tests`: 286 sites vs `TESTS_CEILING = 251` (line 319)
  - `packages/*/src`: 80 sites vs `CEILING = 79` (line 206)
- Test cast targets are mostly kernel and runtime fixtures, not real boundaries:
  - kernel fixtures: `KernelInput` 19, `ExecutionContext` 12, `KernelRunOptions` 11, `KernelState` 10, `KernelContext` 7, `PhaseDeps` 6, `KernelHooks` 5
  - other doubles: `NodeJS.WriteStream` 12, `typeof` (mostly `fetch`) 27, `Response` 6
  - by package: reasoning 105, runtime 87
- Shell `grep` in Claude Code is an ugrep wrapper (`-I --ignore-files`). It silently skipped `packages/reasoning/src/kernel/assessment/assess.ts` (not gitignored, valid UTF-8, no control chars; cause unknown).
- `AGENTS.md` is 750+ lines. Hand-written counts and versions in it and in `.agents/MEMORY.md` get copied into briefs.
- Stale surfaces:
  - `.github/copilot-instructions.md` is a leftover `claude-mem` placeholder
  - `wiki/Home.md` has 0 inbound links
  - the five `wiki/MOCs/*` are stale but have 49 inbound links
  - 4 skills (`update-docs`, `prune-memory`, `codebase-health-sweep`, `execute-backlog`) instruct piped `bun test`

## Naming (decided; agents must be able to guess these)

| You want to… | Run | Data file |
|---|---|---|
| See where the project is | `bun run repo status` | generated |
| Know what your change touches (owner, checks, docs) | `bun run repo scope [files…]` | `tools/repo/ownership.json` |
| Run the checks that apply | `bun run repo check [--all]` | `tools/repo/checks.json` |
| Run tests without piping | `bun run repo test <paths…>` | — |
| Verify one package before reporting done | `bun run repo verify <pkg-dir>` | — |
| Lower ceilings your change earned | `bun run repo ratchet [--write]` | `checks.json` |
| Validate a warden's UpwardReport | `bun run repo warden-report <file>` | — |
| Find any script in the repo | `bun run repo help --all` | `tools/repo/catalog.json` |
| Check whether agent behavior improved | `bun run repo session-stats [--since ISO]` | `tools/repo/baseline.json` |

Why these names:
- `repo`, not `dev`: in JS repos `bun run dev` means "start a dev server", so agents would guess wrong.
- `check`, not `gate`: matches `scripts/check-*.sh` and avoids colliding with the north-star `gate:*` scripts.
- `scope`, not `route`: "route" reads as HTTP routing.
- `hook` exists for `.claude/settings.json` only and is hidden from `help`.

## `repo` vs `rax` vs `rax-diagnose` (roles must never blur)

| Tool | Audience | Job | Ask yourself |
|---|---|---|---|
| `bun run repo …` | contributors and coding agents working **on** this repo | Keep the change aligned with the repo's rules: scope, checks, tests, verify, status, hook. Never touches an agent runtime. | "How do I change this codebase correctly?" |
| `rax …` (`apps/cli`, published) | end users and operators of Reactive Agents | Create, run, and inspect **agents** (`rax run`, `rax ps`, `rax attach`, scaffolding). Product surface; versioned and documented. | "How do I use the framework?" |
| `rax-diagnose …` (`packages/diagnose`) | contributors and agents debugging a **run** | Read a run trace and name the cause (`rax-diagnose cause <runId\|path>`). | "Why did this agent run behave that way?" |

Rules:
- **One direction of dependency.** `repo` may *invoke* `rax-diagnose` or point to it in a `next:` line. `rax` never imports or mentions `repo`; the published CLI must not know the internal tool exists.
- **No overlap.** `repo` has no command that runs, scaffolds, or inspects an agent. `rax` has no command about the repo's checks, ownership, or tests. A proposed command that fits both goes to `rax` if an end user would want it, otherwise `repo`.
- **Never add contributor tooling to `rax`.** `apps/cli` is public and its commands are documented in `apps/docs`; internal gates stay out of it.
- **`repo help` prints a footer** naming the other two tools and when to use each (one line each, taken from this table). `rax --help` is not changed.
- **Disambiguation lives in one place.** The table above is copied into `wiki/Development/Repo-Navigation.md` and one line into `AGENTS.md`; nowhere else restates it (the doc-drift check in Task 3 catches a `repo` command that does not exist, and Task 11 asserts the footer and docs agree).

**Usage contract, enforced by tests in Task 1:**
- Every command takes `--json` (stable machine output) and `--help` (one-line summary + one example).
- Every failure's last line is `next: <exact command to run>`.
- Defaults act on changed files: no args means "my current diff".
- Unknown flags are errors (exit 2), never ignored.

## Adaptability and alignment (design rules; every task obeys these)

Goals will change. The tool must follow those changes, and it must never push agents in a direction the canonical docs no longer hold.

1. **Data, not code.** Rules, ownership, checks, the script catalog, and every `next:` hint live in versioned JSON manifests (`schemaVersion: 1`, validated on load). TypeScript is a generic engine. Changing direction means editing a data row; no code change is needed.
2. **Manifests verify themselves against reality.** CI fails when a manifest drifts:
   - every `packages/*` and `apps/*` dir matches an `ownership.json` entry (or is listed as `"owner": null, "reason": "<why>"`)
   - every warden named exists in `.claude/agents/`
   - every check id exists
   - every runnable script is in `catalog.json`
   - every `bun run repo <cmd>` mention in `AGENTS.md`, `.agents/skills/**`, and `wiki/Development/**` names a real command
3. **Report and route; never decide direction.** `repo status` copies canonical sources (plan frontmatter, debt-register counts, `Hot.md` date) and *points to* `09-UNIFIED-PROGRAM.md`. It never extracts or infers "what to do next" from prose. Any cited source section whose heading carries a date older than 60 days is printed with `(dated <date> — confirm before relying)`. Example: 09 §4 is headed "Verified state (2026-08-12)".
4. **Every message carries provenance.** Each deny or failure ends with `[source: <manifest>#<id>]`, so agents and humans can trace a message, and dispute it if it's wrong.
5. **The hook fails open; CI fails closed.** If the hook itself crashes, it allows the call and logs the error, so a broken rule can't brick a session. CI checks have no bypass.
6. **Overrides are visible signal.**
   - Agents may bypass a hook rule with `REPO_ALLOW=<rule-id> REPO_ALLOW_REASON="<why>"`, logged to `.repo-logs/overrides.jsonl`.
   - `repo status` reports override counts per rule. A rule overridden ≥3 times prints `rule <id> may be wrong — review tools/repo/rules.json`.
7. **Rules expire unless renewed.** Every rule and check entry has `owner` and `reviewBy` (ISO date). Past `reviewBy`, `repo check` warns. Past `reviewBy` + 30 days, it fails until the rule is renewed or deleted. This reuses the `scripts/check-no-expired-pilots.sh` pattern.
8. **The tool proves it solved the problem.** `repo session-stats` (Task 13) re-measures the baseline metrics from transcripts. The plan is not `completed` until the thresholds in "Done looks like" are met.

## Global Constraints

- `tools/repo` is `"private": true`, never published, and excluded from `apps/docs` package metrics.
- No new dependencies beyond `yaml`, which is already resolved in `bun.lock`.
- Use `node:` built-ins only. No new `Bun.*` APIs (AGENTS.md §Runtime Policy).
- No `any` and no `as any`. New code adds 0 `as unknown as` sites.
- Deterministic: same repo state and args produce the same stdout and exit code. No LLM or network calls.
- `repo scope` and `repo hook` must run in <300 ms on this repo.
- Exit codes: `0` ok, `1` check failed, `2` usage error.
- Style: plain TypeScript functions like `scripts/check-docs-sync.ts`. No Effect-TS; this is dev tooling, not a framework package.
- In `tools/repo` code, read files with `node:fs`. Never shell out to `grep` (see the ugrep evidence).
- `scripts/check-*.sh`, `scripts/lift/`, and `scripts/probes/` do NOT move: 21 source files and about 335 wiki docs reference them.
- **Sequencing:** the Plan 8 instrumentation slice landed on `dev` (`7b46fb9b4`, `c72f36400`, `9513c811d`), and the Plan 8 session released `packages/reasoning`, `packages/runtime`, and `packages/trace` on 2026-11-03. Before Tasks 2 (Step 7) and 9, re-check with that session via `ListAgents` in case a later Plan 8 slice has reclaimed them.
  - **Hold released (2026-11-03):** Plan 8 slice "contract provenance + utility-prompt fast path" committed on `dev`. All reasoning/runtime paths are free, and Task 9 may start. Standing agreement: the Plan 8 session edits only source and NEW test files in those packages, never existing test files, and announces before starting.

## Review Focus

1. **Hook false positives.** `echo "bun test | grep"`, a heredoc containing `sed -i`, and `git commit -m "... python3 - ..."` must all be allowed (Task 6).
2. **`repo scope` with no changes** (clean tree, or detached HEAD with no upstream) prints `no changes` and exits 0 (Task 3).
3. **A new `scripts/check-*.sh` missing from `checks.json`** makes `repo check --all` exit 1 and name the file (Task 2).
4. **A crashed test runner** (no summary line) gives `fail: unknown`, exit 1, never 0 (Task 4).
5. **An UpwardReport with no `upward-report:` key** gives `valid:false`, `next: escalate`, never a pass (Task 8).

---

## File Structure

```
tools/repo/
  package.json        "@reactive-agents/repo-tools", private
  tsconfig.json
  checks.json         every gate: id, script, scope globs, stages, ratchet, owner, reviewBy
  ownership.json      path glob → owner warden, checks[], docs[]
  rules.json          hook rules: id, match, reason, alternative, owner, reviewBy, examples{allow[],deny[]}
  catalog.json        every other runnable entry: id, path|script, kind, summary, invoke
  src/cli.ts          main(argv) + registry
  baseline.json       2026-11-03 session metrics (Task 13)
  src/commands/{help,status,scope,check,test,verify,ratchet,warden-report,session-stats,hook}.ts
  src/lib/{manifest,glob,changed-files,bun-test-summary,output,catalog}.ts
  tests/*.test.ts
```

Root `package.json`: add `"repo": "bun tools/repo/src/cli.ts"` and `"tools/repo"` to `workspaces`.

---

### Task 1: CLI skeleton + usage contract

**Files:**
- Create: `tools/repo/{package.json,tsconfig.json}`, `src/cli.ts`, `src/lib/output.ts`, `src/commands/help.ts`
- Modify: `package.json`
- Test: `tools/repo/tests/cli.test.ts`

**Interfaces:**
- Produces:
  - `export interface Command { name: string; summary: string; example: string; hidden?: boolean; run(args: readonly string[], io: Io): Promise<number> }`
  - `export interface Io { json: boolean; out(text: string): void; data(value: unknown): void; fail(message: string, next: string): number }`, where `fail` prints the message, then `next: <next>`, and returns `1`
  - `export const commands: readonly Command[]`
  - `export async function main(argv: readonly string[]): Promise<number>`

- [ ] **Step 1: Write failing tests:**
  - `main(["help"])` returns `0` and lists every non-hidden command name. `hook` is absent.
  - `main([])` behaves like `help`.
  - `main(["nope"])` returns `2`, and stderr contains `unknown command: nope` and `next: bun run repo help`.
  - For every command `c`: `c.summary` is ≤80 chars, and `c.example` starts with `bun run repo ${c.name}`.
  - `main(["help","--bogus"])` returns `2`.
  - With `--json`, `help` prints valid JSON listing `{name, summary, example}`.
- [ ] **Step 2: Run** `bun test tools/repo/tests/cli.test.ts --timeout 15000`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `main`, the registry, and `Io`. `help` output is sorted by name.
- [ ] **Step 4: Run** the tests, then `bun run repo help`. Expected: PASS, and the help listing prints.
- [ ] **Step 5: Commit** `feat(repo-tools): internal repo CLI skeleton + usage contract`.

### Task 2: `checks.json` + `repo check` + `repo ratchet`, one run per gate

**Files:**
- Create: `tools/repo/checks.json`, `src/lib/{manifest,glob,changed-files}.ts`, `src/commands/{check,ratchet}.ts`
- Modify:
  - `.github/workflows/ci.yml:82-88`: replace the glob loop with `bun run repo check --all`
  - `scripts/check-cross-cutting.sh:678-775`: delete the five delegated sub-invocations (volatile-placement, ablatable, cost-accounting, event-wiring, harness-config)
  - `packages/reasoning/tests/enforcement-scripts.test.ts`: replace per-script spawning with a registry-completeness assertion. **This edit waits for the Plan 8 report.**
- Test: `tools/repo/tests/check.test.ts`

**Interfaces:**
- Produces:
  - `export type Stage = "hook" | "pre-commit" | "ci"`
  - `export interface CheckEntry { id: string; script: string; scope: readonly string[]; stages: readonly Stage[]; ratchet?: { file: string; constant: string; measure: string } }`
  - `export function loadChecks(root: string): readonly CheckEntry[]`
  - `export function matchesGlob(path: string, glob: string): boolean`
  - `export function selectChecks(checks: readonly CheckEntry[], changed: readonly string[], stage: Stage): readonly CheckEntry[]`
  - `export function changedFiles(root: string): readonly string[]` (union of `git diff --name-only HEAD` and untracked, non-ignored files)

- [ ] **Step 1: Write failing tests:**
  - `loadChecks(repoRoot)` has exactly one entry per `scripts/check-*.sh` on disk.
  - `selectChecks(checks, ["packages/reasoning/src/kernel/x.ts"], "ci")` includes matching-scope checks and excludes an `apps/docs/**`-only check.
  - A temp root with an unregistered `scripts/check-new.sh` makes `repo check --all` exit `1`, names `check-new.sh`, and ends with `next: add check-new to tools/repo/checks.json` (Review Focus 3).
  - `matchesGlob("a/b/c.ts","a/**")` is true; `matchesGlob("a/b.ts","a/*/c.ts")` is false.
  - `repo ratchet` on a fixture: ceiling 100 with measured 90 prints `100 → 90` and exits 0. Measured 110 prints the overage and exits 1. Without `--write`, no file changes.
- [ ] **Step 2: Run** `bun test tools/repo/tests/check.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Write `checks.json`.**
  - One entry per current `scripts/check-*.sh` (29 today). Scope comes from each script's header comment, defaulting to `["**"]`. Stages default to `["ci"]`.
  - Register `scripts/check-file-size.sh` (it fails on shrink, so wardens must lower its ceiling) and both `as-unknown-as` ceilings as `ratchet` entries.
- [ ] **Step 4: Implement** `repo check [--all|--changed] [--stage s]`. It runs each selected script once, streams output, and ends with `checks: N pass, M fail`. On failure it adds `next: bun run repo check --only <id>`.
- [ ] **Step 5: Implement** `repo ratchet [--write]`. It measures, prints `<id> <file>: <old> → <new>`, and never raises a ceiling.
- [ ] **Step 6: Run** the tests, then `bun run repo check --all`. Expected: PASS, with the same pass/fail set as `for s in scripts/check-*.sh; do bash "$s"; done` on this commit (paste both into the PR).
- [ ] **Step 7: Apply the dedupe edits** listed under Modify. The `enforcement-scripts.test.ts` edit happens only after the Plan 8 report.
- [ ] **Step 8: Run** `bash scripts/check-cross-cutting.sh`. Expected: PASS.
- [ ] **Step 9: Commit** `feat(repo-tools): checks registry; run each gate once; ratchet`.

### Task 2b: Script catalog + anti-entropy check (canonicalize the scattered surface)

Today's runnable surface:
- 77 tracked files under `scripts/`
- 32 under `.agents/skills/harness-improvement-loop/scripts/`
- 15 under package and app `scripts/` dirs
- 36 root `package.json` scripts and 190 package-level scripts
- 40 inline `run:` blocks in `.github/workflows/`

Nothing lists them, so agents rediscover them by searching, and new ones scatter.

**Files:**
- Create: `tools/repo/catalog.json`, `src/lib/catalog.ts` (library only; the catalog is surfaced through `help --all`, not a separate command)
- Modify: `src/commands/help.ts` (`help --all` prints the catalog grouped by `kind`)
- Test: `tools/repo/tests/catalog.test.ts`

**Interfaces:**
- Produces:
  - `export type ScriptKind = "check" | "release" | "build" | "docs" | "test-support" | "research" | "ops"`
  - `export interface CatalogEntry { id: string; path?: string; script?: string; kind: ScriptKind; summary: string; invoke: string }`
  - `export function uncatalogued(root: string, catalog: readonly CatalogEntry[], checks: readonly CheckEntry[]): readonly string[]`

- [ ] **Step 1: Write failing tests:**
  - On the real repo after Step 3, `uncatalogued(root, …)` returns `[]`. It covers:
    - every file under `scripts/` (recursing into `lift/` and `probes/`)
    - `.agents/skills/*/scripts/*`
    - `packages/*/scripts/*` and `apps/*/scripts/*`
    - every root `package.json` script name
  - A temp root with an extra `scripts/new-thing.ts` returns `["scripts/new-thing.ts"]`. `repo check --all` then fails with `next: add scripts/new-thing.ts to tools/repo/catalog.json (kind + summary)`.
  - Every catalog `summary` is ≤80 chars, and every `invoke` is a runnable command string.
  - `help --all` groups output under the 7 `kind` headings.
  - `help` (with or without `--all`) ends with a "Other tools" footer: `rax` (use/operate agents, end-user CLI), `rax-diagnose` (explain a run trace), each with one line. `--json` includes it as `otherTools: [{name, useFor}]`.
  - No file under `apps/cli/` contains the string `bun run repo` or `tools/repo` (one-way dependency; scan the source).
- [ ] **Step 2: Run** `bun test tools/repo/tests/catalog.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Write `catalog.json`.** Classify every entry. Each file's header comment and its callers (CI, `package.json`, `bunfig.toml`) decide its `kind`. Register `catalog-coverage` as a check in `checks.json` with stage `ci`.
- [ ] **Step 4: Prune root `package.json` scripts.** Delete any root script whose job a `repo` command now does, and record each deletion's replacement in the commit body. Keep every alias CI or docs invoke; Grep for the script name first.
- [ ] **Step 5: Run** the tests and `bun run repo check --all`. Expected: PASS.
- [ ] **Step 6: Commit** `feat(repo-tools): script catalog + coverage check`.

### Task 3: `ownership.json` + `repo scope`

**Files:**
- Create: `tools/repo/ownership.json`, `src/commands/scope.ts`
- Test: `tools/repo/tests/scope.test.ts`

**Interfaces:**
- Consumes: `matchesGlob`, `loadChecks`, `changedFiles` (Task 2).
- Produces:
  - `export interface OwnershipEntry { glob: string; owner: string | null; checks: readonly string[]; docs: readonly string[] }`
  - `export interface ScopeResult { owners: readonly string[]; checks: readonly string[]; docs: readonly string[]; unowned: readonly string[] }`
  - `export function scopeFiles(files: readonly string[], entries: readonly OwnershipEntry[]): ScopeResult`

- [ ] **Step 1: Write failing tests:**
  - `scopeFiles(["packages/reasoning/src/kernel/loop/runner.ts"], e).owners` equals `["kernel-warden"]`.
  - Two packages produce sorted, deduped owners.
  - `scopeFiles(["README.md"], e).unowned` equals `["README.md"]`.
  - Every `owner` in `ownership.json` has `.claude/agents/<owner>.md`.
  - Every `checks[]` id exists in `checks.json`.
  - A clean temp git repo prints `no changes` and exits 0 (Review Focus 2).
  - **Coverage (design rule 2).** Every dir in `packages/*` and `apps/*` matches an entry. An entry with `"owner": null` must carry a non-empty `reason`. A temp root with a new `packages/newpkg/` fails `repo check --all` with `next: add packages/newpkg/** to tools/repo/ownership.json`.
  - **Doc-command drift.** Every `bun run repo <word>` occurrence in `AGENTS.md`, `.agents/skills/**/*.md`, and `wiki/Development/**/*.md` names a registered command. A fixture doc mentioning `bun run repo route` fails with `next: rename to an existing command (bun run repo help)`.
  - **Expiry.** A `checks.json` or `rules.json` entry past `reviewBy` warns. One past `reviewBy` + 30 days fails `repo check --all`. Today is injected.
  - Every manifest file has `"schemaVersion": 1`. A missing or unknown version fails load and names the file.
- [ ] **Step 2: Run** `bun test tools/repo/tests/scope.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Write `ownership.json`.** Copy rows verbatim from the warden table under AGENTS.md §Team-Ownership Dev Contract and the doc-update table under AGENTS.md §Documentation Workflow.
- [ ] **Step 4: Implement** `repo scope [files…]`. It prints `owners:`, `checks:`, and `docs:` blocks, plus `unowned:` when non-empty. When owners are present, the last line is `next: dispatch <owner> with a MissionBrief (.agents/skills/mission-brief/SKILL.md)`.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(repo-tools): ownership manifest + repo scope`.

### Task 4: `repo test` (scoped, unpiped, logged)

**Files:**
- Create: `src/lib/bun-test-summary.ts`, `src/commands/test.ts`
- Modify: `.gitignore` (add `.repo-logs/`)
- Test: `tools/repo/tests/test-command.test.ts`

**Interfaces:**
- Produces:
  - `export interface TestSummary { pass: number | null; fail: number | null; skip: number | null; failures: readonly string[] }`
  - `export function summarizeBunTest(log: string): TestSummary`

- [ ] **Step 1: Write failing tests (inline log fixtures):**
  - ` 136 pass`, ` 0 fail`, ` 2 skip` give `{136,0,2,[]}`.
  - Two `(fail) suite > name` lines give both names, in order.
  - No summary lines give all-`null` (Review Focus 4).
- [ ] **Step 2: Run** `bun test tools/repo/tests/test-command.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement** `repo test <paths…> [--timeout ms]` (default `15000`).
  - It spawns `bun test` with no pipe and writes the full output to `.repo-logs/test-<ISO>.log`.
  - It prints only the summary, the failure names, and `log: <path>`.
  - Exit is `1` if `fail > 0`, if `fail === null` (prints `fail: unknown`), or if the child exits non-zero.
  - On failure it ends with `next: open <log path>`.
- [ ] **Step 4: Run** the tests, then `bun run repo test tools/repo/tests/cli.test.ts`. Expected: PASS, and the log file exists.
- [ ] **Step 5: Commit** `feat(repo-tools): scoped test runner with log file`.

### Task 5: `repo verify <pkg-dir>`

**Files:**
- Create: `src/commands/verify.ts`
- Test: `tools/repo/tests/verify.test.ts`

**Interfaces:**
- Consumes: `selectChecks` (Task 2), the test runner (Task 4).
- Produces: `export function planVerify(pkgDir: string, checks: readonly CheckEntry[]): readonly string[]`.

- [ ] **Step 1: Write failing tests:**
  - `planVerify("packages/tools", c)` returns, in order:
    1. `bun run repo test packages/tools`
    2. `bun run --cwd packages/tools typecheck`
    3. one `bash scripts/<check>` per check whose scope matches `packages/tools/**`
  - An unknown dir exits `2`.
  - `--dry-run` prints the list without running anything.
- [ ] **Step 2: Run** `bun test tools/repo/tests/verify.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.** Run the steps in order, stop at the first failure, and print a `✓`/`✗` line per step.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(repo-tools): repo verify scoped verifier`.

### Task 6: PreToolUse hook (`repo hook pre-bash`)

**Files:**
- Create: `tools/repo/rules.json`, `src/commands/hook.ts`
- Modify: `.claude/settings.json` (add a `PreToolUse` hook, matcher `Bash`, command `bun tools/repo/src/cli.ts hook pre-bash`)
- Test: `tools/repo/tests/hook.test.ts`

**Interfaces:**
- Produces:
  - `export interface HookRule { id: string; match: { command: string; notInside?: ("quotes" | "heredoc-to-file")[] }; reason: string; alternative: string; owner: string; reviewBy: string; examples: { allow: readonly string[]; deny: readonly string[] } }`, where `match.command` is a regex applied to the stripped command
  - `export type HookDecision = { decision: "allow" } | { decision: "deny"; ruleId: string; reason: string }`
  - `export function classifyBash(command: string, rules: readonly HookRule[], env: Readonly<Record<string, string | undefined>>): HookDecision`

  The command reads the hook JSON on stdin and emits Claude Code PreToolUse deny JSON (`hookSpecificOutput.permissionDecision: "deny"`, `permissionDecisionReason` = `reason + "\n" + alternative + "\n[source: tools/repo/rules.json#<id>]"`) only on deny. On any internal error, it allows the call and appends to `.repo-logs/hook-errors.jsonl` (design rule 5).

- **Rules shipped in `rules.json`** (ids are final):
  - `no-piped-test` (alternative: `bun run repo test <paths>`)
  - `no-scripted-edit` (covers `python3 -` with `.replace(` and `sed -i`; alternative: `use the Edit tool`)
  - `no-cd-prefix` (alternative: `use absolute paths in the command`)

- [ ] **Step 1: Write failing tests:**
  - Deny `timeout 590 bun test packages/x 2>&1 | tail -5`. The reason contains `bun run repo test packages/x`.
  - Deny a `python3 - <<'EOF' … .replace('a','b') … EOF` command. The reason contains `use the Edit tool`.
  - Deny `sed -i 's/a/b/' packages/core/src/x.ts`. The reason contains `use the Edit tool`.
  - Deny `cd /home/u/repo && git status`. The reason contains `absolute paths`.
  - Allow (Review Focus 1):
    - `echo "bun test | grep"`
    - `git commit -m "fix: python3 - replace"`
    - `cat <<'EOF' > notes.txt\nsed -i\nEOF`
    - `bun test packages/x --timeout 15000`
    - `sed -n '1,5p' file`
  - A 2,000-char command classifies in <5 ms.
  - **Rules verify themselves.** For every rule in `rules.json`, each `examples.deny[i]` is denied by that rule, and each `examples.allow[i]` is allowed by all rules. A rule with fewer than 2 allow and 2 deny examples fails load with `next: add examples to tools/repo/rules.json#<id>`.
  - With `REPO_ALLOW=no-piped-test` and `REPO_ALLOW_REASON="x"` set, the piped command is allowed, and one line is appended to `.repo-logs/overrides.jsonl` with `{ruleId, reason, command, ts}`. `REPO_ALLOW` without a reason is still denied.
  - A deliberately malformed `rules.json` in a temp root makes the hook allow and log to `hook-errors.jsonl` (fail open). The same file makes `repo check --all` exit 1 (fail closed).
  - Every deny reason ends with `[source: tools/repo/rules.json#<id>]`.
- [ ] **Step 2: Run** `bun test tools/repo/tests/hook.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement `classifyBash` as a generic engine over `rules.json`.** No rule logic in TypeScript.
  - Strip quoted strings and heredoc bodies per each rule's `notInside`, then apply `match.command`.
  - A heredoc fed to `python3 -` counts as executed. It is not stripped.
  - Write the three rules with their examples, using the allow and deny cases above as the rules' `examples`.
- [ ] **Step 4: Run** the tests. Then pipe `{"tool_input":{"command":"bun test a | tail"}}` into `bun run repo hook pre-bash`. Expected: PASS; the payload produces deny JSON in <300 ms.
- [ ] **Step 5: Commit** `feat(repo-tools): PreToolUse hook enforcing test/edit rules`.

### Task 7: `repo status`

**Files:**
- Create: `src/commands/status.ts`
- Test: `tools/repo/tests/status.test.ts`

**Interfaces:**
- Produces: `export interface StatusReport { branch: string; activePlans: readonly { path: string; title: string }[]; openDebt: number; hotUpdated: string | null; dirtyFiles: number; testsPassing: number | null }` and `export function collectStatus(root: string): StatusReport`. `testsPassing` is read from `apps/docs/src/data/metrics-cache.json` (`tests` field).

- [ ] **Step 1: Write failing tests (temp fixture root):**
  - Two `status: active` plans plus one `completed` give `activePlans.length === 2`.
  - `hotUpdated` equals `wiki/Hot.md` frontmatter `updated`.
  - A 3-row fixture register with 1 fixed row gives `openDebt === 2`. Match the real status column of `wiki/Architecture/DEBT-REGISTER.md`.
  - Rendered output is ≤40 lines.
  - **Pointer, not inference.** The output contains `authority: wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` and lists 09's `##` headings with line numbers. It does not reproduce any text from below those headings (assert no 09 body line appears in the output).
  - **Staleness flag.** A fixture heading `## 4. Verified state (2026-08-12)`, with "today" injected as 2026-11-03, renders with `(dated 2026-08-12 — confirm before relying)`. A heading dated within 60 days renders without it.
  - **Override signal.** A fixture `.repo-logs/overrides.jsonl` with 3 entries for `no-cd-prefix` prints `rule no-cd-prefix may be wrong — review tools/repo/rules.json`.
  - **Expiry.** A rule whose `reviewBy` is before injected-today prints under `expired rules:`.
  - `collectStatus` takes `today: string` as a parameter (never reads the clock internally), so output is deterministic.
- [ ] **Step 2: Run** `bun test tools/repo/tests/status.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement**, parsing frontmatter with `yaml`.
- [ ] **Step 4: Run** the tests, then `bun run repo status`. Expected: PASS, and real output ≤40 lines.
- [ ] **Step 5: Commit** `feat(repo-tools): generated repo status`.

### Task 8: `repo warden-report`

**Files:**
- Create: `src/commands/warden-report.ts`
- Test: `tools/repo/tests/warden-report.test.ts`

**Interfaces:**
- Produces:
  - `export type NextAction = "verify" | "verify-with-ablation" | "redispatch" | "escalate" | "surface-blocker"`
  - `export function checkUpwardReport(text: string, retriesRemaining: number): { valid: boolean; errors: readonly string[]; next: NextAction }`

  The schema follows `.agents/skills/upward-report/SKILL.md:13-24`, and the FSM follows AGENTS.md §Dispatcher FSM. There is no `accept`: acceptance happens only after the parent's verifier passes.

- [ ] **Step 1: Write failing tests, one per FSM row:**
  - `completed` with confidence 0.8 gives `verify`.
  - `completed` with confidence 0.5 gives `verify-with-ablation`.
  - `failed` with blockers and retries 1 gives `redispatch`.
  - `failed` with retries 0 gives `escalate`.
  - `denied-by-authority` gives `escalate`.
  - `blocked` gives `surface-blocker`.
  - No `upward-report:` key gives `valid:false, next:"escalate"` (Review Focus 5).
  - Confidence outside 0–1 gives `valid:false`.
- [ ] **Step 2: Run** `bun test tools/repo/tests/warden-report.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.** Parse the last `upward-report:` YAML block with `yaml`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat(repo-tools): upward-report validator + next action`.

### Task 9: Design out the `as unknown as` failures (after the Plan 8 report)

Goal: both ceiling tests pass, and the ceilings ratchet **down** to the new measured counts. Never raise them.

**Files:**
- Create:
  - `packages/reasoning/src/testing/kernel-fixtures.ts`, exported via a new `"./testing"` subpath in `packages/reasoning/package.json`
  - `packages/testing/src/doubles/{fetch,write-stream,response}.ts`, re-exported from `packages/testing/src/index.ts`
- Modify: the test files whose casts these builders replace (reasoning 105 and runtime 87 sites are the bulk); `packages/runtime/test/as-unknown-as-ceiling.test.ts:206,319` (lower the constants to the measured counts)
- Test: `packages/reasoning/tests/testing/kernel-fixtures.test.ts`, `packages/testing/tests/doubles.test.ts`

**Interfaces:**
- Produces:
  - `makeKernelInput(overrides?: Partial<KernelInput>): KernelInput`
  - `makeKernelState(overrides?: Partial<KernelState>): KernelState`
  - `makeKernelRunOptions(overrides?: Partial<KernelRunOptions>): KernelRunOptions`
  - `makeKernelContext(overrides?: Partial<KernelContext>): KernelContext`
  - `makeExecutionContext(overrides?: Partial<ExecutionContext>): ExecutionContext`
  - `makePhaseDeps(overrides?: Partial<PhaseDeps>): PhaseDeps`
  - `makeKernelHooks(overrides?: Partial<KernelHooks>): KernelHooks`
  - `stubFetch(handler: (input: Request) => Response | Promise<Response>): typeof globalThis.fetch`
  - `fakeWriteStream(opts?: { isTTY?: boolean; columns?: number }): { stream: NodeJS.WriteStream; output(): string }`

  Each builder constructs a complete object with defaults. **Builders contain 0 `as unknown as` casts.** That is the point of the design.

- [ ] **Step 1: Write failing tests:**
  - Each builder with no overrides returns an object that type-checks as the target type (compile-time assertion via `satisfies`).
  - Overrides win.
  - `stubFetch` returns the handler's `Response`.
  - `fakeWriteStream().output()` captures writes.
  - A source scan of the new builder files finds 0 `as unknown as`.
- [ ] **Step 2: Run** `bun test packages/reasoning/tests/testing packages/testing/tests/doubles.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement the builders.**
- [ ] **Step 4: Replace cast sites** with builders, package by package: reasoning, then runtime, then the rest. Run `bun run repo verify <pkg>` after each package.
- [ ] **Step 5: Fix the src overage** to ≤79 by replacing the most recent src site (listed first in the ceiling test failure output) with a typed alternative. If no typed alternative exists, document why in the ceiling comment block.
- [ ] **Step 6: Run** `bun run repo ratchet --write` and confirm both constants went down. Then run `bun run repo test packages/runtime/test/as-unknown-as-ceiling.test.ts`. Expected: 2 pass, 0 fail.
- [ ] **Step 7: Commit** `refactor(testing): typed fixture builders replace as-unknown-as test casts; ratchet ceilings down`.

### Task 10: Declutter file surface

**Files:**
- Delete:
  - `.agents/{CORTEX-PUBLISH-GUIDE,KNOWN-ISSUES,PATCH-ISSUES-v0.11.0,PHASE-1-SYNTHESIS,RELEASE-SWEEP-SUMMARY,V0_11_0-PATCH-VERIFICATION}.md` (0 references; May 2026)
  - `scripts/add-package-keywords.ts` (0 callers, 0 doc references)
- Replace: `.github/copilot-instructions.md` (stale `claude-mem` placeholder) → 3 lines pointing to `AGENTS.md` and `bun run repo help`
- Move:
  - `.superpowers/sdd/*.md` → `wiki/Research/Debriefs/_archive/2026-07-sdd/`
  - `.agents/MEMORY-ARCHIVE.md` (604 KB) → `wiki/Research/Agent-Memory-Archive.md`, so `.agents/` holds only `MEMORY.md` + `skills/`
  - `scripts/{build-judge-container.sh,judge-up.sh,run-frozen-judge-regression.sh}` → `packages/judge-server/scripts/`
  - `scripts/capture-golden-run.ts` → `packages/benchmarks/scripts/`
  - `scripts/{telegram-session.sh,signal-register.sh}` → `apps/advocate/scripts/`
- Rewrite:
  - `wiki/Home.md` → short pointer to the "Canonical Wiki Index" in `wiki/Development/Repo-Navigation.md`
  - each `wiki/MOCs/*.md` → the same pointer. Filenames stay, so the 49 inbound links keep resolving.
- Update: the 4 skills that instruct piped `bun test` (`update-docs`, `prune-memory`, `codebase-health-sweep`, `execute-backlog`) → `bun run repo test`. Also update any skill or doc citing a moved path.
- Test: `tools/repo/tests/declutter.test.ts`

- [ ] **Step 1: Write failing tests:**
  - Deleted and moved source paths are absent; destinations exist.
  - `.agents/` contains only `MEMORY.md` and `skills/`.
  - No file under `.agents/skills/` matches `/bun test[^\n`]*\|/`.
- [ ] **Step 2: Run** `bun test tools/repo/tests/declutter.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Fix references before each move.** Use the Grep tool (not shell `grep`) for the old path, and update every hit outside `_archive`.
- [ ] **Step 4: Move and delete** with `git mv` / `git rm`. Apply the rewrites and skill updates.
- [ ] **Step 5: Run** the test, `bun run build`, and `bun run repo check --all`. Expected: all PASS.
- [ ] **Step 6: Commit** `chore: remove stale agent docs; colocate package scripts; point wiki hubs at canonical index`.

### Task 11: AGENTS.md becomes a contract

**Files:**
- Modify: `AGENTS.md`
- Test: `tools/repo/tests/agents-md.test.ts`

- [ ] **Step 1: Write failing tests:**
  - `AGENTS.md` is ≤20,000 bytes.
  - It contains `bun run repo status`, `bun run repo scope`, and `tools/repo/ownership.json`.
  - Every backticked repo path in it without a glob or `<placeholder>` exists.
  - It contains one line distinguishing `repo` (work on the repo), `rax` (use the framework), and `rax-diagnose` (explain a run); its `bun run rax` build-command line is annotated "user CLI, not for repo checks". `wiki/Development/Repo-Navigation.md` carries the full table from "`repo` vs `rax` vs `rax-diagnose`" in this plan.
  - Neither `AGENTS.md` nor `.agents/MEMORY.md` matches `/\b\d{1,3}(,\d{3})+ (pass|tests?|files)\b/` (no hand-written counts).
- [ ] **Step 2: Run** `bun test tools/repo/tests/agents-md.test.ts --timeout 15000`. Expected: FAIL (about 56 KB).
- [ ] **Step 3: Edit.**
  - Warden table and doc-update table → one line on `repo scope` / `ownership.json`.
  - §Terminal Execution Rules → one line on the hook.
  - §Key File Paths and §Canonical Documents → pointer to the Repo-Navigation canonical index.
  - Delete §Current Framework Snapshot; live state comes from `repo status` and `wiki/Hot.md`.
  - Keep: Golden Rules, Common Pitfalls (including #12, the substrate rule), Agent Efficiency Rules, the Release Workflow summary, and the package tree.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `docs(agents): AGENTS.md is a contract; routing and rules live in repo tool`.

### Task 12: Wire + final acceptance

**Files:**
- Modify:
  - `.githooks/pre-commit`: call `bun tools/repo/src/cli.ts check --changed --stage pre-commit`
  - `wiki/Development/Repo-Navigation.md`: add the Naming table and the "`repo` vs `rax` vs `rax-diagnose`" table from this plan
  - `wiki/Hot.md`, `wiki/Planning/Planning-Index.md`, `.agents/MEMORY.md`

- [ ] **Step 1: Mark pre-commit checks.** Only checks measured under 1 s (`time bash scripts/<check>`) get `"pre-commit"`. Record the timings in the commit body.
- [ ] **Step 2: Final acceptance.** Run each of these; each must pass:
  - `bun run repo test packages apps tools`: **0 fail**
  - `bun run repo check --all`: 0 fail
  - `bun run typecheck`
  - `bun run build`
  - `bun run repo status`: ≤40 lines
- [ ] **Step 3: Update the docs** listed under Modify, and set this plan's status to `completed`.
- [ ] **Step 4: Commit** `chore(repo-tools): wire pre-commit; final acceptance`.

### Task 13: `repo session-stats`, proof the tool solved the problem

**Files:**
- Create: `src/commands/session-stats.ts`, `tools/repo/baseline.json`
- Test: `tools/repo/tests/session-stats.test.ts`

**Interfaces:**
- Produces:
  - `export interface SessionMetrics { sessions: number; bunTestCalls: number; pipedBunTest: number; scriptedEdits: number; editToolCalls: number; agentSpawns: number; subagentTurns: number; mainTurns: number; hookDenies: number; overrides: number }`
  - `export function measureSessions(jsonlPaths: readonly string[]): SessionMetrics`

  The default input is `~/.claude/projects/<cwd-slug>/*.jsonl` modified after `--since <ISO>`. The parsing logic matches the 2026-11-03 analysis: tool_use blocks by name; Bash commands matched for `bun test` and `|`, `python3 -` with `.replace(`, and `sed -i`.

- [ ] **Step 1: Write failing tests** against 3 tiny inline JSONL fixtures:
  - The counts match hand-computed values.
  - `--since` excludes older files.
  - A malformed line is skipped and counted under `skippedLines`, never thrown.
- [ ] **Step 2: Run** `bun test tools/repo/tests/session-stats.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement**, and write `baseline.json` with the 2026-11-03 values:

  ```json
  { "sessions": 9, "bunTestCalls": 491, "pipedBunTest": 478, "scriptedEdits": 533, "editToolCalls": 79, "agentSpawns": 239, "subagentTurns": 8225, "mainTurns": 3845 }
  ```

- [ ] **Step 4: Print rates vs baseline.** `repo session-stats` prints each rate next to its baseline and exits `1` if any threshold in "Done looks like" is missed.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `feat(repo-tools): session-stats outcome measurement`.

The plan's status moves to `completed` only after `bun run repo session-stats --since <merge date>` passes over at least 3 sessions run after rollout.

---

## Done looks like

- Agents start with `bun run repo status`, then `bun run repo scope`, and end with `bun run repo verify <pkg>`. Every failure says the next command.
- A full test run is green by default. Ceilings only ratchet down.
- `.agents/` holds only `MEMORY.md` and `skills/`. The root has no stray files. `scripts/` holds only live gates, release scripts, `test-preload.ts`, and research dirs.
- Each check runs once per CI run.
- Every runnable script is in `catalog.json`. A new uncatalogued script fails CI, so the surface cannot re-scatter.
- Changing direction (a new goal, rule, owner, or check) means editing one manifest row. Self-verification catches a stale row before it can misdirect an agent.
- **Measured thresholds** (`repo session-stats`, ≥3 post-rollout sessions):
  - piped `bun test` ≤5% of `bun test` calls (baseline 97%)
  - scripted edits ≤ `Edit` tool calls (baseline 533 vs 79)
  - hook overrides ≤2 per session

  If an override threshold is exceeded, fix or delete the offending rule; don't relax the threshold.

## Open decisions

- **Gitignored `*-traces/` under `wiki/Research/**`** leave reports citing them non-self-contained. Proposed rule: a report copies its cited excerpt inline. A gate for this is deferred.

## Out of scope (deliberately)

- Moving `scripts/check-*.sh` or `scripts/lift|probes`: high reference churn, no agent benefit once `repo` indexes them.
- Pruning `wiki/Research/Harness-Reports/_archive` (237 files) and probe fixtures (333 files): evidence, loaded only on query.
- `.claude/skills`: already symlinked to `.agents/skills` (35 of 37). The 2 real dirs are third-party plugin skills.
