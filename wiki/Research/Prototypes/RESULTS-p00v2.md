# RESULTS — p00v2 competent-bare-vs-harness (rw-2 × qwen3:4b)

**Date:** 2026-04-27  
**Spike:** [`p00v2-competent-bare-vs-harness.ts`](./p00v2-competent-bare-vs-harness.ts)  
**Methodology:** `docs/spec/docs/00-RESEARCH-DISCIPLINE.md`  
**Outcome class:** SURPRISING — re-frames competitive question

---

## Hypothesis (locked before run)

> A COMPETENT bare-LLM ReAct loop (qwen3:4b, ollama SDK, native FC, ~80 LOC)
> on rw-2 produces output of comparable quality to the @reactive-agents
> harness on the same task with the same model.
>
> COMPETITIVE QUESTION: Why wouldn't someone just hand-roll their own agent?

## Key configuration finding (course-correction during spike)

qwen3 has a verbose `<think>` mode that explodes token usage (5K → 45K) and
puts the answer in a separate `thinking` field, leaving `content` empty.
Disabled via the SDK's `think: false` parameter (preferable to `/no_think`
in prompt). **The harness auto-enables thinking for qwen3** (verified via
`packages/llm-provider/src/providers/local.ts:215`) — which probably explains
why the bench showed harness-on-qwen3 shipping 0b output 3/3 times. That's
a thinking-mode interaction artifact, not a verifier rejection. **Bench
comparison data for qwen3:4b harness is unreliable until re-run with thinking off.**

## Result

**Bare LLM is COMPETENT but SHALLOW.** With proper config (native FC,
think:false, decent system prompt), bare qwen3:4b solves the loop mechanics
perfectly but can't see past the obvious explanation.

| Metric | Bare LLM (5 runs) | Harness on cogito-8b (3 runs)* |
|---|---|---|
| Tool called? | 5/5 ✓ | 3/3 ✓ |
| Iterations | 2 (deterministic) | 10–15 (varies) |
| Tokens avg | **3,250** | **~25,300** (~7.8× more) |
| Wall time avg | **4.0s** | **~21s** (~5× slower) |
| Output: ships content? | 5/5 | 1/3 (rest honest-fail empty) |
| Output: identifies TV OOS (correct)? | 0/5 | 0/3 |
| Output: identifies discount (red herring)? | **5/5** | 1/3 |
| Output: arithmetic correct? | 0/5 (claims drop = $4,610; actual ≈ $2,800) | 1/3 (correct $339 partial figure) |
| Output: fabricated content? | 0/5 (grounded in data) | 0/3 |

*Using cogito-8b harness data because qwen3-4b harness data is corrupted
by thinking-mode interaction described above.

### Bare LLM output (deterministic across all 5 runs)

> "The revenue drop on day 2 (2025-03-11) compared to day 1 (2025-03-10) is
> primarily due to a 15% discount applied to all orders on day 2... The
> revenue drop on day 2 compared to day 1 is: 8059.84 - 3449.91 = 4609.93"

**Wrong answer (grabs the red herring), wrong arithmetic** — but the
answer IS grounded in observations (the discount IS in the data).

## Six-level signal taxonomy

| Level | Bare LLM | Harness | What this tells us |
|---|---|---|---|
| **Behavioral** | Tool called 5/5 | Tool called 3/3 | Both engage with data — no behavioral gap |
| **Mechanistic** | Reads CSV, computes per-day revenue | Reads CSV, multi-iteration | Bare's reasoning is single-pass; harness loops longer |
| **Quality** | Wrong (red herring) 5/5 | Wrong (red herring) 1/3 + empty 2/3 | NEITHER solves the task |
| **Cost** | 3.2K tok, 4s | ~25K tok, ~21s | **Harness is 7.8× more expensive** |
| **Robustness** | Deterministic (5/5 identical) | Highly variable | Bare more predictable |
| **Surprise** | Bare loop is genuinely competent at mechanics | Harness's "honest-fail" mode IS its main differentiator | Capability isn't the gap; trust is |

## What this changes about the harness's value proposition

The competitive answer the user asked us to address:

> **"Why wouldn't someone just hand-roll their own agent via SDK and bare LLM calls?"**

Based on this single task with this model pair, the answer is:

| If you need... | Hand-roll wins | Harness wins |
|---|---|---|
| Speed (≤4s vs 21s) | ✓ | |
| Token efficiency (3K vs 25K) | ✓ | |
| Deterministic behavior | ✓ | |
| Simple loop logic (50 LOC) | ✓ | |
| **Refuses to ship confident-wrong answers** | | **✓ (2/3 honest-fail) — the trust differentiator** |
| Multi-iteration reasoning | (could be added) | ✓ |
| Built-in tool catalog | | ✓ |
| Memory across runs | | ✓ |

**The harness's defensible value isn't capability boost — it's trust.** The
bare loop and harness both fail this task; the harness fails *honestly* most
of the time, the bare loop fails *confidently*. In production business agent
contexts (marketing/sales/SQL personas), confident-wrong is dangerous,
honest-fail is operable.

But this trust comes at **7.8× the token cost** and **5× the wall time** —
which is the wrong trade for many use cases (chat agents, real-time apps).

## What this DOESN'T tell us (honest gaps)

- **Frontier model behavior** (claude-haiku, gemini, gpt-4o) — untested.
  The "trust" differentiator might evaporate when the model is smart enough
  to not fabricate in the first place.
- **Multi-task robustness** — n=1 task is anecdote, not pattern.
- **Real harness on qwen3 with thinking off** — bench data unreliable until
  re-run with `withReasoning({ ... })` set to disable thinking for qwen3.
- **Whether a competent prompt + verification gate (no full harness) gets
  most of the trust gain** — this is the actual test that decides if the
  harness is justified.

## Implications for next spike

Given the finding "harness's value is trust, not capability," the highest-
leverage next spike is **NOT** cross-provider testing (p03 from earlier list)
— it's **isolating which harness mechanism delivers the trust gain.**

### p01 (revised): bare + minimal verification gate

```
HYPOTHESIS: Adding a single ~30-LOC post-LLM verification step to bare-LLM
  (check: did the model call a tool? does answer reference data the tool
  returned?) reduces confident-wrong outputs to <2/5 on rw-2.

NULL: Verification doesn't change the output (model still grabs red herring).
  Implication: even the trust gain isn't from verification; it's from
  something else (multi-iteration? reflection? the system prompt structure?).

PROMOTION CRITERIA: ≥3/5 outputs are either correct OR honest-fail (not
  confident-wrong). Total LOC stays ≤120 (vs harness's ~30 packages).

KILL CRITERIA: ≤1/5 improvement vs p00v2. Implication: verification alone
  isn't the trust mechanism; need a different spike.
```

If p01 succeeds: we've isolated the harness's trust mechanism in 30 LOC and
have empirical mandate to delete the rest. If it fails: the trust mechanism
is more sophisticated than verification alone, and p02 isolates the next
candidate (multi-iteration? reflection? specific prompt patterns?).

This is the flywheel: each spike isolates one mechanism, measures, decides
keep/cut.

## Promote / Kill / Refactor (per Rule 6)

This is a control experiment — no harness change candidate. Outcome:

- **Methodology PROMOTE**: spike took ~25 min from "no file" to "decision-grade
  evidence." Discipline is operational.
- **Bench-data RE-RUN required**: harness-on-qwen3 with thinking explicitly
  disabled, before further bench-based decisions.
- **Next spike prioritized**: p01 (bare + verification gate) — the falsifiable
  test of whether verification is the harness's actual differentiator.
