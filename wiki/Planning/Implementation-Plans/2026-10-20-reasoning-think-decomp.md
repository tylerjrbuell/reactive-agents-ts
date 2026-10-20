---
type: plan
status: active
created: 2026-10-20
tags: [reasoning, kernel, decomposition, execute-backlog, warden]
---

# Bundle: reasoning-think-decomp (GH #219 / HS-249)

Date: 2026-10-20 · Budget: 90 min · Issues: #219

## Context

Issue body (2026-09-23): `packages/reasoning/src/kernel/capabilities/reason/think.ts` — 2,135 LOC, in a package whose own decomposition precedent (`59b7bc32`) was triggered at 944 LOC. **Bundle-time drift: 2,445 LOC on dev** (regrown +310 since the sweep — same big-filename gravity as #217/#218).

## Structure scan (bundle time)

- Lines 1–331: cohesive small helpers, mostly already exported with JSDoc (`CONTEXT_PRESSURE_THRESHOLDS`, `shouldNarrowToFinalAnswerOnly`, `cappedHiddenTools`, `buildToolIndexCallableSchemas`, `buildToolIndexText`, `PLANNING_PATTERNS`, `looksLikeCompleteProse`, `looksLikeFinalAnswer`, `buildThinkProviderRequest`).
- Line 332 → 2,445: `handleThinking` — **a single ~2,100-LOC function** with staggered `──` phase-comment sections (dynamic meta-tool injection, context pressure hard gate, tool-surface resolution/defer-list capture, …).
- Import surface: **zero importers outside `kernel/capabilities/reason/`**; `index.ts` does not re-export think.ts symbols — surface moves are free inside kernel authority. Sibling modules already exist in the dir (`think-guards.ts`, `stream-parser.ts`).

## Acceptance criteria (#219)

- `think.ts` LOC ≤ 1,600 (from 2,445; hard band).
- Zero behavior change: bodies moved verbatim into stage modules under `kernel/capabilities/reason/`; `think.ts` keeps its export names (moved to modules, re-exported if needed) so every existing test import path still resolves — no consumer edit required.
- Reasoning suite at exact baseline: **3,163 pass / 4 todo / 0 fail / 366 files**; typecheck rc=0.
- Kernel-writes discipline: no behavior changes; trace events preserved verbatim (KernelState contract shape unchanged).
- Zero new `as any`/`as unknown as`; test counts unchanged (decomposition only, no new tests).

## Execution units

1. **Unit 1 (kernel-warden, ~60 min):** stage extraction from `handleThinking` per the phase-comment section map (meta-tool injection builders, pressure gate, contract deny-capture, tool-surface resolution, response interpretation, etc.) into cohesive modules under `kernel/capabilities/reason/`, names verb-noun kebab-case consistent with the package's existing convention.
2. **Unit 2 (parent, ~20 min):** verifier — reasoning-equivalent gates; review-patterns categories (Cat 9 kernel-extension inapplicable — no new phases/guards/meta-tools).

## Risk register

- `handleThinking`'s phase sections share a large local mutable scope (KernelState fields) — extraction may need a stage-context object; warden should prefer fn(state, context) signature packs over new inventories; refuse signature drift vs kernel phase contract if any moved block is a Phase candidate.
- `think.ts` is in the kernel phase pipeline; per review-patterns Cat 9: plan must NOT add per-turn logic to `kernel/loop/runner.ts` (unify there = refusal-class).
- Regrowth: +310 LOC in 4 weeks — debrief must note new-code target: submodules.

## Verification protocol

- `bunx tsc --noEmit -p packages/reasoning` — rc=0
- `bun test packages/reasoning/ --timeout 20000` — 3,163 pass / 4 todo / 0 fail (exact baseline)
- Full-suite ceiling test (`packages/runtime/test/as-unknown-as-ceiling.test.ts`) — 2/2; counts flat
- Scope: think.ts modified + new `kernel/capabilities/reason/*` only; no edits outside kernel
- PR CI green before merge to dev

## Out of scope

- Behavior changes, new phases/guards/meta-tools, runner.ts changes (kernel-extension is a separate skill and issue #221's execution-engine is separately scoped).
- The stream-parser and think-guards files (already modular).

## Baseline

- Typecheck rc=0; suite 3,163 pass / 4 todo / 0 fail / 10,570 expect() / 366 files.
- `think.ts`: 2,445 LOC. Branch off `origin/dev` @ `df59a2a0b`.
