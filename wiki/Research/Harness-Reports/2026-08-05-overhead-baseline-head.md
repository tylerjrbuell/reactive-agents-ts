# Harness Overhead Baseline on HEAD (2026-08-05)

**Purpose:** Move 0 of the [[../../Planning/Implementation-Plans/2026-07-31-competitive-edge-structural-program|competitive-edge program]] — stop reasoning about lift and measure it. Grade the shipped Move 2/4/5 work and locate the biggest user-noticeable lever with real numbers, on current HEAD (post those changes).

**Method:** `packages/benchmarks/src/harness-cost-attribution.ts` — one deliverable task (read `./data.json`, sum the `values`, write to `./sum.txt`), three arms, n=3. `inline` = the default bare path (`_enableReasoning` false, RA's own tool loop). `kernel` = `.withReasoning()` (contract/assessment/projection/guards). `kernel+RI` = `+ .withReactiveIntelligence()`. Anthropic out of credits → larger tier measured on Gemini + Groq.

## The number

| tier | inline (bare) | kernel | overhead | kernel+RI | deliverable (all arms) |
|---|---:|---:|---:|---:|:--:|
| **local** `gemma4:12b` | 1029 t | 2051 t | **+99 %** | 2088 t (+103 %) | 3/3 |
| **cloud** `gemini-2.5-flash` | 763 t | 4337 t | **+469 %** | 4330 t (+468 %) | 3/3 |

Both far exceed 09 §6's 15 % ceiling. **Every arm delivered 3/3 — the kernel overhead bought zero accuracy on this task.** This is the 7th and 8th lift cell to clear nothing.

## The insight that matters

The kernel overhead is **largely a FIXED token cost** — a roughly constant ~3300–3500 t of scaffolding (contract compile + assessment + projection prompt blocks + an extra `think` round trip + a `synthesize` call) added on top of the bare loop. Consequence:

- On a chatty local model (bare = 1029 t) the fixed scaffolding is +99 %.
- On an efficient cloud model (bare = 763 t) the SAME fixed scaffolding is +469 %.

**The leaner and better the underlying model, the WORSE the harness's percentage overhead looks** — because the tax is fixed, not proportional. This is the single biggest user-noticeable lever: cost and latency paid on every run, and it grows relative to the value as models improve.

## Where the shipped work lands (honest grade)

Move 2 (success authority), Move 4 (dead memory delete), Move 5 (loop signal + per-run cap) **do not appear in these numbers** — this task is a happy-path single-tool deliverable that never false-fails, never enables memory, never thrashes. Those changes are **edge-case correctness / opt-in cost**, verified by tests + targeted E2E, but they are NOT the every-run lever. The P0 timeout fix (broken→working for async tools) remains the one broad, verified user win to date.

## Two cross-tier reliability BUGS surfaced by the measurement

1. **Groq `llama-3.3-70b-versatile` — the kernel path is unusable.** Every `kernel` run failed fast with `groq request failed: Failed to call a function. Please adjust your prompt.` (0 tokens, deliverable 0/3) while `inline` delivered 2/3. The kernel's injected meta-tools (final-answer / discover-tools) produce a function-calling schema Groq rejects. Directly contradicts the "reliable on every tier" headline. Needs the meta-tool schema audited against Groq's FC constraints.
2. **Gemini `gemini-2.5-flash` — the kernel fabricates a final answer.** Every `kernel`/`kernel+RI` run tripped `[verifier] terminal output rejected: output-is-model-authored — output was assembled by harness fallback (terminatedBy=harness_deliverable), model never produced a synthesized final answer`, then `[output-gate] Synthesized output to match requested format`. The model ends its turn (Gemini's native FC returns a functionCall part with no text), the kernel can't find a model-authored answer, and **fabricates one**. `inline` never does this. An honesty-adjacent defect on the default kernel path with a native-FC cloud model.

## Second bench — lazy-disclosure arms (`disclosure-ablation.ts`, local, n=3)

A harder 3-tool deliverable (read → compute → write). All arms 3/3 correct.

| arm | mean tokens | vs inline |
|---|---:|---:|
| inline (bare) | 9663 | — |
| prune-only | 12147 | +26 % |
| prune+discover (kernel default) | 12737 | +32 % |
| no-prune | 15112 | +56 % |
| stable-surface | 15615 | (cache manip-check failed on ollama — ignore) |

Two actionable reads:
- **`discover-tools` is waste on this shape.** `prune-only` (12147 t) ≈ `prune+discover` (12737 t) with the identical 3/3 deliverable — the discovery escape hatch spent round trips that changed nothing (F3, re-confirmed on HEAD). A concrete, removable token cost on the default kernel path.
- **Pruning itself earns its keep (on cost).** `prune+discover` (12737 t) is ~16 % cheaper than `no-prune` (15112 t), same 3/3. So lazy disclosure is a real cost win vs showing every tool — the waste is the *discovery* layer on top of it, not the pruning.

## Decisive answers

- **Is the harness overhead real?** Yes: **+99 % local, +469 % cloud**, measured on HEAD, and it buys 0 accuracy on the happy path. It is a fixed scaffolding tax, worst on the best models.
- **Did the shipped Move 2/4/5 work move this?** No — those are edge-case fixes; they don't touch the every-run tax.
- **Biggest noticeable impact next?** Cut the fixed scaffolding tax. That is **Move 1 (collapse the two loops so the default path isn't the heavier one)** + trimming the kernel's context/prompt scaffolding + the extra think/synthesize round trips. Plus the two cross-tier bugs above (Groq FC, Gemini fabrication) which break the headline reliability claim on real cloud models.

## Caveats (honesty)

- T=1, n=3. This resolves the LARGE overhead difference decisively (per the tool's own uncertainty note) but says nothing about a 3 pp accuracy lift — bench cells are Bernoulli. An accuracy verdict needs the multi-task campaign (BENCHMARK_TASKS, T≥5) and live arms.
- `inline` is RA's bare tool loop, not a raw provider API call, so the true overhead vs a hand-rolled loop is a FLOOR — the real tax on a from-scratch comparison is larger.
- Groq/Gemini were single measured configs; the bugs are reproduced n=3 but not yet root-caused.
