# Harness Bench Comparison — main vs feat/phase-1-sprint-2-invariant-curator

**Date:** 2026-04-27  
**Session:** `local-models` (real-world tasks rw-2, rw-3, rw-6, rw-8, rw-9)  
**Sample:** 5 tasks × 2 models × 2 variants × 3 runs = 60 task runs per ref

| Ref | SHA | What's in it |
|---|---|---|
| main baseline | `839f706d` | Last main commit before branch — pre-everything |
| current HEAD | `14135d6d` (+ memory commit `7c508ee4`) | 92 commits including: Sprint 3.4 (step type separation), Sprint 3.5 (verifier as capability), Sprint 3.5 Stage 2 (verifier-driven retry), Sprint 3.5 Stage 2.5 (control-pillar override hooks), Sprint 3.6 (diagnostic system), parrot leak fix, output ownership consolidation, etc. |

## Headline finding — harness lift (ra-full − bare-llm) per ref

| Model | MAIN lift | HEAD lift | Improvement |
|-------|-----------|-----------|-------------|
| cogito-8b | **+0.01** (no benefit) | **+0.24** | **+0.23** |
| qwen3-4b | **-0.17** (harness HURT performance) | **+0.06** | **+0.23** |

**On main, the harness was a wash on cogito-8b and actively harmful on qwen3-4b.**  
**On HEAD, the harness adds measurable lift on both tiers, uniformly +0.23 better than main.**

## Methodological note on absolute scores

Direct score comparison across refs is unreliable. The bench's LLM judge runs as an agent (`ReactiveAgents.create()...build()`), so when 92 commits restructure the agent code, the judge behavior changes too. Symptom in the data: MAIN scores show fine-grained granularity (0.1, 0.15, 0.35, 0.75) while HEAD scores show categorical 0/0.5/1, indicating a different judge prompt/response shape.

**Lift remains comparable** because both variants run through the same judge within a ref.

## Token cost

| Model | Variant | MAIN tokens | HEAD tokens | Δ |
|-------|---------|-------------|-------------|---|
| cogito-8b | bare-llm | 662 | 858 | +30% |
| cogito-8b | ra-full | 16925 | 27706 | **+64%** |
| qwen3-4b | bare-llm | 2263 | 1915 | -15% |
| qwen3-4b | ra-full | 13607 | 13918 | +2% |

cogito-8b's harness cost went up significantly. Likely sources: verifier-driven retry firing more often, retry signals adding iterations, additional verification gate. **Worth it given lift went from 0 → +0.24.** qwen3-4b's cost held flat with similar lift improvement — pure win.

## Caveats

1. **Small sample.** 5 tasks × 3 runs = 15 data points per cell. Directional, not statistically powered.
2. **Local tier only.** Frontier models (claude-haiku, gemini-2.5-flash) untested. Whether harness improvements port to frontier remains an open question — frontier models may have different failure modes the harness doesn't address.
3. **Judge change confound.** Absolute scores aren't comparable; only within-ref lift is. Future bench compares should pin a stable judge by checking out the bench package separately.
4. **No statistical test.** No p-values, no confidence intervals. The +0.23 improvement is consistent across both models (different tasks have different complexities), which is suggestive evidence the win is real — but a longer run with `runs: 10+` would be more conclusive.

## Implications for North Star plan

- The branch's harness work is empirically validated as net-improvement across local-tier models.
- The "did this session help?" question we couldn't answer earlier is partially answered: the cumulative branch work helps. We can't yet attribute the +0.23 lift to specific commits without ablation runs at intermediate SHAs.
- **Pre-merge to main:** worth running `local-models` with `runs: 10` for tighter CIs, plus adding a frontier model to confirm no regression there.
- **Pre-ship (v0.10+):** wire `regression-gate` (claude-haiku) into CI so future commits get this signal cheaply.

## Files

- `bench-MAIN-839f706d.json` — main baseline run
- `bench-HEAD-14135d6d.json` — current branch HEAD run
- This summary
