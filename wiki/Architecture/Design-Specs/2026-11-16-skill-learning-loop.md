---
type: design-spec
status: draft
created: 2026-11-16
tags: [skills, learning, reactive-intelligence, memory, tiers, distillation, cortex]
---

# Skill learning loop: experience in, validated tier-sized skills out

Owner direction 2026-11-16: strengthen skill primitives so skills improve from experience (our own take on Hermes-style self-evolving skills), adapt one skill to model tiers (a frontier-grade skill distilled for a small model), and fuse memory layers, past traces and RI data into accelerated, specialised learning. Rule: framework primitive first, Cortex only renders and operates it (see `2026-11-16-plan-execute-posture-robustness.md`). Method rule: a mechanism ships only on measured lift (`01-RESEARCH-DISCIPLINE.md`, ablation-warden bar) and after a zero-token spike.

## Where things stand (verified by read-only map, 2026-11-16)
- **Schema and store exist.** `core/types/skill.ts` `SkillRecord`: versions, `versionHistory` (candidate|active), confidence tentative|trusted|expert, `evolutionMode`, `modelAffinities`, `contentVariants {full, summary, condensed}`. `memory/services/skill-store.ts`, `skill-evolution.ts` (`refine`, `checkRegression`, `checkPromotion`, `generateVariants`).
- **Outcome credit is binary and thin.** `runtime/engine/finalize/skill-outcomes.ts` feeds only the debrief `runOutcome` plus used skill names; no entropy, token, tier or failure-cause signal. `avgPostActivationEntropyDelta` and `avgConvergenceIteration` exist in the schema; nothing verified populates them.
- **Refine is manual** (`agent.refineSkills()`), evidence is episodic summaries only, and a candidate goes live immediately, judged only by the post-hoc regression rollback. No shadow, A/B or held-out check.
- **Tier primitives are unwired.** `Tier = local|mid|large|frontier` and per-tier budgets exist (`core/contracts/capability.ts`, `context-engine.ts`). `SkillTierBudget` and `SkillVerbosityMode` are types with no consumer. `compressSkillContent` / `getDefaultCompressionStage(tier)` (RI `skills/skill-compression.ts`) have no runtime caller. `contentVariants` is global, never chosen by tier, and read only by the SKILL.md export.
- **Experience is tool-param level.** `ExperienceSummary` holds working params and tool error patterns; `ExperienceRecord.errors[{tool,error,recovery}]` and `modelTier` exist. RI skill synthesis emits a config recipe (strategy/temperature), not a textual procedure.
- **RI aggregation is per model, not per skill.** Community profiles and signed telemetry carry model calibration; skills do not consume them.
- **Raw material for mining exists.** Traces (`~/.reactive-agents/traces/<runId>.jsonl`), `rax-diagnose attribute/cause`, `packages/replay` (scripted re-run), `benchmarks/replay-*`. No failure-to-recovery pair extractor.
- **Cortex.** Living skills tab (list, events, refine, rollback, mode, diff) and read-only Memory Studio. Docs mark the UI and schema "not finalized".
- **Prior art.** `Audit-Reports-2026-11-03/oss-harness-landscape.md` (Hermes): adapt a deterministic curator prune; a review fork only opt-in and only after an ablation (does run N+1 beat run N?).

## The loop
```
experience  ->  distill  ->  candidate  ->  validate  ->  promote | reject  ->  tier-fit  ->  serve
(traces,RI,     (failure->   (versioned,    (held-out     (gated, with     (per-tier   (resolver picks
 episodic,       recovery     origin =       replay +      rollback)        variants)    variant by budget)
 sandbox runs)   pairs)       evidence ids)  shadow)
```

### Stage 1 — Experience (framework, memory + RI + trace)
One `ExperienceEvidence` record per episode: task type, tier/model, outcome, ordered failure->recovery pairs (tool, error class, what fixed it), skills active, entropy delta, iterations, tokens, trace id. Sources, same shape: live runs (finalize), recorded traces (offline miner over `loadTrace`), replay/sandbox runs, and (opt-in, anonymised) RI community aggregates keyed by skill content hash and task type. Deterministic extraction first; no LLM to find a pair (AGENTS.md rule 5).

### Stage 2 — Distill (the only LLM step)
Input: >=N failure->recovery pairs for one task type + current skill. Output: a candidate procedure with provenance (`evidenceIds`). Frontier model distills; the small model never self-distils its own failures unchecked. Replaces the single-episodic-summary refine. Triggered by evidence count or idle, never per run; opt-in (`evolutionMode`).

### Stage 3 — Validate (what the framework lacks today)
A candidate is `candidate` until it passes: (a) **held-out replay**: re-run recorded tasks not used in distillation with the candidate on a scripted/real small model; (b) **shadow**: live runs sample-activate it and compare outcome to control; (c) accept rule stated first (>=3pp lift or >=15% fewer calls at no accuracy loss, <=15% token overhead). Reject keeps the evidence so the same pair is not re-distilled. Existing `checkRegression` stays as the live backstop.

### Stage 4 — Tier-fit
Per skill, `variants[tier]` (local|mid|large|frontier), each with its own validation result. Distillation target = the tier's `SkillTierBudget` (token budget, verbosity mode, examples on/off). Reuse the 5-stage `skill-compression.ts` as the deterministic floor; an LLM rewrite is a candidate like any other and must pass Stage 3 **on that tier's model**. A smaller variant that does not lift is dropped, not served (fall back to catalog-only).

### Stage 5 — Serve
`skill-resolver` chooses the variant by the run's tier and remaining context budget (wire `getDefaultCompressionStage` / budgets; emit `SkillSkippedContextFull` when nothing fits). Deterministic curator prunes stale, low-use, or conflicting skills.

### Sandboxed training (optional Stage 0)
Generate N tasks for a use case, run them in a sandbox (replay tool tables + fixture/real sandboxed tools), grade with deterministic verifiers where the task has one (tests pass, file diff, schema), judge otherwise. Output feeds Stage 1. Needs a trustworthy grader per use case; no grader, no training. Hold out a task split to prevent generator overfitting.

## Where it lives
| Concern | Package |
|---|---|
| `SkillRecord.variants[tier]`, `ExperienceEvidence` types, events (`SkillCandidateCreated/Validated/Rejected`) | core |
| store, candidate lifecycle, curator, variant storage | memory |
| trace miner, evidence builder, distiller, validation runner, tier compression wiring, resolver variant choice | reactive-intelligence (+ replay for held-out runs) |
| outcome credit enrichment (entropy delta, tokens, tier, failure causes) | runtime (finalize) |
| graders for sandbox tasks | eval / verification |
| UI: evidence view, candidate diff + validation result, per-tier variant tabs, promote/reject, training-run launcher | cortex (render and operate only) |

## Phases (each one concern; ablation where a default changes)
0. **Spike, zero tokens (gate for everything below).** Offline miner over existing traces: how many failure->recovery pairs exist per task type; do they recur? If few or non-recurring, stop and re-scope. Output: counts + 10 hand-read examples in `wiki/Experiments/`.
1. **Evidence + enriched outcomes.** `ExperienceEvidence`, populate entropy delta / convergence / tier / failure causes; trace miner CLI (`rax-diagnose pairs`). harness-warden (miner) + runtime + core.
2. **Tier variants, deterministic.** Wire `compressSkillContent` + `SkillTierBudget` into the resolver; `variants[tier]` from compression only (no LLM). Ablation: skill served compressed vs full on `local`/`mid` tiers. kernel/RI + memory + core.
3. **Distill + validate.** Evidence-driven distiller, candidate lifecycle with held-out replay and shadow gate, reject memory. RI + memory + eval. Ablation: run N+1 vs run N on a repeated-task suite (Hermes rule).
4. **Tier-aware distillation.** Frontier-to-small rewrite validated per tier. Ablation across >=2 tiers.
5. **Cortex.** Evidence, candidate review, variant tabs, promote/reject; then the training-run launcher.
6. **Sandbox training + collective (opt-in).** Generated tasks + graders; community aggregates per skill hash, privacy review first.

## Risks and guards
- Goodhart: distilled skills overfit the generator or grader -> held-out split, deterministic graders first.
- Skill bloat: each skill must pay its context tokens; curator prunes; budget-gated serving.
- Self-distillation drift: frontier distils, small model validated, never the reverse unchecked.
- Privacy: community data off by default, content-hash keyed, no task text.
- Attribution noise: Bernoulli cells (~13pp SE at 5x5) -> n and significance per the project bench rules before any default change.

## Phase 0 result (2026-11-17): RE-SCOPE
Report: `wiki/Experiments/2026-11-17-skill-learning-phase0.md`. 3,744 traces (1,306 real-model), 563 failure episodes, 351 usable recoveries in 170 runs; 13 recurring groups, but they are recurrences of tool-surface faults (shell allowlist/sandbox, empty args, todo unknown action, umami metrics args), not multi-step procedures; of 12 hand-read pairs 1 was skill-worthy, 5 harness/config-fixable, 6 model quirks. `ExperienceStore` is effectively empty today. Consequences for this spec:
- Phase 1 narrows to the **evidence layer only** (`ExperienceEvidence` + `rax-diagnose pairs` miner, harness-warden); the learned unit is a **tool-usage note** (tool, error class, corrected shape) before it is a skill.
- Recurring tool-surface faults go to their domain wardens as guards first (shell allowlist in the description + empty-command guard, empty-args guard for web-search/crypto-price, todo action hint, rooted-path heal, approval-handler default); several are already fixed (3aedf6c2e, d9f4326dc).
- The distiller (Stage 2), validation (Stage 3) and tier-aware distillation (Stage 4) are held until recurring non-schema pairs persist after the guards land and `ExperienceStore` accumulates; re-run the miner then. Local tier has 10 usable pairs and there are no same-task small-vs-frontier pairs, so tier distillation has no evidence base yet.

## Non-goals
Fine-tuning model weights; a second skill format; per-run LLM refinement; making Cortex own any learning logic.
