---
type: measurement
status: complete
created: 2026-09-23
tags: [research, prototypes, judgment, spike]
---

# RESULTS — p04d: does richer state presentation change complexity-router agreement?

**Date:** 2026-09-23
**Spike:** [`p04d-state-presentation-bias.ts`](./p04d-state-presentation-bias.ts)
**Outcome:** **NOT-WORTH-IT** — zero measured effect; disagreement is a routing-shape issue, not a presentation artifact

## Scope correction (made before running, not after seeing results)

The MissionBrief targeted "strategy-selection/complexity-router
disagreement." This probe tests **complexity-router only**, because it has
a standalone, exported, deterministic heuristic (`heuristicClassify`) to
compare against. Strategy-selection's heuristic logic lives un-exported
inside `adaptive.ts` and isn't reusable without duplicating undocumented
internals — testing it would have required either exporting new surface
from `adaptive.ts` (out of scope: read-only authority on
`packages/reasoning/src/**`) or re-deriving the heuristic by hand (risking a
silently-wrong proxy). Complexity-router's 93.5% baseline agreement (per the
2026-09-23 report) is already high, but the presentation question
generalizes regardless of which site's absolute agreement rate is higher.

## Hypothesis (locked before run)

> Fetched `docs.typesafe.ai/concepts/state` live before writing this probe.
> Its guidance: "use an object for most requests so each part of the state
> has a descriptive name," group related information, and keep state to
> facts (not criteria/instructions, which belong in questions). Today's
> shipped state for complexity-router is `{task: string}` — a single
> unlabeled field. Enriching it with descriptively-named derived facts
> (word count, keyword-presence booleans, explicit "first turn" context)
> should raise agreement with the heuristic if some of today's disagreement
> is a presentation artifact rather than a genuine reasoning-shape gap.
>
> PROMOTE: enriched-state agreement >= current-state agreement + 10pp.
> KILL/INCONCLUSIVE: enriched agreement within +/-5pp of current, or lower.

## Method

Same 20 tasks as p04a/p04c. Two state conditions, same unchanged Choice
question both times (isolates presentation from question/routing shape):

- **CURRENT:** `{task}` — the real shipped `buildComplexityJudgmentState`
  payload, verbatim.
- **ENRICHED:** `{taskText, taskWordCount, mentionsCodeKeyword,
  mentionsMultiStepKeyword, mentionsAnalysisKeyword, conversationContext}`
  — deterministic, descriptively-named derived facts (no LLM, no hand
  labeling), following the docs' "descriptive field names" + "facts not
  criteria" guidance. Ran both conditions concurrently per case
  (`Promise.all`) against the real, unmodified `heuristicClassify(task)` as
  the agreement baseline.

## Result

```
SUMMARY (n=20):
  current-state agreement: 13/20 (65.0%)
  enriched-state agreement: 13/20 (65.0%)
  delta: 0.0pp
```

**Exactly zero measured effect.** Both conditions agreed with the heuristic
on the identical 13 cases and disagreed on the identical 7 — same count,
same *cases* (verified in the raw per-case output). 6 of the 7 disagreements
also picked the identical judged tier under both conditions (e.g. both
picked `sonnet` where the heuristic said `haiku` on "Debug this script...
find the root cause and fix it"); one case ("First, fetch the current
weather for Tokyo, then convert...") picked `haiku` under CURRENT vs
`sonnet` under ENRICHED — both still disagreeing with the heuristic (which
itself returned `null`/no-match on that task), so it doesn't change the
agreement count, but it's the one case where enrichment measurably moved
jev's answer without moving the final agreement verdict.

Note: this run's 65.0% agreement (13/20) is lower than the 2026-09-23
report's 93.5% (29/31) for the same site — expected, since this probe's
20-case set deliberately mirrors p04a's task mix (weighted toward multi-step
and analysis-heavy prompts to stress the strategy-selection/comprehension
sites in the other 3 probes), not resampled to match that report's
tier-balanced distribution. The absolute agreement rate isn't the finding
here; the **zero delta between the two state conditions on the identical
case set** is.

## What this does and doesn't justify

- **Justifies NOT pursuing state-enrichment as a fix for shadow-site
  disagreement**, at least not the enrichment style tested here
  (structured derived facts, descriptive field names). The disagreement
  complexity-router shows is a genuine reasoning-shape gap between the
  regex heuristic and jev's read of the task — not fixable by better
  labeling the same information.
- **Does not rule out all forms of state enrichment.** This probe tested
  one specific enrichment (deterministic derived facts + explicit
  conversation-context field). It did not test, e.g., adding few-shot
  examples to state, or restructuring the Choice criteria themselves
  (a routing-shape change, explicitly out of scope for isolating
  presentation).
- **Strengthens the case that any future disagreement-reduction work should
  target the question/routing shape, not the state payload** — consistent
  with p04c's finding that a 2-stage split (a routing-shape change) also
  didn't cleanly help, suggesting the disagreement here is a harder,
  substantive gap between how the heuristic and jev each read task
  complexity, not a cheap wiring fix in either direction tested so far.

## Limitations

- n=20, single session, one specific enrichment design — a materially
  different enrichment strategy (e.g. including retrieved examples, or
  restating the Choice rubric within state against the docs' own advice)
  might behave differently; this probe deliberately followed the docs'
  guidance rather than testing an anti-pattern for contrast.
- Tests complexity-router only, not strategy-selection (see scope
  correction above) — the 74.2% agreement site the MissionBrief was most
  interested in remains untested for this specific question.

## Verdict

**NOT-WORTH-IT** for the enrichment style tested. Zero measured effect on
the identical case set is a clean, decisive negative result, not an
ambiguous one — the disagreement complexity-router shows against the regex
heuristic is not a state-presentation artifact.
