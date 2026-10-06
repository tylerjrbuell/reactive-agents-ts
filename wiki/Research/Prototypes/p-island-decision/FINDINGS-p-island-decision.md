# p-island-decision - findings

**Date:** 2026-10-06
**Question:** which SDK primitive should drive one island agent's per-tick decision?

## Probe

Throwaway script `probe.ts`, one agent ("Mira"), fixed partial-observation
perception with hidden canaries, three variants × 3 ticks.
Raw data: `RESULTS-p-island-decision.md`.

Local models are the target. Ran `qwen3:4b` (full 3 ticks); smoke-checked
`nimble:latest` (1 tick).

| variant | schema-valid | tokens/tick | latency/tick | leaks |
|---|---|---|---|---|
| A stateless structured (`.withOutputSchema` + `run`) | 3/3 | ~1950 | ~7.0s | none |
| B persistent session (`session.chat`) | 3/3* | ~1854 | ~8.1s | none |
| C memory-backed structured (`.withMemory` + `run`) | 3/3 | ~1800 | ~6.8s | none |

\* B is only "valid" because the probe hand-extracts JSON from free text; the
framework validates nothing on the session path.

## Recommendation

**Use A: stateless structured decisions with engine-owned memory.**

- One `agent.run(perception)` per agent per tick, `.withOutputSchema(Decision,
  { mode: "fast" })`. The engine builds the perception string and owns the
  per-agent memory list - partial observability is guaranteed by construction.
- Cost/latency is the lowest and most predictable of the three; no history to
  grow.
- `.withMemory()` (C) did not beat it on any measured axis for short histories.
  Keep the seam pluggable so C can be toggled later without rework.
- Do **not** use `session.chat()` for decisions (B): no schema enforcement, and
  history grows unbounded (tick 3: 2949 tokens / 13s vs ~2000 / 6s).

## Framework gaps surfaced (dogfood report)

1. **No structured output on the session/chat path.** `.withOutputSchema()` is
   ignored by `agent.session()` / `session.chat()` / `agent.chat()`; they return
   plain text with no `object` / `objectError` / validation. Persistent agents (a
   natural fit for simulation) cannot produce typed decisions. Probe B only
   parsed because we hand-rolled `extractJson()`.
2. **Output schema is agent-global and sticky.** Once `.withOutputSchema()` is
   set, *every* `run()` is coerced into that schema - the probe's free-text
   "what did you observe first?" introspection call came back as a `Decision`
   JSON object (variants A and C). There is no per-call override
   (`run(input, { schema })` / `schema: null`) and no `runText()`. A sim needs
   typed decisions **and** free-text summaries/dialogue from the same agent.
3. **No partial-observability / scoped-memory primitive.** The engine must build
   the perception string by hand and cannot ask the framework to guarantee an
   agent only sees its own knowledge. A "per-agent memory namespace + perception
   assembly" building block would remove the easiest way to leak global state.
4. **No simulation clock / tick / batch-decision primitive.** Driving 8 agents
   per tick means hand-rolling the scheduler and `Promise.all` over N isolated
   `agent.run()` calls, with no aggregate cost/token budget or per-agent
   isolation guarantee. A `runBatch`/parallel-structured-decisions helper with a
   per-agent token cap would make local-model sims tractable.
5. **Determinism is at the LLM layer, not the decision layer.**
   `.withReplayLLM()` / `.withTracing()` replay tokens, but "deterministic once
   initialized" wants: seed + world state + the ordered decision list, replayable
   without a model. No sim-level record/replay API; must be hand-rolled.
6. **Local-model cost is invisible.** Ollama reports `cost: 0`, so
   `metadata.cost` is useless for local budgets; tokens are the only signal.
   A local "token budget" / `maxCallsPerTool`-equivalent for `run()` decisions
   would help.

## Local-model constraint

`qwen3:4b` needs ~7s and ~1900 tokens per decision. 8 agents/tick is ~56s
sequentially - parallel decisions are mandatory for a watchable sim, and
perception prompts must stay small.

## Addendum: `agent.judge()` probe (2026-10-06)

`probe-judgment.ts` tested `agent.judge()` as the action-selection primitive
(one batched `choice`-over-actions + `choice`-target + `score`-urgency call):

| backend | model | latency | calibrated | example |
|---|---|---|---|---|
| `jev` | TypeSafe `jev-latest` | **131 ms** | true | action `move` conf 0.75 (move 0.77 / gather 0.14); target `berries` 0.96 |
| `llm` | Ollama `nimble:latest` | 95283 ms | false | overconfident 1.00 on all questions |

`jev` models available to the account: `jev-latest`, `jev-preview`.

**Revised recommendation: judgment-first decisions.** `agent.judge()` is
~50x faster than a structured `run()` decision (131 ms vs ~7 s) and returns
calibrated probabilities + confidence that the UI and fallback logic can use.
Pass the engine-built perception as the explicit `state:` argument - that is
the partial-observability boundary. Backends: `ollama` (`nimble`/`clef-flash`,
local + calibrated, ships with the active `2026-10-05-systemone-decision-backends`
plan), `jev` (works today), `llm` (emulation: slow + uncalibrated, fallback
only), `scripted` (offline).

Structured `run()` is still the right choice for world generation and optional
free-text narration, on a separate agent instance to avoid the sticky-schema
gap (#2).
