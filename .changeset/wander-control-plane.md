---
"@reactive-agents/reasoning": minor
---

Wave 4 control plane (4.1 + 4.6 + 4.7): ONE progress arbiter (design law #5) + evidence-based pace banding.

**4.7 — the progress arbiter.** A single pure predicate (`kernel/assessment/progress-arbiter.ts`) classifies every step / observation / output as SUBSTANTIVE vs NON-PROGRESS (framework helper, no-op, or give-up). The loop detector's no-new-evidence pattern (d) and the byte-identical repeat (a) now route through it: a `success:true` META / pseudo / no-op tool result no longer counts as progress, so the varied-args thrash (the frozen `discover-tools` ×146 false-success, `evidenceDelta:0` on every assessment) trips the guard it previously slipped past. Pattern (c) keeps its "any action resets" rule — reclassifying META actions there fired on legitimate recall/find loops.

**4.1 — pattern (e) evidence staleness + band rule.** The loop detector gains pattern (e): N iterations with `assess()` `evidenceDelta == 0` while work remains fires regardless of tool variety/args, fed from the assessment's ledger-derived `health.iterationsSinceEvidence` (no private counter). Pace banding is now evidence-based: `band: "green"` is impossible while `evidenceDelta == 0` and deterministic work is outstanding (band from evidence, not token volume).

**4.6 — evidenceDelta crediting.** `assess()` `evidenceDelta` now credits only arbiter-SUBSTANTIVE results: a success-shaped HARNESS pseudo-tool or no-op (e.g. `discover-tools` → "No tools registered.", repeated `final-answer`/`recall` no-ops) no longer defeats pattern (e).

Pinned by behavior tests against the frozen false-success fixture via the replay lane, plus synthetic unit shapes (meta thrash trips; substantive tool with new evidence does not; band and crediting arms). Detection arms only — no live-thrash-elimination claim.

**W4-live — default-on efficient termination (actuation half of 4.1/4.2).** A live user report proved detection without actuation: an impossible task (`builtins:false`, no capable tool) still cost ~4-5 iterations / ~2K tokens before abstaining, because the band rule keyed on *deterministic* outstanding (the live shape's only outstanding requirement is the non-deterministic self-answer floor, so `detOutstandingCount===0` short-circuited it to `"green"`) and the pattern-(e) actuator was horizon-gated. Three fixes, all default-on:
- **Band honesty:** `"green"` is now impossible while ANY requirement is outstanding (the answer floor included) and this iteration produced no new evidence. The live trace's `evidenceDelta:0 ∧ requirementsOutstanding:1` shape is non-green from iteration 1.
- **Zero-evidence stand-down actuator:** a real LLM trajectory (tokens spent) with NO tool call at all, no deliverable, no declared required tool, no explicit `loopDetection` override, and outstanding requirements that produces no new evidence for 2 iterations now terminates as an honest `abstained` (`sentinelDeliverable("no_substantive_output", …)`, `harnessAuthoredOutput: true`) — reusing the assessment's ledger-derived staleness signal, not a private counter. Replaces the ~5-iteration `loop_graceful` grind with a <=2-iteration honest abstention.
- **4.3 early-stop through the terminal gate:** a `controller-early-stop` (RI dispatcher flat trajectory at confidence 0) no longer ships `exit-success` when the frozen contract still has unsatisfied requirements / ungrounded required tools — it routes through `evaluateTerminalGate` coverage and refuses success.

Pins: an impossible-task trajectory abstains in <=2 iterations with a named reason; the progressing-run false-positive guard (substantive tool + new evidence) is not terminated; the band shape is non-green; the 4.3 coverage arm (unsatisfied → refusal; satisfied → still terminates). Cut arm (sever the actuator) recorded RED.
