---
title: E2E + Performance Bottleneck Findings (post-refactor)
date: 2026-05-29
status: findings
branch: restructure/canonical-refactor-2026-05-28
related: [[project_canonical_refactor_2026_05_28]]
---

# E2E + Performance Bottleneck Findings

Investigation after the canonical refactor + corrections. Goal: prove the framework works end-to-end on real workloads (incl. MCP) and find what's left causing perf issues.

## E2E health — GREEN

| Surface | Result |
|---|---|
| Offline smoke (deterministic provider) | 44/44 pass, 6 xfail |
| Live ollama qwen3.5 — simple-agent | ✓ correct, 811tk, 2 steps, 12s |
| Live — builtin-tools (file write/read) | ✓ `BUILTIN_TOOLS_VERIFIED`, 6 steps |
| Live — token-streaming | ✓ |
| Live — reasoning-strategies (8-iter tool loop) | ✓ (witness) |
| **GitHub MCP spot-test** (docker + real repo) | ✓ fetched 10 commits, categorized, wrote markdown, self-critiqued, clean MCP teardown |
| Full unit suite | 1438 reasoning / ~5790 repo, 0 fail |

MCP works end-to-end: docker stdio transport → tool discovery → multi-iteration tool-calling → session disconnect, all clean.

## Framework overhead — LOW (refactor introduced NO perf regression)

Controlled variants (`apps/examples/scratch-perf.ts`, warm model, 1-step task):

| Metric | Value | Verdict |
|---|---|---|
| `build()` (layer composition incl. `finalizeComposition`) | 50–126ms | ✓ cheap |
| baseline warm unaccounted (simplest path) | 27ms (4%) | ✓ Effect runtime overhead minimal |
| per-phase dispatch (bootstrap/verify/audit/etc.) | ~1ms each | ✓ |
| memory layer build delta (V2−V1) | 2ms | ✓ |
| memory-flush on 1-step run | ~0ms (trivial-skip) | ✓ |

The 10-capability phase pipeline, the decomposed kernel (iterate-pass phase-steps), and the single `finalizeComposition` widening boundary all add negligible overhead. **WS-1..6 + corrections did not regress runtime performance.**

## Real bottlenecks (model-loop-driven + scaling — NOT the refactor)

### B1 — Stall detection fires late (~8 iterations)
Weak local models (qwen3.5) loop on multi-step tasks. On a 3-logical-step task (write→read→count) the agent ran **20 steps / 8 stalled iterations** before `[harness-deliverable]` recovery + `[output-gate]` synthesis fired. Each stalled iteration = a wasted LLM call + context growth.
- **Lever:** detect repeated no-progress earlier (e.g. 3–4 identical-signature iterations) and short-circuit to deliverable assembly. Loop-detector streak rule exists (`maxConsecutiveThoughts: 3`) but the stall→deliverable handoff waits ~8.
- Evidence: `scratch-perf` run 1 — 20 steps, 21458 tokens, 62.9s; harness-deliverable assembled after 8 stalls.

### B2 — Context bloat from loops (93% input tokens)
On the 20-step run: **17199 input vs 1188 output tokens** — full message history re-sent every iteration; stalls multiply it. Context curation exists but the loop outpaces it.
- **Lever:** tie compression more aggressively to iteration count / input-token growth (the `CompressionRecommendation` → curator path from #119 exists; it could trigger sooner under stall).

### B3 — memory-flush scales with conversation size
`memory-flush` runs `MemoryExtractor.extractFromConversation` over the **full message history** (O(conversation)). ~0ms on 1-step, **5.3s on the 20-step bloated run**.
- Mitigated already: trivial runs skip; moderate runs fork it as a non-blocking daemon (MOVE-3). But complex runs run it **blocking**.
- **Lever:** cap extraction input window, or always-daemon the flush, or skip extraction when the run stalled (low-signal conversation).

## Correctness edge (pre-existing, verifier-guarded — NOT a refactor regression)

On the failed V3 loop, the verifier rejected the output: `output-not-harness-parrot ... rationale-XML wrapper (think.ts strip regression)`.

- **Provenance verified:** strip line `think.ts:696` (`stripRationaleBlocks`) is from commit `1449c2dcd` (2026-05-23) — **predates this refactor branch**. Phase 6 commits (`85431889`, `d60df1ca`) never touched it. C5's `stall-deliverable.ts` extraction (`6814d94b`) was behavior-preserving (1438=1438).
- **Root cause (pre-existing architectural gap):** HS-105 moved rationale-strip to the producer (`think.ts:696`) and made `output-assembly` an identity shim — single-chokepoint-strip. But the **stall-recovery fallback** (`stall-deliverable.ts` assembling raw `_tool_result_*` artifacts + thoughts after N stalls) does NOT route through the producer strip, so markup can leak there.
- **Safety net works:** the verifier's `output-not-harness-parrot` producer-regression alarm catches it → `severity: reject` → output suppressed → user never sees markup (run terminates cleanly as failed). `verifier.test.ts` 41/41 pass.
- **Follow-up (filed):** route the stall/fallback delivery path through `stripRationaleBlocks` (or a shared `sanitizeForDelivery` chokepoint), so the single-chokepoint assumption holds on ALL delivery paths — not just the producer.

## Net

- Framework is E2E-healthy incl. real MCP; refactor added zero perf overhead.
- The "performance issues" are **model-loop economics** (stalls → token bloat → latency) and **memory-flush scaling**, not framework structure.
- Three tuning levers (B1 earlier stall cutoff, B2 stall-triggered compression, B3 flush windowing) + one correctness follow-up (fallback-path strip chokepoint).
- All are independent, non-blocking, and orthogonal to the merge.

Harness: `apps/examples/src/research/perf-bottleneck-isolation.ts` (renamed from `scratch-perf.ts` 2026-06-01; controlled-variant timing probe retained for re-measurement).
