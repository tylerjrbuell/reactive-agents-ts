---
tags: [decision, ratification, wave-c, ledger]
date: 2026-07-22
status: RATIFIED (owner decision, 2026-07-22 planning session)
amends: wiki/Architecture/Specs/09-UNIFIED-PROGRAM.md §3 C1 (wording only)
---

# C1 "steps becomes a projection" → containment invariant

## Decision
09-C1's literal wording — steps[] "becomes a ledger projection" — is satisfied
by the **containment-invariant form**, not a physical write-direction flip:

1. steps[] mutates ONLY via the `transitionState` chokepoint
   (`scripts/check-ledger-writes.sh`, tightened this wave).
2. **`projectStepsToLedger(steps history) ⊆ state.ledger`** — every step-derived
   entry appears in the ledger, in seq order (`kernel/ledger/equivalence.test.ts`,
   red-on-cut). It is a **subset, NOT an equality**: the ledger is a strict
   SUPERSET that additionally carries non-step facts seeded through the SAME
   chokepoint via `patch.ledger` — `artifact` (act.ts), `requirement`
   declared/transitions (runner.ts / iterate-pass.ts), terminal `verdict`/`claim`
   (arbitrator.ts). `projectStepsToLedger` never emits those kinds, so
   re-projecting steps alone cannot reproduce the production ledger — and MUST
   NOT be expected to. These extra entries are load-bearing: Slice 2's receipt
   consumes the `artifact` entries as deliverable evidence. **Do not "converge"
   by deleting the `patch.ledger` seeding — that would gut the receipt.** The
   invariant the gate + test actually pin is: steps never grow without their
   derived entries also appearing (no silent steps/ledger drift), and the single
   write path is the chokepoint. (The equivalence test scripts a step-only
   transition sequence with no `patch.ledger` seeding, so for that script the
   two sides are byte-equal — that is the subset relation with the extra-facts
   set empty, not a claim of general equality.)
3. The ledger is CANONICAL for all new readers (receipt, stream, journal —
   Wave C.1 slices 2–3). No new reader may scan steps[] when a ledger query
   answers the same question.

## Why not the literal flip
The shipped projection is deliberately lossy: thought/plan/reflection/critique
steps map to no entries ("not high-value ledger facts", step-projection.ts),
and tool results carry 240-char previews. A lossless inversion would require
full-content entry kinds — growing the ledger/codec ~5–10× on verbose runs,
burdening compaction, and contradicting the ledger's own design. The C1 goal
("no second store") is about READER convergence + a single write path; the
invariant delivers both.

## Consequences
- `TODO(C-final)` comments in step-projection.ts / kernel-state.ts are
  restated to point here (done this wave).
- 09 §3 C1 text stands as written; this doc is the binding interpretation
  (09 conflict rule: ratification event, not edit-in-passing).
- The literal flip may be revisited ONLY with bench evidence that a reader
  needs lossless thought/plan history from the ledger.
