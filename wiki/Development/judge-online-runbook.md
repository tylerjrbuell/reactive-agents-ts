---
title: Judge-Online Runbook — the honest-grading half of the measurement spine
date: 2026-06-02
status: verified
tags: [measurement, benchmarks, judge-server, runbook]
---

# Judge-Online Runbook

> The measurement spine has two halves: **honest cells** (PreFlight refuses to score a misconfigured-budget cell — shipped) and **honest grading** (a frozen judge distinct from the SUT scores accuracy — this runbook). Together they make the cross-tier benchmark — the vision's proof engine — trustworthy.

## Key finding (2026-06-02)

**Judge-online was an *operational* gap, not a code bug.** The `judge-server` live layer (`packages/judge-server/src/live-layer.ts`) was always sound — it just needed to be RUN. Earlier baselines (e.g. `cs-dishonest-bait` 0% everywhere) were ungraded because nobody started the judge, not because grading was broken.

Verified live both directions with `claude-haiku-4-5`:
- "The capital of France is Paris" → `passed:true, overallScore:1.0, accept` (per-layer: Factual Accuracy / Completeness / Clarity, real reasoning)
- "The capital of France is Berlin" → `passed:false, overallScore:0.0, reject` (factual_accuracy 0, criteria_compliance 0)

This is genuine discrimination, not the stub's flat 0.95.

## Bring it up (turnkey)

```bash
scripts/judge-up.sh                                  # anthropic/claude-haiku-4-5 on :8910
JUDGE_MODEL=gpt-4o-mini JUDGE_PROVIDER=openai scripts/judge-up.sh   # alt judge
```

The script starts the live layer, health-gates `/version`, and prints the `JUDGE_URL` to point the bench at. Requires the provider key in `.env` (Bun auto-loads it).

## Point the bench at it

```bash
JUDGE_URL=http://127.0.0.1:8910 bun run --cwd packages/benchmarks bench --session <session-id>
```

`runSession` reads `session.judgeUrl ?? JUDGE_URL`. Two guards then fire:
1. **Rule-4** (`runner.ts:runSession`) — probes `/version` and REFUSES to run if `judgeModelSha` matches any SUT model (self-preference bias, arXiv:2410.21819). Keep judge ≠ SUT: a cloud judge (haiku/gpt-4o-mini) against a local SUT (qwen) satisfies this.
2. **Capability-source PreFlight** (per-cell) — fallback-source SUT cells go `inconclusive`, never scored.

## Manual grade probe (no bench)

```bash
curl -s -X POST http://127.0.0.1:8910/judge -H "Content-Type: application/json" -d '{
  "taskId":"smoke","sutResponse":"<answer>","taskInput":"<task>",
  "sutModel":"qwen3.5:latest","runId":"probe","taskCriteria":"<oracle>"
}'
```

## pass^k

The bench already carries N≥3 + reliability: the `context-stress` session sets `runs: 3` and `aggregateRuns` computes the `reliability` dimension (`computeReliability`). With the judge online, a graded N≥3 cross-tier run yields the per-tier `pass^k` the convergence design's standing protocol requires.

## Tiers (cross-tier live run)

| Tier | Provider/Model | Available here (2026-06-02) |
|---|---|---|
| local | ollama qwen3.x / cogito | ✅ ollama reachable |
| mid | gpt-4o-mini / claude-haiku | ✅ keys in `.env` |
| frontier | claude-sonnet-4-6 | ✅ keys in `.env` |
| **judge** | claude-haiku-4-5 (≠ SUT) | ✅ verified live |

## Stop

```bash
# the script prints the PID; or:
ps -eo pid,args | grep '[j]udge-server/src/index.ts'
kill <pid>
```

## Why this matters

Every future capability change (WS-4 recitation, experience-reuse, the I4 resolver merge) is now gate-able against a REAL accuracy signal — not faith. This completes the measurement spine: we can prove design lift, cross-tier, before shipping it default-on.
