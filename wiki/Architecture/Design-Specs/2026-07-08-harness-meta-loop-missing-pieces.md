# The Harness Meta-Loop — Missing Architectural Pieces (2026-07-08)

**Status:** PROPOSED (awaiting ratification). Amends the [[2026-07-07-ideal-harness-architecture|9-pillar spec]] and re-shapes Phases 4–6 of the [[../../Planning/Implementation-Plans/2026-07-07-adaptive-harness-overhaul|overhaul plan]]. Grounded entirely in the [[../../Research/Audit-Reports-2026-07-08/00-SYNTHESIS-deliverables-longhorizon-sweep|2026-07-08 sweep]] (diseases D1–D4).

## Diagnosis: why the systems aren't cohesive

The shipped pillars (gateway, tool surface, terminal gate) and the planned ones (ledger, control plane, policy compiler) are **actuators and stores**. What the sweep exposed is that the harness is missing the middle of its own loop:

- It has no typed representation of **what the goal IS** (D3: "done" is inferred from tool-name proxies, prompt regexes, and one literal path).
- It has no **shared assessment of how the run is going** (D2: 23 guards each invent "stuck" from private counters).
- It has no **owner of what the model gets to see** (D1: five storage rails, zero guaranteed read paths; priorContext composed-then-dropped; recall gate keyed to a marker nothing emits).
- It has no **notion of where in the run it is** (D4: iteration 2 of orientation and iteration 38 of synthesis are governed identically).

The unifying frame: **the harness is itself an agent supervising an agent, and it is missing half of its own capability loop.** The agent kernel has sense → comprehend → reason → act → verify. The harness today has only act (gateway, tool surface, gates) and a fragmented memory. The missing pieces are its comprehension, its perception, and its expression.

## The four missing pieces

### 1. RunContract — the goal compiler (harness "comprehend")

One typed object, compiled at run start, that answers *what does done mean here*:

```ts
RunContract = {
  requirements: TaskRequirement[]   // {id, kind: question-answered | artifact-produced | constraint-held | tool-coverage, spec, weight}
  deliverables: DeliverableSpec[]   // {id, kind: file | answer-section | structured-object, matcher, acceptance}
  constraints:  Constraint[]        // forbidden tools, format contracts, honesty requirements
  horizon:      "short" | "long"    // + estimated effort class
  acceptance:   AcceptancePolicy    // deterministic checks > checker > self-critique (stakes-tiered)
}
```

- Compiled from: task prose (today's `deriveConditions`, upgraded), declared `TaskContract` when present, tool nominations, comprehend classification (+ new `horizon` axis). LLM-assisted decomposition allowed at compile time (the judge's requirement-decomposition pattern, given a schema at last) — but the OUTPUT is typed and frozen; amendable mid-run only via an explicit ledger-recorded `contract-amended` entry.
- Consumers: terminal gate (check 2.5 = contract vs ledger, replacing tool-name sets), progress estimator, pace bands, receipts (`deliverables[]`), projector (renders outstanding items), plan-execute reflect (its free-text requirement list becomes contract refs).
- This is the anchor for "goal-driven": today the goal exists only as a prose string re-interpreted by every subsystem independently. PostCondition {ToolCalled, ArtifactProduced, OutputContains} is the seed vocabulary — already live, already ledger-verified.

### 2. RunAssessment — the progress estimator (harness "sense/perceive")

One pure function, one output object, recomputed each iteration:

```ts
assess(contract: RunContract, ledger: RunLedger, budget: BudgetState): RunAssessment = {
  requirements: {satisfied: Ref[], outstanding: Ref[], blocked: Ref[]}
  deliverables: {produced: ArtifactRef[], missing: DeliverableSpec[]}
  evidenceDelta: number          // NEW substantive evidence this iteration (the one progress currency)
  phase: "orient" | "gather" | "execute" | "synthesize" | "verify"
  pace: {burnRatio, projectedCompletion, band: green | economize | triage | terminal}
  health: {stuckSignals, repeatWaste, contradictions}
}
```

- **Every guard, gate, and policy consumes RunAssessment. None may hold private counters.** This is the structural kill for D2: veto counters, low-delta streaks, stall thresholds, nudge ladders all become pure functions over Assessment fields (windowed and phase-scaled by construction). The 5-of-23 mechanisms that already distinguish gathering-from-stuck prove the signals exist — this gives them one home.
- The **run-phase model** lives here (D4's dynamic half): gathering tolerates repetition and spends cheap; synthesize is protected from early-stop and spends `generous`; the RI maxIter−2 amputation becomes "never amputate the synthesize phase."
- Budget finally joins remaining work: `pace` is computed FROM `outstanding × burnRatio` — the coupling that today is zero lines of code.
- Enforcement: `check-run-assessment.sh` — no `count`, `streak`, or threshold state outside the estimator module.

### 3. Projector — the attention authority (harness "express")

The dual of the ledger. The ledger owns *what is true*; the projector owns *what the model sees*, as the SINGLE rendering authority with a two-way contract:

- **Reachability:** every ledger entry is reachable from the rendered window through ONE reference vocabulary (`ref://` — the same tokens the previews emit, the recall gate matches, and `from_step` resolves). Kills the D1 class at the root — priorContext, todo, handoffs, stored full results all become projector inputs, not orphaned rails.
- **Traceability:** every rendered line carries provenance to ledger entries (compaction can then say exactly what it dropped — no more "summarized" stubs that lie).
- Inputs: RunContract (outstanding requirements rendered as the standing goal frame), RunAssessment (phase decides render profile: gathering = wide evidence, synthesize = full deliverable materials), HarnessPlan (budget for the window), guidance channel.
- Hotfixes H1 (render priorContext) and H2 (recall-gate vocabulary) are **provisional patches on this seam** — shipped now, subsumed when the projector lands.
- Enforcement: `check-projection.sh` — no prompt/message assembly outside the projector module (the render-side twin of the gateway's call-side invariant).

### 4. The meta-loop wiring (cohesion by construction)

Strict one-directional DAG per iteration — this is the anti-tangle contract:

```
RunContract (compiled once; amendable via ledger entry)
     │
RunLedger (append-only facts: tool, artifact, requirement, claim, verdict, handoff, compaction)
     │
RunAssessment = pure fn(Contract × Ledger × Budget)      ← the only place counters live
     │
     ├── Control Plane: proposals → ONE action            (Phase 5, consumes Assessment)
     ├── Policy recompile: Assessment → HarnessPlan delta (Phase 6, .withAdaptiveHarness)
     │
Actuators read (Assessment, Plan): gateway budgets · tool surface · terminal gate · guards
     │
Projector = fn(Contract × Ledger × Assessment × Plan) → the LLM window
     │
model turn → new facts → append to Ledger → next iteration
```

Rules that keep it untangled:
1. Arrows point one way. No subsystem reads a downstream one. Control actions re-enter only as ledger entries.
2. One module = one owner = one enforcement script = pure core with effects at the edge (the pattern that made Phases 1–3 stick).
3. Strategies and guards may not: hold counters (estimator's job), render text into the window (projector's job), or decide accept/redirect/abstain (terminal gate's job — already enforced).
4. Every boundary emits a trace event (`contract-compiled`, `assessment`, `projection-rendered` join the existing `tool-surface-resolved` / `terminal-gate` events) — the whole meta-loop becomes replayable and diagnosable from one trace.

## What this does to the plan (re-shaping, not rewriting)

| Was | Becomes | Why |
|---|---|---|
| Phase 3.6 hotfixes | unchanged — ship now | H1/H2 marked "subsumed by Projector" |
| Phase 3.5 instrument | unchanged — ship now | lh-1 gates everything below |
| Phase 4 "Evidence Ledger" | **4a RunContract → 4b RunLedger → 4c Projector** | contract first (small, unblocks typed requirement entries); ledger as planned + amendments; projector closes the read side. 4a/4c are each S–M; 4b remains the L |
| Phase 5 "Control Plane" | **5a RunAssessment → 5b Control Plane** | proposals need the shared currency to exist first; estimator is the evidenceDelta home |
| Phase 6 Policy Compiler | unchanged scope | now has real inputs: consumes Assessment (recompile-on-evidence becomes trivial), contract.horizon replaces ad-hoc profile flag |
| Phase 7 Strategy→Policy | unchanged | strategies hollow out naturally once contract/assessment/projector own their stolen jobs |

Nothing already shipped is discarded: gateway/tool-surface/terminal-gate become the actuator row; PostConditions seed the contract; requirement-state/entropy/budget-signal code folds INTO the estimator; the two enforcement scripts become six.

## Acceptance (how we know the meta-loop is real)

1. **Mid-run query test:** at any iteration, `assessment.requirements.outstanding` and `artifacts()` answer correctly on lh-1 — no grep, no trace forensics.
2. **Long-gathering false-positive test:** 15 distinct successful gathering calls / 15 iterations → zero termination pressure (Assessment shows evidenceDelta > 0 throughout).
3. **Read-back test:** any fact gathered at iteration 3 is retrievable by the model at iteration 30 through the projector's ref vocabulary (no re-gathering).
4. **Deliverable truth test:** rw-8 with 1-of-3 files written terminates as `partial` with the 2 missing deliverables named in the receipt.
5. **Replay test:** the meta-loop trace events alone reconstruct every control decision (`rax:diagnose replay` renders contract → assessment → action chains).
