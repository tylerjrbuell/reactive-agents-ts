---
type: audit
status: complete
created: 2026-11-19
tags: [tooling, dev-env, memory, disk, tests, turbo, worktrees]
---

# Dev-environment waste: test leaks, worktrees, caches (2026-11-19)

The owner asked what else slows local development and keeps piling up. The machine has 6 cores and 30 GB of RAM, and the OOM killer was ending VS Code. This audit was run by tooling-warden. It covers `tools/repo`, `scripts`, and the root `package.json`. Nothing outside a test root was deleted. All cleanup commands below need the owner's approval.

## Measurements

| Item | Parent measured (start of day) | At hand-off (10:30) | Note |
| --- | --- | --- | --- |
| `~/.reactive-agents/memory` | ~9,256 dirs, 1.9 GB | 330 dirs, 81 MB | Someone else deleted most of these while this audit ran. The leak was still live: new `guardrail-test-*` dirs appeared at 10:20. |
| Test-fixture memory dirs | sub-grand 2,658, sub-child 2,658, guardrail-test 1,986, sub-capper 460, sub-kid 421, sub-alpha/sub-beta 369 each | 3 (`wire-agent`, `integration-test-agent`, `test-sub-memory`) | |
| `~/.reactive-agents` ULID run dirs | 325 | 326 | Real Durable-run data, not from tests (tests already use `REACTIVE_AGENTS_RUNS_DIR`). |
| `~/.reactive-agents/traces` | 4,106 files | 4,110 files, 130 MB | No retention policy. |
| `~/.reactive-agents/judgment-shadow.db` | 262 MB | 262 MB | Grows without bound. |
| Linked git worktrees | 10, ~19 GB | 3, ~6 GB | The rest were removed while this audit ran. |
| `.turbo` | 3.4 GB | 3.5 GB | Never pruned. |
| `~/.bun/install/cache` | 7.9 GB | 19 MB | Already cleared by someone else. |
| `bun run build` wall time | 84.3 s, default concurrency (10), 17/38 tasks cached | 83.1 s, `--concurrency=3`, 0/38 cached (cold) | Same max RSS: 1.70 GB before, 1.73 GB after. |

Why the build "after" number was cold: root `package.json` is a turbo `globalDependency`, so editing it invalidated every cached task. At concurrency 3, a cold build ran as fast as a mostly warm build at concurrency 10. The build is bound by the package dependency chain (DTS emit), not by parallelism. Capping concurrency costs nothing measurable and frees cores for tests and the editor.

## Root cause of the memory leak

The framework has no single data-dir override:

- The memory db path (`packages/memory/src/types.ts` `defaultUserMemoryPath`) reads `process.env.HOME`.
- Other stores call `os.homedir()`. These include `runtime/src/services/run-store.ts` (it has `REACTIVE_AGENTS_RUNS_DIR`), `tools/src/scratchpad-spill.ts`, `runtime/src/runtime-gateway-layer.ts` (schedules), `tools/src/mcp/auth/token-store.ts`, `tools/src/mcp/registry/approval-store.ts`, and `runtime/src/builder/build/build-agent.ts` (judgment-shadow).
- Trace and run dirs already had env overrides. The test preload used them, but memory had none.
- The builder's `NODE_ENV=test` fallback to `:memory:` only covers auto-enabled memory. Suites that build memory layers directly (for example `packages/runtime/tests/memory-guardrails.test.ts`) still wrote to the real home.

Bun caches `os.homedir()` at process start. A preload that changes `HOME` therefore redirects only code that reads `process.env.HOME`, plus child processes. It does not redirect `os.homedir()` callers in the same process.

## What changed

1. **HOME isolation for tests** (`tools/repo/src/lib/test-home.ts`).
   - `repo test`, `repo verify` and `repo test --all` set `HOME` in the spawn env to `<test root>/home`. This directory mirrors the real home: every top-level entry is a symlink (git config, bun cache and playwright browsers keep working), except `.reactive-agents`, which starts empty.
   - The directory is removed with the test root. `RA_TEST_REAL_HOME` records the real home for nested runs.
   - Raw `bun test` goes through `scripts/test-preload.ts`. That path covers the memory resolver and child processes, but not `os.homedir()` callers.
2. **Pinned by a test** (`tools/repo/tests/test-home.test.ts`). It runs `memory-guardrails.test.ts` twice:
   - With the `repo test` env: a positive control shows the suite writes `guardrail-test-*` dirs into the mirror home, and none appear in the real home.
   - As a raw `bun test`: no new entries appear in the real home.
3. **`repo janitor` reports more, and still deletes nothing outside temp.** Each entry comes with its exact cleanup command:
   - Every linked worktree from `git worktree list` (anywhere on disk) that has been idle more than 24 h. Prunable worktrees get `git worktree prune`; locked ones get unlock-then-remove.
   - Test-fixture memory dirs in the real `~/.reactive-agents/memory`, grouped by prefix with count, size and a delete command scoped to that prefix.
   - `.turbo` above 2 GB, and the bun install cache above 5 GB.
4. **Builds run behind the memory guard.** `build`, `build:packages`, `build:apps`, `build:clean`, `clean` and `typecheck` now run `bun run repo guard && turbo run ... --concurrency=3`. The guard takes 0.1 s.

## Owner-approval cleanup commands

Run `bun run repo janitor --dry-run` first. It lists the live set with sizes. As of hand-off:

```bash
# Stale worktrees (idle 58-361 h, ~2 GB each). `git worktree remove` refuses a dirty tree; check each first.
git worktree remove /home/tylerbuell/.claude/jobs/eaddf328/tmp/wt-h3
git worktree remove /home/tylerbuell/Documents/AIProjects/pr289-verify
git worktree remove /home/tylerbuell/pp-wt
git worktree prune

# Test-fixture memory dirs left in the real home (3 left at hand-off)
for p in wire-agent integration-test-agent test-sub-memory guardrail-test- sub-grand- sub-child- sub-capper- sub-kid- sub-alpha- sub-beta-; do
  find ~/.reactive-agents/memory -maxdepth 1 -name "${p}*" -exec rm -rf {} +
done

# Turbo cache (3.5 GB; rebuilt on the next build)
rm -rf /home/tylerbuell/Documents/AIProjects/reactive-agents-ts/.turbo

# Bun install cache (only when the janitor reports > 5 GB again)
bun pm cache rm
```

Not test leftovers, so this audit left them alone: `chat-titler-*` (77), `chat-compactor-*` (23) and `goal-checker-*` (10). These are Cortex utility agents (`apps/cortex/server/services/chat-session-service.ts`), and their dirs may come from real Cortex use. A Cortex test also uses the `chat-titler` name, so the cortex owner should decide whether those agents need memory at all.

## Follow-ups (0.20 product work, for the owning wardens)

- **runtime-warden / memory owner:** add one framework data-dir override, for example `REACTIVE_AGENTS_HOME`. Every `~/.reactive-agents/<x>` resolver (memory, spill, schedules, mcp-auth, mcp-approvals, judgment-shadow, capabilities, runs, traces) should read it before `os.homedir()`. Tests and embedders could then isolate with one variable instead of a HOME mirror.
- **runtime / observability:** add retention for `~/.reactive-agents/traces` (4,110 files) and `judgment-shadow.db` (262 MB, append-only).
- **Per-package `bun test`** (`turbo run test` runs `bun test` in each package dir) does not load the root `bunfig.toml` preload, so those runs get no TMPDIR, HOME, trace or runs isolation. Run tests with `bun run repo test`, or have the package owners add a preload.
- **release-warden (review):** `publish.yml` and `ci.yml` call `bun run build` and `bun run typecheck`, so they now run the guard and `--concurrency=3`. The guard refuses only below 1 GB MemAvailable, where a build would OOM anyway. On non-Linux systems it does nothing.
