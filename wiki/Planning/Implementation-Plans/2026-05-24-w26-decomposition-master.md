---
date: 2026-05-24
status: ready
issue: "#76"
owner: runtime
sub-bundles:
  - w26a-execution-engine
  - w26b-builder
  - w26c-runtime
  - w26d-reactive-agent
---

# W26 Runtime Decomposition — Master Plan

> **Scope:** Close GitHub issue #76 ("Four runtime files >1500 LOC need decomposition wave W26+") by extracting cohesive modules from the four monoliths until each drops below the 1500-LOC line. This is the **master index + sequencing doc**, not an implementation plan. Each sub-bundle below has its own implementation plan written immediately before execution.

## Goal

After all four sub-bundles ship, `wc -l packages/runtime/src/{builder,runtime,execution-engine,reactive-agent}.ts` reports **every** file under 1500 LOC, with zero net behavior change (test suite passes at the same pass/fail/skip counts vs the W26 kickoff baseline).

## Why now

- W24/W25 already proved the pattern works (execution-engine 4499→1539 LOC; builder 6232→2407 LOC) but both monoliths have drifted back: builder.ts +245, runtime.ts +86, execution-engine.ts +20 since the 2026-05-21 audit.
- The Compose API + RI bridges added in v0.11 land their wiring code in these files; each new feature compounds the drift. Convergence Phase 1 work (issues #112-#119, all closed) seeded modules under `engine/`, `agent/`, `builder/` — W26 finishes the move-out.
- Anti-Scaffold Principle (North Star §9): keeping the host files small forces each new addition to land in a focused module with a typed boundary, not as another inline closure in the megafile.

## Current state (2026-05-24 baseline)

```
2726 packages/runtime/src/builder.ts          (target ≤1700)
2083 packages/runtime/src/runtime.ts          (target ≤1300)
1676 packages/runtime/src/execution-engine.ts (target ≤1100)
1578 packages/runtime/src/reactive-agent.ts   (target ≤1000)
Σ 8063                                         Σ ≤5100  (−2963 LOC)
```

Existing extraction substrate:

| Host file | Existing landing dir | Notes |
|---|---|---|
| `execution-engine.ts` | `engine/` (3415 LOC across 18 files) | Phase pipeline + agent-loop + finalize + bootstrap modules already in place. Continue the pattern. |
| `builder.ts` | `builder/` (build-effect/, types.ts, helpers.ts, etc., 27.6K types.ts alone) | W25 extracted to-config.ts + build-effect/. Withers and option-group helpers still inline. |
| `runtime.ts` | none yet | `createRuntime` factory (820 LOC) and `RuntimeOptions` interface (730 LOC) both live inline; no `runtime/` subdir exists. Create one. |
| `reactive-agent.ts` | `agent/` (no contents inspected here — W25 created shell) | W25 named the dir but did not finish moving methods. Class methods inline. |

## Sequencing (4 sub-bundles, 4 PRs, executed one at a time)

| # | Bundle | Target file | Est. LOC out | Branch | Plan doc | Status |
|---|---|---|---|---|---|---|
| W26-A | `execution-engine.ts` | 1676 → ≤1100 | ~600 | `bundle/w26a-execution-engine-decomp` | `2026-05-24-w26a-execution-engine-decomposition.md` | **READY** |
| W26-B | `builder.ts` | 2726 → ≤1700 | ~1050 | `bundle/w26b-builder-decomp` | (write at kickoff) | pending |
| W26-C | `runtime.ts` | 2083 → ≤1300 | ~800 | `bundle/w26c-runtime-decomp` | (write at kickoff) | pending |
| W26-D | `reactive-agent.ts` | 1578 → ≤1000 | ~600 | `bundle/w26d-reactive-agent-decomp` | (write at kickoff) | pending |

### Why this order

1. **W26-A first** — highest drift (+20 since W24) on the most-touched file across Compose/RI work; pattern most established (18 modules already in `engine/`); risk lowest because the gen function has clean phase boundaries.
2. **W26-B second** — largest absolute drift (+245) and largest absolute LOC. Builder is the public-API surface; landing decomp here unblocks any v0.12 builder method additions.
3. **W26-C third** — `runtime.ts` is a single factory function + a single options interface. Splitting requires creating a `runtime/` subdir from scratch. Lower-risk after W26-A/B confirm the team has rhythm.
4. **W26-D last** — `reactive-agent.ts` is one class. Moving methods is mechanical but cross-cuts the most surface area (every public agent method). Save for after the supporting files are stable so the class refactor doesn't fight with parallel changes.

Each sub-bundle ships as a **standalone PR** off `origin/main`. No stacking. Each closes a fraction of #76 (via a `Partial: #76` line in the PR body — the issue stays open until W26-D merges, then closed by W26-D's `Closes #76`).

## Hard rules (apply to every sub-bundle)

1. **Behavior-preserving only.** No new features, no API changes (public surface stays identical), no new tests beyond the regression net needed to prove behavior preserved. If you find an `as any` or a dead branch while extracting, fix in scope; if you find a bug, file a follow-up issue and leave the bug for that issue.
2. **One module per commit.** Each commit moves exactly one cohesive unit (one function, one closure, one option-group). Commit message: `refactor(runtime): extract <unit> from <host> (W26-X step N)`.
3. **Baseline-pinned tests.** Run `bun test packages/runtime/ && bun run build` at sub-bundle kickoff; record counts. Final verify must match exactly (build 38/38; runtime tests at baseline pass count; zero net new failures).
4. **No re-exports left dangling.** When a symbol moves, the host file re-exports it for backward compat OR deletes it entirely if grep confirms zero external importers. Default to delete; re-export only if a `grep -rn 'from.*runtime/src/<host>'` finds an importer of that exact symbol.
5. **Workspace-test-flake protocol applies.** Per-package test run is authoritative; workspace-level flakes in untouched packages don't block the bundle (per `execute-backlog` skill v7).

## Out of scope for W26

- Functional changes (bug fixes, API additions, type strengthening beyond the boundary helpers needed to extract).
- Cross-package moves. Everything stays in `@reactive-agents/runtime`. If extraction reveals a candidate for `@reactive-agents/core` or another package, file a follow-up issue and leave the code in runtime.
- Test refactoring. Touch a test only if its imports break after a move.
- Doc updates beyond a one-line CHANGELOG entry per sub-bundle.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Extraction breaks a non-obvious test through circular-import re-shuffling | Medium | Each commit isolated; run full `bun test` between commits, not just at the end. |
| Builder option-group extraction collides with in-flight Memory v2 work | Low | Memory v2 Phase v2.0 is NOT STARTED per memory; sequence W26-B before Memory v2 starts OR coordinate via Hot.md. |
| `as any` proliferation inside extracted modules (the bug we're fixing migrates with the code) | High | Extract WITH typed boundary helpers, mirroring #71/#72/#73 precedent. Every `as any` flagged by extraction is a follow-up issue (do not silence). |
| Sub-bundle blows past one-day budget | Medium | Each sub-bundle is independently descopable — ship N of M extractions, file follow-up for remainder. The goal is each file under 1500, not all extractions in one PR. |
| Snapshot/Replay determinism breaks (replay package pins behavior) | Low | `@reactive-agents/replay` integration test (`packages/replay/tests/`) must pass at every commit. Run it as part of per-commit verify. |

## Verification protocol (cross-cutting)

After each commit in any sub-bundle:

```bash
rtk bun test packages/runtime/      # touched package
rtk bun test packages/replay/        # determinism gate
rtk bun run build                    # all packages green (38/38)
rtk wc -l packages/runtime/src/{builder,runtime,execution-engine,reactive-agent}.ts  # progress check
```

After all four sub-bundles ship:

```bash
rtk gh issue view 76 --json state    # should be CLOSED after W26-D merge
rtk wc -l packages/runtime/src/{builder,runtime,execution-engine,reactive-agent}.ts
# Every value below 1500 → #76 satisfied.
```

## Cross-references

- Issue: https://github.com/tylerjrbuell/reactive-agents-ts/issues/76
- W24 retro (execution-engine 4499→1539): commit history `git log --oneline -- packages/runtime/src/execution-engine.ts`
- W25 retro (builder 6232→2407): `wiki/Research/Debriefs/` directory (search for w25)
- Anti-Scaffold Principle: `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` §9
- Memory entry: `.agents/MEMORY.md` → `project_w24_execution_engine_decomposition.md`, `project_w25_builder_decomposition.md`

---

**Next action:** Execute W26-A using its implementation plan. After W26-A merges, kickoff W26-B by writing `2026-05-24-w26b-builder-decomposition.md` (the master will be amended with that doc's status change).
