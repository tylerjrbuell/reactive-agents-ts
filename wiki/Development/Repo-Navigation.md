---
tags: [reference, navigation, meta]
status: reference
---

# Repository Navigation — Structure Map & Agent Patterns

> Moved here from root `NAVIGATION.md` on 2026-08-18 — `AGENTS.md` is the single root entry
> point per the project's own "root = entry points, wiki = knowledge" convention; this is
> detail, not an entry point. Read `AGENTS.md` first; come here for the repo map and
> task-pattern recipes it doesn't spell out.

## Canonical Wiki Index (single entry table, verified 2026-11-03)

Use this table to find the authoritative file for each question. Do not browse `wiki/Home.md` or `wiki/MOCs/*` (stale).

| Question | Authoritative path |
|---|---|
| What changed recently / what's in flight | `wiki/Hot.md` (≤500 words), then `wiki/Log.md` |
| Sequencing and release slicing | `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` |
| Product arc and exit gates | `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` |
| Which spec is authoritative | `wiki/Architecture/Specs/DOCUMENT_INDEX.md` |
| Open technical debt | `wiki/Architecture/DEBT-REGISTER.md` |
| Feature designs | `wiki/Architecture/Design-Specs/` |
| Implementation plans | `wiki/Planning/Implementation-Plans/` |
| Post-feature debriefs | `wiki/Research/Debriefs/` |
| Probe and benchmark evidence | `wiki/Research/Harness-Reports/` |
| Decisions | `wiki/Decisions/` |
| Failure modes | `wiki/Failure-Modes/` |
| Experiments | `wiki/Experiments/` |
| Cross-session agent memory | `.agents/MEMORY.md` (index); details in `wiki/Research/Agent-Memory-Archive.md` |

## Repo tool: `bun run repo <command>` (decided names; guess these)

Internal dev CLI at `tools/repo/` (details: `tools/repo/README.md`). Data lives in JSON manifests there; the TypeScript is generic. Run `bun run repo help` for the live list.

| You want to… | Run | Data file |
|---|---|---|
| See where the project is | `bun run repo status` | generated |
| Know what your change touches (owner, checks, docs) | `bun run repo scope [files…]` | `tools/repo/ownership.json` |
| Run the checks that apply | `bun run repo check [--all]` | `tools/repo/checks.json` |
| Run tests without piping | `bun run repo test <paths…>` | none |
| Verify one package before reporting done | `bun run repo verify <pkg-dir>` | none |
| Lower ceilings your change earned | `bun run repo ratchet [--write]` | `checks.json` |
| Validate a warden's UpwardReport | `bun run repo warden-report <file>` | none |
| Find any script in the repo | `bun run repo help --all` | `tools/repo/catalog.json` |
| Find anything in repo or wiki (ranked, capped) | `bun run repo find <query> [--wiki\|--code\|--scripts]` | derived from git + frontmatter |
| Read a big file by section, not whole | `bun run repo outline <file>` | derived |
| Check where a new file may live | `bun run repo place <path>` or `--kind plan` | `tools/repo/placement.json` |
| Check whether agent behavior improved | `bun run repo session-stats [--since ISO]` | `tools/repo/baseline.json` |

`hook` (pre-bash, pre-write) exists for `.claude/settings.json` only and is hidden from `help`. Every command takes `--json` and `--help`; every failure ends with `next: <command>`.

### `repo` vs `rax` vs `rax-diagnose` (roles must never blur)

| Tool | Audience | Job | Ask yourself |
|---|---|---|---|
| `bun run repo …` | contributors and coding agents working **on** this repo | Keep the change aligned with the repo's rules: scope, checks, tests, verify, status, hook. Never touches an agent runtime. | "How do I change this codebase correctly?" |
| `rax …` (`apps/cli`, published) | end users and operators of Reactive Agents | Create, run, and inspect **agents** (`rax run`, `rax ps`, `rax attach`, scaffolding). Product surface. | "How do I use the framework?" |
| `rax-diagnose …` (`packages/diagnose`) | contributors and agents debugging a **run** | Read a run trace and name the cause (`rax-diagnose cause <runId\|path>`). | "Why did this agent run behave that way?" |

`repo` may point to `rax-diagnose`; `rax` never mentions `repo`. Contributor tooling never goes into `rax`.

### When a hook denies you

- Take the alternative printed in the message (it names an exact command or tool).
- Writing a file the placement rules reject: `bun run repo place <path>` shows the canonical home; `bun run repo place --allow <path> --reason "<why>"` is the visible override for `Write`.
- Bash rule you must break: `REPO_ALLOW=<rule-id> REPO_ALLOW_REASON="<why>" <command>` (logged).
- Whole session: `REPO_HOOKS=off`. Commits: `git commit --no-verify`.
- A hook crash fails open. Repeated overrides of one rule are a signal the rule is wrong; `bun run repo status` lists them.

## Repository Structure (Quick Map)

```
reactive-agents-ts/
├── Root docs (entry points + conventions)
│   ├── AGENTS.md ........................ canonical agent workflow + build commands — START HERE
│   ├── README.md ........................ public API overview + quickstart
│   ├── CAPABILITIES.md .................. CI-enforced capability registry
│   ├── CODING_STANDARDS.md .............. TypeScript/Effect-TS authority
│   ├── CHANGELOG.md ..................... release history (auto-generated by changesets)
│   ├── CONTRIBUTING.md .................. contribution guidelines
│   └── ROADMAP.md ....................... public milestone tracker
│
├── .agents/ .............................. agent-internal guidance
│   ├── MEMORY.md ........................ cross-session project memory (READ FIRST)
│   └── skills/ .......................... canonical contributor skills (`.claude/skills/` links to them)
│
├── wiki/ ................................. 🎯 KNOWLEDGE VAULT (single source of truth)
│   ├── Home.md .......................... stub index — see its own banner, not a MOC router
│   ├── Hot.md ........................... recent context cache, read at session start
│   ├── Log.md ........................... append-only session log
│   │
│   ├── Architecture/ ................... system design & specs
│   │   ├── Specs/ ...................... canonical project specs (00-VISION .. 09-UNIFIED-PROGRAM)
│   │   ├── Design-Specs/ ............... feature-level design documents
│   │   └── DEBT-REGISTER.md ............ canonical technical-debt ledger
│   │
│   ├── Planning/Implementation-Plans/ ... ALL plans go here (agent-agnostic)
│   ├── Decisions/ ....................... decisions & RFCs
│   ├── Reference/ ....................... benchmarks, distribution info, changelog history
│   ├── Research/ ........................ debriefs, audits, harness reports, spikes
│   ├── Development/ ..................... contributor workflow notes (this file lives here)
│   ├── Failure-Modes/ ................... FM-A through FM-H catalog
│   ├── Experiments/ ..................... M1-M13 mechanism validations
│   ├── Issues/ ........................... running issues log
│   └── Packages/ ......................... per-package documentation
│
├── tools/repo/ ........................... internal dev CLI (`bun run repo`) + JSON manifests (checks, ownership, rules, placement, catalog)
├── packages/ ............................. workspace packages (published + private: benchmarks, judge-server); `ls packages`
├── apps/
│   ├── docs/ ............................ Starlight/Astro public docs site (docs.reactiveagents.dev)
│   │   └── skills/ ..................... consumer-facing AI agent skills (publicly fetchable)
│   ├── cli/ ............................. rax CLI
│   ├── cortex/ ........................... SvelteKit admin UI (Bun + SQLite)
│   ├── examples/ ......................... ~60 usage examples
│   ├── advocate/ ......................... community growth agent (flagship dogfood)
│   └── stackblitz/ ....................... standalone npm-only demo projects (no workspace:* deps)
│
├── scripts/ .............................. runnable scripts only (check-*.sh gates, gate-*.ts, release.ts, lift/, probes/); see `repo help --all`
├── docker/, .github/workflows/
└── .claude/ .............................. agents/ (wardens), rules/, settings.json (hooks), skills/ (links to .agents/skills)
```

Full package dependency tree and per-layer quick reference: `AGENTS.md` §Architecture Quick Reference.

## Common Agent Patterns

### "Implement a feature in package X"
```
1. Find package: packages/<name>/src/index.ts
2. Load skill: .agents/skills/effect-ts-patterns/SKILL.md
3. Study: packages/<name>/tests/*.test.ts
4. (If multi-step) Write plan: wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md
5. Implement: services first, then wire in runtime.ts
6. Test: bun test packages/<name>/tests/your-feature.test.ts
7. Update docs: README.md + apps/docs/ + CHANGELOG via changeset
```

### "Something is broken in the kernel"
```
1. Identify symptom: AGENTS.md §Common Debugging Entry Points
2. Check: context? → assembly/project.ts (`project()`) | tool-call? → kernel/capabilities/act/act.ts | loop? → kernel/capabilities/reflect/loop-detector.ts
3. Test: bun test packages/reasoning/tests/kernel-*.test.ts
4. (If significant fix) Write debrief: wiki/Research/Debriefs/YYYY-MM-DD-<bug>-debrief.md
```

### "Adding a new provider or tool"
```
1. Read: AGENTS.md §Adaptive Calibration + §Golden Rules
2. Implement: packages/llm-provider/src/providers/<name>.ts OR packages/tools/src/tools/<name>.ts
3. Export: src/index.ts
4. Update: CAPABILITIES.md (CI-enforced registry)
5. Test: bun test packages/{llm-provider,tools}/tests/
6. Document: apps/docs/src/content/docs/features/ + skill in apps/docs/skills/
```

### "Understanding kernel phases"
```
1. Read: wiki/Architecture/Design-Specs/2026-07-11-harness-north-star-architecture.md (ratified kernel architecture)
2. Browse: packages/reasoning/src/kernel/capabilities/ (act, attend, comprehend, decide, learn, reason, recall, reflect, sense, verify)
3. Trace: packages/reasoning/src/kernel/loop/runner.ts calls them in sequence
4. Code example: packages/reasoning/tests/kernel-*.test.ts
```

### "Tests are failing"
```
1. Run: bun run repo test packages/<affected>/tests/<file>.test.ts (scoped, unpiped; log path printed)
2. Read the test file (understand intent), then the source
3. Check: AGENTS.md §Terminal Execution Rules (timeouts, server cleanup)
4. Fix minimum change, re-run scoped test
```

**Last updated:** 2026-08-18 (relocated from root `NAVIGATION.md`; trimmed sections that duplicated `AGENTS.md` — entry points, package map, doc-location table, token-optimization tips all live there now).
