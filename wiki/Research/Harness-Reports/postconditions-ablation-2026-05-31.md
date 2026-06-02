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

---

## RE-ABLATION (post-fix) — VERDICT FLIPS POSITIVE (2026-05-31)

After two fixes — path-norm absolute-vs-relative (`17a7169c`) + write-verb-anchored
derivation (`463fbcee`) + the tier type-mirror sync — re-ran mid (b8uf4pdgg) then
cogito (bjam40031), N=3.

**mid haiku (honest control):** false-block GONE. commits 3/3 + summary 3/3 on BOTH
arms; comparable tokens; pc1 summary even terminates cleaner (final_answer_tool vs
pc0 end_turn). RISK cleared.

**cogito:14b (local):** the WIN — completion-steering, not dishonest-catch (no
dishonest-success appeared; cogito fails honestly, doesn't fake):

| task | pc0 (off) | pc1 (on) |
|---|---|---|
| commits | 3/3 success | 3/3 (parity) |
| summary | **1/3** (2× max_iter, NO file) | **3/3** (all produced the file) |

- fail/block: pc0=2, pc1=**0** — arm B recovers runs that else max-iter without
  delivering. Does NOT false-block.
- Tokens: cogito summary pc1 total 59.9k vs pc0 68.8k — arm B is **cheaper** (pc0
  burns max-iter tokens on failures). Lift with NEGATIVE token overhead.
- CAVEAT: steered completions thinner — pc1 coverage 0.45/0.77/0.77 vs pc0's one
  success 0.95. The gate makes cogito PRODUCE the file but rushed. file-presence ≠
  faithfulness.

**Lift-rule check:** first-attempt success up (cogito summary 1/3→3/3 ≈ +67pp on that
task; commits parity; mid parity), token overhead ≤0 (cheaper), no false-block,
cross-tier safe. CLEARS the default-on bar — EXCEPT the coverage caveat is unmeasured
by success-flag.

**Recommendation:** flip is JUSTIFIED by the ablation. The one open question is whether
the steered output is QUALITY or just present — answerable by a frontier judge.

## JUDGED QUALITY (haiku over the REAL cogito summary deliverables) — FLIP CONFIRMED

`apps/examples/judge-deliverables.ts` — haiku scores each produced summary 0-1 on
faithful/useful coverage of the 57k source (rubric: pass=0.6).

| arm | per-deliverable score | per-RUN expected quality (max-iter failure = 0) |
|---|---|---|
| pc0 (gate OFF) | 0.92 (the 1 success of 3 runs) | (0 + 0.92 + 0)/3 = **0.31** |
| pc1 (gate ON) | 0.72 / 0.72 / 0.72 (all 3 runs) | **0.72** |

- Steered output IS thinner per-deliverable (0.72 < 0.92 — judge: "covers most major
  sections, thin on execution detail") — the caveat is real.
- BUT all 3 pc1 outputs PASS the 0.6 quality bar, and per-RUN expected quality MORE
  THAN DOUBLES (0.31 → **0.72**, +0.41) because the gate converts 2 zero-quality
  max-iter failures into passing reports. A reliable 0.72 beats a 1-in-3 shot at 0.92.

**VERDICT: FLIP RA_POST_CONDITIONS default-on.** Clears every gate — judged quality
lift +0.41/run, cross-tier safe (mid parity, no false-block), token-neutral-to-cheaper.
Flip with an opt-out killswitch (reversible, like RA_ASSEMBLY). Documented FOLLOW-UP:
tune the steer to preserve faithfulness (push pc1 0.72 → 0.92 by steering toward
completeness, not just file-presence); broaden task/model coverage (N=3, 1 task,
cogito — the lift is clear on this probe but not yet broad).
