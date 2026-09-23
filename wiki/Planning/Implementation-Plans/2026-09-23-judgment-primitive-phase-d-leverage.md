---
type: implementation-plan
status: completed
created: 2026-09-23
completed: 2026-09-23
tags: [type-safe, jev, judgment, context, completion, grounding, dx, cookbook, phase-e]
---

# Judgment Primitive Phase D — Leverage Expansion

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox (`- [ ]`) tracking.

**Depends on:** [[2026-09-20-typesafe-judgment-layer]] (Phases A-C shipped, `dev`). Methodology gate
+ shadow-site data: [[Research/Harness-Reports/2026-09-23-judgment-methodology-gate]],
[[Research/Harness-Reports/2026-09-23-shadow-site-exit-gates]].

**Gap this closes:** `agent.judge()` (`packages/runtime/src/reactive-agent.ts`) takes ONLY manually-passed
`state` — zero merging of kernel state, message history, tool observations. Every Phase C site
(strategy/complexity/comprehension/autonomy/healing/guardrails) hand-assembles its own state object.
Users writing their own judgments hit the same wall: judging "is this response done" or "is this claim
grounded" today means manually re-threading context the agent already holds. Phase D closes that gap at
three leverage points, ranked by value/risk.

## Ranked scope

| # | Item | Value | Risk | Blast radius |
|---|---|---|---|---|
| 1 | `includeContext` auto-merge on `agent.judge()` | High — standalone `packages/runtime` DX win for any user judgment (see Sequencing note: NOT a prerequisite for #2/#3, which use direct kernel-state access) | Low | Additive, opt-in param |
| 2 | Completion/termination judgment (shadow) | High — plan's own "highest runtime pain" flag | Medium | Reads `verify/quality-utils.ts`, no gate change yet |
| 3 | Grounding/fabrication judgment (shadow) | Medium — narrower blast radius than #2 | Medium | Reasoning package, additive shadow only |

No inversion in this plan — same boundary as Phase C. Every task here is shadow-only or purely additive;
flipping any of these into a real decision-maker is a distinct future plan requiring its own explicit
sign-off, per the standing convention from Phase C.

---

## Global constraints (carried from Phase C, restated)

- Strict TypeScript, Effect-TS mandatory, no `any`.
- Degrade, never fail: any judgment error falls through to existing heuristic behavior untouched.
- Observable: every new judgment call emits its site-tagged event on `EventBus`.
- `packages/judgment` stays a leaf package — nothing here adds a new dependency *into* it. Consumers
  (`runtime`, `reasoning`, `verification`) depend on `judgment`, not the reverse.
- Warden routing: `packages/runtime/**` → `runtime-warden`; `packages/reasoning/src/kernel/**` →
  `kernel-warden`; `packages/verification/**` + cross-cutting wiring → parent (no existing warden owns
  it; small enough scope this session to keep in-house, escalate to a new warden proposal only if scope
  grows).
- After each task: `bun test packages/<touched>`, `bun run typecheck`, `bun run build`. One concern per
  commit. No co-author trailers.

---

## Task 1: `includeContext` auto-merge on `agent.judge()`

**Files:** `packages/runtime/src/reactive-agent.ts` (the `judge()` method), a new
`packages/runtime/src/judgment-context.ts` (context-assembly helper), tests in
`packages/runtime/tests/`.

**Goal:** let a caller write `agent.judge(questions, { includeContext: true })` and get recent message
history + last tool observations automatically folded into `state`, instead of hand-assembling it. This
is the DX win — it's what makes Tasks 2 and 3 cheap to write, and it's independently useful to any user
building their own judgment on top of a running agent.

- [x] **Step 1:** Read the current `judge()` implementation and `assembly/project.ts`'s `project()` (the
  sole live context assembler) to find the smallest slice of already-computed state worth exposing:
  recent `state.messages[]` (windowed, same trim budget `project()` already uses — do not reimplement
  windowing), and the last N tool results from `state.steps[]` (compressed via the existing
  `compressToolResult` helper in `attend/tool-formatting.ts` — reuse it, don't re-derive a summary
  format).
- [x] **Step 2:** Define `JudgeContextOptions` (`Schema.Struct`, all fields optional): `includeContext:
  boolean`, `messageWindow?: number` (default matches `project()`'s default), `includeToolResults?:
  boolean` (default true when `includeContext` is true). Merge shape: caller's manually-passed `state`
  wins on key collision — auto-context only *fills gaps*, never overwrites an explicit field. Document
  this precedence rule in the JSDoc, it's the one surprising behavior in this feature.
- [x] **Step 3:** Wire `judge()` to build the merged state only when `includeContext` is truthy — zero
  cost, zero behavior change for every existing Phase C call site (none of them pass the option).
- [x] **Step 4:** Emit the existing `JudgmentAsk`/`JudgmentAnswer` events unchanged; add one boolean field
  `contextMerged: boolean` so shadow-analysis tooling can tell which calls used auto-context.
- [x] **Step 5:** Tests: (a) `includeContext: false`/omitted → byte-identical behavior to pre-Phase-D
  `judge()`; (b) `includeContext: true` with no manual state → merged state contains message window + tool
  summaries; (c) manual state key collides with an auto-context key → manual wins; (d) `messageWindow`
  override respected.
- [x] **Step 6:** Docs: add the `includeContext` option to whatever doc page/JSDoc documents `agent.judge()`
  today (grep for the existing judgment-layer docs page from Phase C) with a short before/after example —
  this is the single highest-DX-value line in this task, don't skip it.

**Exit check:** `bun test packages/runtime`, `bun run typecheck`, `bun run build`. No existing Phase C
call site's behavior changes (verify by re-running the Phase C shadow-site tests unmodified).

**✅ IMPLEMENTED (2026-09-23):** shipped via subagent-driven-development (runtime-warden), 1 fix
round (untested `contextMerged` signal; a `compressToolResult` reuse leaking kernel-only
"recall(...)" text into judgment prompts, reverted to a plain honest truncation). 1554 pass / 2
pre-existing on `packages/runtime`. Commits `6a988e5a..0d48d4f5` on `worktree-judgment-phase-d`.

---

## Task 2: Completion/termination judgment (shadow-only)

**Files:** `packages/reasoning/src/kernel/capabilities/verify/quality-utils.ts` (read-only reference —
`isSatisfied`/`detectContinuationIntent`/`GIVE_UP_PATTERNS`), a new shadow-emission site in
`packages/reasoning/src/kernel/capabilities/verify/` (exact file TBD by kernel-warden at dispatch —
likely alongside the existing verifier call site, not a new phase), tests.

**Why this one first among #2/#3:** the plan's own Task list (Phase A doc, "Explicitly out of scope")
flagged completion/termination judgment as the highest runtime pain point, blocked specifically on "a
shadow dataset measurable via the Phase B judge" — the methodology gate that just ran *is* that
measurement instrument now existing. This task is that blocker being cleared, not new scope invention.

- [x] **Step 1 (kernel-warden dispatch, MissionBrief):** Read `quality-utils.ts`'s current
  `isSatisfied`/`detectContinuationIntent` heuristics and the verifier's `GIVE_UP_PATTERNS` list. Identify
  the single funnel point where a termination/continuation decision is made per iteration (per
  `terminate.ts`'s single-owner rule — do NOT add a second termination decision point).
- [x] **Step 2:** Design the judgment: a Noul (`"is this response a complete, satisfying answer to the
  user's request?"`) with state = the task/goal text + the candidate final response + recent tool
  observations read directly from `VerificationContext.priorSteps` (kernel-side direct access — NOT
  Task 1's `includeContext`, which is a `packages/runtime` public-API convenience over `ReactiveAgent`
  state that `packages/reasoning` cannot depend on; see the Sequencing note below). Fire it
  **shadow-only**, alongside the existing heuristic decision, at the same funnel point — do not let its
  answer influence `terminate.ts` in this task.
- [x] **Step 3:** Emit `JudgmentShadow{site:"completion-satisfied", judged, current, agreement}` following
  the exact schema Phase C's four sites already use — no new shadow-event shape, reuse the existing one.
- [x] **Step 4 (exit gate, same bar as Phase C's Task 9/9b/10):** collect ≥30 real shadow samples across a
  range of task types (short factual, multi-step, ambiguous-completion cases specifically — this is the
  site most likely to show a directional bias like strategy-selection did, so don't only sample the easy
  side). Report agreement rate AND, if disagreements cluster, the direction (does the judge tend toward
  premature-termination or under-termination relative to the heuristic?).
- [x] **Step 5:** Write the exit-gate report to `wiki/Research/Harness-Reports/`, same format as the
  2026-09-23 shadow-site report. Explicitly state: no inversion in this task.

**Exit check:** `bun test packages/reasoning`, `bun run typecheck`, `bun run build`. Parent verifies
kernel-warden's report per the standing dispatcher FSM (never re-prompt for self-review; parent fixes any
findings directly).

**✅ IMPLEMENTED (2026-09-23):** shipped via kernel-warden (Steps 1-3), review clean, 0 fix rounds.
Wired into `verifyAndEmit` (`verifier.ts`) — the single funnel all 3 terminal-verification call sites
share — keeping `arbitrate()`/`terminate.ts` provably untouched. 6 new tests, 573/0 on
`packages/reasoning/src/kernel`. Commit `d90fe2c0`. **Step 4/5 real data (2026-09-23, direct-call
methodology against the real jev backend, n=32):** 87.5% agreement; all 4 disagreements ran the safe
direction — jev never rescued an evasive/incomplete answer, and where it diverged from a `verified:
true` heuristic it was stricter (one genuine catch: a shallow single-cause answer to a multi-cause
question), plus correctly sided with correctness against one deliberately-wrong heuristic baseline.
Zero dangerous-direction disagreements. Full write-up:
[[Research/Harness-Reports/2026-09-23-phase-d-completion-grounding-exit-gates]]. **No inversion.**

---

## Task 3: Grounding/fabrication judgment (shadow-only)

**Files:** whichever module currently implements the heuristic evidence-grounding check (grep
`packages/reasoning` and `packages/verification` for the grounding-guard call site referenced in memory
as `project_deterministic_evidence_grounding_2026_08_15` / `project_t0_deterministic_regression_2026_08_16`
— confirm current location before scoping, do not assume it hasn't moved), tests.

- [x] **Step 1:** Read the current heuristic (content-containment check per the t0-deterministic fix) and
  its call site. Confirm it's still the live grounding path (not superseded by something else since
  2026-08-16).
- [x] **Step 2:** Design the judgment: a Noul (`"is this claim supported by the provided evidence?"`) per
  claim/citation, state = claim text + the actual evidence ledger entries read directly from `KernelState`
  via `evaluateUnconsumedEvidenceGrounding` (kernel-side direct access — NOT Task 1's `includeContext`,
  which lives in `packages/runtime` and cannot be depended on from `packages/reasoning`; see the
  Sequencing note below). Fire shadow-only alongside the existing containment check.
- [x] **Step 3:** Emit `JudgmentShadow{site:"grounding-fabrication", ...}`.
- [x] **Step 4 (exit gate):** ≥30 real shadow samples, spanning both well-grounded and deliberately
  fabricated/unsupported claims (construct a few adversarial cases — this is the one site where a false
  negative, i.e. the judge calling a fabrication "grounded," is the failure mode that matters most; weight
  sampling toward catching that direction of error, not agreement rate in general).
- [x] **Step 5:** Report to `wiki/Research/Harness-Reports/`. No inversion.

**Exit check:** `bun test packages/verification packages/reasoning`, `bun run typecheck`, `bun run build`.

**✅ IMPLEMENTED (2026-09-23):** shipped via kernel-warden (Steps 1-3; re-routed from the plan's
original "parent, no warden exists" assumption once the live check was confirmed inside
`packages/reasoning/src/kernel/**`), review clean, 0 fix rounds. Extracted the inline
content-containment IIFE into a pure, regression-pinned `evaluateUnconsumedEvidenceGrounding` in
`runner-helpers/deliverable.ts`; wired the shadow into 1 of `assembleDeliverable`'s 6 call sites
(`runner.ts` §8.8, the most universal terminatedBy-drift-immune reach — widening to the other 5 is a
disclosed future follow-up, not required for this exit bar). 13 new tests, 2883/2 (pre-existing) on
full `packages/reasoning`. Commit `fc77bbbd`. **Step 4/5 real data (2026-09-23, direct-call
methodology against the real jev backend, n=32 — see Task 2's note for why direct-call over
live-agent-run):** 90.6% agreement; all 3 disagreements ran the safe direction — jev over-flagged 3
exact/near-verbatim numeric restatements as "not grounded" (a precision issue, not a safety issue).
**Zero dangerous-direction disagreements** — every deliberately-fabricated claim in the set was
correctly flagged, matching the heuristic. Full write-up:
[[Research/Harness-Reports/2026-09-23-phase-d-completion-grounding-exit-gates]]. **No inversion.**

---

## Sequencing note

**Corrected 2026-09-23 (final whole-branch review, fix round, finding #6):** this note originally said
Tasks 2/3 would use/reuse Task 1's `includeContext`. That never happened and could not have happened —
`packages/reasoning` cannot depend on `packages/runtime` (dependency runs the other way, per `AGENTS.md`'s
package tree), and Task 1's `includeContext` is a `packages/runtime`-only convenience over
`ReactiveAgent`'s own chat-history/reasoning-step caches. Tasks 2/3 live entirely in
`packages/reasoning/src/kernel/**` and correctly used direct `KernelState`/`VerificationContext` access
instead (`VerificationContext.priorSteps` for Task 2, `evaluateUnconsumedEvidenceGrounding(state)` for
Task 3) — this was the right call from the start, not a shortcut or a deviation from plan.

Task 1 shipped as a standalone `packages/runtime` DX feature (the public `agent.judge({includeContext})`
API), independently useful and independently shippable — not a blocking prerequisite for Tasks 2/3. All
three tasks could have shipped in parallel; they happened to ship sequentially because Task 1 was
dispatched first, not because 2/3 depended on it.

---

## Phase E: Consumer Leverage Expansion (added 2026-09-23, post-merge)

**Depends on:** Phase D above (merged `a53f0333`) — confidence-gated `JudgmentShadow` events and
`JudgmentBackend.listModels()` already ship. 4 real-data spike probes
([[Research/Prototypes/RESULTS-p04a|p04a]] batched fan-out, [[Research/Prototypes/RESULTS-p04b|p04b]]
memory rerank, [[Research/Prototypes/RESULTS-p04c|p04c]] hierarchical router,
[[Research/Prototypes/RESULTS-p04d|p04d]] state-presentation bias) proved out candidate leverage before
this phase was scoped — spot-verified accurate (real jev calls, disclosed limitations, self-corrected
scope assumptions) before folding results in here.

**Gap this closes:** Phase D made `agent.judge()` context-aware but the *public* surface around it is
still thin — no typed input re-export for wrapper functions, no facade access to the model catalog, and
every consumer hand-rolls the batched-rerank pattern from
[[../../Research/Harness-Reports/2026-09-23-phase-d-completion-grounding-exit-gates|the cookbook]] from
scratch. This phase closes those three gaps — all additive, all consumer-facing, zero shadow-site
inversion, same boundary discipline as Phases C/D.

### Ranked scope

| # | Item | Value | Risk | Blast radius |
|---|---|---|---|---|
| 4 | Re-export `JudgeInput<Q>` from `packages/runtime/src/index.ts` | Closes a real typed-wrapper DX gap (found while writing Phase D docs) | Trivial | Export-only, no behavior change |
| 5 | `listModels()` on the `agent` facade | Startup-time model-string validation without reaching into `@reactive-agents/judgment` directly | Low | Thin delegation to existing `JudgmentService.listModels()` |
| 6 | `agent.judgeRank(candidates, {...})` — batched candidate re-ranking primitive | Highest leverage: codifies the cookbook's rerank recipe (currently N hand-rolled `judge()` calls + manual sort) into one reusable, tested primitive — the actual "build awesome things" ask | Medium — new public method, new tests, a real batching-vs-candidate-count tradeoff to document, not just sugar |

Memory rerank ([[Research/Prototypes/RESULTS-p04b|p04b]], WORTH-IT conditional) stays excluded — still
pending a rerun against `packages/memory`'s real vector-similarity baseline (p04b used a synthetic
lexical proxy), not ready to scope into a build.

## Task 4: Re-export `JudgeInput<Q>`

**Files:** `packages/runtime/src/index.ts`, a type-only test asserting the export exists and is usable.

- [x] **Step 1 (TDD):** Write a failing test in `packages/runtime/tests/` that imports `JudgeInput` from
  `reactive-agents`/`@reactive-agents/runtime`'s public index and uses it to type a wrapper function
  signature — confirm it currently fails to compile/import.
- [x] **Step 2:** Add `export type { JudgeInput } from "./agent/...";` (confirm exact current file/module
  path — `JudgeInput` was last seen defined in `reactive-agent.ts`, may have moved during Phase D's fix
  round) to `packages/runtime/src/index.ts`.
- [x] **Step 3:** Test passes. `bun run typecheck`, `bun run build` — confirm the new export doesn't widen
  any existing public type unexpectedly (diff `dist/index.d.ts` before/after).

**Exit check:** `bun test packages/runtime`, `bun run typecheck`, `bun run build`.

**✅ IMPLEMENTED (2026-09-23):** shipped via runtime-warden, review clean, 0 fix rounds. Export added at
`packages/runtime/src/index.ts:21`. Also re-exported from the `reactive-agents` umbrella package
(`packages/reactive-agents/src/index.ts`) as part of the final-review fix wave, once the reviewer found
the facade package was missing it. 1616/2 (pre-existing) on `packages/runtime`. Commit `7dbc8144`.

## Task 5: `listModels()` on the `agent` facade

**Files:** `packages/runtime/src/reactive-agent.ts` (new method alongside `judge()`), tests.

- [x] **Step 1 (TDD):** Write failing tests: (a) `agent.listModels()` with `.withJudgment()` configured and
  a `jev`-shaped fake backend returns the model list; (b) without `.withJudgment()`, throws immediately
  (same "caller mistake, not silent no-op" precedent `judge()` already sets — do not degrade silently
  here, this is a direct user call, not an internal shadow site); (c) backend without a catalog
  (`llm`/`JudgmentUnsupported`) surfaces that error, not a swallowed empty list.
- [x] **Step 2:** Implement `listModels()` as a thin delegation to the wired `JudgmentService.listModels()`,
  mirroring `judge()`'s own `Effect.serviceOption(JudgmentService)` guard pattern and error-throwing
  precedent exactly — no new error-handling philosophy invented for this one method.
- [x] **Step 3:** Tests green. Update `features/judgment-layer.md`'s "Listing available models" section
  (written against the library-level-only state in Phase D's doc pass) to show the facade method instead,
  keep the library-level example as a secondary "or, holding `JudgmentService` directly" note.

**Exit check:** `bun test packages/runtime`, `bun run typecheck`, `bun run build`.

**✅ IMPLEMENTED (2026-09-23):** shipped via runtime-warden, review clean, 0 fix rounds. Mirrors `judge()`'s
exact `Effect.serviceOption(JudgmentService)` guard verbatim. 3 new tests, 1619/2 (pre-existing) on
`packages/runtime`. Commit `9339c604`. **Final-review fix wave** corrected test (a), which had resolved a
real `TYPESAFE_API_KEY` from `.env` and made a live network call (passed locally, would have failed CI) —
replaced with a fake `JudgmentService`; and corrected the docs/JSDoc, which claimed `instanceof
JudgmentUnsupported` works on the rejection when it actually doesn't (real shape: a `FiberFailure` wrapper,
message-based matching only) — both fixed in commit range `2755acba..690620b4`.

## Task 6: `agent.judgeRank(candidates, {...})`

**Files:** `packages/runtime/src/reactive-agent.ts` or a new `packages/runtime/src/judgment-rank.ts`
(kernel-warden/runtime-warden's call at dispatch time — likely a new file, mirroring `judgment-context.ts`'s
Task 1 precedent of keeping `reactive-agent.ts` thin), tests.

- [x] **Step 1 (TDD):** Write failing tests first: (a) ranks N candidates by a single Score question,
  returns them sorted best-first with each candidate's score attached; (b) a small candidate count (below
  some documented threshold) batches all candidates as named fields in ONE `ask()` call; (c) a candidate
  count above that threshold chunks into multiple `ask()` calls (mirror the existing `CHUNK_CAP` pattern
  from `judgment-classification.ts` — reuse the concept, don't invent a second chunking scheme); (d) ties
  broken deterministically (stable sort, not answer order); (e) `.withJudgment()` absent → throws, same
  precedent as Task 5.
- [x] **Step 2:** Design the signature: `agent.judgeRank(candidates: readonly {id: string; state:
  JudgmentEntry}[], question: {instructions: JudgmentEntry; criteria: ScoreCriteria}, opts?: {chunkCap?:
  number}) => Promise<ReadonlyArray<{id: string; score: number; confidence: number}>>` — confirm this
  shape against real usage patterns from the cookbook's rerank recipe before finalizing; adjust if the
  cookbook's hand-rolled version reveals a more ergonomic shape.
- [x] **Step 3:** Implement using the existing chunking helper's pattern (batch candidates as named
  `state`+`questions` fields, one Score question per candidate id, single `ask()` per chunk) — real
  leverage over the cookbook's naive one-`judge()`-call-per-candidate loop specifically when candidate
  count is small enough to fit one chunk.
- [x] **Step 4:** Tests green. Add a real usage example to `guides/judgment-cookbook.md`'s "Re-ranking
  candidates" section replacing the hand-rolled `Promise.all` version with `agent.judgeRank(...)`, and
  note the batching-vs-candidate-count tradeoff the cookbook currently only mentions as a caveat.

**Exit check:** `bun test packages/runtime`, `bun run typecheck`, `bun run build`.

**✅ IMPLEMENTED (2026-09-23):** shipped via runtime-warden, kept the suggested signature (cookbook fit
confirmed by task review once the cookbook file existed). New `packages/runtime/src/judgment-rank.ts`, thin
delegator in `reactive-agent.ts`. 1 fix round (task-scoped review): result array can come back shorter than
`candidates` on backend misbehavior (non-Score answer) — was silently undocumented, fixed with an explicit
`@returns` JSDoc clause on both the core function and the facade method. 5 new tests, review clean after the
round. Commits `4a27cad8..c37fcfb3`. **Final-review fix wave** found and fixed two more real issues: (1) a
`chunkCap <= 0`/non-finite value hung the chunking loop (infinite empty-slice push, no interrupt point) —
now rejects up front with a clear error; (2) the `specs` object was built via plain assignment, so a
candidate id of `"__proto__"` polluted the object prototype and was silently dropped, and duplicate
candidate ids silently overwrote each other — fixed via `Object.create(null)` plus an explicit
duplicate-id rejection, both with new tests. Commit range `2755acba..690620b4`.

## Task 7: Documentation pass — navigation + feature completeness

**Files:** `apps/docs/astro.config.mjs` (sidebar structure — confirm `guides/judgment-cookbook.md` and
`features/judgment-layer.md` are actually reachable in the built sidebar, not just present as files),
`apps/docs/src/content/docs/features/judgment-layer.md`, `apps/docs/src/content/docs/guides/judgment-cookbook.md`,
`README.md` (if judgment layer isn't already in the packages/features table — grep first).

- [x] **Step 1:** Confirm sidebar reachability: `apps/docs` autogenerates its sidebar from directory
  structure per `AGENTS.md`'s Docs Site section — verify `judgment-cookbook.md`'s `sidebar.order: 28`
  doesn't collide with an existing guide and that it actually renders in the built nav (re-run
  `bun run docs:build`, inspect the generated sidebar, not just "no build error").
  Removed from Phase D closeout: sidebar collision/reachability was never explicitly re-checked after the
  cookbook page was added — confirm it now, don't assume the earlier clean build proves nav placement.
- [x] **Step 2:** Update `features/judgment-layer.md` for Tasks 4-6: `JudgeInput` re-export mention where
  the `judge()` signature is documented, `listModels()` facade method (supersedes the library-level-only
  note from Phase D), and a new `judgeRank()` subsection under "The three primitives" or its own heading.
- [x] **Step 3:** Update `guides/judgment-cookbook.md`'s re-ranking recipe to show `judgeRank()` as the
  primary example (Task 6, Step 4 — cross-reference, don't duplicate work).
- [x] **Step 4:** Grep `README.md` and `apps/docs/src/content/docs/reference/builder-api.md` for
  `withJudgment`/`agent.judge` — if either doc's method table is missing `listModels`/`judgeRank`, add
  them (Documentation Cross-Reference Rules in `AGENTS.md` — don't let API truth drift between these and
  the Starlight pages).
- [x] **Step 5:** `bun run docs:build` clean, internal link validator passes (`starlight` link check —
  already proven green once for the cookbook page in Phase D's own doc pass, re-verify after these edits).

**Exit check:** docs build clean, sidebar nav includes both pages at a sensible position, no stale
capability tables anywhere Documentation Cross-Reference Rules says to check.

**✅ IMPLEMENTED (2026-09-23):** shipped via parent dispatch (no warden covers `apps/docs/**`), review
clean, 0 fix rounds. Found and fixed a real bug at Step 1: `astro.config.mjs`'s sidebar is hand-curated
(not autogenerated) for most groups, so `judgment-cookbook.md`'s `sidebar.order` frontmatter was inert and
the page was silently absent from the built nav despite building without error — added a real manual
sidebar entry, verified via built-HTML inspection before/after. `judgment-layer.md`/`judgment-cookbook.md`
updated for `JudgeInput`/`judgeRank()`; `builder-api.md` gained a new "Judgment (runtime)" method table
(`judge`/`listModels`/`judgeRank`); `README.md`'s judgment bullet extended (no pre-existing table
structure to match, per brief guidance not to invent one). `docs:build` clean, link validator passed, 95
pages built. Commit `2755acba`. Also folded in, same commit: recovery of `judgment-cookbook.md` and
`judgment-layer.md`'s Phase D harness-sites table rows, which were written earlier in the session but never
committed to `dev` — found when this task's implementer correctly flagged the cookbook file as unexpectedly
missing from the worktree; restored by the controller and reconciled with Task 5's edits (commit
`b203bd8f`).

---

## Explicitly out of scope (this plan)

- Any inversion of Phase C's four existing shadow sites (strategy/complexity/comprehension/autonomy) —
  tracked as open follow-up decisions in the Phase C debrief, not part of Phase D.
- A general "judgment marketplace" or additional judgment sites beyond the three above — same scope
  discipline as Phase C's own warden note: ship the bounded primitive expansion, not every possible use.
- Changing `terminate.ts`'s single-owner decision, or the grounding heuristic's actual gating behavior —
  both stay shadow-only until a future plan with explicit sign-off, mirroring Task 11b's precedent.
