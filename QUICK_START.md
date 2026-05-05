# Quick Start for AI Agents — 5-Minute Orientation

**Before doing anything, read this file + check `.agents/MEMORY.md` (current project status).**

---

## What Project Am I In?

**Reactive Agents** — TypeScript/Effect-TS framework for building reliable, observable AI agents with composable strategies, adaptive provider selection, and explicit control.

**Current version:** v0.10.0 (release-ready, gating on frozen-judge rule validation)
**Architecture:** 28 packages + 5 apps, monorepo via Bun + Turborepo
**Quality bar:** 4,730+ tests, Effect-TS patterns, no raw `throw`/`await`, types-first

---

## What Should I Read First?

1. **`.agents/MEMORY.md`** (5 min) — Project status, resolved issues, current focus
2. **`AGENTS.md`** (15 min) — Architecture + build commands + workflow rules
3. **`NAVIGATION.md`** (5 min) — This repo's structure + quick patterns
4. **Task-specific:** See "I Want to..." below

---

## I Want to...

### Understand the architecture
- Read: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` (target architecture)
- Then: `wiki/Architecture/Specs/04-PROJECT-STATE.md` (current empirical state)
- Reference: `AGENTS.md` §Architecture Quick Reference (package tree)

### Add a new feature
1. Load skill: `.agents/skills/effect-ts-patterns/SKILL.md`
2. Find package: `NAVIGATION.md` §Package Map (29 packages listed)
3. Understand the package: `packages/<name>/src/index.ts` + `src/runtime.ts`
4. Study tests: `packages/<name>/tests/*.test.ts`
5. Implement: new service following Effect-TS patterns
6. Test: `bun test packages/<name>/tests/<my-feature>.test.ts`
7. Update: `README.md` example + changeset via `bun run changeset`

### Fix a bug
1. Find symptom: `AGENTS.md` §Common Debugging Entry Points (11-row table)
2. Read: that file + neighboring files
3. Test: `bun test packages/<affected>/tests/<file>.test.ts`
4. Fix: minimum change, re-test
5. Commit: one concern per commit

### Create a new package
1. Checklist: `AGENTS.md` §New Package Checklist (6 steps)
2. Skills: Load `.agents/skills/build-package/SKILL.md`
3. Reference: Browse `packages/core/` or `packages/llm-provider/` for structure
4. Test: `bun test packages/<name>/tests/` all pass
5. Wire: Update `packages/<name>/package.json` with dependencies (turbo auto-derives build order)
6. Update: AGENTS.md package map, README.md table, architecture-reference skill

### Write a test
1. Skill: `.agents/skills/agent-tdd/SKILL.md` (Effect-TS TDD discipline)
2. Patterns: Check `packages/*/tests/*.test.ts` for style
3. Key rule: Add `--timeout 15000` to prevent hangs; call `.stop(true)` on servers in teardown
4. Run: `bun test packages/<name>/tests/<file>.test.ts`

### Understand the kernel (reasoning engine)
1. Read: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` §4. The Cognitive Architecture
2. Browse: `packages/reasoning/src/strategies/kernel/phases/` (12 files = 12 phases)
3. Trace: `packages/reasoning/src/strategies/kernel/kernel-runner.ts` calls them in order
4. Example: `packages/reasoning/tests/kernel-*.test.ts`

### Add a new LLM provider
1. Reference: `AGENTS.md` §Adaptive Calibration + `llm-api-contract/SKILL.md`
2. Implement: `packages/llm-provider/src/providers/<name>.ts`
3. Register: Add to `src/runtime.ts` layer factory
4. Test: `bun test packages/llm-provider/tests/providers.test.ts`
5. Update: `CAPABILITIES.md` (CI-enforced registry)

### Debug test failures
1. Run scoped: `bun test packages/<name>/tests/<file>.test.ts`
2. Check: AGENTS.md §Terminal Execution Rules (timeouts, dangling servers)
3. Root cause: Check error message + read test file + read source code
4. Fix: Make change, re-run scoped test
5. Commit: Only one concern per commit

### Understand a failure mode
1. Find: `wiki/Architecture/Specs/02-FAILURE-MODES.md` (FM-A1, FM-B2, etc.)
2. Read: Manifestation, reproduction, existing mitigation, empirical evidence
3. Code: Search for the mitigation in `packages/reasoning/src/` or `packages/tools/src/`
4. Tests: Look for related tests in package test files

### Check current project status
- `.agents/MEMORY.md` (session cross-memory: status, resolved issues, running issues)
- `wiki/Architecture/Specs/04-PROJECT-STATE.md` (empirical state: validated mechanisms, unvalidated mechanisms)
- `wiki/Architecture/Specs/07-ROADMAP-v1.0.md` (phase sequencing: gates, validation, Phase 2+ work)

### Find what changed recently
- `CHANGELOG.md` (auto-generated, organized by version)
- `wiki/Hot.md` (Obsidian vault: recent decisions/experiments/sessions)

### Understand methodology / validation rules
- `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md` (12 rules for any harness change)
- `wiki/Architecture/Specs/03-IMPROVEMENT-PIPELINE.md` (DISCOVERY→DEPRECATE flywheel)

---

## Build Commands (Turborepo)

```bash
bun install                     # Install dependencies
bun test                        # Run full test suite (respects cache)
bun test packages/<name>        # Test one package only (faster)
bun test --watch                # Watch tests during dev
bun run typecheck               # TypeScript check (no `any`)
bun run build                   # Build all packages via turbo
bun run build:clean             # Force rebuild (bypass cache)
bun run clean                   # Remove dist + turbo cache
bun run rax -- <args>           # Run rax CLI
bun run docs:dev                # Docs dev server (Astro)
bun run changeset               # Add changeset for next release
```

---

## Key Files at a Glance

| File | Purpose | Read Time |
|------|---------|-----------|
| `.agents/MEMORY.md` | Cross-session project memory | 5 min |
| `AGENTS.md` | Canonical agent workflow | 15 min |
| `NAVIGATION.md` | Repo structure + quick patterns | 5 min |
| `CODING_STANDARDS.md` | TypeScript/Effect-TS authority | skim |
| `CAPABILITIES.md` | CI-enforced capability registry | 2 min |
| `README.md` | Public API overview + examples | 5 min |
| `wiki/Architecture/Specs/04-PROJECT-STATE.md` | Current empirical state | 10 min |
| `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` | Architecture target | 20 min |
| `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md` | Methodology (12 rules) | 5 min |
| `wiki/Architecture/Specs/02-FAILURE-MODES.md` | Failure catalog + mitigations | as-needed |

**Total onboarding time:** 45 min (if you do all 10), or 25 min (essential 5)

---

## Common Pitfalls (Avoid These!)

1. **Ignore the kernel phases** — 12 files in `packages/reasoning/src/strategies/kernel/phases/`, each one is a critical stage. Understand the order.
2. **Raw `throw` or `await`** — Everything goes through Effect.Effect. Load `effect-ts-patterns` skill.
3. **Use `any` types** — Treat types as public API. No `any`, no `as any`. Use precise types + generics.
4. **Create global state** — Explicit builders/layers only. No hidden globals.
5. **Forget timeouts in tests** — Add `--timeout 15000` to prevent process hangs from dangling event loop handles.
6. **Leave servers running in tests** — Always call `.stop(true)` on `Bun.serve()` / Express in teardown.
7. **Run full test suite to verify** — Use scoped tests: `bun test packages/<name>/tests/<file>.test.ts`
8. **Mix concerns in one commit** — One PR = one feature. One commit = one concern.
9. **Manually edit CHANGELOG** — Use `bun run changeset`. Versions are auto-bumped on merge.
10. **Assume old docs are current** — Check dates. Use `wiki/Architecture/Specs/` (canonical) not `_archive/` (historical).

---

## When You're Stuck

1. **"I don't know where this code is"** → `AGENTS.md` §Common Debugging Entry Points (symptom → file mapping)
2. **"The test is hanging"** → Check: did you add `--timeout 15000`? Did you call `.stop(true)` on servers?
3. **"Types don't match"** → Read `CODING_STANDARDS.md` for Effect-TS + schema patterns
4. **"Tests pass locally but fail in CI"** → Check: are you using scoped tests? Any race conditions?
5. **"I broke something in the kernel"** → Read the phase you changed in `packages/reasoning/src/strategies/kernel/phases/`
6. **"I don't understand Effect-TS"** → Load `.agents/skills/effect-ts-patterns/SKILL.md`
7. **"The change should be obvious but isn't"** → Query `.agents/MEMORY.md` or `wiki/Hot.md` (recent decisions)

---

## Token Optimization Tips

- **Don't explore aimlessly.** Read the above 3 files in order, then navigate by task (section "I Want to...").
- **Use symptom maps, not grep.** `AGENTS.md` §Common Debugging has an 11-row table — faster than searching.
- **Scoped tests only.** `bun test packages/<name>/tests/<file>.test.ts` is 100x faster than the full suite.
- **Avoid `_archive/` docs.** They're historical; read canonical docs in `wiki/Architecture/Specs/` instead.
- **Query Obsidian before exploring.** `obsidian-vault-query` for recent decisions is faster than reading 500-page design docs.

---

**Last updated:** 2026-05-04
**Session orientation time:** 25 min (essential) to 45 min (comprehensive)
