---
type: harness-report
status: complete
created: 2026-11-17
tags: [harness, reasoning-strategies, model-size, docs-claims, evidence-audit]
---

# Strategy fit by model size: evidence audit for three docs claims

Method: zero-token mining of existing reports and ledgers. No live probe was run (Ollama is up, but the gaps below need a designed multi-strategy x <=8B campaign, not a one-off cell; a single probe would be n=1 Bernoulli noise). Every number below is quoted from the cited file; none was re-measured here.

## Bottom line

- No measurement in this repo shows any heavy strategy (reflexion, plan-execute-reflect, tree-of-thought) beating reactive on quality at any tier. Where tested, the result is parity at 1.1x to 23x the tokens or wall-clock on local models.
- No measurement exists that rates reflexion or plan-execute as "Poor", "Fair" or "Good" at a given size. The tier table in `choosing-strategies.mdx` is unsourced. The prose and the table both lack evidence; the table is not more right than the prose.
- Recommending plan-execute-reflect for local models is contradicted by the evidence.

## Evidence base (what exists)

| # | Source | What it measured | Models / n |
|---|---|---|---|
| E1 | `wiki/Research/Harness-Reports/2026-06-05-heavy-strategy-niche-probe.md` | reactive vs plan-execute vs reflexion vs ToT on 2 open-ended tasks | qwen3.5:latest (local), gpt-4o-mini; n=1 per cell |
| E2 | `wiki/Research/Agent-Memory-Archive.md` line 558 (2026-06-04 escalation-lift falsification; no standalone report file) | pre-registered, N=3: reactive vs heavy on 4 task classes incl. plan-execute's long-horizon home turf | qwen3:14b, haiku (hard-coding 10/10) |
| E3 | `wiki/Research/Harness-Reports/cross-strategy-matrix-analysis-2026-05-23.md` (+ `_archive/cross-strategy-matrix-*.json`) | 2 models x 4 strategies x 5 tasks; success bool was unreliable, quality read from output length | cogito:14b, qwen3:14b; n=1 per cell; May 2026 code, pre-dates many fixes |
| E4 | `wiki/Research/Harness-Reports/2026-11-03-h3-baseline.md` | H3 frozen suite, default arm (reactive for most tasks; `h3-plan-only` uses plan-execute), k=5 | qwen3:4b, cogito:8b |
| E5 | `wiki/Research/Harness-Reports/2026-11-16-plan-posture-ablations/RESULTS.md` | substrate/posture ablations incl. blueprint and plan-execute-reflect arms, n=18 per arm per tier | qwen3:latest (8.2B), cogito:14b |
| E6 | `wiki/Research/Harness-Reports/2026-08-10-new-user-adversarial-review.md` F12 | one-tool crypto task, strategy cost spread | qwen3.5:latest, qwen3:4b; n=1 |
| E7 | `wiki/Decisions/2026-06-10-roadmap-realignment-v0.12-v1.0.md`, `wiki/Decisions/2026-06-24-high-leverage-roadmap-ranking.md` | owner decisions: adaptive routes to reactive on local tier; heavy strategies = frontier/niche | derived from E1/E2 |
| E8 | `apps/docs/.../choosing-strategies.mdx:246` and `wiki/Research/Harness-Reports/2026-11-13-recent-default-harness-ablation.md` | strategy switching off by default: -6.2pp (noise), +28% billed tokens, qwen3:4b and cogito:8b | n small |

Power caveat (E5 PROTOCOL): n=18 per arm gives sigma about 16pp on a two-arm difference; per-run cells are Bernoulli. Gaps under about 26-31pp are noise. Almost everything below is a "no detectable lift" statement, not a "proven equal" statement.

## Per-strategy, per-tier findings

Reactive (ReAct)
- <=8B: viable but task- and model-dependent, from E4. qwen3:4b: 5/5 on h3-required-tools, h3-continuation, h3-exact-value, rw-9, 4/5 on rw-6 and h3-todo-heavy; 0/5 on rw-2, rw-3, rw-7. cogito:8b: 0/5 on rw-2, rw-3, rw-6, rw-7; 2/5 on rw-9. cogito:8b's 0/5 on trivial tasks traced to tool calls printed as final text (a harness-visible failure shape, not an instrument fault).
- ~14B: strongest cell in E2 (qwen3:14b reactive 7/7 x3 on long-horizon commit analysis, 5/5 on LIS); E3 reactive output complete on both 14B models.
- Frontier: E1 (gpt-4o-mini reactive 4/4 cells passed), E2 (haiku 10/10 hard-coding).

Reflexion
- <=8B: no quality measurement at all. Only cost: qwen3:4b 4,506 tokens / 136.3 s for one crypto lookup (E6); qwen3.5 4.2x tokens on t4, 1.1x on t5 (E1, qwen3.5 is local, size not pinned in these files).
- ~14B: E3 (May 2026 code): cogito:14b reflexion shipped raw `<rationale>` XML as output on 3 of 5 tasks (a harness bug later fixed, cannot be separated from model quality here); qwen3:14b reflexion output was 52% of reactive length on t4. E5 gives no reflexion arm.
- Frontier: E1 gpt-4o-mini reflexion returned empty output on both tasks (improve-phase think errored instantly). Classified as an orchestration bug, filed separately. Fix status NOT verified in this audit.
- Everywhere tested: no quality gain over reactive, including on t5-critique (reflexion's home turf) in E1.

Plan-execute-reflect
- <=8B: E4 `h3-plan-only` (plan-execute): qwen3:4b 1/5, cogito:8b 0/5 (missing files, not plan-only text). E5: qwen3:latest 8.2B plan-execute-reflect 15/18 (0.83); no reactive comparator on that task family. Mixed: plan-execute works for the 8.2B qwen3 on constructed file tasks and fails on 4B/8B cogito H3.
- ~14B: E2 qwen3:14b long-horizon: plan-execute 7/7, 4/7, 6/7 vs reactive 7/7 x3, and 2-3x slower. E5 cogito:14b plan-execute-reflect 0/16 on tasks it solves 44-56% under plan posture (model-specific floor, cause not read from traces). The docs line "Plan-Execute-Reflect produces reliable structured plans at this tier" is contradicted for cogito:14b and unsupported for qwen3:14b.
- Cost: E1 qwen3.5 3.1x-4.4x tokens, 4x-5x time (153 s vs 34 s t4); E2 2-3x slower.
- Frontier: E1 gpt-4o-mini plan-execute 4/4 and cheaper than reactive (0.38x, 0.77x tokens, reactive was verbose there).

Tree-of-thought
- Local: E3 qwen3:14b 191-303 s vs 13-51 s reactive (5-23x); E1 qwen3.5 13-15x tokens, 619-629 s. One E3 cell ended `failed to produce output` yet reported success (framework honesty bug, later work). Not recommended on local; the repo's own guard code was found structurally unreachable (2026-08-10 note).
- Frontier: E1 gpt-4o-mini 4/4, 1.16x-1.73x tokens, parity quality. ToT's exploratory niche (divergent search) was never tested; E1 tasks were expository.
- The docs "14B+" minimum for ToT has no measurement behind it either way.

Adaptive
- Local tier defaults to ReAct (owner decision, E7); no measurement of adaptive routing quality by size beyond that. Strategy switching: no measurable gain on qwen3:4b / cogito:8b (E8).

Direct
- No evidence mined. No claim.

## Verdicts on the three docs claims

### Claim 1: "8B models: ReAct and Reflexion are both viable" (`choosing-strategies.mdx:413`)
- ReAct half: SUPPORTED WITH CAVEAT. Evidence: E4 (qwen3:4b solves 5 of 12 tasks fully, cogito:8b solves almost none of the same suite). "Viable" is true for tool-calling tasks on some models, false as a blanket statement.
- Reflexion half: INSUFFICIENT-EVIDENCE. Zero quality measurements at <=8B; the only data point is cost (4,506 tokens, 136 s for one lookup on qwen3:4b). Docs may not say "viable", nor "Poor".
- Quotable wording (docs may use): "Reactive (`reactive`) is the strategy we have measured on 4B-8B models: it completes tool tasks on some models (qwen3:4b solved 5 of 12 frozen tasks fully) and fails on others (cogito:8b solved 0 of 5 on most). Heavy strategies have not shown a quality gain over it in our tests and cost more on local models."
- For Reflexion at 8B: no claim.

### Claim 2: tier table rates Reflexion "Poor" at <=8B (`choosing-strategies.mdx:378`)
- INSUFFICIENT-EVIDENCE. No measurement supports "Poor" (or "Fair" at 14B, or "Good" at 70B). The Poor/Fair/Good ratings of Reflexion, Plan-Execute and the rest appear to be unsourced judgments carried from the March 2026 adoption-readiness plan (`wiki/Planning/Implementation-Plans/Superpowers/archive/2026-03-11-adoption-readiness-phase2.md:373`: "4B (ReAct only), 8B (ReAct + Reflexion), 14B (all viable)"), which predates all measurements above. Neither the prose nor the table is evidence-based; they contradict each other because both are guesses.
- Recommendation: drop per-size Poor/Fair/Good ratings for Reflexion, Plan-Execute and ToT. Replace with the measured statement below. Keep ReAct as the recommended local default (supported by E1, E2, E7).
- Quotable wording: "We have not measured reflexion by model size. On the tests we ran (open-ended and multi-step tasks on local and frontier models), reflexion gave no quality gain over ReAct and cost more tokens and time on local models. Use ReAct unless your own measurements show otherwise."

### Claim 3: old advice "plan-execute-reflect for local models" (`local-models.mdx:108` "Multi-step planning | qwen3:14b with Plan-Execute", and the table "Fair at 14B")
- CONTRADICTED as a recommendation for local models. Evidence: E2 (reactive equal or better than plan-execute on qwen3:14b, plan-execute 2-3x slower), E1 (3.1x-4.4x tokens on a local model with parity quality), E4 (`h3-plan-only` 1/5 on qwen3:4b, 0/5 on cogito:8b), E5 (cogito:14b 0/16), E7 (owner decision: adaptive routes to reactive on local; heavy = frontier/niche).
- "Fair at 14B" and "reliable structured plans at 14B" are not supported (E5 cogito:14b 0/16); one 14B-class counter-example (qwen3:14b 7/7, 4/7, 6/7 in E2) is mixed.
- Not contradicted: plan-execute works on some local models (qwen3:latest 15/18 in E5) and on frontier (E1), so "never" is also unsupported.
- Quotable wording: "Plan-Execute-Reflect is not the recommended default for local models: in our tests it matched ReAct's accuracy at 2-5x the tokens and time, and failed outright on some 8B-14B models. Reach for it on frontier models, or when you have measured it on your own tasks."
- Related, outside the three claims: `choosing-strategies.mdx:122` says Blueprint is "validated on ... local (qwen3:14b)". E5 shows blueprint 1/18 to 3/18 on cogito:14b and 67-72% on qwen3:latest; no qwen3:14b blueprint measurement was found in this audit. Docs-warden should either cite the source or soften.

## Statements the docs can safely make (all supported)
1. ReAct is the default on every tier; adaptive routes to ReAct on the local tier (owner decision 2026-06-10, E7).
2. Across the tests we ran, no heavy strategy improved quality over ReAct; they cost more, on local models 1.1x to 15x tokens and 3x to 23x wall-clock depending on strategy (E1, E2, E3).
3. On frontier models heavy strategies were cost-comparable and quality-equal in our small test (E1, n=1 per cell).
4. Strategy switching is off by default; measured no gain (E8).

## Caveats and limits
- Small samples throughout (E1 n=1, E3 n=1, E2 N=3, E5 n=18, E4 k=5). Treat nothing here as a size-by-strategy performance curve.
- E3 predates many fixes (rationale-leak, success-bool honesty). Its qualitative reading of reflexion at 14B is stale.
- E2 has no standalone report file, only the ledger line in `wiki/Research/Agent-Memory-Archive.md` line 558. Docs should not cite it as a report until one exists.
- Reflexion at <=8B and ToT's exploratory niche are the true evidence gaps. A minimal fill would be a pre-registered reactive vs reflexion vs plan-execute run on qwen3:4b and cogito:8b over H3 tasks plus an open-ended critique task, k>=5, through `packages/benchmarks/src/h3/run-h3.ts` with `run-started.config` read back per arm. Not run here.
