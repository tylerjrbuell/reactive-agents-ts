---
title: APC-0 Discriminator — RA_MINIMAL_PROMPT bench (decides APC direction)
date: 2026-05-27
status: COMPLETE — empirical evidence drives APC-1 substrate design
related-spec:
  - "wiki/Research/Ablations/2026-05-27-mastra-comparison-honest-3way.md"
related-issues: ["APC-0", "APC-1", "APC-2", "APC-3", "APC-4"]
sample-size: N=1 per cell
---

# APC-0 Discriminator — RA_MINIMAL_PROMPT bench

## Question

Does stripping the iteration system prompt (RA_MINIMAL_PROMPT=1) close the Mastra token gap, or does output verbosity dominate and erase the savings?

## Method

```bash
RA_MINIMAL_PROMPT=1 BENCH_TIER=local BENCH_FRAMEWORKS=ra-lean,mastra bun runner.ts
```

- Tier: local (Ollama qwen3.5:latest)
- 11 tasks
- ra-lean arm = `.withProfile(HarnessProfile.lean())` + `RA_MINIMAL_PROMPT=1` (bypasses 8/9 prompt sections per `context-manager.ts:217`)
- Mastra arm = baseline

## Per-task delta (ra-lean vs ra-lean baseline 2026-05-27 12:48Z)

| Task | Baseline ra-lean | ra-MINIMAL | Mastra | Δ% vs baseline | Verdict |
|---|---|---|---|---|---|
| k1-france-capital (trivial) | 484 | **375** | 50 | **-22%** | input lever works |
| k2-typescript-paradigm | 683 | **654** | 210 | -4% | small win |
| k3-rgb-colors (trivial) | 578 | **499** | 83 | **-14%** | input lever works |
| c1-eventual-vs-strong (complex) | 1569 | **1182** | 1620 | **-25%** | RA undercut Mastra |
| m1-database-indexes | 1094 | **965** | 1386 | -12% | small win |
| f2-no-tool-knowledge-recovery | 630 | **490** | 109 | **-22%** | input lever works |
| t1-calculator-add (tool) | 4772 | **4494** | 1307 | -6% | tiny win |
| m2-version-then-cite (tool/multistep) | 5054 | **4784** | 861 | -5% | tiny win |
| **t2-web-search-cite (tool)** | **5341 ✓** | **12589 ✗** | 2568 | **+136% AND FAILED** | blowup |
| t3-kv-fetch (tool) | 4763 | **6757** | 339 | **+42%** | output rambling |
| f1-web-search-error (failure-recovery) | 12312 | **13626** | 1278 | +11% | output rambling |
| **Aggregate** | **37,280 (11/11)** | **46,415 (10/11)** | **9,811 (9/11)** | **+24% AND -1 quality** | **net worse** |

## Verdict

**Branch 3 + partial Branch 1** (per advisor matrix):

1. **Input-gating IS a real lever** — trivial tasks drop 14-25% with minimal prompt. The structured scaffold induces meaningful overhead that contributes nothing on factual/short prose tasks.

2. **Output verbosity dominates on tool/multi-step tasks** — removing scaffold blows up output by +42% to +136%. The guidance section is load-bearing for tool-failure recovery and multi-tool sequencing.

3. **Cannot ship as global default** — quality regression on t2 (passed → failed), aggregate 24% worse, and one task became catastrophically expensive.

## Implications for APC

| APC design element | Decision |
|---|---|
| TaskShape required | YES — global minimal is empirically broken |
| Conservative classifier defaults | YES — over-classifying trivial regresses quality |
| Tool/multi-step shape → full scaffold preserved | YES — `needsTools ∨ needsMultiStep` predicates retain ALL current sections |
| Per-section ablation gate | YES — APC-4 must ablate per-section per-shape, not globally |
| Output-control mechanism deferred | YES — separate concern; APC focuses input-gating where it's safe (trivial) |

## Refined APC-4 target

- **k1/k3/f2/c1/m1 (5 trivial tasks):** apply shape-gated minimal → expect ~5500t baseline drop to ~3500t (-37% on trivial subset, ~2-3× Mastra parity on these)
- **t1/t2/t3/m2 (4 tool tasks):** UNCHANGED — full scaffold, quality preserved
- **f1 (failure-recovery):** UNCHANGED — needs guidance section for retry semantics

Expected: 11/11 quality preserved, trivial subset saves ~2000t, aggregate 37,280 → ~35,000t (~3.6× Mastra). Modest but safe lift.

## Anti-pattern caught

Advisor (2026-05-27) flagged: APC-on-input alone cannot close the trivial output gap (Mastra emits ~30t for "Paris"; RA emits ~200-400t even with empty system prompt). Output-verbosity control is a separate mechanism (response-format constraint, tier-specific cap) deferred to MOVE-9 / post-APC.

## Cross-references

- [[2026-05-27-mastra-comparison-honest-3way]] — baseline ra-lean numbers
- [[2026-05-26-master-optimization-plan]] — APC fits as MOVE-7 successor (shape-gated, not global)
