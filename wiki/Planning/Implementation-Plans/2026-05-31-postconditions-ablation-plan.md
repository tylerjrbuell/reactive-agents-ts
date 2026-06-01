---
title: "#7 PostCondition spine — default-on ablation plan"
date: 2026-05-31
branch: overhaul/agentic-core-2026-05-31
status: ABLATION DESIGNED — probe building, run pending
---

# #7 PostCondition spine — RA_POST_CONDITIONS default-on ablation

## Orient (the mechanism is BUILT, not aspirational)
- `verify/post-conditions.ts` — pure, ledger-only verifier. 3 condition kinds:
  `ToolCalled`, `ArtifactProduced` (linked successful WRITE to the target path — NO
  union fallback, refuses false-met), `OutputContains`. Honesty-first by design.
- `verify/derive-conditions.ts` — conservative, NO-LLM derivation: requiredTools →
  ToolCalled(each); literal deliverable path (high-precision: write-verb + file-noun/
  separator + real-extension allowlist + prose-abbrev/URL/decimal rejection) →
  ArtifactProduced + writing ToolCalled. Empty set if nothing clears → prose stands.
- Wired at 2 chokepoints, env-gated `RA_POST_CONDITIONS === "1"`, default-OFF/additive:
  - `arbitrator.applyPostConditionGate` — on an `exit-success` verdict with unmet
    conditions, converts to `escalate(POST_CONDITION_STEER)` + `describeUnmet` steer →
    loop re-enters (budget-bounded). **Forces the deliverable to actually exist
    before success.**
  - `reflexion.ts` Gate B — same flag; SATISFIED critique + unmet spine → forces improve.

## What the flip changes
Termination. Today completion is judged on PROSE (verifier/critique inspect output
text) → a run can report `success:true` with the deliverable never produced (the
cogito GitHub-MCP "glowing summary, no ./commits.md" class). The spine demotes prose
to a quality signal and makes STATE the gate.

## Ablation (the bar for default-on)
- **WIN (catch dishonest-success):** arm A (=0) may exit-success with the deliverable
  absent/empty; arm B (=1) blocks → recovers (file appears, honest success) or hits
  budget (honest failure). Metric: `dishonest = success && (!fileExists || empty ||
  coverage<0.5)` — arm B should drive this toward 0.
- **RISK (false-block honest runs):** if `deriveConditions` over-derives or
  `requiredTools` over-specifies, arm B burns iterations steering toward an
  already-done/not-needed thing. Metric: on runs arm A completes honestly, does arm B
  ever false-block (extra iterations / max-iter failure)? + token overhead.
- **Gate:** default-on iff arm B reduces dishonest-success with NO honest-run regression
  and token overhead within the project lift rule (≤15%). Else opt-in. (ablation-warden
  is the formal veto-holder; this run mirrors the FLIP precedent — author-run grid →
  kernel-warden flips if green.)

## Probe (honest caveat)
Harness: `apps/examples/postconditions-ablation.sh` (clone of the proven
assembly-ab-grid; arm = RA_POST_CONDITIONS, RA_ASSEMBLY=1 fixed since now-default;
deliverable tasks commits.md / agents-summary.md; per-cell fs-reality + coverage +
dishonest flag). **Tiers: local cogito:14b + mid haiku** — cogito:14b IS installed
(rtk had truncated the ollama list; corrected 2026-05-31). cogito:14b is the KNOWN
dishonest-prone probe (narrates the deliverable as text instead of calling file-write
→ glowing summary, no file) → it should EXHIBIT the dishonest-success arm B catches.
haiku is the honest mid control (does arm B false-block a model that delivers cleanly?).
This is the ideal 2-tier matrix: dishonest-local + honest-mid.
Outcomes: (a) cogito dishonest-success on arm A, caught on arm B, with no haiku
false-block → flip default-on. (b) arm B false-blocks honest haiku runs or over-costs
→ keep opt-in / tune derivation. (Run b48ghnora, 2026-05-31.)
