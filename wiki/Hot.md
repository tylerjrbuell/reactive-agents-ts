---
aliases: [Recent Context]
tags: [meta, session-start]
updated: 2026-08-16
---

# Hot (Recent Context Cache)

**Purpose:** Quick lookup of last session state. Read this first at session start.

---

## 2026-08-16 — health sweep (pre-release cleanliness pass)

User asked for a DX/cleanliness pass before v0.15.0. 4 parallel scan agents
found a real correctness bug in earlier-this-session code (HS-224: 3 of 5
scratchpad-spill read sites bypassed marker resolution — the grounding guard
could inject the raw `[SPILLED_TO_DISK:...]` marker into the model's evidence
prompt), 2 crash-instead-of-degrade robustness fixes (HS-225/226), and a
dead-export deletion + DX doc/error-suggestion gap. A reported P0 ("tool
validation doesn't fire on the real path") turned out FALSE on independent
repro — registration is lazy (fires at `run()`, not `build()`), and it
correctly throws. Filed as a finding-shape for future sweeps rather than
fixed. Full findings:
[[Issues/Running Issues Log#Health Sweep — 2026-08-16 (v0.15.0 release-prep)]].
Debrief: [[Research/Debriefs/2026-08-16-health-sweep-debrief]].

## 2026-08-16 — code-action-worker-interruption bundle

Closed #35 (real, current bug — not stale): `code-action`'s sandbox Worker
kept running unsupervised after the run's fiber was interrupted, since
`runInSandbox` wrapped a bare `Promise` via `Effect.tryPromise`. Now returns
an `Effect.async` with an interrupt finalizer that terminates the Worker.
Regression test proves it behaviorally (RED-confirmed against pre-fix code).
Residual, documented limitation: an already-in-flight tool call itself isn't
interrupted, only the Worker stops making further progress. Skill amended
(v14): fiber-interruption regression tests must keep fork+wait+interrupt in
one `Effect.gen`, or the fork's own ephemeral scope self-interrupts the
child before the test can observe it. Retro:
[[Research/Debriefs/2026-08-16-code-action-worker-interruption-execution-debrief]].

## 2026-08-16 — replay-determinism-revalidation bundle

Closed #30 + #53. #30 turned out already-shipped (PR #196/#197, never closed
against the work) — closed with evidence, no code change. #53 re-ran the
full determinism-pinning suite cluster (44 tests, 0 fail), published
`wiki/Research/Harness-Reports/replay-determinism-revalidation-2026-08-16.md`.
Merged to local `main` directly (same hold-until-tag convention as the prior
bundle). Retro:
[[Research/Debriefs/2026-08-16-replay-determinism-revalidation-execution-debrief]].

## 2026-08-16 — v0.15.0 release-prep + tools-result-handling bundle

Not yet tagged. Root-caused + fixed a `t0-deterministic` gate regression
(`c2418864`) — see [[project_t0_deterministic_regression_2026_08_16]] in
Claude memory. Reconciled `ROADMAP.md`'s version-to-arc mapping (was
self-contradicting; v0.15 renamed to an interim "Stability & QOL" cut, Arc 2
Boundary+Gate moved to v0.16). Shipped `bundle/tools-result-handling`
(#47/#57/#58, merged `22547736`): bounded scratchpad with disk spill
(`packages/tools/src/scratchpad-spill.ts`), registration-time tool-definition
schema validation, clear tool-result error messages. Full suite 8902 pass /
0 fail / 1157 files. Merged to local `main` directly (not a GitHub PR — this
repo holds unreleased work locally until tag time; a PR against `origin/main`
right now would show 357+ unrelated commits). Retro:
[[Research/Debriefs/2026-08-16-tools-result-handling-execution-debrief]].

## Active program (2026-07-28)

**A-TIER GAP CLOSURE** — [[Planning/Implementation-Plans/2026-07-28-a-tier-gap-closure]].
Supersedes the simplification program as the WIP=1 item; the simplification
program's motivating figure (555–640% harness overhead) was **retracted** on
2026-07-28 because the instrument was broken (`2f97ca1e`).

**F10 RESOLVED (2026-08-26, `4f7c4bc0`, closed `89bb8a43`):**
[[Failure-Modes/RUNNING-CATALOGUE#F10]] — was the request prefix churning every
iteration so the prompt cache never hit. Root cause: per-iteration harness
guidance appended to the system-prompt string tail still invalidated the
cache (system precedes messages in Anthropic's cache hierarchy); guidance
now rides as a trailing user message instead. Live-Sonnet rebaseline confirms
nonzero `cacheRead` on every disclosure arm. Do not cite the old 41%-tokens/
17%-more-money figure as current.

**Do not cite** any token-overhead figure predating `2f97ca1e`.

**Measurement ladder:** deterministic replay → haiku → fast non-reasoning local
tool-callers. Promotion requires rungs 2 and 3 to agree in sign.

**External gate:** τ-bench (ratified 2026-07-28).

## What's Next

1. **v0.14 launch line** — cut v0.14, publish bench receipts (Arc 1 launch-gate item 5), Show-HN, push main. Overdue since Wave A/B boundary (07-08).
2. **Wire-or-delete sweep** — adapter hooks, CompletionEnvelope (blueprint/code-action), RA_RECITE session, ledger dead kinds, verifierTier, adaptive-plan fields.
3. **#39 per-entity requirements**, **#44 kernel→engine signal unification**, **#38 thought-continuity ablation** (Ollama `thinking` capture prereq).
4. RATIFY-or-reject subagents-and-logging DRAFT.
5. Bench P2 remainder (7 llm-judge → graded, re-baseline) + P3 `horizon:long` tasks; then #36 adaptive re-cut.
6. Small: `metrics-cache.json` 7190→7671 write-back (else next `metrics:sync-readme` regresses README); `.agents/MEMORY.md` 407KB archive split.

## Prior Sessions (compact pointers)

- **2026-07-05→12** — the harness root-cause fortnight: Arc 1, meta-loop, measurement rebuild, wiring audits ×4, probe fleet, receipt truth. Full map: the 07-12 snapshot above. Process lesson recorded there (§4): ~14% same-week rework, whack-a-mole before class-level prevention.
- **2026-07-02** — v0.13.0 RELEASED (35 pkgs); v0.13.5 + v0.13.6 followed 2026-07-05/06 (Groq+xAI, ui-core).
- **2026-07-01** — comprehensive framework review + v13 lift plan (superseded by 09-UNIFIED-PROGRAM).
- **Earlier** — see `git log -- wiki/Hot.md` and MEMORY-ARCHIVE.

## Authoritative Document Hierarchy

| Order | Doc | Role |
|---|---|---|
| 1 | `wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md` | Program sequencing + convergence rulings (CANONICAL) |
| 2 | `wiki/Architecture/Specs/08-AGENTIC-OS-NORTH-STAR.md` v6.0 | Product-arc content, exit gates, honest-claims law |
| 3 | `wiki/Architecture/Design-Specs/2026-07-11-harness-north-star-architecture.md` | Kernel architecture (RATIFIED 07-11) |
| 4 | `wiki/Planning/Implementation-Plans/2026-07-10-harness-root-cause-closure-program.md` | Ranked open backlog (active) |
| 5 | `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md` | Current empirical state |

`04-PROJECT-STATE.md` is deprecated as the empirical-state read (banner added 07-12). Conflict rule: lower defers upward; changing a higher doc is a ratification event.

## How to Update This Note

At session end: replace "Latest Session" with new date + key updates, demote prior to one-line pointers, update "What's Next." Keep under 120 lines.

**Last Updated:** 2026-08-18
**Current Phase:** v0.14 launch line + wire-or-delete sweep (post root-cause fortnight)

## Session Note (2026-08-18)
Executed backlog bundle `health-export-surface` + `umbrella-export-surface` (issue #155). Re-verified all 4 sub-items natively (RTK/stale claims): HS-D-01 (observe) and HS-D-02 (vue) already dead — coverage landed since the 2026-05-27 sweep. HS-D-17 (health) and HS-D-19 (umbrella) fixed with additive shape tests (`adc3dbe1`, `f8063744`). Issue closed. Build 37/37, `bun test packages/health/` 9/0, `bun test packages/reactive-agents/` 20/0. See wiki/Research/Debriefs/2026-08-18-health-umbrella-export-surface-execution-debrief.md.

Continued same session: closed #61 (v0.11.0 tracker — all 3 sub-items resolved/stale; ToT `dispatcher-early-stop` debt item confirmed fixed by #127, synced `.agents/MEMORY.md`). Closed #188 (AgentStreamEvent 3-way divergence) — original claims mostly dead (ui-core now exists as the shared entry point), but found and fixed a live successor bug: react/svelte/vue each independently hand-rolled a lossy 5-tag escape-hatch `AgentStreamEvent` masking a silent cast that dropped 15 of 20 real event tags. Fixed all 3 (`2afbd7c8`, `92d28315`, `d4aae9c1`). Build 37/37. See wiki/Research/Debriefs/2026-08-18-agentstreamevent-dedup-execution-debrief.md.

Closed #184 (kernel import cycles) — drift found (assembly/context relocated out of kernel/, cycle count 9→14). Fixed the still-matching cluster (5 assembly project↔stages cycles, `5dd47133`, pure type-extraction to `assembly-ctx.ts`). Filed #200 with accurate current-state evidence for the remaining 8 (not one coherent bundle — different root causes). Amended SKILL.md's execute-backlog Phase 3.5 (branch-before-edit discipline, v15) after catching a branch-discipline slip mid-pass. #124/#125 reviewed and left open — large open research RFCs, not root-cause-fixable bugs, out of this skill's scope. See wiki/Research/Debriefs/2026-08-18-kernel-assembly-cycle-fix-execution-debrief.md.

Followed up on #200 same session: fixed 6 of its 8 cycles (`9cc56f78`) — ledger cluster (3), llm-gateway↔purpose-routing (1), kernel-state↔synthesis-types (1), kernel-state↔verifier (1), all via the same leaf-extraction shape. Left #200 open, scoped to the remaining 2 (kernel-state↔completion-envelope/completion-status) — genuinely different shape, envelope/status derive FROM the full KernelState by design, needs a Pick<> narrowing refactor not a leaf extraction. `bunx madge --circular src/kernel`: 8→2. Build 37/37, reasoning tests 2718/0/4todo unchanged.

Closed #200 out same session (`ad89fe88`): the last 2 cycles fixed via structural narrowing rather than a shared-type extraction — `envelopeFromKernelState`/`resolveCompletionStatus`/etc. only read 5 meta fields + status, so a narrow `CompletionAuthorityState` interface (any real `KernelState` satisfies it for free, zero call-site casts) broke the cycle. `bunx madge --circular src/kernel`: 0 (was 8 at #200's filing). New reusable pattern for future god-object cycles noted in the retro. Build 37/37, reasoning tests unchanged.
