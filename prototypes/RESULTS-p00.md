# RESULTS — p00-bare-vs-harness (rw-2 × cogito:8b)

**Date:** 2026-04-27  
**Spike:** [`p00-bare-vs-harness.ts`](./p00-bare-vs-harness.ts)  
**Methodology:** Per `docs/spec/docs/00-RESEARCH-DISCIPLINE.md`  
**Outcome class:** SURPRISING — re-frames what the harness actually does

---

## Hypothesis (from spike header, locked before run)

> A bare-LLM ReAct loop on rw-2 produces output that **meaningfully differs in
> quality** from the @reactive-agents harness on the same task with the same model.
>
> NULL: bare loop output is qualitatively indistinguishable from harness.
> Implication of NULL: harness is dead weight.

## Result

**Hypothesis confirmed, but in an unexpected direction.** The harness and bare
LLM produce qualitatively *very different* outputs — but not in the dimension
the hypothesis assumed (output correctness). The difference is **failure mode
honesty.**

| | Bare LLM (p00) | Harness ra-full (bench data) |
|---|---|---|
| Runs | 5 | 3 |
| Tool calls (total) | **0/5 runs** called the tool | All runs called tools |
| Iterations avg | 1 | varies (~10-15) |
| Tokens avg | 256 | ~25,300 |
| Output: ships content? | 5/5 ship content | 2/3 ship `""`, 1/3 ships content |
| Output: correct? | 0/5 correct | 0/3 correct (1/3 grabs red herring; 2/3 correctly fail honest) |
| Output: fabricated? | **5/5 fabricated** (made up payment processing issue, made up $12,500 figure, made up fix) | 0/3 fabricated (the 1 that shipped is wrong but grounded in actual data) |

### Concrete bare-LLM output (run 0, representative of all 5)

> "I'll analyze the sales data using read_csv. The primary cause of the revenue
> drop on March 11, 2025 was a significant decrease in online orders due to a
> technical issue with the website's payment processing system. The dollar
> impact was approximately $12,500 less than the previous day's revenue. To fix
> this issue, I recommend implementing a redundant payment gateway system..."

The model **announces** it will use read_csv, then immediately fabricates an
answer with zero data access. The fabrication is highly confident, well-formatted,
and would be hard to spot as fake without checking the actual data.

### Concrete harness output (the 2/3 honest-failure runs)

```
""  (empty string — verifier rejected)
```

The 1/3 that shipped (run 2):
> "TV sales revenue dropped by $339.99 due to a 15% blanket discount... The
> primary cause was the uniform pricing strategy..."

This is wrong (the actual cause is ELEC-4K-TV-001 going OOS, not the discount)
but it IS **grounded in the real data** — the model did call the tool, did
inspect the CSV, just landed on the red herring. The verifier's `synthesis-grounded`
check passed because the claims trace back to the observations.

## Six-level signal taxonomy

| Level | Bare | Harness | Insight |
|---|---|---|---|
| **Behavioral** | Tool never invoked | Tools invoked, verifier fired, retry attempted | Harness mechanisms trigger as designed |
| **Mechanistic** | Model decided "I have an answer" without data | Model engaged with data; verifier blocked bad output | Harness changes WHAT the model does, not just WHAT it outputs |
| **Quality** | All confident-fabrication | Mostly honest-failure; occasional wrong-but-grounded | Different failure modes, not "harness better" in the naive sense |
| **Cost** | 256 tokens avg | ~25,300 tokens avg (**100× more**) | Harness pays heavily for its honesty |
| **Robustness** | 5/5 same failure mode | 2/3 honest-fail, 1/3 grounded-wrong | Harness output more variable |
| **Surprise** | Model lies fluently when given an out | The harness's "win" is REFUSING to ship, not producing right answers | Re-frames harness's value proposition |

## Implication for harness design

**The original framing was wrong.** I was treating the harness as an "agentic
problem-solving booster" that should make models produce *better answers*.
The empirical evidence says it's actually a **fabrication firewall** — its
job is to recognize when the model is bullshitting and refuse to pass that
through to the user.

This re-frames many things:

1. **Verifier-driven retry's actual job** is to give the model a 2nd chance
   to engage with data, not to "improve" an already-correct answer.
2. **Token cost is the price of trust.** 100× more tokens to ship `""`
   instead of a confident lie may be the correct trade-off for production
   business use cases (per the marketing/sales/SQL agent personas
   discussed earlier — those agents must NOT confidently lie about
   pipeline data, query results, etc.).
3. **The "lift" metric the bench uses (rubric-judged correctness) doesn't
   capture this win.** The bench scores empty output as 0 and confident
   fabrication as 0 too — but they're radically different failure modes
   in production. **We need a "fabrication rate" signal in the bench**
   to credit the harness for its actual contribution.

## Implications for next spike(s)

The hypothesis space updates. Three productive next spikes, in priority order:

### p01: bare-LLM with verification gate (highest leverage)

> HYPOTHESIS: Adding a single verification step (post-LLM, pre-output) that
> checks "did the model actually call any tool before answering?" to bare-LLM
> reduces fabrication rate from 5/5 to <2/5 on rw-2.
>
> If this works: most of the harness's anti-fabrication value comes from a
> single ~30-LOC mechanism. The other ~30 packages are doing other things
> (or not).

### p02: bare-LLM with required-tool nudge (parallel test)

> HYPOTHESIS: A system-prompt addition like "You MUST call at least one
> tool before answering" eliminates fabrications without needing post-hoc
> verification.
>
> If this works: the harness's "agent-took-action" check might be solvable
> by prompting alone for cooperative models. (Almost certainly fails on
> some models; that becomes the data point.)

### p03: cross-model bare-LLM run (validate the failure mode is universal)

> HYPOTHESIS: Bare-LLM fabrication on rw-2 occurs on Anthropic
> claude-haiku and OpenAI gpt-4o-mini at significantly lower rates than
> on cogito:8b (≤1/5 vs 5/5).
>
> Tests whether fabrication is a local-model phenomenon or universal.
> Determines whether harness anti-fabrication mechanisms are needed
> at all for frontier providers.

## Discipline check (per contract Rule 6)

This spike's outcome is **PROMOTE** for the methodology itself:

- The single-file spike approach took ~30 minutes from "no file exists" to
  "decision-grade evidence in hand."
- The result re-framed the harness's value proposition in a way that 6+
  hours of bench analysis didn't surface.
- The signal taxonomy caught the "Quality looks bad / Mechanistic is huge
  win" gap that pure score-based analysis misses.

For p00 itself there's nothing to promote/kill (it's a control), but the
findings prioritize p01-p03 above as the next spikes, before any harness
code is touched.

## Files

- `prototypes/p00-bare-vs-harness.ts` — the spike
- `harness-reports/spike-results/p00-bare-rw2.json` — raw run data
- `harness-reports/bench-comparison-2026-04-27/bench-HEAD-14135d6d.json` — harness comparison data (already collected)
