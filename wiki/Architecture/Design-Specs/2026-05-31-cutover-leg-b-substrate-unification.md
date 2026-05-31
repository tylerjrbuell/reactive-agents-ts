---
title: Cutover Leg (b) — Substrate Unification (#2)
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
status: DESIGN — ready to scope tasks
supersedes_framing: "#1 debrief leg (b) = 'project() covers non-reactive strategies'"
---

# Cutover Leg (b) — Substrate Unification (#2)

## TL;DR

The #1 debrief framed leg (b) as *"`project()` must cover the non-reactive
strategies (plan-execute / ToT / reflexion)."* **That framing is wrong and was
about to under- or mis-scope #2.** This spec corrects it against the actual code
coupling and re-scopes #2 to what "clean and pure" actually requires.

- `project()` is a **conversation-THREAD assembler** (system + `messages[]` from an
  `EventLog`). The non-reactive strategies do not have a conversation thread —
  they issue **single-shot, often JSON-constrained, task-spec prompts**
  (`buildPlanGenerationPrompt`, `buildReflectionPrompt`, `buildStepExecutionPrompt`,
  ToT thought-gen/eval, reflexion critique). Piping those through the thread
  pipeline is a category mismatch and would **break structured-output parsing**
  (the code already warns this — `context/context-engine.ts:60-62`). **Rejected.**
- But "planners aren't thread-assembly" must **not** be used to conclude
  "non-reactive can stay as-is." That leaves **two context substrates running in
  parallel** — the opposite of the mandate, and the same shape as the
  metric-gaming reverted in the 2026-05-29 course-correction (declaring cutover
  "done" by redefining cutover).

**The honest #2: substrate unification, not assembler unification.** `project()`
stays the *sole conversation-context assembler*; planners stay single-shot
task-specs; **but all result-injection flows through the one `ResultStore` +
`preview+ref` policy, and the projection policy is single (not two).**

## Coupling map (verified, not assumed)

Four greps sized the real scope (2026-05-31):

| Query | Result | Implication |
|---|---|---|
| `\.curate(` callers | **1** — `think.ts:353` only | Flip-default-on AND delete-`curate()` are **independent of non-reactive**. |
| `scratchpad` in `strategies/` | 2 hits — a comment + a config field | Strategies don't mutate the scratchpad Map; ResultStore replacement stays centralized in `KernelState`. |
| `messages[]` in `strategies/` | All hits are ephemeral single-shot `messages:[{user}]` per `.complete()` | The only persistent thread (`state.messages[]`) is the reactive kernel's, already `project()`-covered. reflexion `runningMessages` = a kernel sub-call's returned thread (already covered). |
| step-executor result injection | `compressToolResult` + scratchpad-pointer (`step-executor.ts:216`), feeding `priorResults` (`:238`) | **The concrete split:** a SECOND projection path (`compressToolResult`/scratchpad-pointer) parallel to reactive's `ResultStore.preview`/`result_ref` (#1). |

## The three separable goals (do not collapse)

1. **Flip `RA_ASSEMBLY` default-on (reactive seam).** Gated only by `think.ts`.
   Needs **nothing** from non-reactive. Gate = cross-tier A/B proof (the #1
   overflow A/B is one cell; full grid in `apps/examples/assembly-ab-grid.sh`).
2. **Delete legacy `curate()`.** Exactly one caller. Once (1) flips default-on and
   the `else`-branch in `think.ts` is removed, `defaultContextCurator.curate()`
   has zero callers and deletes. Independent of non-reactive.
3. **Substrate unification (the real #2 / north-star step).** Non-reactive
   result-injection must use the **one** `ResultStore` + `preview+ref` policy
   instead of the parallel `compressToolResult`/scratchpad-pointer path.

(1) and (2) are unblocked *today* by this spec's finding — they were only "blocked"
by the incorrect leg-(b) framing. The work below is (3).

## What (3) actually is

The split is concrete and small:

- **Reactive (post-#1):** overflow tool results → `ResultStore.preview(ref, budget)`
  → bounded structure-aware preview + `result_ref="…"`. One policy, deterministic,
  A/B-proven 22/22 vs legacy 19/22.
- **Non-reactive (today):** tool_call step results → `compressToolResult(sanitized,
  tool, budget, previewItems)` → preview + a *different* scratchpad-pointer format,
  stored on `step.result`, then raw-injected into `priorResults` /
  `buildReflectionPrompt` / next step prompt.

Two preview algorithms, two pointer formats, two budgets. Unify on the canonical
one:

- **(3a) Single projection helper.** Introduce a single-shot-appropriate projector
  that reuses `ResultStore.preview()` (the structure-aware skeleton + honest
  truncation marker + `result_ref`) for **prompt-embedded result injection**.
  Non-reactive result-injection sites call it instead of `compressToolResult`:
  - `step-executor.ts:216` (tool_call step result) + `:238` (`priorResults`)
  - `buildReflectionPrompt` step-result rendering (`plan-prompts.ts:266`)
  - `buildStepExecutionPrompt` `priorResults` rendering (`plan-prompts.ts:230`)
  - ToT prior-thought injection + reflexion prior-result injection
- **(3b) One ResultStore.** Non-reactive overflow results are `put` into the same
  `ResultStore` keyed for the run, so the `result_ref` a planner emits is
  resolvable by the same `materialize`/`write_result_to_file(result_ref=…)` path
  reactive uses — one pointer namespace, not scratchpad-key vs result-ref.
- **(3c) Retire `compressToolResult` for these sites** once (3a) covers them
  (it may survive elsewhere; verify callers before deleting — same discipline as
  `curate()`).

**Explicitly NOT in (3):** routing planner/critique/JSON prompts through
`project()`; replacing `state.steps[]` with `EventLog` as the sole record (that is
roadmap **#3 EventLog sole-record**, larger, separate). (3) is the *result-injection
substrate* only — the piece that makes the #1 faithfulness lift apply to
non-reactive and kills the two-policy split.

## Migration sequence (TDD, each step independently committable)

1. **Verify-and-unblock (1)+(2) framing.** Add a test asserting `curate()` has one
   caller; document that flip-default-on is gated by the cross-tier grid, not by
   non-reactive. *(No behavior change — this records the corrected framing so the
   wrong leg-(b) framing can't resurface.)*
2. **(3a) Build the single-shot projector** over `ResultStore.preview()`. RED:
   a test that a 50k tool_call step result injected into a step/reflection prompt
   appears as `preview+ref` (structure skeleton + marker + ref), never raw, never
   via the old scratchpad-pointer format. GREEN: implement; route step-executor
   tool_call results through it.
3. **(3b) One ResultStore for non-reactive.** RED: a `result_ref` emitted by a
   planner resolves via the same `materialize`/`write_result_to_file` path as
   reactive. GREEN: `put` non-reactive overflow results into the run's ResultStore.
4. **(3c) Retire `compressToolResult` at the migrated sites.** Verify callers;
   delete only the now-unreachable ones.
5. **Cross-tier proof.** Run the plan-execute / ToT overflow cells of the A/B grid
   (haiku + a local tier) under the section-coverage grade
   (`apps/examples/section-coverage-grade.ts`). Honesty gate: faithfulness up or
   flat, no honesty loosened, tokens within the project rule (≤15% overhead for a
   default-on change; else opt-in).

## Honesty gates / what would falsify this

- **If (3a) regresses faithfulness or success on any tier** vs `compressToolResult`
  → the canonical preview is not yet superior for the planner-injection shape; do
  not migrate that site; record the gap (do not metric-game by re-grading lenient).
- **If `compressToolResult` has callers outside the result-injection sites** → (3c)
  is narrower than "delete"; keep it for those, unify only the injection path.
- **If flipping `RA_ASSEMBLY` default-on fails the cross-tier grid** → (1) is not
  done regardless of (3); the flag stays opt-in. (3) and (1) are independent —
  neither blesses the other.

## After #2

Roadmap then continues: **#3 EventLog sole-record** (collapse `state.steps[]`/
`messages[]` into the one append-only log — non-reactive strategies append step/
thought/critique events), **#5 scaffoldProfile governance** (incl. the deferred
window-source fix: mid tier capped at 32768 not haiku's real 200k,
`from-kernel-state.ts:112`), **#7 `RA_POST_CONDITIONS` default-on**,
**#8 KV-cache-friendly assembly**. #2 (this spec) is the substrate seam that makes
#3 tractable: once result-injection is one policy + one store, replacing the record
with `EventLog` is a record swap, not a re-derivation of two projection policies.
