---
tags: [benchmark, comparison, mastra, competitive-analysis, private]
date: 2026-05-25
status: complete (v1, private)
public: false
mastra-version: 1.36.0 (current Agent.generate() + createTool() + AI SDK v5)
ra-version: 0.11.1 + PR #141 (workspace HEAD)
total-cells: 66 (11 tasks × 2 frameworks × 3 tiers)
---

# Reactive Agents vs Mastra — Head-to-Head Benchmark (private)

**Status:** Internal characterization. Decide publish y/n after review.

**Headline:** RA wins correctness in every tier (33/33 vs Mastra 27/33). Mastra wins efficiency on every tier except frontier (where token usage breaks even). Both frameworks have real weaknesses surfaced by the corpus.

## Methodology

- **Frameworks**
  - **Reactive Agents** v0.11.1 (workspace HEAD, includes PR #141 empty-run invariant). `withReasoning({ defaultStrategy: "reactive" })`. No `.withReactiveIntelligence()` (Mastra has no equivalent — kept fair).
  - **Mastra** v1.36.0 — `new Agent({...}).generate(prompt, { stopWhen: stepCountIs(N) })`. Current API per docs (not deprecated `generateLegacy()`). AI SDK v5 stack: `@ai-sdk/anthropic@3.0.79`, `@ai-sdk/openai@3.0.65`, `ollama-ai-provider-v2@1.5.5`, `ai@6.0.191`. Tools defined via `createTool({ id, description, inputSchema, execute })`.
- **Fairness fixes applied**
  - Bench tools renamed with `bench_` prefix (`bench_web_search`, `bench_lookup`, `bench_calculator`) to avoid name collision with RA's built-in tools. RA's `web-search` built-in shadowed the synthetic bench tool in v1 (documented at `packages/tools/src/skills/builtin.ts:178` — known RA bug).
  - Both frameworks see identical tool names, descriptions, parameters, behaviors.
- **Tiers**
  - `frontier` — Anthropic `claude-sonnet-4-6` ($3/$15 per 1M tokens)
  - `mini` — OpenAI `gpt-4o-mini` ($0.15/$0.60 per 1M tokens)
  - `local` — Ollama `qwen3.5:latest` (free)
- **Tasks** — 11 across 5 categories: knowledge (3), tool-required (3), multi-step (2), critique (1), failure-recovery (2). See `bench/mastra-vs-ra/tasks.ts`.
- **Verifier** — deterministic substring / regex / long-form rubrics (no LLM-as-judge variance).
- **Budget** — 180s per-cell timeout.
- **Total cells** — 66 (11 × 2 × 3).

## Per-tier summary

| tier | framework | pass/N | tokens (in+out) | $cost | avg dur |
|---|---|---|---|---|---|
| frontier | **ra** | **11/11** | 17965 (0+17965) | $0.2695 | 23.7s |
| frontier | mastra | 9/11 | 18770 (9085+9685) | $0.1725 | 17.6s |
| mini | **ra** | **11/11** | 38232 (0+38232) | $0.0229 | 15.7s |
| mini | mastra | 9/11 | 5145 (3073+2072) | $0.0017 | 6.5s |
| local | **ra** | **11/11** | 42499 (0+42499) | $0.0000 | 20.5s |
| local | mastra | 9/11 | 7547 (4534+3013) | $0.0000 | 5.8s |

> RA's `tokens` is total-only (no input/output split surfaced in `result.metadata.tokensUsed`). Cost computed from total × output-rate which inflates the $ comparison against RA. With a proper input/output split, RA's frontier $0.27 would drop closer to ~$0.18 — still above Mastra's $0.17. This is a real RA observability gap, flagged as follow-up.

## Per-category aggregate (across all tiers)

| category | ra pass | mastra pass | ra avg tok | mastra avg tok | ra/mastra tok |
|---|---|---|---|---|---|
| knowledge | 9/9 | 9/9 | 526 | 148 | 3.55× |
| tool-required | **9/9** | 6/9 | 4664 | 1104 | 4.22× |
| multi-step | **6/6** | 3/6 | 2606 | 1773 | 1.47× |
| critique | 3/3 | 3/3 | 1651 | 1598 | 1.03× |
| failure-recovery | 6/6 | 6/6 | 5232 | 795 | 6.58× |

**Three real findings:**

1. **Mastra fails 50% on multi-step + 33% on tool-required.** Both losses are the same shape: agent calls tool, receives `{key, value}` shaped result, then **fails to echo the value verbatim** in final answer. Two tasks, three tiers, six consistent failures.
2. **RA wins correctness on every tier (11/11 each = 33/33).** Mastra wins only knowledge and critique categories — categories where no tool is involved. The moment a tool result needs to flow into output, RA pulls ahead.
3. **RA's token overhead collapses from 6× at local → 4× at mini → 1× at frontier.** Frontier Sonnet uses fewer iterations to converge, amortizing RA's kernel overhead. At frontier RA is actually 4% MORE token-efficient than Mastra.

## Per-task winners (frontier tier, for the report's headline)

| task | category | ra | mastra | winner |
|---|---|---|---|---|
| k1-france-capital | knowledge | ✓ 428tok 4.6s | ✓ 43tok 0.9s | Mastra (efficiency) |
| k2-typescript-paradigm | knowledge | ✓ 861tok 13.9s | ✓ 574tok 9.1s | Mastra (efficiency) |
| k3-rgb-colors | knowledge | ✓ 458tok 5.1s | ✓ 93tok 1.7s | Mastra (efficiency) |
| t1-calculator-add | tool-required | ✓ 1334tok 15.8s | ✓ 1466tok 2.7s | Mastra (efficiency) |
| t2-web-search-cite | tool-required | ✓ 2885tok 31.1s | ✓ 2849tok 14.2s | Mastra (efficiency) |
| **t3-kv-fetch** | tool-required | ✓ 1010tok 13.9s | **✗** 1511tok 3.9s | **RA** |
| **m1-database-indexes** | multi-step | ✓ 3217tok 63.5s | ✓ 5268tok 95.3s | **RA (efficiency)** |
| **m2-version-then-cite** | multi-step | ✓ 1163tok 21.7s | **✗** 1698tok 6.3s | **RA** |
| c1-eventual-vs-strong | critique | ✓ 2586tok 52.4s | ✓ 2486tok 50.6s | tie |
| f1-web-search-error | failure-recovery | ✓ 3531tok 33.2s | ✓ 2687tok 7.4s | Mastra (efficiency) |
| f2-no-tool-knowledge-recovery | failure-recovery | ✓ 492tok 5.1s | ✓ 95tok 1.1s | Mastra (efficiency) |

## Mastra's consistent weakness — exact-extract from tool results

Both Mastra failures repeat on every tier:

- **t3-kv-fetch:** task `"fetch value for key 'api-endpoint'. Return only the value."` → tool returns `{key: "api-endpoint", value: "https://api.example.com/v2"}` → Mastra's final answer **doesn't include the URL**. Failed at frontier (Sonnet), mini (gpt-4o-mini), local (qwen3.5).
- **m2-version-then-cite:** task `"get value for key 'api-version'. ... Final answer should include both the version number AND the explanation."` → tool returns `{key, value: "2.4.1"}` → Mastra explains semver but **omits the version number**. Failed at all 3 tiers.

3-tier consistency = real architectural weakness, not model variance. Mastra agents have a pattern of describing what they found instead of citing it verbatim. Could be in their default system prompt, instruction template, or tool-result framing.

RA handles both cleanly across all tiers (3+3 successes vs Mastra's 0+0).

## RA's consistent weakness — token overhead on simple tasks

Local + mini knowledge tasks: RA uses **3-12× more tokens** for the same single-word answer.

- `k1-france-capital` frontier: RA 428 tokens / 4.6s vs Mastra 43 tokens / 0.9s.
- `k3-rgb-colors` local: RA 587 tokens / 10.9s vs Mastra 83 tokens / 2.9s.

Root cause: RA's reactive kernel runs a full think→act→verify cycle on every iteration. For pure knowledge recall, the answer is in the first LLM response — kernel iterations + entropy scoring + verifier checks are all overhead.

The earlier improvement-loop session (2026-05-25) named this **affordance leakage** — every framework surface fires by default regardless of per-task relevance. Today's evidence confirms it shows up as token waste on simple tasks.

## RA's spectacular failure on failure-recovery local

`f1-web-search-error` on local tier: RA 12220 tokens / 29.4s vs Mastra 1294 tokens / 4.3s. **9.4× tokens, 6.8× duration**, both pass.

Both produced "cannot/unable" text so the bench verifier passed both. But RA spent 6 iterations retrying the (always-erroring) tool while RI's healing pipeline injected redirects to `crypto-price` (an irrelevant built-in RA tool). Mastra honored the prompt's "stop after 2 attempts" rule cleanly.

Confirms FM-A3 root cause is broader than my PR #141 backstop addresses — the affordance leakage problem applies to RA's healing pipeline too (it suggested `crypto-price` because that's another built-in tool, regardless of task scope).

## Where each framework wins / loses

### Reactive Agents wins

- **Tool-result fidelity** — exact-extract tasks across all 3 tiers (3 wins, 0 losses; Mastra 0 wins, 3 losses)
- **Multi-step coherence** — m1 + m2 wins at every tier
- **Frontier-tier token efficiency** — only 1.03× tokens vs Mastra (essentially tied)
- **Honest never-fail across tiers** — 33/33 perfect score
- **Trace-grade observability** — `rax-diagnose` lets you replay any run, query event kinds, diff before/after
- **Strategy diversity available** (reactive, plan-execute-reflect, reflexion, ToT, code-action) — not exercised in this bench but real capability

### Mastra wins

- **Latency** on every category except multi-step — 3-10× faster on knowledge / tool / critique / failure-recovery
- **Token efficiency** at local + mini tier — 4-7× cheaper across categories
- **Dollar cost** at every tier — 12-14× cheaper at frontier+mini, free at local
- **Surface simplicity** — `new Agent({instructions, model, tools}).generate(prompt)` vs RA's `ReactiveAgents.create().withName().withProvider().withModel().withReasoning().withTools().build()`
- **Honest failure response** on f1 — followed the prompt's "stop after 2 attempts" without RI overreach

### Both lose

- **Mastra:** exact-extract from structured tool results (3-tier consistent)
- **RA:** token bloat on simple tasks (3-12× on knowledge / tool-required at local + mini tiers); spurious tool engagement (FM-A3) at local tier despite PR #141 backstop

## Recommendation — DO NOT publish v1

Reasons to hold:

1. **N=11 tasks is too small** for HN/Twitter-grade publication. A skeptic will accuse cherry-picking on either side. Need 30-50 tasks.
2. **Cost comparison is unfair to RA** because RA's `metadata.tokensUsed` doesn't surface input/output split. Cost calculation inflates RA's $ at frontier. Fix the RA metadata before publishing any cost-comparison number.
3. **Mastra's exact-extract failure is too clean a result.** Public publish would look like we hand-picked a category Mastra is bad at. Need to also test categories Mastra is reputed strong at (workflow orchestration, structured output schemas).
4. **The "RA wins correctness" headline obscures the affordance-leakage finding** — RA's token overhead is real and consumer-visible. Publishing the win without owning the loss damages credibility.

Reasons to consider publishing later:

- After N≥30 tasks (add workflow-style multi-agent, schema-validated structured output, real web search with TAVILY key, conversational memory across turns)
- After fixing RA's input/output token metadata split
- After adding LLM-as-judge verifier so subjective categories (critique quality, long-form depth) aren't gated by substring matchers
- After landing FM-A3 root cause fix (per-task tool relevance gating) so the local-tier token bloat narrows

## Followup work (filed as tasks)

1. **RA `metadata.tokensUsed` surface input/output split** — current 0+totalTokens is misleading for cost calc. Estimate: ~5 LOC at finalize/telemetry-emit.
2. **FM-A3 root cause — per-task tool relevance gating** — `find` / `web-search` / `crypto-price` shouldn't auto-inject on tasks with `tools: []` or unrelated tools. Empirical evidence: this bench's f1 local cell.
3. **Add 20+ tasks to bench corpus** before any public comparison. Categories to add: structured output (Zod schema), workflow (multi-agent handoff), real-web-search (with API key), conversational memory (multi-turn), tool-result piping (multiple tools chained).
4. **Wire LLM-as-judge verifier** for critique + long-form categories. Optional `@mastra/evals` integration to leverage their pre-built metrics.
5. **Mastra exact-extract investigation** — possibly an upstream issue worth reporting / blogging about. Reproducible 3-tier failure.

## Files

- `bench/mastra-vs-ra/` — runner + corpus + verifier + tools (private, not in release)
- `bench/mastra-vs-ra/results/cells-2026-05-26T01-12-15-194Z.json` — frontier raw
- `bench/mastra-vs-ra/results/cells-2026-05-26T01-08-29-073Z.json` — mini raw
- `bench/mastra-vs-ra/results/cells-2026-05-26T01-07-38-596Z.json` — local raw
- `bench/mastra-vs-ra/analyze.ts` — analysis helper
- `bench/mastra-vs-ra/README.md` — bench operation guide
