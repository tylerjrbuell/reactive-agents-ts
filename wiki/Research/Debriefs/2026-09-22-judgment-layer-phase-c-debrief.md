---
type: debrief
created: 2026-09-22
tags: [type-safe, jev, judgment, guardrails, interaction, tools, phase-c]
---

# TypeSafe/Jev Judgment Primitive — Phase C Debrief

Plan: [[Implementation-Plans/2026-09-20-typesafe-judgment-layer]]. Covers Phase C (runtime judgment
tier, Tasks 8–13), implemented across several sessions and closed out 2026-09-22–23. Builds on
[[Research/Debriefs/2026-09-22-jev-judge-eval-overhaul-debrief]] (Phase A+B).

## What shipped

**Task 8 — `.withJudgment()` builder wiring.** `ReactiveAgentBuilder.withJudgment(options?)` mirrors
`.withGuardrails()`/`.withVerification()`; a genuinely-optional `judgmentOptLayer` (`Layer.empty` when
unset). Backend auto-selects `jev` when a TypeSafe key resolves, else `llm` (bridges the agent's own
`LLMService`). Public primitive: `agent.judge<Q>(input): Promise<JudgmentAnswers<Q>>` — throws loudly
if `.withJudgment()` was never called (a caller mistake, not a silent degrade, unlike `health()`'s
pattern). `JudgmentSites` config interface threaded through unread (Tasks 9+ consume it).

**Tasks 9 / 9b — strategy selection & complexity routing (REPLACE, shadow-only).** Both are duplicate
instances of the same defect class: a regex/keyword ladder deciding a model-facing routing choice.
`adaptive.ts` and `complexity-router.ts` each gained a shadow classification (`Effect.forkDaemon`,
never awaited) that fires the equivalent batched judgment question and emits `JudgmentShadow` —
the existing heuristic still decides. Step 4 (invert) NOT started — needs ≥30 real shadow samples per
the plan's own gate.

**Task 10 — `comprehend/` fan-out (ADD, shadow-only).** One batched judgment request reproduces the
union of four regex-derived task-classification signals (complexity/horizon/multi-step/output-format/
citation) plus a per-tool `requires::<name>` Noul, wired into the kernel's `runKernel()`. Post-review
fixes: derived the tool-cap from the actual built object instead of a second hardcoded constant; made
the shadow's input-building genuinely lazy (a thunk, not a value) so an absent `JudgmentService` is a
true zero-cost no-op, not just zero-events.

**Naming correction (mid-Phase-C).** Before continuing to Task 11, corrected vendor-coupled naming that
had crept into the backend-agnostic shadow mechanism across 4 packages: `JudgmentShadow.jev` →
`.judged`, `jevClassifyShadow`→`judgmentClassifyShadow`, file renames (`adaptive-jev-questions.ts` →
`adaptive-judgment-questions.ts`, etc.), `JEV_JUDGED_DIMENSIONS`→`JUDGMENT_SCORED_DIMENSIONS`.
Concrete backend-selector identifiers (`jev-backend.ts`, `makeJevBackend()`, `judgeEngine:"jev"` literal)
were deliberately left alone — same pattern as naming a provider `"anthropic"` vs `"openai"`. Verified
3255/0 across the affected packages before proceeding.

**Task 11 — guardrails battery (ADD, opt-in, parallel to regex).** New
`packages/guardrails/src/detectors/judgment-battery.ts`: one batched request (4 Nouls +
1 severity Score) runs alongside the existing regex detectors. Default `"additive"` strictness only
adds a violation or escalates a *matching* dimension's severity — a strict superset of today's
regex-only behavior; opt-in `"jev-primary"` can also unblock a regex hit the battery disagrees with.
New opt-in `screenOutputs` runs the same battery over replies, observability-only
(`GuardrailOutputFlagged`, never blocks). Review-band emits `GuardrailReviewFlagged`, evaluated
per-dimension (not one lossy aggregate max). Post-review fixes: a severity-escalation bug that
inflated an unrelated violation type's severity off the shared Score; wired the 5 new config fields
through the public `.withGuardrails()` builder API (were otherwise unreachable — `GuardrailsOptions`
didn't expose them); deduplicated severity-max logic (previously hand-copied in `pii-detector.ts`) into
one shared `types.ts` helper; wired a real `JudgmentService` into `createLightRuntime()` (sub-agent/
light-runtime callers could set `guardrailsOptions.enableJudgmentBattery` but the service was never in
that runtime's Layer graph — silently dead for every sub-agent).

**Task 11b — autonomy/approval confidence (ADD, shadow-only, highest blast radius).** Deliberately its
own task, not folded into Task 11: guardrails only ever adds a block signal (worst case is
over-blocking, caught by the superset test); autonomy confidence gates *auto-approval of actions*, so
a confident-wrong judgment here could auto-approve something a human should have seen. `preference-
learner.ts`'s existing confidence/occurrences/action/cost-threshold gate decides exactly as today; a
batched `preferenceMatch` Score + `safeToAutoApprove` Noul fire in parallel, tagged
`site: "autonomy-confidence"` (and a second event, `site: "autonomy-confidence-match"`, surfacing the
Score once a reviewer noted it was otherwise computed and discarded). No inversion step is written —
Step 4 (≥50 real shadow samples, reporting false-auto-approval risk as the headline metric, not
agreement rate) needs real production traffic and is explicitly deferred.

**Task 12 — healing stage 3 (ADD, lowest leverage).** New `packages/tools/src/healing/judgment-
healing.ts`: `runJudgmentHealing()` fires only when the existing synchronous fuzzy-match healer misses
(no exact/alias/edit-distance≤2 match) — batches a Choice over the 5 closest-by-edit-distance candidate
tools plus an `arg_present::<param>` Noul per top-candidate parameter. Heals only above a 0.8
confidence floor. The existing synchronous `runHealingPipeline()` is untouched — this is an additional
export, not a rewrite; its two live call sites in `packages/reasoning` are not wired to it yet (tracked
as a kernel-warden follow-up). Dispatched to `tools-warden` per the team-ownership convention; parent
verified independently and a review pass caught two real bugs before commit: `healParamNames` (alias/
typo param healing) was silently skipped for every judgment-resolved call, and an unresolvable Choice
answer was reporting fabricated success instead of degrading to `succeeded: false`.

**Task 13 — closeout.** This debrief; changeset `.changeset/typesafe-judgment-primitive-phase-c.md`;
new `apps/docs/src/content/docs/features/judgment-layer.md` (both its code examples are real,
typechecked snippets, not skip-marked fragments); `builder-api.md` gained a `withJudgment` row plus an
expanded `withGuardrails` row for the 5 new fields; `AGENTS.md`'s dependency tree corrected for
`tools`/`guardrails`/`interaction` (all three gained a real `judgment` dependency this phase — plus a
pre-existing, unrelated drift on `interaction`'s `reasoning`/`observability` deps, fixed opportunistically
since it was the same line); `README.md` gained a judgment-layer bullet; `feature-matrix.ts`'s
uncovered-capability ratchet bumped 36→37 for the new `withJudgment` wither (bench has no ablation arm
for it yet — its shadow sites need real production data first, same reason Task 9/9b/11b's exit gates
are deferred).

## End-to-end verification (real, not unit-mocked)

Beyond each task's own unit tests, this closeout ran a genuine end-to-end smoke test through the real
builder → runtime → execution-engine → guardrail-phase chain (not a hand-constructed `Layer.mergeAll` in
a test file): `.withJudgment({backend:"llm"})` + `.withGuardrails({enableJudgmentBattery:true})`,
against the `test` LLM provider with a scripted `{json: ...}` turn.

1. `agent.judge()` returns the expected typed Noul answer.
2. `agent.judge()` without `.withJudgment()` throws the documented error.
3. A real `agent.run()` call with a paraphrased prompt-injection attempt (one the regex detector table
   does not match) is genuinely blocked, with exactly one `GuardrailViolationDetected` event fired —
   proving the full chain (builder → runtime → execution engine's `guardrail` phase → `GuardrailService`
   → `judgment-battery.ts` → `JudgmentService.ask()` → `llm` backend → `LLMService.completeStructured()`
   → test provider) wires correctly for a real agent, not just an isolated `GuardrailServiceLive` layer.

Full-repo gate (post-fixes): `bun test` → 9,578 tests / 9,546 pass / 25 skip / 4 todo / 2 fail (both the
pre-existing `as unknown as` cast-site ceiling gate, unrelated — confirmed via the same baseline
methodology as Tasks 8–10). `bunx turbo run build` → 38/38 clean. `check-cross-cutting.sh` → 12/12.
`check-version-sync.sh` → 35/35 packages match `VERSION=0.16.0`. `docs:sync:check` → all rules in sync.
`docs:examples:check` → 382 checked / 0 failed, skip count held at the existing 248 ceiling (the two
new judgment-layer.md examples were fixed to typecheck rather than skip-marked). `bun run docs:build` →
94 pages, all internal links valid.

One real, unrelated regression caught by the full-repo run: `packages/benchmarks/tests/feature-
coverage.test.ts`'s drift check failed because `withJudgment` (shipped in Task 8, predates this session)
was never classified in `FEATURE_MATRIX` — fixed by classifying it as an uncovered capability with a
gap reason, and bumping the ratchet ceiling 36→37 with a dated justification comment, matching the
project's existing ratchet-bump precedent.

## Deviations from the written plan

1. **Task 8(a):** sub-agent/`LightRuntimeOptions` path was NOT wired when Task 8 first shipped — flagged
   as a known gap. Partially closed this session: `createLightRuntime()` now honors `enableJudgment`/
   `judgmentOptions` when a caller passes them directly (fixes the guardrails-battery dead-wiring bug
   above). Still NOT closed: no parent→child inheritance chain exists (unlike `parentEnableGuardrails`),
   so a sub-agent spawned via `.withDynamicSubAgents()`/`.withAgentTool()` does not automatically inherit
   the parent's `.withJudgment()` config. Tracked as an open gap, not silently claimed fixed.
2. **Task 12:** not wired into any live kernel call site (`packages/reasoning`'s `act.ts`/`tool-
   observe.ts` still use the plain synchronous healer) — explicitly out of scope for the tools-scoped
   dispatch; a kernel-warden follow-up.
3. **Every Step-4 exit gate across Tasks 9/9b/10/11b** (invert-a-shadow decisions) remains NOT STARTED —
   all need real production shadow-agreement data before an inversion (or, for 11b, even a written
   inversion task) is justified. This is the plan's own explicit gate, not an oversight.

## Verification summary

| Gate | Result |
|---|---|
| Full `bun test` | 9,546 pass / 25 skip / 4 todo / 2 fail (pre-existing, unrelated) |
| `bunx turbo run build` | 38/38 clean |
| `check-cross-cutting.sh` | 12/12 |
| `check-version-sync.sh` | 35/35 |
| `docs:sync:check` | all rules in sync |
| `docs:examples:check` | 382 checked, 0 failed, skip ceiling unchanged (248) |
| `docs:build` | 94 pages, all links valid |
| End-to-end smoke (real builder→runtime→engine chain) | 3/3 pass |

**Not yet shipped as a release** — everything in Phase C is committed on `dev`, no PR opened, no tag cut.
