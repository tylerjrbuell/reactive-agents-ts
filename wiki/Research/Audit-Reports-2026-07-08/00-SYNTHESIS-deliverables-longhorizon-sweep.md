# Sweep 2026-07-08 — Deliverable Truth + Long-Horizon Capability — SYNTHESIS

**Mandate (user, 2026-07-08):** the harness is tuned to respond quickly and nudge on repeated tool calls; research-class and long-horizon tasks need many tool calls, long context gathering, and a harness that knows what it has and hasn't delivered — feeding the evidence ledger. Sweep the harness and all core agentic systems; verify the direction; produce a durable plan.

**Inputs:** six parallel audits (01–06 in this directory), run at `f4213c07` (Phases 1–3 of the adaptive-harness overhaul shipped; bench validity fix `a9727e8c` shipped). Prior sweep (2026-07-07) findings were excluded by instruction — everything here is new ground or explicit correction.

**VERDICT: CONTINUE the ratified 9-pillar/7-phase plan — with one inserted instrument phase (3.5), one hotfix wave (3.6), and named scope amendments to Phases 4/5/6.** No pillar is wrong; the two new requirements are absorbable. But four cross-cutting diseases must be named, and two of the six audits found the measurement instrument itself biased against exactly the capability the user is asking for.

---

## The four diseases (cross-audit convergence)

### D1 — The write-only harness: evidence is retained but unreadable
The system records nearly everything and lets almost none of it back out.
- `priorContext` composed at every strategy switch / ToT handoff / memory bootstrap — **its only renderer was deleted with the APC stack**; nothing renders it today (03-F1). Post-switch, the model restarts blind while harness gates "remember" via steps[].
- The recall round-trip is structurally dead: the gate that unlocks `recall` needs a `recall("` marker in the projected window; the projector emits only `result_ref=` previews (03-F2). Scratchpad retains full results forever, checkpoint-safe — with no model-facing read path.
- Requirement verdicts (`verify()` met/unmet) are recomputed at the arbitrator gate and again at terminate, then **discarded both times** (01-F“recomputed and thrown away”).
- Numeric claims are extracted at the synthesis gate and discarded (01-F2).
- The todo meta-tool (P6a) is the most durable rail in the system (shared Ref, checkpoint-safe, survives switch/compaction) — and **no gate, reflect pass, or trace ever reads it** (04-#6).
- `ReasoningStepCompleted.totalSteps` is dropped at the stream projection (`execute-stream.ts:194`); `EventLog.goal_state.remaining` is internal-only; no percent/N-of-M reaches any consumer (04 child-audit).

### D2 — No shared progress currency
Every guard invents its own definition of "stuck," most of them blind to real progress (02: 23 mechanisms, 8 HIGH misfire):
- Controller-veto counters are run-cumulative with **no decay** — a transient 429 at iteration 2 helps veto a correct iteration-28 answer into `failed` (02-#2).
- `low_delta_guard` consults only token delta; successful tool observations never reset it (02-#3).
- RI early-stop unconditionally amputates the final 2 iterations — the synthesis phase — of every run (02-#5).
- The required-tool nudge ladder fast-fails tasks whose required tool legitimately comes last (research→write) (02-#6).
- Budget warn (0.80) has exactly one consumer: a diagnostics event. Nothing economizes, triages, or downshifts; the next state is the `budget_exceeded` cliff that discards the in-progress answer (05-#1).
- **Budget ∝ remaining work: no code relates them.** `budget` and `postConditions` sit side by side in ArbitrationContext, never joined (05-#2).
- Five mechanisms DO distinguish gathering from stuck (args-normalized loop detector, stall artifact-reset, F3 success-reset, RI tool-progress gate, F1 grounding) — proof the pattern exists; it is not shared.

### D3 — Deliverable-blindness
- No artifact record exists: recognition = 4 hardcoded write-tool names + 15 path-arg keys; code-execute/bash/MCP writes are invisible to every gate (01-F1). No enumeration API, no hashes, no partial-completion mechanism (rw-8 witness: writing 1 of 3 files passes both gates).
- **Every run's final deliverable synthesis is budget-classed `terse` (2048)** — finalize.ts:147, runner.ts:1018/1155 — while `generous` (8192) has zero call sites (05-#3/#4).
- Stall-deliverable ships concatenated artifacts as `success` mid-gather; witnessed in trace 01KWZ811: in-loop verifier said `verified:false` (emit-only), terminal verdict flipped true, `run-completed success` with no model-authored answer (02-#4).
- Deliverable provenance dies at `commitDeliverable` — collapsed to a string; any string launders into `model_synthesis` (01-F4).
- Post-condition derivation covers exactly: requiredTools + at most ONE literal path after the LAST write verb. Research reports, described-not-named files, multi-file outputs, directories, quantities: derive nothing (01-F5/F6).

### D4 — No upward gear (and the instrument can't see it)
- Comprehend signals only shrink: trivial→cheap paths; moderate/complex fall through to identical defaults. `shape` is fully decorative; `intent` is bypassed by live re-derivation (04-#8, child-audit). Nothing sizes iterations, budgets, cadence, or checkpointing UP.
- Model routing is run-scoped advisory; the gateway never sets per-request model — gathering-cheap/synthesis-strong is an unwired seam (05-#5).
- **The bench has no task over 25 iterations** — every lift-gate verdict to date is horizon-blind (06-#2).
- **The ≤15% token-overhead lift rule structurally rejects gather-more mechanisms** (re-run #2: +20.8pp lift → OPT-IN purely on 640% tokens) (06-#4). The selection pressure that tuned the harness for fast convergence is still active.

---

## Corrections to prior audits (falsified claims — update mental models)
- `detectCompletionGaps` is NOT dead: live at `act.ts:427` + `think.ts:1094` (weak — 3 verb regexes) (04-#5).
- P4 strategy-switch carryover IS shipped (8 obs + toolsUsed live in steps[]) — but D1 means the carried steps are never RENDERED to the model post-switch (03-F5). Shipped ≠ effective.
- A2 remedy #1 (structured-output retry fail-fast) was NOT shipped — identical-budget retry loop remains at pipeline.ts:249-260 (05-#10).

---

## Amended sequencing

```
Phase 3.6 (hotfix wave, days)  ──►  Phase 3.5 (instrument, days)  ──►  Phase 4 (ledger, amended)  ──►  5 ──► 6 ──► 7
```

### Phase 3.6 — hotfix wave (0.5-class: high leverage, no architecture)
| # | Fix | Source | Where |
|---|-----|--------|-------|
| H1 | Render `priorContext` (one assembly-stage change) — un-blinds strategy switch, ToT handoff, memory bootstrap | 03-F1 | context assembly |
| H2 | Align recall-gate marker with projector vocabulary (`result_ref=`) so the stored-evidence read path works | 03-F2 | think-guards + result-store |
| H3 | Reclass terminal synthesis sites `terse`→`generous` (finalize.ts:147, runner.ts:1018/1155); `generous` gains its intended call sites | 05-E2 | llm-gateway call sites |
| H4 | Structured-output retry fail-fast (stopReason/empty-content check; no identical-budget re-spend) | 05-E10 | pipeline.ts:249 |
| H5 | Stall-deliverable honors the in-loop verifier: `verified:false` must not flip to terminal `success` (trace 01KWZ811 three-bug stack) | 02-#4 | stall-deliverable + verifier seam |
| H6 | Remove/scale the RI early-stop maxIter−2 amputation (protect the synthesis quartile) | 02-#5 | early-stop.ts |
Each hotfix: single-cell verify (rw-1 research + rw-7) before commit; suite green.

### Phase 3.5 — the long-horizon instrument (BEFORE Phase 4 gating)
1. **lh-1 bench task**: ≥40-iteration research-and-deliver task (multi-question research → structured report + files), scored by hidden reference checks (bench-validity pattern from `a9727e8c`) + per-requirement judge decomposition. Add to the qwen3:14b session.
2. Horizon-normalized guard scaling: thresholds ∝ maxIterations (stall 2→fraction, nudges, redirect budgets, veto windows) behind a profile flag so short-task behavior is unchanged (02-#12 constants list).
3. Lift-rule amendment: per-task-class verdicts; long-horizon class gates on **cost-per-verified-deliverable**, not raw token overhead (06-#4).
Exit: lh-1 runs to completion under the profile; rw-1..9 scores unchanged without it.

### Phase 4 — Evidence Ledger (scope amendments; the sweep's center of mass)
All six audits converge here. Add to the ratified Phase 4 scope:
- **Entry types**: tool-invocation/result (existing sketch) + `artifact` (registry-declared `produces`, path, digest, op), `requirement` (declared / satisfied(evidence-ref) / blocked), `claim`, `verdict` (persist every verify() result instead of discarding), `deliverable-commit` (provenance survives), `handoff`, compaction markers **with dropped-ref enumeration** (03-F4: current stub says "summarized" and lies).
- **Evidence facets**: unified EvidenceEntry {full, preview, extractedFact, storedKey} + ONE reference vocabulary shared by projector, recall gate, and from_step (03-#14).
- **Typed requirement schema**: `TaskRequirement {question-answered | artifact-produced | constraint-held | tool-coverage}` grafting the judge's decomposition pattern onto the live PostCondition vocabulary; derivation consumes TaskContract, not just prompt regex (04-#9, eval child-audit).
- **Projections**: progress % / N-of-M (kills the dropped-totalSteps class), `receipt.deliverables[]`, outstanding() for steering, gather-dedup index on (tool, args-hash) (03-F6).
- **Gates read the ledger**: terminal gate check 2.5 = requirement coverage from ledger entries, not tool-name sets (04-R2).
- Enforcement script: `check-ledger-writes.sh` — no state mutation of steps/scratchpad/plan outside ledger appenders (06-#5 pattern).

### Phase 5 — Control Plane (amendments)
- One shared `evidenceDelta` progress currency consulted by ALL proposal emitters (02-#14); windowed/decaying counters replace run-cumulative ones.
- Steer-never-deliver until the final quartile; harness-pass budget separated from model iteration budget (02-#7).
- Regression test: long-gathering false-positive (15 different successful calls / 15 iterations must not accumulate termination pressure).

### Phase 6 — Policy Compiler (amendments)
- `horizon` classification axis + `horizonProfile` in HarnessPlan — first upward consumer of comprehend signals (04-#11: replan cadence every-N from complexity).
- Pace bands green → economize(0.60) → triage(0.80, steer against unmet requirements) → terminal(0.95, forced synthesis at `generous`) — joins budget to remaining work for the first time (05-#12).
- Purpose→tier routing through the gateway's per-request model field (gathering cheap, synthesis strong) (05-#5).
- Acceptance test now spans rw-1..9 AND lh-1 on both model tiers.

---

## Durability contract
The pattern that survives: **one owner module + one grep-able enforcement script per invariant** (check-llm-gateway.sh, check-termination-paths.sh). Every remaining phase ships its script (06-#5): check-tool-surface, check-ledger-writes, check-control-plane, check-policy-compiler, check-single-loop, check-deliverable-truth. A phase without its invariant script is not done.

## What this sweep does NOT change
- No new strategies; falsified levers stay dead; default-on still requires the (amended) lift gate; ablation-warden veto stands.
- Publication line unaffected (gate item 5 rides re-run verdicts, not this program).

## Priority order (if forced to pick three things)
1. **H1+H2** (render priorContext, fix recall gate) — the model literally cannot read what the system already saved; cheapest capability unlock in the codebase today.
2. **lh-1 + horizon profile** (Phase 3.5) — without the instrument, every future verdict keeps selecting against long-horizon capability.
3. **Requirement+artifact+deliverable ledger entries** (Phase 4 core) — turns "what have I delivered" from vibes into a query.
