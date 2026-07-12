# Meta-Loop Execution Plan — Subagent-Driven (2026-07-08)

> **Program position:** dispatch layer of Strand K in [[../../Architecture/Specs/09-UNIFIED-PROGRAM|09 — The Unified Program]]. Wave C must honor convergence ruling C1 (Arc 1 log/receipt/replay re-base onto RunLedger projections — no second event store); Wave B lands C2 (RunContract absorbs TaskContract); v0.14 launch line opens at the Wave A/B boundary (C7).

**Authority:** [[../../Decisions/2026-07-08-harness-meta-loop-ratified|meta-loop ratification]] + [[../../Architecture/Design-Specs/2026-07-08-harness-meta-loop-missing-pieces|spec]] + [[2026-07-07-adaptive-harness-overhaul|amended overhaul plan]].
**Evidence:** [[../../Research/Audit-Reports-2026-07-08/00-SYNTHESIS-deliverables-longhorizon-sweep|2026-07-08 sweep]] (audits 01–06) + 2026-07-07 sweep.
**Status ledger (updated 2026-07-12):** PLAN FULLY EXECUTED 2026-07-08. Phases 1–3 (`60b805fc`/`e0d7ce61`/`c102489a`/`3e2d3876`) · bench validity (`a9727e8c`) · Phase 3.6 H1–H6 (`7bb5afdb`) · Wave A `36f66dee` · Wave B RunContract `6db0bf71` · Wave C RunLedger `c7a836da` · Wave D Projector `14351866` · Wave E Assessment `5c5fb778` · Wave F Control Plane `a33409d5` · Wave G Policy Compiler `99527ed8`+`bab0758b` · Phase 7 `66c5d1b3` · review fixes `6b0647f3`/`451ec96d`. G ablation INCONCLUSIVE (n=1) — adaptive stays opt-in; re-cut = task #36. Wiring residue tracked in [[2026-07-10-harness-root-cause-closure-program]] + `wiki/Research/Audit-Reports-2026-07-12/00-STATE-OF-THE-FRAMEWORK.md`.

This document is the dispatch source: each task is a self-contained brief a subagent can execute. Tasks name their scope, spec source, TDD expectations, acceptance checks, and dependencies. The traceability matrix at the bottom proves every audit finding lands in a task (or is explicitly closed/deferred).

---

## Ground rules (binding for every dispatch)

1. **Checkout discipline.** All work on LOCAL MAIN unless the task says worktree. If a worktree is used: paths must be worktree-relative — absolute main-checkout paths silently edit main (bit twice, 2026-07-05); `git status` BOTH trees before handoff. Subagents NEVER commit — they leave a clean working tree + report; the main thread reviews the diff and commits.
2. **TDD.** Failing test first for every behavior change (agent-tdd skill conventions: timeout flags, Effect.flip for error paths, Layer isolation). Behavior-identical refactors pin OLD behavior first, then move code.
3. **Strict TS.** No `any`; `unknown` + guards. `bunx tsc --noEmit` clean (ignoreDeprecations false-positive excepted) AND package `bun test` green before reporting done.
4. **Enforcement scripts are deliverables.** A wave that lands a subsystem ships its grep-able invariant script wired like `check-llm-gateway.sh` / `check-termination-paths.sh`. A phase without its script is not done.
5. **Bench gates.** Per-task: suites only. Per-wave: single-cell verifies (task list names the cells; judge = `JUDGE_LAYER=live JUDGE_PROVIDER=openai JUDGE_MODEL=gpt-4o-mini` on :8910, qwen3:14b via ollama, GPU-serial). Per-phase: full-session re-run + `rax eval gate` + improvement-ledger entry before the phase is declared done. lh-1 joins every gate from Wave A onward.
6. **Trace events.** Every new subsystem boundary emits its event (`contract-compiled`, `assessment`, `projection-rendered`) wired through core tag → trace kind → normalize → `rax:diagnose replay` renderer — same pattern as `tool-surface-resolved`.
7. **Review pass.** Every task's diff gets a reviewer pass (code-review or cavecrew-reviewer) before the main thread commits. Findings fixed before commit, not after.
8. **Meta-loop DAG is law.** Contract → Ledger → Assessment → (Control/Policy) → Actuators → Projector. No back-edges; control actions re-enter as ledger entries only. Any task whose natural implementation violates the DAG must STOP and report up instead of improvising.

---

## Wave A — Phase 3.5: the long-horizon instrument

> Gates everything after it: without lh-1, every verdict keeps selecting against long-horizon capability (audit 06). Parallelizable pair.

### A1. lh-1 bench task (agent: general-purpose · packages/benchmarks only)
- Build `lh-1` in a new `src/tasks/long-horizon.ts`: ≥40-iteration research-and-deliver task — N research questions (≥6) requiring multi-source web gathering + a structured multi-file deliverable (report.md + findings.json + sources.md). `maxIterations: 50`, `horizon: "long"` tag.
- Scoring: hiddenFixtures reference checks (the `a9727e8c` pattern — deterministic assertions on the deliverable files: structure, per-question coverage markers, source-count floors) + per-requirement judge rubrics (one dimensionRubric per research question family). NO trivially-satisfiable criteria — replay-test the vacuous case exactly like rw-7's tests do (`tests/rw7-hidden-reference.test.ts` as the template).
- Wire into the qwen3:14b session (`public-competitor-qwen3-14b`) + `real-world-full`.
- Timeout: the 420s bench wall ≈ 7–20 local iterations (audit 02-#8) — lh-1 needs its own per-task timeout override (task field exists? if not, add `timeoutSec` to BenchmarkTask consumed by runInternal).
- Acceptance: deterministic tests green; one live lh-1 cell completes end-to-end (any score — the INSTRUMENT working is the exit, not the score).

### A2. Horizon-scaled guard profile (agent: general-purpose · reasoning + reactive-intelligence)
- Opt-in profile (builder flag `.withLongHorizon()` or config `horizonProfile: "long"` — check builder conventions) that scales the audit-02-#12 constants ∝ maxIterations instead of absolute counts: stall threshold (2→max(2, 10% of maxIter)), required-tool nudge cap + ignoredNudgeTolerance, redirect budgets (grounding/coverage 1→2 for ≥30 iter), oracle nudges, maxConsecutiveThoughts (3→5 for ≥30 iter), controller veto stall/inject counters become WINDOWED (last N=10 iterations) under the profile.
- OFF by default — rw-1..9 behavior byte-identical without the flag (pin with a config-plumbing test).
- Acceptance: unit tests per scaled constant (on/off); lh-1 cell under profile completes without guard-kill; rw-9 pin unchanged without profile.

### A3. Lift-rule amendment (agent: caveman:cavecrew-builder · packages/benchmarks/src/gate)
- `evaluateLiftGate`: per-task-class verdicts; long-horizon class gates on cost-per-verified-deliverable (tokens ÷ deliverable-check pass-rate), not raw token-overhead %. Short-task classes unchanged.
- Acceptance: gate unit tests cover both classes; existing gate tests untouched-green.

**Wave A gate:** lh-1 live cell + rw-7/rw-9 pins. Commit per task.

---

## Wave B — Phase 4a: RunContract

> Spec §1. Small, unblocks typed requirement entries in 4b. Audits: 01-F5/F6, 04-R1/R2, eval child-audit.

### B1. Contract types + compiler (agent: general-purpose · reasoning)
- `kernel/contract/run-contract.ts`: `RunContract`, `TaskRequirement {id, kind: question-answered | artifact-produced | constraint-held | tool-coverage, spec, weight}`, `DeliverableSpec`, `AcceptancePolicy` — grafted onto the live PostCondition vocabulary (post-conditions.ts:29-56 is the seed; do NOT fork it, extend it).
- `compileRunContract(task, opts)`: deterministic core = upgraded `deriveConditions` (multi-path derivation — ALL literal paths, inflected write verbs; audit 01-F5 fix lives HERE) + declared TaskContract consumption + tool nominations + comprehend classification (+`horizon` axis added to `classifyTask` — first upward consumer, audit 04-#8).
- Optional LLM-assisted decomposition at compile time (gateway `purpose:"classify"`, structured output → TaskRequirement[]) — capability-gated like the requiredTools classifier; deterministic core is the floor, never the LLM alone.
- Frozen post-compile; `contract-amended` mutation seam stubbed (typed, unused until 4b ledger entry exists).
- Trace event `contract-compiled {requirements, deliverables, horizon}`.
- Acceptance: property tests — every rw-1..9 + lh-1 prompt compiles to a non-empty contract; rw-8 compiles 3 artifact-produced requirements (the 1-of-3 witness); deterministic (same input → same contract).

### B2. Contract consumers (agent: general-purpose · reasoning; after B1)
- Terminal gate check 2.5: `evaluateTerminalGate` accepts optional `contract` + evidence scan; coverage check consumes requirement satisfaction (artifact-produced verified via the existing `isArtifactProduced` ledger scan) instead of tool-name sets when a contract is present. Tool-name path stays as fallback (no contract = today's behavior, byte-identical).
- plan-execute reflect: requirement list rendered from contract refs instead of free-text re-derivation (audit 04-#7).
- Receipt: `deliverables[]` {spec, produced|missing} from contract × steps scan (core TrustReceipt extension; runtime threading).
- Enforcement: `scripts/check-run-contract.sh` — no `deriveConditions(` / requiredTools-set done-ness inference outside kernel/contract/ (grandfathered call sites enumerated in-script, shrinking each wave).
- Acceptance: rw-8 partial cell — 1-of-3 files terminates `partial` with 2 missing deliverables NAMED in receipt (the sweep's acceptance test #4); rw-9 pin 1.0.

**Wave B gate:** rw-8 partial-truth cell + rw-9 + lh-1. 

---

## Wave C — Phase 4b: RunLedger (the L-size one; sequential after B)

> Spec §"ledger" + amended plan Phase 4b. Audits: 01 (entries), 03 (evidence facets + refs + compaction), 04 (requirement entries), 05 (switch-carryover losses).

### C1. Ledger spine (agent: general-purpose · reasoning/kernel; likely worktree)
- `kernel/ledger/run-ledger.ts`: append-only typed entries — `tool-invocation`, `tool-result`, `artifact`, `requirement` (declared/satisfied(evidence-ref)/blocked), `claim`, `verdict`, `harness-signal`, `handoff`, `contract-amended`, `compaction-marker` (WITH dropped-ref enumeration), `checkpoint-marker`, `deliverable-commit`.
- Grown FROM steps[]: dual-emit first (every steps[] writer also appends), steps become a projection LAST. Serialization into kernel-codec (durable resume carries the ledger).
- Emitters wired: act.ts tool paths (artifact entries from registry `produces` declarations — C2), verify() results (persist the verdicts both gates currently discard, audit 01), evidence-grounding claims (stop discarding, audit 01-F2), terminal-gate decisions, guidance injections, todo mutations (audit 04-R3: todo becomes ledger-readable).
- Acceptance: resume/replay equivalence tests; dual-emit property test (steps projection ≡ legacy steps for a recorded run corpus).

### C2. Artifact truth (agent: tools-warden + general-purpose · tools + reasoning; with C1)
- Tool registry gains `produces?: "file" | "data" | "none"` + path-extraction contract per builtin (kills the 4-name/15-key heuristic, audit 01-F1). code-execute declares side-effect capability; MCP tools default `data`.
- `artifact` ledger entries carry {path, digest, op, toolCallId}. `artifacts()` query.
- `countDeliverableCandidates` + abstention `hasDeliverable` re-read from artifact entries (audit 01: stall counters conflate any-success with artifact).
- Acceptance: rw-8 fixture run enumerates exactly its written files; code-execute file write produces an artifact entry (new unit).

### C3. Evidence facets + one ref vocabulary (agent: general-purpose · reasoning/assembly; after C1)
- `EvidenceEntry {full, preview, extractedFact, storedKey}` unifying scratchpad `_tool_result_*`, ResultStore refs, from_step values (audit 03-#14). ONE ref grammar shared by projector previews, recall gate, from_step — H2's vocabulary fix generalized; `res_*` minted refs retired or made recallable.
- Gather-dedup index on (tool, normalized-args-hash): duplicate gathering call → ledger flags + guidance nudge with the existing ref (audit 03-F6). Advisory only (no block) until benched.
- Acceptance: iteration-30 read-back test (sweep acceptance #3) — synthetic 30-iteration state, iteration-3 fact retrievable via ref; dedup unit tests.

### C4. Compaction discipline (agent: general-purpose · reasoning/assembly; after C3)
- Single compaction path = re-projection with protected entry classes (goal, contract outstanding, handoffs, recent evidence); `preserveOnCompaction` becomes LIVE (today read by nothing, audit 03-F4); stubs enumerate dropped refs (no more "summarized" lies); post-compaction size self-check (shrink or emit event).
- Acceptance: compaction property tests (protected classes survive; strictly shrinks or event fires; every stub ref resolvable).

**Wave C gate:** full suites + rw-1/rw-7/rw-8/rw-9/lh-1 cells + `scripts/check-ledger-writes.sh` (no steps/scratchpad/plan mutation outside ledger appenders).

---

## Wave D — Phase 4c: Projector (after C)

> Spec §3. Audits: 03-F1/F5 (H1 subsumed), D1 class.

### D1. Projector authority (agent: general-purpose · reasoning/assembly; worktree)
- `project(contract, ledger, assessment?, plan?) → messages` absorbs: systemPromptStage priorContext block (H1 patch retired), guidance render, todo render, contract.outstanding as the standing goal frame, handoff entries RENDERED post-switch (audit 03-F5: carried steps currently live in state but never render).
- Two-way contract enforced by tests: reachability (every ledger evidence entry reachable via ref grammar from the rendered window) + traceability (rendered sections carry entry provenance; `projection-rendered {sections, refs, droppedRefs, chars}` trace event).
- Render profiles keyed by assessment.phase (until 5a lands, profile = "default").
- Enforcement: `scripts/check-projection.sh` — no message/prompt assembly outside assembly/ (grandfather list shrinking).
- Acceptance: switch-blindness test (post-switch window contains handoff summary — kills the D1 witness); H1/H2 tests keep passing against the new owner; golden traces re-pinned once.

**Wave D gate:** rw-1 (research, most projection-sensitive) + lh-1 + rw-9 pin.

---

## Wave E — Phase 5a: RunAssessment (after C; parallel with D where files disjoint)

> Spec §2. Audits: 02 (all 23 mechanisms), 05 (pace/budget-work coupling), 04 (replan cadence), D2/D4.

### E1. Estimator core (agent: general-purpose · reasoning/kernel)
- `kernel/assessment/assess.ts`: pure `assess(contract, ledger, budget) → RunAssessment {requirements, deliverables, evidenceDelta, phase, pace, health}` — recomputed per iteration, cached on state, `assessment` trace event.
- `evidenceDelta` = new substantive ledger evidence this iteration (successful non-meta tool results not seen before — reuses gather-dedup). Phase model: orient/gather/execute/synthesize/verify from contract progress + recent action mix.
- Pace: burnRatio from BudgetSignal inputs × outstanding requirements → bands green/economize(0.60)/triage(0.80)/terminal(0.95) (audit 05-#12 — budget finally joins remaining work).
- Acceptance: long-gathering false-positive test (sweep acceptance #2): 15 distinct successful calls / 15 iterations → evidenceDelta > 0 every iteration, zero stuck signals.

### E2. Guards consume Assessment (agent: general-purpose · reasoning + reactive-intelligence; after E1 — the D2 kill)
- Migrate, behavior-pinned-then-improved: low_delta_guard (token delta OR evidenceDelta>0 resets — audit 02-#3), controller veto counters → windowed health fields (02-#2), stall-deliverable staleness, F3 error-class arg-sensitivity (02-#11), required-tool nudge "ignored" definition (02-#6: consult phase — gathering-phase non-write ≠ ignoring), RI early-stop consumes phase (H6 generalized: never fire in synthesize phase).
- Each migration: pin current behavior test → move decision onto Assessment field → improvement behind the horizon profile flag where behavior CHANGES (lift-gate discipline).
- Enforcement: `scripts/check-run-assessment.sh` — no count/streak/threshold state outside kernel/assessment/.
- Acceptance: 02's top-5 misfire scenarios become named regression tests (veto-at-finish-line, harness-takeover, terse-model tax, endgame amputation, required-tool-last).

### E3. Pace actions (agent: general-purpose · reasoning; after E1)
- economize: gateway budgetClass downshift for non-synthesis purposes; triage: steer-line naming outstanding requirements (guidance channel); terminal: forced synthesis at `generous` before budget_exceeded cliff (audit 05-#1 — the cliff stops discarding answers).
- Acceptance: unit tests per band; budget-exhaustion integration test ends with synthesized answer + honest partial status, not discarded output.

**Wave E gate:** lh-1 (must show phase transitions + pace bands in trace) + full rw pins.

---

## Wave F — Phase 5b: Control Plane (after E)

### F1. Proposals + resolver (agent: general-purpose · reasoning)
- `ControlProposal` type; loop detector, RI dispatcher, guards, budget monitor, F1/F3 emit proposals consuming Assessment; arbitrator generalizes to ONE action/iteration with documented total order (abstention > strategy-switch kills the P5 race); steering proposals carry remedy metadata (fixes F3 wrong-remedy, audit 02).
- Trace event per resolution (proposals in, action out, why). `scripts/check-control-plane.sh`.
- Acceptance: P5 race regression test; long-gathering false-positive re-run at the control-plane level.

---

## Wave G — Phase 6: Policy Compiler (after B, C, E)

### G1. HarnessPlan + compiler (general-purpose · runtime + reasoning)
- Compile per-run config from capability + calibration + contract.horizon + classification; withers become plan overrides. `horizonProfile` subsumes A2's flag.
- `.withAdaptiveHarness()`: recompile mid-run on Assessment evidence (repeated failure → deepen; clean → lean).
### G2. Purpose→tier routing (provider-warden + general-purpose)
- Gateway sets per-request model from plan (gathering cheap/local, synthesize strong) — the unwired seam (audit 05-#5). Capability-gated, opt-in.
### G3. Ablation + gate (harness-warden)
- `ra-adaptive ≥ max(ra-minimal, ra-full)` on qwen3:14b + cogito:8b per task class incl. lh-1; cost-per-verified-deliverable for the long class; ablation-warden veto stands.
- `scripts/check-policy-compiler.sh`.

---

## Explicitly closed / deferred (so the matrix is total)

- CLOSED by H-wave: 03-F1 (H1), 03-F2 (H2), 05-E2 (H3), 05-E10 (H4), 02-#4 (H5), 02-#5 (H6).
- CLOSED earlier: bench rw-7/rw-4/rw-8 criteria (`a9727e8c`); F1/B1/P3/reflexion drift (terminal gate `3e2d3876`).
- DEFERRED (named, not lost): rw-2 red-herring analysis → P6b independent checker wiring rides Wave F/G (checker slot already in the gate); memory-package live integration (03-F7 in-run memory write-only) → after 4c (projector renders find(memory) results — small follow-on task D1b if bench demands); Phase 7 Strategy→Policy → after G; meta-tool alternating-ping dedup (05-#8) → subsumed by E2 windowed health; bench zombie-fiber contention → already fixed by hard-kill (verify at next full re-run).
- WONTFIX: none.

## Traceability matrix (finding → task)

| Audit finding | Task |
|---|---|
| 01-F1 no artifact record / heuristic recognition | C2 |
| 01-F2 claims discarded | C1 |
| 01-F3/F“verdicts discarded” | C1 |
| 01-F4 provenance dies at commit | C1 (`deliverable-commit`) |
| 01-F5 condition derivation brittle | B1 |
| 01-F6 multi-deliverable partial completion | B1+B2 (rw-8 acceptance) |
| 01 receipt blind to artifacts | B2 + C2 |
| 02-#2 veto no decay | E2 |
| 02-#3 low_delta ignores tool success | E2 |
| 02-#4 stall ships verified:false | H5 ✅ |
| 02-#5 endgame amputation | H6 ✅ + E2 (phase-aware) |
| 02-#6 required-tool-last ladder | E2 |
| 02-#7 double budget (harness passes spend model budget) | E1/E2 (health) + F1 |
| 02-#8 bench 420s wall | A1 (per-task timeout) |
| 02-#11 F3 arg-insensitive error class | E2 |
| 02-#12 <10-iter constants | A2 (profile) → E2 (structural) |
| 02-#14 shared progress currency | E1 |
| 03-F1 priorContext write-only | H1 ✅ → D1 (owner) |
| 03-F2 recall round-trip dead | H2 ✅ → C3 (one grammar) |
| 03-F3 preview cut kills facts | C3 (facets + read-back test) |
| 03-F4 compaction lies / dead protected class | C4 |
| 03-F5 switch handoff unrendered | D1 |
| 03-F6 no gather dedup | C3 |
| 03-F7 in-run memory write-only | deferred D1b |
| 04-R1 requirement ledger spine | B1 + C1 |
| 04-R2 gate check 2.5 | B2 |
| 04-R3 todo harness-readable | C1 |
| 04-R4 typed plan events + checkpoint persistence | C1 (ledger serialization) + D1 (render) |
| 04-R5 replan cadence | E1 (phase) + G1 (cadence policy) |
| 04-R6 blueprint SOLVE gate parity | B2 (contract consumers cover blueprint) |
| 04-R7 retire completion-gaps heuristic | E2 (subsumed by requirement coverage) |
| 04-#8 comprehend no upward gear | B1 (horizon axis) + G1 |
| 05-#1 warn=log, cliff discards answer | E3 |
| 05-#2 budget∝work NONE | E1 |
| 05-#3/#4 terse deliverable / generous unreachable | H3 ✅ + E3 |
| 05-#5 routing seam unwired | G2 |
| 05-#6 switch loses scratchpad/plan | C1/C3 (ledger carries; nothing lost) |
| 05-#7 batching model-dependent | G1 (plan may nudge fan-out) — low priority |
| 05-#8 meta-tool alternating pings | E2 |
| 05-#9 three maxIterations formulas | G1 (plan owns) |
| 05-#10 SO retry dead budget | H4 ✅ |
| 05-#11 two budget systems | E1 (single pace) |
| 06 bench horizon-blind | A1 |
| 06 lift rule anti-gathering | A3 |
| 06 guard constants absolute | A2 → E2 |
| 06 enforcement per phase | B2/C/D1/E2/F1/G3 scripts |

## Dispatch order

```
A1 ∥ A2 ∥ A3          (Wave A — instrument)
B1 → B2               (4a)
C1 ∥ C2 → C3 → C4     (4b)
D1 (after C)  ∥  E1 → E2 ∥ E3 (after C)
F1 (after E)
G1 → G2 → G3 (after B,C,E)
```
Full-session re-run + `rax eval gate` + ledger entry at each wave boundary from C onward. Publication thread independent (gate item 5).
