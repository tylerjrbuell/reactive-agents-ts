# DECISION: Adaptive Harness Architecture — RATIFIED 2026-07-07

**Decider:** Tyler (user), ratifying [[2026-07-07-ideal-harness-architecture|the 9-pillar ideal-architecture spec]].

**Decision:** RA's forward architecture direction is the centralization of scattered/duplicated concerns into the 9-pillar design, culminating in a harness that **molds and adapts dynamically to framework composition and task complexity** — smart, adaptive, efficient, accountable.

**User's words:** "This is the direction we need to go in, we have duplicated and scattered concerns. An ideal harness is one that can mold and adapt dynamically with the framework composition and task complexity and intricacy needs. Agents of the future need a harness that is smart, adaptive, efficient and accountable."

## What this supersedes / reshapes

- The Agentic OS North Star (spec 08) arcs remain the delivery vehicle, but Arc 2+ content is now the migration path from the ideal-architecture spec: gateway → ambient context → terminal gate → evidence ledger → control plane → policy compiler → strategy-to-policy.
- Publication (launch-gate item 5) still blocked on the post-fix bench story.

## Execution rules (unchanged, binding)

1. Evidence-gated: each migration wave verified by bench (single-cell probes + full-session gate) before the next.
2. No big-bang rewrite; strategies hollow out incrementally.
3. Default-on requires the cross-tier lift rule; ablation-warden veto stands.
4. The four adjectives are the acceptance axes: **smart** (policy compiler picks machinery per model+task), **adaptive** (harness recomposes mid-run on evidence: strategy switch, budget escalation, checker engagement), **efficient** (no dead exchanges, no re-execution, no cache-hostile prompts), **accountable** (ledger-backed receipts, checker verdicts, honest abstention).

## Wave 1 begins

First increment (2026-07-07, same session): FiberRef ambient run context read by observable-llm (kills the P2 class permanently) + varied retries in the structured-output pipeline (never byte-identical). Committed on local main.
