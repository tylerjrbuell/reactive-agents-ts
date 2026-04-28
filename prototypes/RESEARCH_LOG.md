# Research Log — Spike-driven harness validation

> Per `docs/spec/docs/00-RESEARCH-DISCIPLINE.md` Rule 5: every spike gets
> ONE PARAGRAPH here, regardless of outcome. This log is the running record
> of what's been tried, what worked, what didn't, what to never propose again.

---

## p00-bare-vs-harness — 2026-04-27 — `cogito:8b × rw-2 × 5 runs`

**Question:** Does the harness produce qualitatively different output than a
bare-LLM ReAct loop on the same task? **Outcome:** Yes — but in an unexpected
direction. Bare LLM fabricated 5/5 runs (never called the tool, made up
"payment processing issue" + wrong dollar amount). Harness fabricated 0/3 runs:
2/3 honest-failed (`""`), 1/3 grabbed the red herring but stayed grounded in
real data. **Re-frames harness value proposition: it's a fabrication firewall,
not a problem-solving booster.** Token cost is 100× higher (256 vs ~25,300) —
the price of trust. Bench's score-based "lift" metric DOESN'T capture this win
because empty output and confident lie both score 0. **Next spike priorities:**
p01 (bare + verification gate to test if a single mechanism captures most of
harness's anti-fabrication value), p02 (bare + required-tool prompt nudge),
p03 (validate fabrication failure mode across providers — is this cogito-only or universal?).

**Artifacts:** [`p00-bare-vs-harness.ts`](./p00-bare-vs-harness.ts), [`RESULTS-p00.md`](./RESULTS-p00.md), `harness-reports/spike-results/p00-bare-rw2.json`

---

## p00v2-competent-bare-vs-harness — 2026-04-27 — `qwen3:4b × rw-2 × 5 runs`

**Question:** Why wouldn't someone hand-roll their own agent? Does a competent
80-LOC bare-LLM ReAct loop match the harness on rw-2? **Outcome:** Bare loop is
COMPETENT but SHALLOW. With proper config (native FC, `think:false`, decent
prompt), bare qwen3:4b deterministically calls the tool, computes, and ships
an answer in 4s / 3.2K tokens. **But it grabs the red herring (15% discount)
5/5 times** instead of identifying the TV out-of-stock as the cause. Harness
on cogito:8b: 1/3 grabs same red herring, 2/3 honest-fails (empty output) —
the "honest fail" mode is the actual differentiator. Cost: harness 7.8× more
tokens, 5× slower. **Re-frames competitive answer:** harness's defensible
value is TRUST (refuses confident-wrong), not capability boost. The bare loop
fails confidently; harness fails honestly. Important infra finding: harness
auto-enables qwen3 thinking-mode → empty content output → bench-data for
qwen3:4b harness is unreliable until re-run with thinking disabled. **Next
spike (p01):** bare-LLM + minimal ~30-LOC verification gate — does this single
mechanism deliver the trust gain, or is the gain distributed across many
harness mechanisms?

**Artifacts:** [`p00v2-competent-bare-vs-harness.ts`](./p00v2-competent-bare-vs-harness.ts), [`RESULTS-p00v2.md`](./RESULTS-p00v2.md), `harness-reports/spike-results/p00v2-bare-rw2-qwen3-4b.json`

---

## p01 + p01b — bare-LLM + 30-LOC verification gate — 2026-04-27 — `(qwen3:4b + cogito:8b) × rw-2 × 5+5 runs`

**Question:** Does a single ~30-LOC verification gate (check: tool called?
answer references observations?) capture most of the harness's anti-
fabrication value? **Outcome:** SPLIT — gate is mechanism-correct,
**model-specific.** On qwen3:4b (which calls tool + grounds answer): gate
PASSES 5/5, ships same red herring as bare. KILL — gate doesn't catch
shallow-reasoning failures. On cogito:8b (which fabricates without FC):
gate FAILS 5/5 (`agent-took-no-action`), converting **5/5 dangerous
confident-fabrication into 5/5 honest-fail**. PROMOTE — gate IS the
fabrication firewall at <1.5% the harness's token cost (325 tok vs 25,300+
tok for the full harness). **Decision-grade finding:** the harness's main
trust differentiator is implementable in 30 LOC of pure code — most other
harness mechanisms need to spike-validate against this baseline or face
deletion. Different mechanism class needed for shallow-reasoning failures
(multi-hypothesis enumeration? critique loop?). **Next spike (p02):** does
retry-on-rejection (verifier-driven retry like commit `45960be6`) convert
cogito's 5/5 honest-fail into ≥1/5 grounded answer? Or is cogito's FC
failure unsolvable by harness feedback (model-level limitation)?

**Artifacts:** [`p01-bare-with-verification.ts`](./p01-bare-with-verification.ts), [`p01b-bare-with-verification-cogito.ts`](./p01b-bare-with-verification-cogito.ts), [`RESULTS-p01.md`](./RESULTS-p01.md), `harness-reports/spike-results/p01-bare-verify-rw2-qwen3-4b.json`, `harness-reports/spike-results/p01b-bare-verify-rw2-cogito-8b.json`

---

## p02 — bare + gate + retry-on-rejection — 2026-04-27 — `cogito:8b × rw-2 × 5 runs (max 2 retries)`

**Question:** Does retry-on-rejection convert cogito's 5/5 honest-fail
(p01b) into ≥1/5 grounded answer? **Outcome:** KILL — 0/5 recover. Cogito
ignored retry feedback every attempt; consumed 4.2× tokens (1,072 vs 325
baseline) for zero recovery. Cogito interprets the prompt as "look at an
attached file" rather than "call the read_csv tool" — model-level FC
failure not solvable by harness feedback. **Empirically validates that
verifier-driven retry (commit 45960be6) is tier-specific, not universal**
— and the override hook (`VerifierRetryPolicy`, commit 14135d6d) is the
correct control surface for developers to suppress retry on known-non-
recovering models. **Subtle positive surprise:** p02's stricter system
prompt eliminated cogito's fabrication (vs p00's gentle prompt where it
made up "$12,500 / payment processing"). Now it honest-fails at the model
level ("I don't see the attached file") without needing the verification
gate. **Suggests prompt strictness alone may match the verification gate's
anti-fabrication value at zero overhead.** Next spike (p03): ablation of
prompt-strictness alone vs gate alone vs both — does the harness's trust
value reduce further to ~5 lines of system prompt?

**Artifacts:** [`p02-bare-with-verify-retry-cogito.ts`](./p02-bare-with-verify-retry-cogito.ts), [`RESULTS-p02.md`](./RESULTS-p02.md), `harness-reports/spike-results/p02-bare-verify-retry-rw2-cogito-8b.json`
