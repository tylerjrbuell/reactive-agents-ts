# RESULTS — p02: bare-LLM + verification gate + retry-on-rejection (cogito:8b × rw-2)

**Date:** 2026-04-27  
**Spike:** [`p02-bare-with-verify-retry-cogito.ts`](./p02-bare-with-verify-retry-cogito.ts)  
**Outcome:** **KILL on cogito** — empirically validates retry is tier-specific

---

## Hypothesis (locked before run)

> Adding retry-on-rejection (max 2 retries) to p01b's verification gate
> converts cogito:8b's 5/5 honest-fail into ≥1/5 grounded answer.
>
> NULL: Cogito ignores retry feedback (still doesn't call tool).
>   Implication: cogito's FC failure is at the model level, not solvable by
>   harness feedback.
>
> PROMOTION: ≥1/5 retry produces grounded answer.
> KILL: 0/5.

## Result — KILL outcome confirmed

**0/5 runs recovered.** All 5 runs hit the max retry budget without ever
calling the tool. Each run consumed 3 attempts × ~360 tok = 1,072 tokens
total (vs 325 tok baseline gate-only in p01b — a **4.2× cost increase
for zero recovery**).

### Per-attempt response pattern

Cogito's responses across the 3 attempts in run 0:

| Attempt | Tool calls | Response start |
|---------|-----------|----------------|
| 0 | 0 | "I apologize, but I don't see any attached file named 'sales-data.csv'..." |
| 1 (with retry feedback) | 0 | "I apologize, but I don't see any attached file or sales data.csv..." |
| 2 (with retry feedback) | 0 | "I apologize, but I don't see any attached file named 'sales-data.csv'..." |

The response pattern is **stable and honest**: cogito interprets the task as
"look at an attached file in the conversation" rather than "call the
read_csv tool." Retry feedback ("you MUST emit a tool call") doesn't move
the model — it just keeps apologizing about missing attachments.

### Subtle positive finding (orthogonal to hypothesis)

The stricter system prompt in p02 (vs p00's gentler one) **prevented
fabrication entirely.** In p00 cogito made up "payment processing issue"
+ "$12,500 figure"; in p02 cogito honest-fails ("I don't see the file")
without inventing data. This suggests **prompt strictness alone is a
significant fabrication mitigator** for cogito — possibly more important
than the verification gate for this model.

This is its own next-spike candidate: "does prompt strictness alone
(system: 'never invent values') match the verification gate's anti-
fabrication value at zero overhead?"

## Empirical mandate for the harness — scope-limited per Rule 11

> **Scope-of-claims calibration (Rule 11):** This spike tests retry-on-rejection
> on cogito:8b × rw-2 specifically. The finding "retry doesn't recover cogito"
> is bounded to that combination. Retry on other models or other failure modes
> may behave differently — earlier today (Pass B), retry helped qwen3 recover
> on a synthesis task (trace `01KQ84GK70AX1HG485ZRY9QMAS`).

This spike empirically supports the design intent of commit `14135d6d`
(the `VerifierRetryPolicy` injection hook):

**Permitted claim:** Retry-on-rejection on cogito:8b × rw-2 produces 0/5
recovery and consumes 4.2× the tokens of the gate-only baseline. Cogito
ignores explicit retry feedback for this failure mode.

**NOT a permitted claim:** "Retry is universally useless" — qwen3 evidence
contradicts that.

**NOT a permitted claim:** "Cogito should be removed from supported models" —
that's a routing decision requiring much broader evidence.

**Implication for the harness:** the `VerifierRetryPolicy` injection hook
is the correct control surface — developers can suppress retry per-model
where evidence shows it doesn't recover. The `defaultVerifierRetryPolicy`
uses budget-based logic; tier-aware composition is left to integrators
until enough evidence accumulates to ship a smarter default.

## Six-level signal taxonomy

| Level | Result |
|---|---|
| **Behavioral** | Retry mechanism fired correctly (3 attempts × 5 runs) |
| **Mechanistic** | Cogito's behavior unchanged across attempts — it isn't reading the retry feedback as a tool-call instruction |
| **Quality** | No quality change (still 0/5 grounded) — but stricter prompt did eliminate fabrication |
| **Cost** | 1,072 tok per run vs 325 baseline — **4.2× for zero recovery** |
| **Robustness** | Stable failure mode across all 5 runs (not random — reproducible model limitation) |
| **Surprise** | Stricter prompt eliminated fabrication WITHOUT verification gate; suggests prompt-strictness alone may match gate value at zero overhead |

## What this means for the verifier-driven retry shipped today

Commit `45960be6` (verifier-driven retry):
- ✅ Helps qwen3-class models that intermittently fabricate (validated earlier today on rw-2 → recovery seen on a different task)
- ❌ Does NOT help cogito-class models with consistent FC failure (this spike)
- ✅ The override hook (`VerifierRetryPolicy`, commit 14135d6d) gives developers the control surface to opt out per-model

**Net assessment:** retry is a real mechanism, but its applicability is
narrower than universal "harness improves outcomes." It's valuable when:
- Model has intermittent FC compliance (sometimes calls tool, sometimes doesn't)
- Model can be coerced by explicit feedback ("you didn't do X — do X")
- The cost (2-3× tokens) is acceptable for the trust gain

It's NOT valuable when:
- Model's failure is consistent and deep (cogito's "I don't see attachment")
- Token budget is tight relative to expected recovery rate
- Better alternatives exist (text-parse driver, model swap, prompt engineering)

## Updated minimum kernel sketch (calibrated)

The kernel sketch in `00-RESEARCH-DISCIPLINE.md §2` was:
> tool-loop + verify-retry + episodic memory

Refining post p01+p02 (with appropriate caveats per Rule 11):
> tool-loop + **verify-gate** + (optional, tier-specific) retry + episodic memory

The verify-GATE has spike evidence for FM-A1 on cogito:8b. Retry has spike
evidence as tier-specific (helps qwen3 sometimes, doesn't help cogito ever).
**The minimum kernel is a convergence target subject to broader failure-mode
evidence**, not a finished claim. Other mechanisms (compression, RI dispatch,
strategy switching, etc.) need their own spikes against the failure modes
in `01-FAILURE-MODES.md` before the kernel sketch can be fully validated.

## Promote / Kill / Refactor (per Rule 6)

**For p02 hypothesis:** KILL. Retry doesn't recover cogito-class FC failures.
**For the verifier-retry mechanism overall:** Already shipped (commit
45960be6) with override hook (commit 14135d6d) — empirical evidence supports
keeping it but with tier-specific defaults. Refactor task: **add a "retry
not effective for this model" detection** so default policy can suppress
retry after first failed retry (saves tokens automatically).

## Next spike candidate (p03) — prompt strictness ablation

The p02 surprise finding:
- p00 cogito (gentle prompt): 5/5 fabricate
- p02 cogito (strict prompt + gate + retry): 5/5 honest-fail (no fabrication)

What's actually doing the work — the strict prompt or the verification gate?

```
HYPOTHESIS: Stricter system prompt alone ("Never invent values. If you
  can't access the data, say so explicitly.") on bare-LLM cogito eliminates
  fabrication 5/5 (matches gate value at zero overhead).

PROMOTION: ≥4/5 honest-fail OR correct (no confident-wrong fabrication).
KILL: ≥3/5 still fabricate.
```

If PROMOTE: The verification gate is necessary BUT optional when prompt is
strict enough — most of the harness's anti-fabrication value is achievable
through prompt engineering at zero LLM cost. The harness's contribution
narrows further.

If KILL: Verification gate is the load-bearing mechanism, prompt strictness
is just additive.

This is the right next experiment because it determines whether the harness's
trust value can be replaced by ~5 lines of system prompt.
