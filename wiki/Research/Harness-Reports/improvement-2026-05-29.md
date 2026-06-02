---
title: Harness Improvement Session 2026-05-29
date: 2026-05-29
tags: [harness, frontier, recall, compression, efficiency, provider-routing]
status: findings-only (NO code changes — branch owned by canonical-refactor agent)
related:
  - "[[improvement-2026-05-28]]"
  - "[[2026-05-28-canonical-refactor]]"
---

# Harness Improvement Session — 2026-05-29

## Scope + constraint

User redirect: probe the harness on **the models most likely to be used by
users** — i.e. frontier API tiers, not the local-tier weak models prior
sessions chased. Hard constraint mid-session: **make NO code changes** —
another agent is actively executing
`wiki/Planning/Implementation-Plans/2026-05-28-canonical-refactor.md` on this
branch (`restructure/canonical-refactor-2026-05-28`). This is a
**findings-only** report. The refactor is *structural* (runtime layer
mutation chain, kernel capability DAG, casts); the findings below are
*behavioral* and orthogonal — hand-off candidates for after the refactor
lands.

Probe: `task-quality-gate.ts` (T1–T5), `withCalibration("auto")`, default
harness. Keys loaded from `.env` (Bun auto-load).

## Headline

**On the models users actually run, the harness is clean.** The quality-gate
failure modes from 2026-05-28 (F1/F2/F5) do **not** appear on frontier
providers in the T1–T5 suite. Note the scope limit: F3 (classifier
owner/repo→web-search) and F4 (recall-by-query-vs-key) come from the
github-MCP / owner-repo scenario, which was **NOT exercised on frontier this
session** — they are "not observed here," not proven absent on frontier.

| Model (provider) | avg composite | T5 faith | T3 recall-smell | notes |
|---|---|---|---|---|
| gpt-4o-mini (openai) | 97% | 60% | **YES** | T5 faith is the known citation-metric mismatch, not fabrication |
| claude-sonnet-4-6 (anthropic) | 100% | 93% | **YES** | cleanest; T3 done in 1.8K tok |
| gemini-2.5-flash (gemini) | 100% | 100% | **YES** | T5 perfect |

(Local-tier baselines for diff, prior session: cogito:latest ~85–87%,
qwen3:14b ~89%.)

## The one model-independent finding — T3 recall-via-truncation (efficiency)

**Every** frontier model fires `recall()` on **T3 only** (the 25-item fetch),
never on T1/T2/T4/T5 (smaller lists). Composite stays 100% — output is
correct — but it costs an extra LLM round-trip.

### Trace evidence — gemini-2.5-flash T3, run `01KSTNRZ2J8J6QMWJSP1JY1KEH`

```
iter0  get-hn-posts        → 25 posts fetched, observation TRUNCATED in-context
iter1  recall(full:true)   → model's own rationale (verbatim):
       "To access the complete list of Hacker News posts, which was
        truncated in the previous tool output, I need to use recall with
        the full: true parameter to retrieve all the necessary data for
        sorting and formatting."
iter2  final-answer        → correct top-3-by-comments output
```

Cost: the **universal, robust** cost is the extra LLM round-trip —
**3 llmCalls instead of 2** (think→recall→think) on every frontier model.
Token cost is model-dependent: gpt-4o-mini T3 = 11.9K vs ~5.8K norm (~2×);
gemini T3 = 13.0K, in line with its T4 (10.7K) / T5 (12.0K) so NOT 2× there;
sonnet recalled but barely re-read (1.8K). So: lead with the round-trip; the
token blow-up is real on gpt-4o-mini but not uniform.

### Mechanism (VERIFIED from observation payload, not inferred)

The iter0 `get-hn-posts` observation in trace `01KSTNRZ2J8J6QMWJSP1JY1KEH`
shows the compression directly — only **5 of 25** items survive in context:

```
[get-hn-posts result — compressed preview]
Type: Array(25) | Schema: id, title, score, by, descendants, url
Preview (first 5 of 25):
  [0] ... descendants=75 ...
  ...20 more
  — full text is stored. Use recall("_tool_result_2") to retrieve.
```

So observation compression drops the 25-item result to a 5-item preview —
below what a **sort-by-secondary-field** task needs (top-3-by-comments
requires all 25 `descendants` values). The harness *itself* instructs the
model to `recall()` for the rest. Frontier models have **no calibration
profile** → conservative preview default (5 items) → the model follows the
harness instruction and recalls. The recovery path works, so correctness is
preserved, but the harness has forced a manual recall its own design
philosophy says should be unnecessary:

> "Recall is automatic + contextual, not 'agent must call recall()' to
> retrieve data. The harness's job is to ensure all relevant memories are
> IN-CONTEXT and available for synthesis." — `task-quality-gate.ts:14-17`

This is **architectural smell #1** from the probe header, sharpened: not
"recall when data was already in context" but "**recall because the harness
compressed the data OUT of context** for a task that needed it."

Same root the 2026-05-28 session touched for local tiers
(`optimalToolResultChars` 2000→4000 calibration bump). Frontier tiers have no
profile, so they hit the conservative default.

### Why NOT fixed this session
1. User constraint: no code changes (branch owned by refactor agent).
2. It is an **efficiency** finding (Pillar 6), not a correctness defect —
   composite is 100% across all three models.
3. The clean fix touches compression budget / calibration defaults, which
   overlaps WS-3 (kernel capability DAG) and the Recall capability seam the
   refactor is actively reshaping. Fixing now would collide.

### Hand-off candidate (post-refactor)
Two non-exclusive options, to be ablated when the branch is stable:
- **Frontier calibration profiles**: give gpt-4o-mini / claude-* / gemini-*
  a `optimalToolResultChars` high enough that a 25-item list survives
  compression (their context windows are large; the conservative default is
  miscalibrated for them).
- **Task-shape aware compression**: when `taskIntent` needs ranking by a
  per-item field, raise the per-item render budget so the sort key
  (`descendants`) stays visible without a recall round-trip.

## Secondary finding — invalid provider name silently routes to ollama

`withProvider("google")` (wrong — canonical name is `gemini`) did NOT error.
It silently fell back to the ollama default and tried to serve
`gemini-2.5-flash` via ollama → `llm_error`, 0 tokens, 5/5 tasks failed
(produced a 41% scorer-floor fingerprint — the generic "0 output" tell).

- The typed builder API (`withProvider(provider: ProviderName)`) prevents
  this for real callers; only the probe's `as never` cast reached it.
- Still a robustness gap: an unknown provider string should fail loud, not
  degrade to a confusing downstream `llm_error`. Low priority; noting for a
  future honesty-pass (WS-5) sweep.
- **Diagnostic lesson:** a 0-token / 41%-floor result is NOT a harness failure
  mode — it is an infra/config failure. Check provider routing before reading
  it as a quality signal. NB: the earlier qwen3.6:27b 0-token run produced the
  **same 41% fingerprint but a DIFFERENT cause** — it ran on the *correct*
  default provider (ollama) and genuinely failed to serve the 17GB model
  locally (OOM/load). Same scorer floor, two distinct root causes; the
  fingerprint is a "0-output" tell, not a shared bug.

## Verified-clean (do not resurface as frontier issues)
- T5 long-form synthesis: 60% faith on gpt-4o-mini is the quality-gate
  citation-ratio metric vs paraphrase mismatch (advisor-flagged 2026-05-28),
  NOT fabrication — sonnet 93%, gemini 100% confirm the metric, not the model.
- F2 (synthesis-grounded no-op) from 2026-05-28: not observed in frontier
  T1–T5.
- F3 (classifier owner/repo→web-search), F4 (recall-by-query): **scenario not
  run on frontier** — these need the github-MCP / owner-repo probe, not
  task-quality-gate. Status: untested on frontier, NOT cleared.

## Artifacts
- `task-quality-gate-gpt-4o-mini-2026-05-29T20-05-38.json`
- `task-quality-gate-claude-sonnet-4-6-2026-05-29T20-07-35.json`
- `task-quality-gate-gemini-2-5-flash-2026-05-29T20-10-40.json` (correct provider)
- Trace `01KSTNRZ2J8J6QMWJSP1JY1KEH` (gemini T3 recall narrative)
