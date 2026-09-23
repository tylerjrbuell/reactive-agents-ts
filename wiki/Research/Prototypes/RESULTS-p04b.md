---
type: measurement
status: complete
created: 2026-09-23
tags: [research, prototypes, judgment, spike, memory]
---

# RESULTS — p04b: jev rerank vs lexical-similarity baseline for memory recall

**Date:** 2026-09-23
**Spike:** [`p04b-memory-rerank.ts`](./p04b-memory-rerank.ts)
**Outcome:** **WORTH-IT** — large, decisive lift, but see the baseline-fidelity caveat before scoping a build

## Hypothesis (locked before run)

> `packages/memory` has zero judgment coverage today (confirmed: no
> `@reactive-agents/judgment` import anywhere under `packages/memory/src`).
> A jev Score-based rerank over the same candidate set should beat a pure
> lexical-similarity baseline, especially on paraphrased/indirectly-worded
> queries.
>
> PROMOTE: jev top-1 hit rate >= baseline + 15pp, AND jev mean-rank-of-correct
> <= baseline mean-rank-of-correct - 0.5.
> KILL: jev top-1 hit rate <= baseline, or mean rank not improved.

## Method

18 labeled `(query, 5 candidates, correct-candidate-id)` cases, authored to
represent the shape of real episodic/semantic memory content (decision
records, incident notes, benchmark results, policy statements). **Disclosed
as synthetic** — `packages/memory/src/**` was read-only per the MissionBrief
and no populated memory DB was available to draw real content from within
this probe's scope. 7 of 18 cases were deliberately adversarial: the correct
candidate has low lexical overlap with the query (paraphrase), and/or a
decoy candidate shares many query keywords but is topically wrong or states
the opposite fact.

Baseline: TF-cosine similarity (case-local corpus, no IDF) between query and
each candidate — **explicitly a proxy for a real embedding-cosine baseline**,
not the genuine article. A real embedding-model call was out of scope for
this probe's budget; this is disclosed here as a limitation, not glossed
over.

jev: one batched `ask()` per case, one Score question per candidate
(3-level relevance rubric: not-relevant / somewhat-relevant / highly-relevant),
ranked by returned Score value descending.

## Result

```
SUMMARY (n=18):
  top-1 hit rate: baseline=7/18 (38.9%)  jev=18/18 (100.0%)
  mean rank of correct: baseline=2.11  jev=1.00
  adversarial subset (n=7): baseline top-1=3/7  jev top-1=7/7
```

jev put the correct candidate at rank 1 in **every single case**, including
all 7 adversarial ones (paraphrase-only overlap, or a decoy sharing more
surface keywords). The TF-cosine baseline got only 38.9% top-1, exactly as
expected for a lexical-overlap signal facing paraphrase and false-keyword-
overlap traps.

## What this does and doesn't justify

- **Clears both promotion criteria by a wide margin** (61.1pp top-1 lift,
  1.11 mean-rank improvement vs the 15pp / 0.5 bars). This is a strong,
  unambiguous WORTH-IT signal for the *shape* of the mechanism: Score-based
  jev rerank over a small candidate set beats a term-overlap baseline,
  especially on the paraphrase/false-keyword-overlap cases that are exactly
  where lexical/FTS5-only recall is known to fail.
- **Does not by itself justify a specific integration design.** Real
  `packages/memory` recall uses vector-similarity (sqlite-vec KNN) + FTS5
  union, not raw TF-cosine — this probe's baseline is a proxy, one level
  further from the real embedding baseline than ideal. A real embedding
  model's cosine similarity is a materially stronger baseline than raw term
  overlap (embeddings already capture some paraphrase similarity), so the
  TRUE lift over the production vector-similarity baseline is very likely
  smaller than 61pp — possibly much smaller. **Before scoping a build, rerun
  this exact case set against the real `packages/memory` vector-similarity
  ranking** (not a TF-cosine proxy) to get the true baseline delta.
- **A 100% jev top-1 result on a self-authored case set is itself a soft
  signal to distrust slightly** — cases written by the same person proposing
  the mechanism are more likely to land squarely in jev's strengths (natural-
  language relevance judgment) by construction. A perfect score invites a
  "too easy" concern, not just a "too good" one.
- Candidate count was fixed at 5 per case (matching a plausible top-K recall
  fan-out) — untested at production-scale candidate counts (which could be
  10-50+), where a single batched `ask()` per query may hit the same
  per-request question-count pragmatics `judgment-classification.ts`'s
  `CHUNK_CAP = 30` already anticipates for a different shadow site.

## Limitations

- n=18, synthetic cases, single author, single measurement session.
- Baseline is TF-cosine, not the real vector-similarity/FTS5 union recall
  path — this is the single most important caveat and should gate any
  scoping decision.
- No latency/cost measurement was captured for this probe (out of scope —
  the MissionBrief's success criterion for Probe B was rank-quality only).
  A real integration would add ≥1 jev round trip per recall call; that cost
  needs its own measurement before a build decision.

## Verdict

**WORTH-IT, conditionally.** The mechanism shape (Score-based rerank beating
a term-overlap baseline, especially on paraphrase cases) is a real, large
effect on this data. **Recommended next step before scoping a build:**
re-run this same case set (or a real-memory-derived one) against
`packages/memory`'s actual vector-similarity ranking as the baseline, and
add a latency/cost measurement — both were explicitly out of this probe's
narrow scope but are the two gaps between "promising spike" and "a build
decision."
