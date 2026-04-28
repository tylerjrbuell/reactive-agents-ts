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
