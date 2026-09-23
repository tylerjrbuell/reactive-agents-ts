---
type: implementation-plan
status: active
created: 2026-09-23
tags: [type-safe, jev, judgment, context, completion, grounding, dx]
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

## Explicitly out of scope (this plan)

- Any inversion of Phase C's four existing shadow sites (strategy/complexity/comprehension/autonomy) —
  tracked as open follow-up decisions in the Phase C debrief, not part of Phase D.
- A general "judgment marketplace" or additional judgment sites beyond the three above — same scope
  discipline as Phase C's own warden note: ship the bounded primitive expansion, not every possible use.
- Changing `terminate.ts`'s single-owner decision, or the grounding heuristic's actual gating behavior —
  both stay shadow-only until a future plan with explicit sign-off, mirroring Task 11b's precedent.
