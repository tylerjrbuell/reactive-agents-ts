---
date: 2026-09-23
type: measurement
status: complete
related:
  - "[[Implementation-Plans/2026-09-23-judgment-primitive-phase-d-leverage]]"
  - "[[Research/Harness-Reports/2026-09-23-judgment-methodology-gate]]"
  - "[[Research/Harness-Reports/2026-09-23-shadow-site-exit-gates]]"
---

# Phase D Exit Gates — Completion/Termination + Grounding/Fabrication Shadow Sites

Real jev-backend data for Task 2's `completion-satisfied` and Task 3's `grounding-fabrication`
shadow sites. **This report supplies the data each task's Step 4 gate asked for. It does NOT invert
either site into a real decision — that stays a separate, explicit follow-up decision, per the same
boundary Phase C's exit gates and this plan's own "Explicitly out of scope" section state.**

## Method

Both shadow functions (`judgmentCompletionShadow`, `judgmentGroundingFabricationShadow`) are called
**directly** against the real jev backend with curated `(task, candidateOutput, heuristicVerified)`
/ `(claim, evidence, heuristicGrounded)` triples, rather than via full live-agent runs.

This deviates from Phase C's and Task 9/9b/10's live-agent-run methodology, and the reason is
specific to this task: Task 2's shadow site fires on every terminal verification (trivial to hit via
a live agent run), but Task 3's site only fires on a narrow, rare edge case documented in its own
code comment — `status === "done" && !state.output && countDeliverableCandidates(state) > 0`, the
"model shipped empty final output despite having done real tool work" case its comment traces to a
2026-06-29 cross-tier sweep (gpt-4o-mini and sonnet both hit it). Forcing that specific edge case
reliably via live prompts would be unreliable and non-representative of the actual judgment quality
question. Calling the shipped shadow function directly with the exact same question/state shape it
uses in production — the same class of methodology as the Task 6 frozen-dataset gate — exercises the
real jev backend against curated ground truth without needing to coerce live-model behavior into a
rare branch.

**32 cases per site** (64 total), spanning: complete/satisfying vs. partial/evasive/give-up
responses for Task 2; well-grounded, restated, and deliberately-fabricated claims for Task 3. Both
case sets include a few cases where the *heuristic's own* verdict was set adversarially (e.g. marked
`heuristicVerified: false` for an objectively complete answer) to probe whether jev sides with
correctness against a wrong baseline, not just with the baseline. Full case list and raw output:
`.superpowers/sdd/2026-09-23-judgment-primitive-phase-d-leverage/shadow-collection-task2-task3.ts`
(gitignored scratch script, not committed — this report is the durable record).

## Results

| Site | n | Agreement | Disagreements |
|---|---|---|---|
| Completion/termination (Task 2) | 32 | 87.5% (28/32) | 4 |
| Grounding/fabrication (Task 3) | 32 | 90.6% (29/32) | 3 |

### Completion/termination — jev runs stricter, never more permissive

All 4 disagreements run the same direction: **jev never rescues a heuristic's `verified: false`,
and 3 of 4 times jev is MORE demanding than a heuristic `verified: true`** — the reverse of the
dangerous direction (which would be jev calling an evasive/give-up response "complete").

- 3 cases: heuristic said `verified: true`, jev said not-satisfied. One (`"The French Revolution
  happened because of economic problems"` for "explain the causes") is a genuine catch — a
  single-cause, shallow answer to a multi-cause question — the heuristic's containment/pattern check
  has no way to judge depth, jev does. The other two (a correct-but-terse photosynthesis explanation,
  a correct-but-terse REST API design) are more debatable: jev appears to want more elaboration than
  the task strictly required, on answers that are factually complete just brief.
- 1 case ran the other way and confirms jev isn't just rubber-stamping the heuristic: a
  deliberately-adversarial case (`heuristicVerified: false` set artificially on an objectively
  correct, complete answer — "why is the sky blue") had jev correctly side with `judged: true`
  against the wrong baseline.

**Headline: zero disagreements in the dangerous direction** (jev calling an evasive/incomplete
response "satisfying" when the heuristic correctly rejected it). The one real product-relevant
finding is a possible over-strictness bias on terse-but-correct answers — worth more samples before
any inversion, not a blocker.

### Grounding/fabrication — jev over-flags exact numeric restatement, never under-flags fabrication

All 3 disagreements share a direction too, and it is the **safe** one for this site specifically:
jev flagged content as **not** grounded (`judged: "false"`) in 3 cases where the heuristic correctly
said `heuristicGrounded: true` — a stock price, a test-count summary, and a Node version constraint,
all near-verbatim restatements of the evidence. **Zero occurrences of the dangerous direction** the
brief explicitly asked to weight sampling toward: jev never called a real fabrication "grounded."
Every deliberately-fabricated claim in the 32-case set (embellished dollar amounts, invented root
causes, fabricated specifics layered onto a terse log line) was correctly flagged by jev and matched
the heuristic's own reject verdict.

The 3 false-positive-on-caution cases suggest jev may be pattern-matching on "does this look like an
exact quote" more strictly than the actual semantic question ("is every fact here supported") — a
precision issue, not a safety issue, since it makes jev *more* cautious than the heuristic, not less.

## What this does and doesn't justify

- **Neither site's 0% dangerous-direction-disagreement result should be read as "safe to invert."**
  n=32 per site is the plan's stated minimum, not a production-traffic sample — same limitation
  Phase C's own shadow-gate report flagged for its synthetic-scenario data.
- The completion-judgment's terseness-over-strictness signal (2 of 4 disagreements) and the
  grounding-judgment's exact-restatement over-flagging (3 of 3 disagreements) are both worth a larger
  follow-up sample specifically targeting those two shapes before any inversion decision — the
  directional consistency here is suggestive, not yet conclusive at n=32.
- Both sites stay shadow-only, per the plan's explicit scope. No code change resulted from this
  report.

## Limitations

- Direct-call methodology (not live-agent runs) for both sites — see Method above for why, but this
  means the `candidateOutput`/`claim`/`evidence` inputs were authored, not organically produced by a
  live model mid-run. A follow-up drawing real values from actual kernel state (live agent runs that
  happen to hit Task 3's rare branch, logged over time in shadow mode) would be stronger evidence,
  especially for Task 3 where the triggering condition is itself rare in practice.
- Task 3's shadow is wired into only 1 of `assembleDeliverable`'s 6 call sites (a scoping decision
  made during implementation, not this measurement pass) — this report's direct-call methodology
  sidesteps that limitation for THIS measurement, but production shadow volume through the wired site
  alone will likely be much lower than n=32 per unit time; widening to the other 5 sites is a
  separate follow-up.
- Same single-session-authorship caveat as Phase C's report: cases were constructed by the person
  writing this report, which risks confirmation bias in what counts as "clearly complete" or
  "clearly fabricated."
