---
title: "#7 PostCondition spine ablation — VERDICT: DO NOT FLIP (false-unmet bug found)"
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
harness: apps/examples/postconditions-ablation.sh (run b48ghnora)
verdict: DO NOT FLIP — RA_POST_CONDITIONS=1 false-blocks 100% of deliverable runs
---

# #7 PostCondition ablation — RA_POST_CONDITIONS 0 vs 1

N=3, local cogito:14b (dishonest-prone probe) + mid haiku (honest control), deliverable
tasks (commits.md / agents-summary.md), RA_ASSEMBLY fixed ON.

## Result — arm B (pc1) is BROKEN

| cell | pc0 (off) | pc1 (on) |
|---|---|---|
| mid summary | success ✓, file cov=**1.0**, final_answer_tool, ~4k tok | success **✗**, file cov=**1.0**, **max_iterations** |
| mid commits | success ✓, file 913B, final_answer_tool | success **✗**, file 913B, **max_iterations** |
| local summary | 2/3 success (cov .82/.95) | **0/3 success**, files present (cov 1.0/.68/.73), max_iter, +tokens |
| local commits | 3/3 success, file present | **0/3 success**, file present, max_iter, +tokens |

**arm B false-blocks EVERY deliverable run — including perfectly-completed ones (file
present, cov=1.0).** Turns honest successes into max_iterations failures. No
dishonest-success existed to catch (DISH=false everywhere — both models actually wrote
the files), so the WIN was not exhibited and the RISK fired at 100%.

## Root cause — absolute-vs-relative path mismatch in artifact detection

The model writes to the **absolute** path (`file-write` arg/ledger:
`/home/.../apps/examples/agents-summary.md`), but `deriveConditions` derives
`ArtifactProduced("./agents-summary.md")` from the task. `post-conditions.ts:normalizePath`
only strips a leading `./` — it does NOT reconcile absolute vs relative. So
`isArtifactProduced` compares `"agents-summary.md"` (target) against
`"home/.../agents-summary.md"` (write arg) → no match → condition UNMET despite a
genuine successful write → `applyPostConditionGate` escalates → loop to max_iterations.
(No `"You still must"` steer in the log because the escalate lands at the iteration cap.)

ToolCalled conditions likely fire correctly; the breakage is ArtifactProduced path
matching against the real reactive ledger (where write paths are absolute).

## Verdict
**DO NOT FLIP.** The ablation prevented a catastrophic default-on (would break every
deliverable task). #7 is gated on a fix:

1. Fix `isArtifactProduced` / `normalizePath` to match a written path to the derived
   path robustly (basename / resolve-both / suffix), reconciling absolute vs relative.
   (Diagnose path-norm vs toolCallId-linkage with a RED repro first — the gate requires
   BOTH a linked successful write AND a path match.)
2. Re-ablate. Only flip if arm B then (a) does NOT false-block honest haiku runs and
   (b) catches a real dishonest-success (needs cogito to actually narrate-not-write a
   deliverable — it wrote files in this run; may need a trickier task to exhibit).

## Honesty note
This is the ablation working as intended: a default-on flip that *felt* safe (the
mechanism is carefully built + honesty-first) was empirically catastrophic due to a
ledger-shape mismatch invisible from code review. Read the wire, grade the deliverable.
