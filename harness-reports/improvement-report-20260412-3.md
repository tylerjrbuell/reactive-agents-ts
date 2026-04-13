# Harness Improvement Report — Pass 3

> **Instructions for the agent filling this template:**
> Fill every field with real observed data. If a field says "measured from probe output" — only fill it from actual JSONL events or console output. Never fill it from code reading alone. "?" is acceptable only for metrics that could not be extracted. Delete this instruction block when saving the report.

---

## Session Header

| Field                   | Value                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------- |
| Pass number             | {N}                                                                                   |
| Date                    | {YYYY-MM-DD}                                                                          |
| Focus area              | {e.g., "termination quality" / "context pressure" / "loop efficiency" / "full sweep"} |
| Probes run              | {list probe IDs}                                                                      |
| Changes since last pass | {git log --oneline since last report, or "first pass"}                                |
| Agent model used        | {e.g., claude-sonnet-4-6}                                                             |
| Total probe cost        | ${total across all probes}                                                            |

---

## Probe Run Summary

Fill from probe runner console output and `harness-reports/probe-summary.json`.

| Probe ID            | Strategy             | Iterations Used / Max | Wasted Iters¹ | Duplicate Tool Calls | Context Peak² | Quality Score³ | Duration | Cost | Pass? |
| ------------------- | -------------------- | --------------------- | ------------- | -------------------- | ------------- | -------------- | -------- | ---- | ----- |
| trivial-1step       | reactive             | ? / 5                 | ?             | ?                    | ?%            | ?              | ?s       | $?   | ✅/❌ |
| multistep-research  | plan-execute-reflect | ? / 15                | ?             | ?                    | ?%            | ?              | ?s       | $?   | ✅/❌ |
| tool-heavy          | adaptive             | ? / 12                | ?             | ?                    | ?%            | ?              | ?s       | $?   | ✅/❌ |
| context-pressure    | plan-execute-reflect | ? / 20                | ?             | ?                    | ?%            | ?              | ?s       | $?   | ✅/❌ |
| termination-quality | adaptive             | ? / 10                | ?             | ?                    | ?%            | ?              | ?s       | $?   | ✅/❌ |

¹ Wasted iterations = think iterations that produced no tool call and no final-answer  
² Context peak = highest context ratio seen in any think phase for this probe  
³ Quality score = final quality score emitted before termination (from JSONL)

**Pass/Fail criteria per probe:**

| Probe               | Fail conditions                                                   |
| ------------------- | ----------------------------------------------------------------- |
| trivial-1step       | iterations > 1, OR any tool call fired                            |
| multistep-research  | hit maxIterations, OR output has no citations                     |
| tool-heavy          | > 3 web-search calls, OR duplicate searches with same query       |
| context-pressure    | auto-checkpoint did NOT fire, OR output is truncated mid-sentence |
| termination-quality | hit maxIterations on a clearly answerable question                |

---

## Baseline Metrics (first pass only — carry forward unchanged)

Establish what the harness is currently doing so future passes have a reference point.

| Metric                                         | Measured Value | How Measured               |
| ---------------------------------------------- | -------------- | -------------------------- |
| Avg iterations for trivial task                | ?              | trivial-1step probe        |
| Avg iterations for research task               | ?              | multistep-research probe   |
| Token efficiency (output chars / input tokens) | ?              | cost data                  |
| Auto-checkpoint trigger ratio                  | ?%             | context-pressure JSONL     |
| Quality score at termination (typical range)   | ?–?            | termination-quality JSONL  |
| Reflect phase improvement delta                | ?              | plan-execute-reflect JSONL |

> After Pass 1, lock this section. It is the zero-line. All improvements are measured against it.

---

## Observed Weaknesses

One entry per distinct observed weakness. Only include weaknesses with evidence from probe output.

---

### [W{N}] {Concise weakness title}

**Severity:** `high` / `medium` / `low`

> Severity guide:
>
> -   **high** — causes task failure, infinite loops, or context truncation that loses the answer
> -   **medium** — wastes ≥ 3 iterations or ≥ 30% of token budget on a probe that should use fewer
> -   **low** — measurably suboptimal but task still completes correctly

**Probe(s) where observed:** {probe-id, probe-id}

**Observed behavior:**

```
{Paste the exact console output or JSONL event sequence that shows the problem.
 Minimum: 3 events showing the pattern. Actual output, not paraphrase.}
```

**Expected behavior:**
{One sentence: what should have happened instead, stated as a measurable condition}

**Measured delta:**

-   Iterations wasted: {N} (expected 0)
-   Tokens wasted: ~{N} (from cost delta vs expected)
-   Quality score at premature termination: {N} (threshold is {N})
-   _(use whichever metrics apply — delete irrelevant ones)_

**Root cause hypothesis:**
{File path + function/line where the decision is made. What condition in the code leads to this behavior. Be specific — "the termination oracle checks X but not Y" not "the termination logic seems off".}

**Source evidence:**

```bash
# Command used to find this in code:
grep -n "relevant_function" packages/reasoning/src/...
```

**Impact:** {What types of tasks / users are hurt by this. Estimate: % of tasks affected.}

**Status:** `OPEN` | `IN-PROGRESS (Pass N)` | `FIXED (Pass N)` | `WONTFIX`

---

_(repeat [W{N}] block for each weakness)_

---

## Improvement Candidates

Ranked by: **impact score** (1–5) × **inverse effort** (1=hardest, 5=easiest). Highest product first.

| IC ID  | Weakness Ref | Change Required                          | File:Line    | Impact | Effort | Score     | Risk         | Success Criteria                                       |
| ------ | ------------ | ---------------------------------------- | ------------ | ------ | ------ | --------- | ------------ | ------------------------------------------------------ |
| IC-{N} | W{N}         | {Specific, scoped change — one sentence} | {file:~line} | 1–5    | 1–5    | {product} | low/med/high | {What the probe would show after the fix — measurable} |

**Success criteria must be measurable from probe output.** Examples of good criteria:

-   "trivial-1step completes in 1 iteration (currently 3)"
-   "quality score ≥ 0.85 causes termination before maxIterations (currently never triggers early)"
-   "context-pressure probe: auto-checkpoint fires at ≤ 85% context ratio (currently 95%)"

Bad criteria (too vague — do not use):

-   "output quality improves"
-   "agent is more efficient"
-   "termination logic is better"

---

## Regression Watch

Probes that are currently **passing** and must not regress. For each IC, note which passing probes could be affected.

| IC ID  | Passing Probes at Risk | What to Re-Run After Fix   |
| ------ | ---------------------- | -------------------------- |
| IC-{N} | {probe-id}             | {specific thing to verify} |

---

## Carry-Forward from Prior Reports

Copy the weakness table from all prior reports. Update status column only. Do not rewrite descriptions — the original observed text is the historical record.

| Weakness ID | First Seen | Title   | Severity     | Status                          | IC ID  |
| ----------- | ---------- | ------- | ------------ | ------------------------------- | ------ |
| W{N}-P{N}   | Pass {N}   | {title} | high/med/low | OPEN / FIXED (Pass N) / WONTFIX | IC-{N} |

---

## Next Pass Focus

Max 3 items. Each must be a falsifiable hypothesis to test with a probe.

1. **Hypothesis:** {specific claim about harness behavior}
   **Test:** {which probe, what variant, what to look for in output}
   **Why now:** {what this report revealed that makes this the highest-value next question}

2. ...

3. ...

---

## Handoff Tickets

One ticket per IC you are handing off to `agent-tdd`. Copy these verbatim into the TDD session.

---

### Ticket: IC-{N}

**From report:** `harness-reports/improvement-report-{DATE}-{N}.md`
**Weakness:** {W title and description in 1–2 sentences}
**File:** `{packages/reasoning/src/...}`
**Change:** {Specific change described at the function/condition level}
**Test to write:**

-   File: `packages/reasoning/tests/{...}.test.ts`
-   Scenario: {Input state description}
-   Expected: {What the function should return}
-   Currently: {What it actually returns — from probe evidence}
    **Regression guard:** Run probe `{probe-id}` after fix. Expect `{measurable outcome}`.

---

_(repeat ticket block for each IC being handed off)_
