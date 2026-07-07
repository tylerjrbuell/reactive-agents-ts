# Public Competitor Bench — qwen3:14b re-run (post F1–F3), 2026-07-07

**Status:** internal receipts report — basis for the public launch-gate publication (item 5, spec 08 §10).
**Session:** `public-competitor-qwen3-14b` v1.0.0 · SHA `4e2c9ecb` · 5 tasks × 6 variants × 3 runs (90 cells)
**SUT:** qwen3:14b via Ollama (local GPU) · **Judge:** OpenAI `gpt-4o-mini` via judge-server (`JUDGE_LAYER=live`, Rule-4 separation from local SUT; live-layer verified with a real `/judge` POST before the run — `/version` alone is not a health check)
**Code state:** local main post-Arc-1 merge (`3c9c15fa`), includes F1 (grounded-terminal), F2 (arg-shape healing), F3 (repeated-failure escalation), bench required-tools wiring (`d26e8695`), file-root sandbox fix (`78bd31ac`).

## Headline (per-task, ra-full vs bare-llm)

| Task | Bare LLM | RA Full | Lift |
|---|---|---|---|
| Research synthesis w/ source conflict (rw-1) | 67% | 0% | **−67%** |
| Data investigation w/ red herring (rw-2) | 53% | 7% | **−47%** |
| Multi-file debug, no test suite (rw-7) | 0% | 33% | **+33%** |
| Memory under compaction pressure (rw-8) | 0% | 33% | **+33%** |
| Resilience under tool failure (rw-9) | 0% | 100% | **+100%** |

Accuracy by variant: bare-llm 24% · manual-react 57% · langchain-react 44% · vercel-ai-sdk 40% · mastra-agent 41% · **ra-full 35%**.

**Cross-model thesis (holds on both models): the harness wins where execution is hard and loses where the model could have just answered.** On cogito:8b (2026-07-03 final, clean run: 0 timeouts, 0 judge errors) ra-full is best-of-six at 44% (bare 33%, manual-react 33%, langchain 20%, vercel 20%, mastra 27%). On qwen3:14b the same execution-task dominance holds (all three hard-execution tasks won, resilience by +100%), but research-synthesis tasks regress hard enough to drag the aggregate below the lean scaffolds.

## Why RA loses the research tasks (traced, not guessed)

Forensic single-cell repro (probe, plan-execute + qwen3:14b + rw-1 prompt) shows the mechanism end to end:

- The harness **forces tool grounding** (plan → web-search × N → synthesize). The searches run against a noisy local web-search tool (several calls returned empty in traces).
- qwen3:14b then **synthesizes fabricated entities from weak search context**: probe output named "EdgeVec" (does not exist), "LiveBlocks" (real product, not a vector DB), "MIT (assumed based on open-source trends)" (invented license).
- The judge rubric — "Score 0.0 if any database is fabricated" — correctly kills it.
- Meanwhile `manual-react` (and `bare-llm`) answer largely from parametric knowledge and name real databases (Qdrant/Weaviate/Redis), scoring 1.0.

So the regression is **real model behavior under forced grounding**, not a scoring artifact: on knowledge-retrieval tasks, a weak-search + strong-prior model does worse when the harness makes it "verify" than when it just answers. This is the sharpest open product problem for the harness on research-type work, and it is exactly the class of problem the Arc-1 trust receipt makes visible.

### Receipt vignette (honest-claims, live)

The fabricated probe answer carried `receipt: {verdict: "tool-grounded", confidence: 0.8, toolsUsed: ["web-search"]}` — the receipt truthfully reports *tools were used and succeeded*, while the content is still wrong. Working as designed and as documented ("graded evidence about HOW the answer was produced — not a truth certificate"), and a perfect illustration of why the receipt's copy must never be read as correctness.

## Data-integrity findings from this run (fixed / caveated)

1. **FIXED — error cells reached the judge.** A timed-out cell (420s cap, 0 tokens, empty output) was sent to the LLM judge, which hallucinated evidence ("at least one database is fabricated") over an empty string. Fix: `scoreErrorCell` (commit on main) — error/timeout cells now score 0 deterministically with evidence naming the true cause and duration, never reaching the judge.
2. **CAVEAT — timeout cells leave zombie fibers.** The bench's per-cell timeout races `agent.run()` but cannot abort the underlying fiber; the abandoned agent keeps consuming the GPU, slowing subsequent cells. Trace census for this run: 41/51 RA-side cells completed, 3 failed, 7 abandoned at the cap. Successful rw-1 cell durations degraded monotonically (248s → 380s → cap) — consistent with contention. **The qwen3:14b aggregate (35%) is therefore a lower bound**; the per-task win/loss pattern is robust (it reproduces the pre-fix run's pattern and the cogito pattern), but the exact aggregate should not be quoted without this caveat.
3. **Session ran without `--output`** — per-cell JSON was not persisted for the 90-cell run; per-task numbers come from the run's report table, forensics from `benchmark-traces/*.jsonl` + a persisted single-run forensic re-run (`--task rw-1 --runs 1 --output`). Future sessions: always pass `--output`.

## Honest comparison notes

- `manual-react` (a ~50-line hand-rolled loop) beats every framework on qwen3:14b accuracy (57%). On cogito:8b it ties bare-llm (33%) and loses to ra-full (44%). Lean scaffolds are genuinely strong when the model is strong — we publish that, not just the cells we win.
- Competitor frameworks (LangChain/Vercel AI SDK/Mastra) cluster at 40–44% on qwen3:14b, all above ra-full's caveated 35%; on cogito:8b all fall well below ra-full (20–27%).
- Reliability dimension: ra-full 59% vs competitor 96–100% on qwen3:14b — RA attempts more (tool engagement) and its honesty tracer flags unverified claims (`claimed-success (unverified)` / `dishonest-success-suspected` lines throughout the run log); frameworks that do less claim less.

## Publication posture (recommendation)

- **Headline dataset: cogito:8b** (clean: 0 timeouts, 0 judge errors) — ra-full 44%, best of six.
- **qwen3:14b: publish the per-task pattern** (execution wins incl. +100% resilience; research regressions) with the timeout caveat, NOT the aggregate as a ranking claim.
- Publish the fabrication-under-forced-grounding finding as an open problem we are working on — it is the strongest possible demonstration that these benches are receipts, not marketing.
- Artifacts: traces in `packages/benchmarks/benchmark-traces/`, forensic JSON `/tmp` (re-generate with `--output` for the public artifact), this report.

## Follow-ups filed

- Bench: abort/reap the agent fiber on cell timeout (zombie-fiber contention); always `--output`; consider per-cell GPU cooldown.
- Harness (Arc 2 candidates): research-task posture — when search results are empty/low-quality, prefer abstention or parametric-answer-with-caveat over forced synthesis (F1's grounded-terminal invariant currently pushes engagement; it needs a "grounding failed, say so" branch); web-search tool quality (multiple empty results in traces).
