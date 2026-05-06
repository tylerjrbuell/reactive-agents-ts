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

## The combined finding — scope-limited per Rule 11

> **Scope-of-claims calibration (added 2026-04-27 per discipline contract Rule 11):**
> The numbers below describe ONE failure mode (FM-A1: no-tool-fabrication) on ONE task (rw-2) on TWO models. They do NOT support claims about the harness's overall value vs the verification gate, because the harness handles many other failure modes (compression, multi-turn, sub-agents, MCP lifecycle, tool errors, memory) that this spike doesn't touch.

| Approach | Token cost | Outcome on **fabrication failure** (FM-A1) on **cogito:8b × rw-2** |
|---|---|---|
| Bare LLM | 256 tok | 5/5 confident-wrong (FM-A1 manifests) |
| **Bare LLM + 30-LOC gate** | **325 tok (+27%)** | **5/5 honest-fail (FM-A1 caught)** |
| Full @reactive-agents harness | 25,300+ tok | 2/3 honest-fail, 1/3 grounded-wrong on rw-2 |

**Permitted claim (Rule 11):** A 30-LOC verification gate addresses
failure mode FM-A1 (no-tool-fabrication) on cogito:8b × rw-2 at near-zero
LLM token cost.

**NOT a permitted claim:** "30-LOC gate captures harness's trust differentiator."
The harness does many other things this spike didn't measure. The harness's
larger token footprint goes to mechanisms (compression, retry loops, RI dispatch,
strategy switching, etc.) that target other failure modes catalogued in
`01-FAILURE-MODES.md`. Each of those mechanisms needs its own spike before
its value can be assessed.

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

**Implications for the minimum kernel** (per discipline contract §2 — calibrated per Rule 11):

The minimum kernel sketch is:
> tool-loop + verify-gate + (optional, tier-specific) retry + episodic memory

This spike contributes evidence for the `verify-gate` mechanism specifically:
- ✅ Verification gate addresses FM-A1 (no-tool-fabrication) on cogito:8b × rw-2
- ✅ Implementable in ~30 LOC, near-zero LLM cost
- ⚠️ Did NOT address shallow-reasoning failures on qwen3:4b × rw-2 (see p01)
- ❓ Untested on other failure modes (FM-B*, FM-C*, FM-D*, FM-E*, FM-F*, FM-G*, FM-H*)
- ❓ Untested on frontier providers

The `retry` part is tested in p02. **The harness's broader machinery
(RI dispatcher, strategy switching, compression, healing pipeline, etc.)
each needs its own spike against its target failure modes** — see
`01-FAILURE-MODES.md` for the catalog and `02-IMPROVEMENT-PIPELINE.md`
for the operational rhythm.

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
