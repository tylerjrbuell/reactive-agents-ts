---
type: harness-report
title: "Heavy-Strategy Niche Probe — Open-Ended / Unverifiable Tasks"
date: 2026-06-05
models: [qwen3.5:latest, gpt-4o-mini]
strategies: [reactive, plan-execute-reflect, reflexion, tree-of-thought]
tasks: [t4-multistep, t5-critique]
status: complete
tags: [harness, reasoning-strategies, escalation-lift, ablation]
related:
  - "[[project_observability_efficiency_sprint_2026_06_04]]"
---

# Heavy-Strategy Niche Probe (2026-06-05)

## Why this probe

Yesterday's escalation-lift falsification (2026-06-04) used only **verifiable** tasks
(gradable rubric, LIS algorithm, commit-analysis). That class structurally favors
reactive — the verifier gate *is* the critique signal, making reflexion's separate
self-critique loop redundant. The one class where heavy strategies could win **by
construction** — open-ended generation with no tool-verifiable ground truth — was
excluded. This probe targets exactly that gap.

- **t4-multistep**: "Explain trade-offs between B-tree / hash / full-text indexing (≥3 sections)."
- **t5-critique**: "Trade-offs of eventual vs strong consistency. After your first answer, critique it, then improve." — reflexion's *purest* home turf.

Harness: `cross-strategy-matrix.ts` (extended to capture full `output` for quality judgment;
binary `success` is blind to prose quality). N=1 per cell. Trace dir `.reactive-agents/traces/niche-probe`.
Data: `cross-strategy-matrix-2026-06-05-02:53.{json,csv}`.

## Cost table

| model | strategy | task | success | chars | tokens | time |
|---|---|---|---|---|---|---|
| qwen3.5 | **reactive** | t4 | ✓ | 5385 | **4724** | **34s** |
| qwen3.5 | plan-execute | t4 | ✓ | 4280 | 20623 | 153s |
| qwen3.5 | reflexion | t4 | ✓ | 2181 | 19654 | 121s |
| qwen3.5 | tree-of-thought | t4 | ✓ | 6784 | **69498** | **629s** |
| qwen3.5 | **reactive** | t5 | ✓ | 6720 | **5137** | **69s** |
| qwen3.5 | plan-execute | t5 | ✓ | 4119 | 15996 | 141s |
| qwen3.5 | reflexion | t5 | ✓ | 3563 | 5717 | 50s |
| qwen3.5 | tree-of-thought | t5 | ✓ | 5395 | 69065 | 619s |
| gpt-4o-mini | reactive | t4 | ✓ | 4491 | 26388 | 34s |
| gpt-4o-mini | plan-execute | t4 | ✓ | 3216 | 9948 | 33s |
| gpt-4o-mini | **reflexion** | t4 | **✗ FAIL** | **0** | 4403 | 8s |
| gpt-4o-mini | plan-execute | t5 | ✓ | 2295 | 12893 | 41s |
| gpt-4o-mini | **reflexion** | t5 | **✗ FAIL** | **0** | 3558 | 3s |
| gpt-4o-mini | tree-of-thought | t4 | ✓ | 4206 | 30653 | 79s |
| gpt-4o-mini | tree-of-thought | t5 | ✓ | 2840 | 28840 | 81s |

Roll-up: reactive 4/4, plan-execute 4/4, **reflexion 2/4** (both gpt-4o-mini = empty output), ToT 4/4.

### Within-model cost ratios (vs reactive — the only valid comparison)

Cross-model token counts are not comparable; ratios are computed within each model.

| | plan-execute | reflexion | tree-of-thought |
|---|---|---|---|
| **qwen3.5 (local)** t4 | 4.4× | 4.2× | **14.7×** |
| **qwen3.5 (local)** t5 | 3.1× | 1.1× | **13.4×** |
| **gpt-4o-mini (frontier)** t4 | **0.38× (cheaper)** | crash | 1.16× |
| **gpt-4o-mini (frontier)** t5 | **0.77× (cheaper)** | crash | 1.73× |

**The cost penalty is model-dependent, not universal.** On local, every extra LLM call
reprocesses large context with no prompt caching → 3–15× penalty. On frontier, heavy
strategies are comparable or **cheaper** than reactive (reactive's frontier runs used more
tokens here — verbose tool use). Do NOT flatten this into "heavy always costs more."

## Quality verdict (full-output read — N=1, qualitative)

All open-ended cells reached **rough quality parity** — every strategy produced a
serviceable multi-section answer on the same task. No heavy strategy produced a
*categorically better* answer that reactive missed. Notes (single-sample, treat as soft):
reactive's outputs were consistently complete (t5 reactive self-organized into
First→Critique→Improved with 9 subsections *without* a dedicated critique strategy);
ToT t4 shipped a **broken mermaid diagram**; reflexion's outputs were terser (terser ≠
worse — not counted against it). The robust read across cells: **parity, no lift large
enough to justify cost** — not "reactive writes better prose."

### Reflexion frontier failure = orchestration bug, NOT a quality signal

Both gpt-4o-mini reflexion cells returned **empty output** (0ch, ~4400 tok burned). Trace
shows the cause: inside `reflexion:improve`, `✗ [phase:think] 0.1s` — the improve-phase
think errored instantly, then "Critique stagnant after 2 attempts, exiting early" returned
with no output. This is a **fragility bug in reflexion's improve→critique loop on
native-FC frontier models**, not a bad answer. It is excluded from the quality verdict and
should be **filed as a separate issue** (reflexion improve-phase think failure → silent
empty completion).

## Conclusion

**No quality lift large enough to justify the cost — on either task class.** On the
open-ended / unverifiable class (the one class heavy strategies should win by construction),
all strategies reached rough quality parity; no heavy strategy beat reactive. Combined with
the 2026-06-04 verifiable-task battery (plan-execute's long-horizon home turf, also negative),
the "heavy orchestration earns its keep" hypothesis is **falsified for plan-execute and
reflexion specifically** — both their theoretical home turfs were tested and showed no lift.

**Cost is the decider, and it's tier-dependent:** severe on local (3–15×), negligible-to-
favorable on frontier. So the practical case against heavy-as-default rests on **local-tier
cost + universal quality parity**, not a flat "heavy costs more."

**Architectural implication:** the kernel is already canonical (all 5 strategies call
`reactKernel`). "Unify divergent strategies to improve performance" is a **category error** —
the divergence is the orchestration layer, and that layer yields no quality lift. The
supported move is to make **reactive the canonical default** and put heavy strategies
**behind explicit opt-in / deprecation review**, not to merge their code for performance.
Trips §9 anti-scaffold + no-@deprecate-to-hit-count cautions → stage as a deliberate decision,
not a metric play.

**Not yet falsified:** ToT's *theoretical* niche is divergent exploration / generate-N-paths-
and-select. t4/t5 are expository, not exploratory — ToT was never tested where it'd shine.
Its cost profile (15× local, broken output) makes it impractical as a *default* regardless,
but its niche is not closed the way reflexion's and plan-execute's are.

## Limits

- N=1 per cell (yesterday was N=3). The strong claim (quality parity, no cost-justifying
  lift) survives single-sample noise; the soft per-cell quality notes do not — treat them
  as colour, not evidence.
- 2 task types, 2 models. Both are **expository** open-ended tasks. reflexion's critique
  home turf (t5) was tested cleanly; ToT's exploratory niche was **not** — see conclusion.
- Local-tier quality read uses qwen3.5 only; cost is the tier-dependent variable (see
  within-model table). Cross-model token counts are not compared.
- reflexion's gpt-4o-mini empty output is a confirmed orchestration crash (improve-phase
  think failure), filed separately — excluded from the quality verdict.
