---
date: 2026-09-23
type: measurement
status: complete
related:
  - "[[Implementation-Plans/2026-09-20-typesafe-judgment-layer]]"
  - "[[Research/Harness-Reports/2026-09-23-judgment-methodology-gate]]"
  - "[[Hot]]"
---

# Judgment Shadow-Site Exit Gates — Real Data (Tasks 9 / 9b / 10 / 11b)

Real live-API runs collecting `JudgmentShadow` agreement data at all four shadow sites the Phase C
runtime tier added, using the `jev` backend (validated by the methodology gate above). **This report
supplies the data each site's Step 4 gate asked for. It does NOT invert any site — inverting a shadow
into a real decision is a separate, explicit follow-up decision per the plan's own wording, not taken
here.**

## Method

**Tasks 9 / 9b / 10** (strategy-selection, complexity-router, task-comprehension): one real agent
(`claude-haiku-4-5-20251001`, `.withReasoning({defaultStrategy:"adaptive"})`, `.withModelRouting({})`,
`.withJudgment({backend:"jev"})`) run against 31 varied real prompts — a mix of simple factual
questions (haiku-tier), moderate multi-step tasks, and complex analysis/design/critique prompts
(intended to span the full strategy/tier range) — each run capped at 45s wall-clock (several longer
`plan-execute`/`tree-of-thought` dispatches were cut off mid-execution, which is fine: the shadow
fires early, during strategy classification, well before the dispatched strategy finishes running).

**Task 11b** (autonomy-confidence, the highest-blast-radius site): 50 synthetic-but-realistic approval-
pattern scenarios (10 task types × 5 pattern shapes each) run through the real `PreferenceLearner`
against the real `jev` backend — no fake `JudgmentService`. Pattern shapes deliberately spanned both
auto-approve-worthy cases (established, consistently-approved, low-risk cost) and escalate-worthy
cases (sparse history, inconsistent/denied history, cost-threshold breaches), per the plan's explicit
instruction not to sample only the easy side.

## Results

| Site | n | Agreement | Disagreements |
|---|---|---|---|
| Strategy selection (Task 9) | 31 | 74.2% (23/31) | 8 |
| Complexity routing (Task 9b) | 31 | 93.5% (29/31) | 2 |
| Task comprehension (Task 10) | 135 (multi-question fan-out per run) | 98.5% (133/135) | 2 |
| Autonomy confidence — `safeToAutoApprove` (Task 11b) | 50 | 96.0% (48/50) | 2 |
| Autonomy confidence — `preferenceMatch` (Task 11b, secondary) | 50 | 60.0% (30/50) | 20 |

### Strategy selection — the interesting one

All 8 disagreements share the same direction: **jev always picked a more exploratory/planning
strategy than the heuristic did**, never a simpler one — `tree-of-thought` or `blueprint` where the
heuristic picked `reactive`/`reflexion`/`plan-execute-reflect`. This is a consistent, interpretable
bias, not noise: on the complex analysis/design/critique prompts in this set, jev consistently reads
them as warranting more deliberate exploration than the keyword heuristic does. Whether that's jev
being *right* (heuristic under-escalates genuinely hard tasks) or *overcautious* (jev over-escalates
tasks a simpler strategy handles fine) isn't answerable from agreement rate alone — it needs the
actual task outcomes compared, which this pass didn't measure (out of scope for a shadow-agreement
gate). Flagging this as the one site where "run more samples before inverting" is a real recommendation,
not a formality.

### Complexity routing & task comprehension — narrow, explainable disagreement

Complexity routing's 2 disagreements were both `jev:"sonnet"` vs heuristic `"haiku"` — jev tends
slightly more conservative (higher tier) on borderline cases, never the reverse direction, and never a
2-tier jump. Task comprehension's 2 disagreements (out of 135) were isolated single-question misses
(`citation-needed` and `output-format`), not a systematic pattern.

### Autonomy confidence — the headline metric, per the plan's own instruction

The plan explicitly asks for **false-auto-approval risk**, not agreement rate, as the headline number
here (a wrong classifier answer costs accuracy; a wrong auto-approval costs an unreviewed action).
Both of the 2 `safeToAutoApprove` disagreements were `judged:"true", current:"false"` — i.e. **jev
would have auto-approved an action the existing static gate correctly escalated to a human, in 2 of
the 30 escalate-worthy scenarios in this set (6.7%)**. Zero disagreements ran the other direction
(jev never recommended escalating something the gate auto-approved). This is exactly the risk the
plan's blast-radius framing anticipated, and exactly why Task 11b was scoped shadow-only with no
inversion task written.

The secondary `preferenceMatch` signal (meant to eventually replace the hand-tuned `+0.1` confidence
increment) showed lower agreement (60%) against its heuristic-bucketed comparison value, but every
disagreement was one-bucket-adjacent (`strong` vs `plausible`, never `sparse` vs `strong`) — consistent
with comparing a continuous judgment to a coarse 3-bucket heuristic proxy, not a real quality problem.

## What this does and doesn't justify

- **Complexity routing and task comprehension** cleared a high bar (93.5% / 98.5%, narrow and
  explainable disagreements) — these are the two sites where writing an inversion task next would be
  the reasonable next step, pending the user's explicit sign-off (this report doesn't do that).
- **Strategy selection** needs more samples and, ideally, outcome data (not just agreement) before any
  inversion decision — the consistent directional bias is worth understanding, not averaging away.
- **Autonomy confidence stays shadow-only, full stop.** The plan is explicit that a positive result
  here justifies a *follow-up plan with its own explicit human sign-off step* — not an inversion task
  in this plan. The 6.7% false-auto-approval rate on escalate-worthy cases is the number that follow-up
  plan would need to weigh, and this report surfaces it rather than deciding it.

## Limitations

- n=31/50 clears each site's stated minimum (≥30, ≥50 for 11b) but is still a single measurement
  session, not a production-traffic sample. The plan's Task 11b gate specifically asks for real
  production shadow data, not synthetic scenarios — this run used realistic-but-constructed scenarios,
  a reasonable proxy but not the same evidentiary bar as live user traffic.
- Strategy-selection/complexity-routing tasks were authored by the same person writing this report,
  which risks confirmation bias in task selection — a follow-up pass drawing tasks from real historical
  usage (if available) would be stronger evidence.
