---
"@reactive-agents/reasoning": minor
---

Wave 4 control plane (4.1 + 4.6 + 4.7): ONE progress arbiter (design law #5) + evidence-based pace banding.

**4.7 — the progress arbiter.** A single pure predicate (`kernel/assessment/progress-arbiter.ts`) classifies every step / observation / output as SUBSTANTIVE vs NON-PROGRESS (framework helper, no-op, or give-up). The loop detector's no-new-evidence pattern (d) and the byte-identical repeat (a) now route through it: a `success:true` META / pseudo / no-op tool result no longer counts as progress, so the varied-args thrash (the frozen `discover-tools` ×146 false-success, `evidenceDelta:0` on every assessment) trips the guard it previously slipped past. Pattern (c) keeps its "any action resets" rule — reclassifying META actions there fired on legitimate recall/find loops.

**4.1 — pattern (e) evidence staleness + band rule.** The loop detector gains pattern (e): N iterations with `assess()` `evidenceDelta == 0` while work remains fires regardless of tool variety/args, fed from the assessment's ledger-derived `health.iterationsSinceEvidence` (no private counter). Pace banding is now evidence-based: `band: "green"` is impossible while `evidenceDelta == 0` and deterministic work is outstanding (band from evidence, not token volume).

**4.6 — evidenceDelta crediting.** `assess()` `evidenceDelta` now credits only arbiter-SUBSTANTIVE results: a success-shaped HARNESS pseudo-tool or no-op (e.g. `discover-tools` → "No tools registered.", repeated `final-answer`/`recall` no-ops) no longer defeats pattern (e).

Pinned by behavior tests against the frozen false-success fixture via the replay lane, plus synthetic unit shapes (meta thrash trips; substantive tool with new evidence does not; band and crediting arms). Detection arms only — no live-thrash-elimination claim.
