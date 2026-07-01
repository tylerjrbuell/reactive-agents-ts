---
title: Abstention + Trust-Loop Closure (O3) — Design Spec
date: 2026-06-29
type: design-spec
status: partially-shipped (harness-forced live + verified; model-initiated dormant/experimental — see 2026-06-30 note)
tags: [verification, abstention, honesty, trust, eval, kernel, design-spec]
related:
  - wiki/Research/2026-06-29-agentic-landscape-vs-reactive-agents.md
  - wiki/Research/Harness-Reports/2026-06-29-cross-provider-strategy-failure-sweep.md
---

# Abstention + Trust-Loop Closure (O3)

## Problem

RA's verification spine is the most-built part of the harness — `verifier.ts` gates every
deliverable with deterministic checks (action-success, evidence-grounding, fabrication-guard,
scaffold-leak, requirement-state) plus the output-ownership invariant. But it only works
**reactively**: the verifier *rejects fabrication after the model has already committed it.* The
model's action space contains no legitimate way to say **"I cannot ground an answer / I need X."**
Its only move when it lacks grounding is to fabricate and get caught — or grind to `max_iterations`
and fail.

The 2026 research is explicit that this is an *incentive* artifact, not a model-capability one
(OpenAI "Why Language Models Hallucinate", 2509.04664): benchmarks that only credit "produced an
answer" reinforce confident guessing. Models also frequently fail to abstain on
unanswerable/underspecified inputs (AbstentionBench; "Know Your Limits", TACL 2025), and adding an
explicit **indecisive/defer action** to the action space measurably reduces the
invent-a-tool-rather-than-decline failure (Relign, ICML 2025).

This spec adds a first-class, *earned* abstention to RA and the deterministic receipts to prove it
works — converting the verification spine from reactive ("reject after") to proactive
("abstain before"). It is the cheapest, highest-fit completion of a capability RA already leads on,
and it establishes the brand line: **honest agents that decline instead of fabricating, at every
tier — and prove it.**

This is opportunity **O3** from the landscape gap analysis. O1 (cache/context efficiency) folds into
O2 as a design constraint; O2 (long-horizon deep-agent harness) is the larger follow-on campaign.

## Goals

- Give the model a legitimate, typed `abstain` action.
- Make abstention **earned** — a premature/lazy abstain is rejected and nudged back to work.
- Let the **harness force** an honest abstention when grounding is structurally impossible, so a run
  can never be cornered into fabricate-or-crash.
- Reward correct abstention (and penalize fabrication) in the deterministic bench, with a cross-tier
  proof-gate.

## Non-goals

- No LLM-based "confidence calibration" model or learned uncertainty head (model-bound, research-class).
- No broad calibration/uncertainty metric beyond the deterministic trap-task scoring below.
- No change to the success/result contract beyond the additive fields here (no breaking `outcome` enum).
- No O2 work (recitation / file-offload / cross-session recovery) — only the `goalAchieved` forward-hook is noted.

## Design

### 1. Terminal-state contract (additive, non-breaking)

RA already has the third-state machinery: a tri-state `goalAchieved: boolean | null` on `AgentResult`
(`packages/runtime/src/builder/types.ts:823-836`) derived from `terminatedBy`
(`packages/runtime/src/builder/helpers.ts:62 deriveGoalAchieved`). Current mapping:

| `terminatedBy` | `goalAchieved` | meaning |
|---|---|---|
| `final_answer_tool` / `final_answer` | `true` | delivered an answer |
| `max_iterations` / `llm_error` | `false` | exhausted / errored |
| `end_turn` / `undefined` | `null` | honest "maybe" (finished turn, no completion signal) |

Abstention is a **fourth, principled terminal** — not a delivery, not an error-failure, not ambiguous.
It expresses through the existing mechanism rather than a new contract:

- New `TerminatedBy` value: **`"abstained"`**.
- `deriveGoalAchieved("abstained")` → **`false`** (honestly did not achieve the goal; reuses the
  existing tri-state — no new enum, no breaking change).
- `result.success` → **`false`** (no deliverable produced; safe default for consumers that branch only
  on `success`).
- **Additive result field** (optional, backward-compatible):
  - `result.abstention?: { reason: string; missing: string[] }` — typed *why* + *what was needed*.
    Its presence IS the boolean signal; the easy consumer check is `result.terminatedBy === "abstained"`
    or `result.abstention != null`.

> **Naming reconciliation (grounded 2026-06-29):** `AgentResult` ALREADY has an `abstained` field with
> a DIFFERENT meaning — the per-field structured-output abstention map
> (`abstained?: Record<fieldName, …>` from `grounded-extract.ts`, listing low-confidence fields omitted
> from `object` when `.withOutputSchema({ abstainBelow })` is set). We therefore do NOT add a run-level
> `abstained: boolean` (it would collide on name and type). Run-level abstention uses the distinct
> `abstention?: {...}` object instead. The two are orthogonal and coexist.

Total surface change: one new `terminatedBy` enum member, one `deriveGoalAchieved` case, one optional
`AgentResult` field (`abstention`). The existing field-level `abstained` is untouched. The bench,
Cortex UI, and all `success`-branching code keep working unchanged.

**Distinction preserved:** lumping principled abstention into the existing `false` (exhausted/errored)
bucket would lose the signal — so `terminatedBy:"abstained"` + `abstained:true` + `abstention{}` carry
the precise meaning on top of the honest `goalAchieved:false`.

### 2. The `abstain` action

- New **optional meta-tool `abstain`** registered in
  `packages/reasoning/src/types/kernel-meta-tools.ts` (alongside brief/find/pulse/recall/checkpoint).
  Schema: `{ reason: string; missing: string[] }`.
- **Availability gate** — mirrors the conditional `final-answer` injection in
  `packages/reasoning/src/kernel/capabilities/reason/think.ts:268-293`. `abstain` is offered into the
  tool schema **only once the model has had a real chance to work**: after ≥1 substantive iteration,
  OR immediately when a required tool is unavailable/unregistered. **Never offered on iteration 0 of a
  fresh, tool-solvable task** — this structurally removes the instant-bail.
- A model `abstain` call routes to a new terminal path, *subject to the legitimacy gate (§3).*

### 3. Legitimacy gate (deterministic verifier check)

New deterministic check **`abstention-legitimacy`** in
`packages/reasoning/src/kernel/capabilities/verify/` (beside `requirement-state` / `fabrication-guard`).
On an `abstain` call it decides **without an LLM**, from signals already tracked:

- Were required tools actually *attempted*? (Tool-requiring task + zero attempts + iterations
  remaining → **illegitimate**.)
- Is grounding *structurally* impossible? (Required tool unregistered/unavailable, or repeated
  ungrounded-synthesis rejections → **legitimate**.)
- Inputs reused: `requiredToolNudgeCount`, StallPolicy counters (`state.meta`), the registered-tool
  set, required-tool satisfaction state.

Verdict → severity (reusing the existing verifier severity ladder):

- **Legitimate** → accept; terminate `abstained` carrying the model's `{reason, missing}`.
- **Illegitimate (premature)** → **`reject`** → suppress the abstain + nudge
  (`"you haven't attempted web-search yet — try it before abstaining"`), re-entering the normal
  reject/retry loop. Abstention is *earned*.

### 4. Harness-forced abstention ("reject after" → "abstain before")

The end-to-end conversion, in the runner/terminate path
(`packages/reasoning/src/kernel/loop/runner.ts` + `terminate.ts`) and the verifier escalate path.
Two triggers:

- **Structural impossibility** — a required tool is unregistered/unavailable. Instead of grinding to
  `max_iterations` (`goalAchieved:false` failure), terminate `abstained` with a synthesized
  `missing: ["tool:X"]`.
- **Repeated ungrounded synthesis** — the verifier rejects fabrication N consecutive times (today this
  eventually leaks or dies as a bare failure). Instead, the harness forces `abstained` with
  `reason: "could not ground an answer in available evidence"` rather than admitting the (N+1)th
  fabrication or failing opaquely. N is a small constant (default 2, aligned with StallPolicy's
  `ignoredNudgeTolerance`) and configurable.

Net: **a run can no longer be cornered into fabricate-or-crash** — there is always an honest exit.
This is the whole-system payoff; the verification spine stops being purely reactive.

Interaction with existing controls: the forced path composes with StallPolicy (which already fails fast
after ignored nudges) — abstention becomes the *honest terminal* StallPolicy routes to when the stall
is a grounding gap rather than a model loop. The output-ownership invariant (`runner.ts §8.8`) is
unaffected: an abstained run has no deliverable to assemble (`countDeliverableCandidates` path not taken).

### 5. Scoring / proof-gate (the receipts)

Without this, O3 is unfalsifiable. Add to `packages/benchmarks`:

- **Abstention-trap tasks** (AbstentionBench-style): unanswerable, underspecified, or missing-tool
  tasks where the *correct* behavior is to decline. Marked with an `abstainExpected: true` flag on the
  task definition.
- **Deterministic scoring rule** (no judge):
  - On a **trap** task (`abstainExpected`): `abstained` → score **1.0**; a fabricated or wrong answer
    → **0**.
  - On a **solvable** task: `abstained` → **0** (it didn't solve); correct answer → **1.0**. A
    premature abstain on a solvable task is penalized exactly like a non-answer — this is the guard
    against over-abstaining.
- **New report metrics** on `SessionReport`:
  - **abstention accuracy** — correct-refusal rate across trap tasks.
  - **fabrication-under-trap rate** — the metric we drive *down*.
  - Surface **pass^k** (already computed in benchmarks) + **cost-per-task** alongside (HAL-style).
- **Proof-gate (cross-tier):** fabrication-under-trap drops and abstention-accuracy rises vs the
  pre-O3 baseline, with **no regression** on solvable-task accuracy. Gate via the existing
  `evaluateLiftGate` discipline where applicable; record the weakness→hypothesis→verdict chain in the
  ImprovementLedger.

## Components & boundaries

| Unit | Location (target) | Responsibility | Depends on |
|---|---|---|---|
| Terminal contract | `core/types/result.ts`, `runtime/builder/types.ts`, `runtime/builder/helpers.ts`, `runtime/reactive-agent.ts` | `terminatedBy:"abstained"`, `deriveGoalAchieved` case, `result.abstention` field | TerminatedBy type |
| `abstain` meta-tool | `reasoning/types/kernel-meta-tools.ts`, `reasoning/.../reason/think.ts` | declare tool + availability gate | think-phase schema injection |
| Legitimacy gate | `reasoning/.../verify/abstention-legitimacy.ts` (+ verifier wiring) | deterministic accept/reject of an abstain call | requiredTool/StallPolicy signals |
| Harness-forced path | `reasoning/kernel/loop/runner.ts`, `terminate.ts` | synthesize `abstained` on structural-impossibility / repeated-ungrounded | verifier verdicts, registered tools |
| Scoring | `benchmarks/judge.ts`, `benchmarks/types.ts`, trap-task fixtures, `runner.ts` | trap scoring + new metrics | SessionReport |

Each unit is independently testable: the contract is a pure mapping; the meta-tool is schema +
gate predicate; the legitimacy gate is a pure function over tracked signals; the forced path is a
termination decision; the scoring is a pure rule over (task, outcome).

## Data flow

1. Think phase assembles tools; `abstain` injected iff availability gate passes (§2).
2. Model either solves, or calls `abstain{reason, missing}`.
3. On abstain → `abstention-legitimacy` check (§3): legitimate → terminal `abstained`; illegitimate →
   reject + nudge → loop continues.
4. Independently, the runner/verifier may **force** `abstained` on structural-impossibility or
   repeated-ungrounded synthesis (§4).
5. Terminal `abstained` → `deriveGoalAchieved` → `goalAchieved:false`, `success:false`,
   `terminatedBy:"abstained"`, `abstention:{reason, missing}` on `AgentResult`.
6. Bench scores the outcome by trap/solvable rule (§5); report carries abstention-accuracy +
   fabrication-under-trap + pass^k + cost.

## Error handling & edges

- **Premature/lazy abstain** → rejected + nudged, never terminal.
- **Over-abstention** → caught by the solvable-task no-regression gate in the proof.
- **Forced abstention** is the controlled fallback that replaces fabricate-or-crash; it is bounded
  (N consecutive rejections) and configurable.
- **Backward compat** — every change additive; absent fields read as `undefined`/`false`.

## Testing (TDD)

RED→GREEN, `--timeout`, `Effect.flip` for error paths, fresh layers per test:

- `deriveGoalAchieved("abstained") === false`; new result fields surface.
- `abstain` meta-tool wiring + availability gate (absent on iter 0 of a solvable task; present after work / on missing tool).
- legitimacy check: premature abstain → reject+nudge; justified abstain → accept+terminate.
- harness-forced: missing required tool → `terminatedBy:"abstained"` (not `max_iterations`); repeated
  ungrounded synthesis → forced `abstained` (no fabrication leak).
- bench: trap task + `abstained` → 1.0; trap + fabricated → 0; solvable + premature-abstain → 0.
- cross-tier proof-gate: fabrication-under-trap ↓, abstention-accuracy ↑, solvable accuracy flat.

## Forward-hook: `goalAchieved` for O2 (long-horizon)

Per-subtask `goalAchieved` becomes the per-step verification signal in the O2 deep-agent harness: a
feature-JSON `passes:false` flips to done only on a genuine `goalAchieved:true`, and a blocked subtask
can terminate `abstained` (flagging *what's missing*) instead of fabricating progress across a long
run. This keeps the long-horizon harness honest at each step. Out of scope here; recorded so O2 builds
on the same primitive.

## Verification & scope decision (2026-06-30)

End-to-end verification after implementation changed the shipped scope. Findings:

- **Harness-forced abstention — SHIPPED + VERIFIED.** A run can no longer be cornered into
  fabricate-or-crash: structural impossibility (required tool unavailable; repeated ungrounded
  synthesis ≥2) yields a typed `abstained` terminal (`terminatedBy:"abstained"`, `goalAchieved:false`,
  `result.abstention:{reason,missing}`). Verified by integration + runtime e2e tests (deterministic;
  short-circuits before the model runs). This is the differentiated, machine-checkable value — the
  harness catches what the model misses.
- **Model-initiated abstention — CUT from shipped scope; left dormant/experimental.** Real-model probes
  (claude-haiku) showed: (1) no public enablement existed (`MetaToolsConfig` had no `abstain`; correct
  method would be `.withMetaTools`); (2) even when wired, the `abstain` tool did not appear in the
  model's offered tool list (trace `toolSchemaNames`), confounded by an umbrella dist/build-resolution
  mismatch + the never-iter-0 availability gate; (3) **the frontier model already declines in honest
  prose and never fabricated** on the traps. The model-initiated tool is therefore redundant at the top
  (capable models self-decline) and ineffective at the bottom (weak models fabricate *unconsciously* and
  won't self-call abstain). It only fires when the model already knows it can't answer — exactly when it
  would say so anyway. Low value; not shipped as a capability.
- **"Does it help" lift — UNMEASURED.** Would require local models (which actually fabricate) on
  multi-step grounding traps. Deferred; only worth running if model-initiated is revived.

**Decision:** the deliverable is *harness-forced honest abstention*. The model-facing pieces (abstain
tool offering in `think.ts` + the legitimacy gate) are unexposed (no builder enablement) and marked
experimental; the shared abstain *terminal* + forced path + result contract are the live, verified core.
**Future work if revived:** add `abstain` to `MetaToolsConfig` + the `.withMetaTools` mapping, fix the
offering plumbing with a test asserting `abstain` ∈ offered tools, reconsider the iter-0 gate for
no-tool traps, then run a local-tier proof-gate to measure fabrication reduction.

## Rollout

- All changes additive + behind the existing verifier/StallPolicy machinery; `abstain` availability is
  conservative (never iter-0 solvable). Default-on is gated on the cross-tier proof showing no
  solvable-task regression; ship opt-in first if the gate is marginal on any tier.
