# RESULTS — p01 + p01b: bare-LLM + verification gate (rw-2)

**Date:** 2026-04-27  
**Spikes:** [`p01-bare-with-verification.ts`](./p01-bare-with-verification.ts) (qwen3:4b), [`p01b-bare-with-verification-cogito.ts`](./p01b-bare-with-verification-cogito.ts) (cogito:8b)  
**Outcome class:** **DECISION-GRADE** — isolates the harness's trust mechanism

---

## Hypothesis (locked before run)

> Adding a SINGLE ~30-LOC post-LLM verification gate to bare-LLM (check:
> tool called? answer references observations?) captures most of the
> harness's anti-fabrication value.
>
> PROMOTION: ≥3/5 outputs CORRECT or HONEST-FAIL, no confident-wrong shipped.
> KILL: ≤1/5 improvement vs p00v2.
>
> PRE-REGISTERED PREDICTION: For qwen3:4b on rw-2, gate UNLIKELY to help
> (model already grounds answers; failure is shallow reasoning, not fabrication).

## Result — split outcome by model

### p01 (qwen3:4b) — KILL

| Metric | p00v2 baseline | p01 (with gate) |
|---|---|---|
| Tool called | 5/5 | 5/5 |
| Verification | n/a | **PASS 5/5** (20/41 references grounded) |
| Output shipped | 5/5 grab red herring | 5/5 grab red herring (same content) |
| Tokens | 3,250 | 3,258 (+8, gate is pure code) |

**Gate did exactly nothing.** Pre-registered prediction held: when the model
DOES call the tool and produces an answer grounded in observations, even if
the answer is wrong, verification passes. Verification is necessary but not
sufficient for trust.

### p01b (cogito:8b) — PROMOTE 🟢

| Metric | p00 baseline | p01b (with gate) |
|---|---|---|
| Tool called | 0/5 (never used FC) | 0/5 (still doesn't FC) |
| Output before gate | 5/5 confident-fabrication ("payment processing issue", made-up $12,500) | Same 5/5 fabrications |
| **Verification** | n/a | **FAIL 5/5** (`agent-took-no-action: no tool was called`) |
| **Output shipped to user** | **5/5 confident-wrong (DANGEROUS)** | **0/5 — all rejected to honest-fail** |
| Tokens | 256 | 325 (+69, only LLM completion; gate is free) |

**Gate works PERFECTLY in its target context.** Converted 5/5 dangerous
confident-fabrication into 5/5 honest-fail. **Zero LLM cost** — the gate
itself runs in pure JS (~25 LOC), the only token delta is the model
producing slightly more or different output text.

## The combined finding — re-frames the harness's economics

| Approach | Token cost | Trust outcome on cogito:8b/rw-2 |
|---|---|---|
| Bare LLM | 256 tok | 5/5 confident-wrong (DANGEROUS) |
| **Bare LLM + 30-LOC gate** | **325 tok (+27%)** | **5/5 honest-fail (SAFE)** |
| Full @reactive-agents harness | 25,300+ tok (98× more) | 2/3 honest-fail, 1/3 grounded-wrong |

**A 30-LOC verification gate captures the harness's trust differentiator at
<1.5% the token cost.** The harness's other ~30 packages are doing... not
that. (For this task. For this model. For this failure mode.)

## What the gate captures vs misses

**Gate catches** (the cogito case):
- Models that fabricate without using tools (no FC capability or skipping)
- Models that hallucinate factual references not in observations

**Gate doesn't catch** (the qwen3 case):
- Models that DO use tools but reason shallowly over real data (red herring)
- Models that compute correctly but draw wrong conclusions
- Subtle misinterpretation of well-grounded data

The "shallow reasoning" failure is a DIFFERENT mechanism class — it needs
something like multi-hypothesis enumeration, devil's-advocate critique, or
explicit "what other causes could explain this?" prompts.

## Six-level signal taxonomy

| Level | qwen3:4b | cogito:8b |
|---|---|---|
| **Behavioral** | Gate fires, passes 5/5 | Gate fires, **catches 5/5** |
| **Mechanistic** | Gate's grounding check matches strings, doesn't reason about correctness | Gate's tool-call check is binary signal |
| **Quality** | No change — same red herring shipped | **DRAMATIC change** — 5/5 dangerous → 5/5 safe |
| **Cost** | +8 tok (effectively zero) | +69 tok (+27% but absolute cost trivial) |
| **Robustness** | Deterministic across runs | Deterministic across runs |
| **Surprise** | Verification can't see "wrong from grounded data" | Cogito's FC failure is so consistent that gate is 100% effective |

## Discipline check (per contract Rule 6)

**Hypothesis OUTCOME (combined):**
- For fabrication failures (cogito-class): **PROMOTE** the gate. 30 LOC,
  near-zero token cost, perfectly catches the failure mode.
- For shallow-reasoning failures (qwen3-class): **KILL** — gate is necessary
  but not sufficient. Need a different mechanism.

**Implications for the minimum kernel** (per discipline contract §2):

The minimum kernel sketch was:
> tool-loop + verify-retry + episodic memory

This spike validates the `verify` half of `verify-retry`:
- ✅ Verification gate IS the trust differentiator (when fabrication is the failure mode)
- ✅ It's implementable in ~30 LOC, near-zero LLM cost
- ✅ Captures the harness's main anti-fabrication value

The `retry` part isn't tested yet. Next spike (p02): does adding retry to the
gate (reject → inject reason → try again) help shallow-reasoning failures?
Predicted outcome: probably not (the model would just regenerate the same
wrong answer), but worth confirming. If retry doesn't help, the harness's
verifier-retry mechanism (commit `45960be6`) is also of limited value beyond
fabrication recovery.

**The bigger question p01b raises:** Does the harness's full machinery
(reactive intelligence dispatcher, strategy switching, context compression,
healing pipeline, AUC validation, etc.) provide value BEYOND the 30-LOC
verification gate? Empirically: probably not on this task class. We have
empirical mandate to investigate which harness mechanisms survive their own
spike test, and which are deletion candidates.

## Next spike priority (p02)

```
HYPOTHESIS: Adding a "retry on rejection" loop to p01b's gate (when gate
  fails, inject the reason as a system message and re-run the loop, max 2
  retries) converts cogito:8b's 5/5 honest-fail into ≥1/5 grounded answer.

NULL: Cogito ignores the retry feedback (still doesn't call tool) — gate
  rejects on retry too. Implication: cogito's FC failure is at the model
  level, not solvable by harness feedback. Mandate: route cogito through
  text-parse driver, OR don't use cogito for tool tasks.

PROMOTION CRITERIA: ≥1/5 retry attempts produce a grounded answer.
KILL CRITERIA: 0/5 — retry feedback is wasted on cogito-class FC failure.
```

## Files

- `prototypes/p01-bare-with-verification.ts` — qwen3 spike
- `prototypes/p01b-bare-with-verification-cogito.ts` — cogito spike  
- `harness-reports/spike-results/p01-bare-verify-rw2-qwen3-4b.json`
- `harness-reports/spike-results/p01b-bare-verify-rw2-cogito-8b.json`
