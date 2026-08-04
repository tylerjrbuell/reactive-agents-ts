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

**The honest #2: substrate unification, not assembler unification** — `project()`
stays the *sole conversation-context assembler*; planners stay single-shot
task-specs; all result-injection *should* flow through the one `ResultStore` +
`preview+ref` policy.

**BUT a code trace (below) then proved the substrate-unification half is GATED BY
roadmap #4, not independent work.** The `result_ref` resolver (`write_result_to_file`
→ `scratchpadStoreRef`) lives only in the kernel act path; plan-execute bypasses it.
A `preview+ref` PUT into a plan-execute-side store resolves nowhere, and
`compressToolResult` has array competence `preview()` lacks. So #2's near-term,
honest, independent wins are: **flip `RA_ASSEMBLY` default-on (reactive)**, **delete
legacy `curate()`** (1 caller), and **strip dead recall/`[STORED:]` hints** from
results injected into tool-less single-shot prompts. The deep result-injection
unification (and the reverted projector helper) move into **#4**, where the resolver
spans plan-execute. See the TRACE FINDING section for the verified evidence.

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

Two preview algorithms, two pointer formats, two budgets.

### TRACE FINDING (2026-05-31) — the clean swap is blocked; (3) is mostly #4

A first wiring attempt (3a: a `projectResultForPrompt` helper over
`ResultStore.preview`) was built, then **reverted** — the trace below proved it has
no honest non-regressing caller, and the substrate it needs is roadmap **#4**, not
this spec. Three findings, each verified in code:

1. **The resolver is kernel-only.** `write_result_to_file` resolves a `result_ref`
   from `scratchpadStoreRef` (a `Ref<Map<string,string>>` keyed `_tool_result_*`),
   registered at `tool-capabilities.ts:91` and populated **only** at
   `tool-execution.ts:538` (`scratchpadStore.set`) — inside the **kernel act path**.
   Plan-execute's top-level `tool_call` steps call `toolService.execute()` directly
   (`step-executor.ts:144`), bypassing it. **A `result_ref` PUT into any
   plan-execute-side store resolves NOWHERE** → emitting an actionable
   `write_result_to_file(result_ref=…)` marker there is a dead pointer with nicer
   text — the same bug relocated, not fixed. Capture + store + **resolve** is the
   triad #4 owns; do not half-build it under #2.
2. **`compressToolResult` has array competence `preview()` lacks.** It renders
   GitHub-commit arrays with a try-fit-ALL-items anti-fabrication path
   (`tool-formatting.ts:251-303`); `ResultStore.preview` only does markdown-heading
   skeleton / bounded-head and would head-truncate a raw JSON array — a
   faithfulness **regression** on exactly the `github/list_commits` overflow case
   compressToolResult was built for (`step-executor.ts:209`). **No wholesale
   renderer swap at the tool_call site.**
3. **The analysis site isn't a clean home either.** Analysis steps
   (`step-executor.ts:265`) return generative content the synthesizer must see
   whole (`plan-execute.ts:891` reads `s.result` into the synthesis prompt);
   previewing/truncating it is lossy, not a referenceable-data win.

**Net:** the canonical `preview+ref` policy cannot replace `compressToolResult` at
the plan-execute capture/injection sites until #4 wires a run-scoped store that the
resolver reads. The (3a)/(3b)/(3c) "unify the injection policy" plan was premised on
a resolver that doesn't span plan-execute. **#2's substrate-unification thrust is
therefore gated by #4 — it is not independent work.**

### What IS honest near-term (the residual #2-adjacent win)

One bounded, no-regression, no-#4-dependency fix remains: **strip dead recall /
`[STORED:]` hints from results injected into TOOL-LESS single-shot prompts.**
`compressToolResult` emits `recall("_tool_result_N")` + `[STORED: …]` coverage
hints; in plan-execute those land in analysis/reflection/synthesis prompts where
recall is uncallable AND (top-level path) the key was never stored. The model is
told to "call recall(…) for the remaining commits" and cannot — risking fabricated
tails or echoed scaffolding (which `evidence-grounding.ts:228` then HARD-fails).
A strip helper already exists for the kernel path (`tool-execution.ts:702`;
`state-queries.ts` `RECALL_TOOL_KEY_RE`/`STORED_TOOL_KEY_RE`). Reuse it at the
plan-execute injection sites. This is honesty-to-consumer-capability, not substrate
unification — a real bug fix that does not pretend to be the cutover.

### Revised dependency verdict

| Goal | Independent? | Gate |
|---|---|---|
| Flip `RA_ASSEMBLY` default-on (reactive) | **Yes** | cross-tier A/B grid |
| Delete legacy `curate()` | **Yes** (1 caller) | follows the flip |
| Strip dead recall/[STORED:] hints in plan-execute | **Yes** | reuse existing strip helper; no #4 |
| Substrate unify result-injection on `preview+ref` | **No — gated by #4** | run-scoped store the resolver reads |

So **flip-default-on + delete-`curate()` + the hint-strip** are the available
near-term wins; the deep substrate unification moves **into #4** (ResultStore as the
LIVE store + tool-side `result_ref` resolution spanning plan-execute), where the
projector helper belongs and gets a real, resolving caller.

## Honesty gates / what would falsify this

- **The reverted projector stays reverted** until #4 wires a resolver that reads its
  store. Re-introducing it before then = a dead-`result_ref` pointer (§9
  scaffold-without-callers).
- **No renderer swap at the tool_call site** without a live A/B (compressToolResult
  vs preview on a real overflowing array, graded by `section-coverage-grade.ts`)
  showing preview does NOT regress list-all arrays.
- **If flipping `RA_ASSEMBLY` default-on fails the cross-tier grid** → the flag stays
  opt-in. Independent of the substrate work — neither blesses the other.

## After #2

The trace re-ordered the roadmap: the deep substrate unification is **#4** (make
`ResultStore` the LIVE store + extend `result_ref` resolution to span plan-execute,
so the reverted projector gets a resolving caller). Then **#3 EventLog sole-record**
(collapse `state.steps[]`/`messages[]` into one append-only log — non-reactive
strategies append step/thought/critique events), **#5 scaffoldProfile governance**
(incl. the deferred window-source fix: mid tier capped at 32768 not haiku's real
200k, `from-kernel-state.ts:112`), **#7 `RA_POST_CONDITIONS` default-on**,
**#8 KV-cache-friendly assembly**.

**Corrected sequence:** the available near-term wins (flip-default-on,
delete-`curate()`, hint-strip) are independent and unblocked now. The
result-injection unification is **#4**, which must wire the resolver across
plan-execute before any `preview+ref` swap is honest. Only after #4 is one policy +
one LIVE store does #3 (record swap to `EventLog`) become a record swap rather than
a re-derivation of two projection policies.
