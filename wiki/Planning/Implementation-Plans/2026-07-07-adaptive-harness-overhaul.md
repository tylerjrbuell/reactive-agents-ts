# Adaptive Harness Overhaul — Implementation Plan (2026-07-07)

**Authority:** [[../../Decisions/2026-07-07-adaptive-harness-architecture-ratified|ratified decision]] + [[../../Architecture/Design-Specs/2026-07-07-ideal-harness-architecture|9-pillar spec]].
**Evidence base:** every phase below maps to a root cause PROVEN in the 2026-07-07 fix waves — no speculative work.
**Goal:** a harness that is dynamic — composed per model + task at build time, recomposable mid-run on evidence — for an OS that creates robust, capable, performant agents of all kinds.

> **AMENDED 2026-07-08** by the deliverable-truth + long-horizon sweep
> ([[../../Research/Audit-Reports-2026-07-08/00-SYNTHESIS-deliverables-longhorizon-sweep|synthesis]], audits 01–06).
> Verdict: CONTINUE — with Phase 3.6 (hotfix wave) and Phase 3.5 (long-horizon
> instrument) inserted before Phase 4, and scope amendments to Phases 4/5/6
> (marked **[LH-AMEND]** below). Four named diseases: D1 write-only harness,
> D2 no shared progress currency, D3 deliverable-blindness, D4 no upward gear.
> Status at amendment: Phases 1–3 SHIPPED (`60b805fc`/`e0d7ce61`, `c102489a`,
> `3e2d3876`); bench validity fix `a9727e8c`.

## Root-cause → phase map

| Proven root cause (today's evidence) | Fix-wave patch (tactical) | Overhaul phase (structural) |
|---|---|---|
| 12 flat-budget LLM sites; 9 untraced sites | P1 provider widening; P2 threading | **1 — LLM Gateway** |
| Tool surface = 6 overlapping concepts; requiredTools incidentally doubled as visibility floor (rw-7/8/9 100%→0 regression) | relevantTools union hotfix | **2 — Tool Surface Compiler** |
| Grounded-terminal held only in react; plan-execute fabricated SATISFIED | P3 ad-hoc gate | **3 — Terminal Authority** |
| Strategy switch lost results + toolsUsed; scratchpad shared-Ref leaks; two records + plan state fragmented | P4 carryover patch; todo key-clear hack | **4 — Evidence Ledger** |
| Loop-detector races F1 abstention; F3 wrong-remedy steering | (open, P5) | **5 — Control Plane** |
| Kernel value model-conditional (+11pp weak / −22pp strong) but applied unconditionally | per-fix conditionals | **6 — Policy Compiler** |
| 8 parallel strategy loops; duplicated synthesis prompts; two compaction paths | prompt edits ×2 | **7 — Strategy→Policy** |

## Phase 0 — DONE / in flight
Ambient run context (CurrentRunContext FiberRef, fallback-only) ✅. Visibility hotfix ✅ (rw-7/8/9 → 1.0 single-cell). Re-run #2 → `rax eval gate` + ledger = baseline for all overhaul ablations.

## Phase 1 — LLM Gateway (pillar 2)

Every model call flows through one mediated path; call sites state intent, gateway decides parameters.

1. Define `LlmCallIntent`: `{ purpose: "think" | "plan" | "synthesize" | "extract" | "classify" | "verify", messages, schema?, budgetClass?: "terse" | "standard" | "generous" }`.
2. Grow `observable-llm.ts` into `kernel/llm-gateway.ts`. Owns: budget resolution (tier default × thinking allowance × budgetClass — supersedes per-site `maxTokens` literals), retry policy (error-fed variation, budget escalation once, never byte-identical), trace correlation (request field ← ambient ← placeholder), model-routing hook (existing `.withModelRouting` slots in), token/cost accounting into the run ledger.
3. Migrate call sites mechanically, package order: kernel capabilities → structured-output pipeline → strategies (plan-execute, blueprint, reflexion, ToT, adaptive) → runtime aux (classifier, finalize).
4. Enforcement: lint/CI grep — zero raw `llm.complete(` / `llm.stream(` outside the gateway module.

**Verify:** suite green; single-cell rw-1/rw-2/rw-9; A2-style token audit shows no dead exchanges. **Exit:** call-site count for budget decisions = 1.

## Phase 2 — Tool Surface Compiler (pillar 6 seed; born from today's regression)

One module computes the ENTIRE tool surface once per iteration; everything else reads it.

1. Define `ToolSurface = { visible: ToolSchema[], callable: Set<string>, required: string[], requiredQuantities, floors: { explicit: string[], meta: string[] } }`.
2. Single resolver consumes ALL current inputs — registrations, `builtins` opt-in, allowedTools, focusedTools, forbiddenTools, classifier output, lazy-disclosure state (used/discovered), gate blocks, pressure state — replacing the scatter across `tool-schemas.ts`, `computePromptSchemas`, `buildToolSchemas`, and guard checks.
3. Invariants enforced IN the resolver (property-tested): `required ⊆ visible`; explicit opt-in ⊆ visible unless forbidden; meta floor always present; `visible ⊆ callable`.
4. Trace event `tool-surface-resolved` with per-tool reason (visible-because / hidden-because) — the rw-9 diagnosis that took a debug-tap becomes one trace line.

**Verify:** rw-7/8/9 cells; property tests; trace shows reasons. **Exit:** deleting any one input (e.g. requiredTools) cannot silently change visibility of an explicitly-requested tool.

## Phase 3 — Terminal Authority (pillar 5)

1. Extract `terminal-gate.ts` service: `(candidate, ledger, contract) → accept | redirect(guidance) | abstain(reason)`. Ordered checks: grounding (F1 arm incl. B1 acceptance), requirement coverage (P3 logic + reflect decomposition), verifier, independent-checker slot (P6b design — opt-in `.withIndependentChecker()`).
2. Adopt everywhere: react kernel (replaces inline arbitration terminal arms), plan-execute (replaces the P3 ad-hoc gate), blueprint plan-verify, reflexion/ToT finishes.
3. One `rawTerminatedBy` vocabulary; abstention first-class terminal in all strategies.
4. Extend `scripts/check-termination-paths.sh` to assert strategies route through the gate.

**Verify:** termination script; abstention/trap-task bench cells; rw-9 stays 1.0. **Exit:** zero strategy-owned accept paths.

## Phase 3.6 — Long-horizon hotfix wave [LH-AMEND] (0.5-class, days)

High-leverage fixes needing no new architecture; each single-cell-verified (rw-1 + rw-7) before commit.

1. **H1** Render `priorContext` — only renderer died with the APC deletion; strategy-switch handoffs, ToT handoffs, memory bootstrap are composed-then-dropped (audit 03-F1). One assembly-stage change.
2. **H2** Align the recall-gate marker with the projector vocabulary (`result_ref=`) so the model can actually re-read stored evidence (03-F2).
3. **H3** Reclass terminal synthesis sites `terse`→`generous` (finalize.ts:147, runner.ts:1018/1155) — the deliverable call currently gets the smallest budget; `generous` has zero call sites (05-E2).
4. **H4** Structured-output retry fail-fast — stopReason/empty-content check; never identical-budget re-spend (05-E10; A2 remedy #1 was never shipped).
5. **H5** Stall-deliverable honors the in-loop verifier — `verified:false` must not flip to terminal success (trace 01KWZ811 three-bug stack, 02-#4).
6. **H6** Remove/scale the RI early-stop maxIterations−2 amputation — protect the synthesis quartile (02-#5).

**Exit:** all six landed; rw-1..9 single-cells within bands.

## Phase 3.5 — Long-horizon instrument [LH-AMEND] (BEFORE Phase 4's merge gate)

The bench has no task >25 iterations, so every gate verdict to date is horizon-blind, and the ≤15% token-overhead lift rule structurally rejects gather-more mechanisms (audit 06).

1. **lh-1 bench task**: ≥40-iteration research-and-deliver task (multi-question research → structured report + files), scored via hidden reference checks (`a9727e8c` pattern) + per-requirement judge decomposition.
2. Horizon-normalized guard profile (opt-in flag): thresholds ∝ maxIterations — stall threshold, nudge/redirect budgets, veto windows (02-#12 constants). Short-task behavior unchanged without the flag.
3. Lift-rule amendment: per-task-class verdicts; long-horizon class gates on **cost-per-verified-deliverable**, not raw token overhead.

**Exit:** lh-1 completes under the profile; rw-1..9 unchanged without it.

## Phase 4 — Evidence Ledger (pillar 4)

1. `RunLedger`: append-only typed entries — tool-invocation(+result), claim, verdict, harness-signal, compaction-marker, checkpoint-marker. Grown FROM `steps[]` (steps become a projection, preserving the two-record insight).
2. Projections: LLM-visible messages (curator), strategy views, receipts + honesty labels (queries — closes P7), trace (the ledger IS the trace source).
3. Scratchpad keys ledger-backed and run-scoped by construction — deletes the shared-Ref cross-run leak class (todo key-clear hack retired).
4. Strategy switch = new policy over the same ledger — P4 carryover patch retired; nothing to carry because nothing is lost.
5. Compaction (pillar 9 folds in): single path = re-projection with protected entry classes + post-compaction size self-check.

**[LH-AMEND] Scope additions (sweep 2026-07-08, audits 01/03/04):**
6. Entry types beyond the sketch: `artifact` (registry-declared `produces` + path + digest + op — kills the 4-tool-name/15-path-key recognition heuristic; code-execute/MCP writes become visible), `requirement` (declared / satisfied(evidence-ref) / blocked — typed `TaskRequirement {question-answered | artifact-produced | constraint-held | tool-coverage}` grafting the judge decomposition onto the live PostCondition vocabulary; derivation consumes TaskContract), persisted `verdict` entries (every verify() result — today recomputed and discarded at both gates), `claim`, `deliverable-commit` (provenance survives commit — no more string laundering into model_synthesis), `handoff`, compaction markers WITH dropped-ref enumeration.
7. Unified EvidenceEntry facets {full, preview, extractedFact, storedKey} + ONE reference vocabulary shared by projector, recall gate, and from_step (kills the dead recall round-trip class at the root).
8. Projections: progress % / N-of-M (dropped-totalSteps class), `receipt.deliverables[]`, `outstanding()` for steering, gather-dedup index on (tool, args-hash).
9. Terminal gate check 2.5: requirement coverage from ledger entries, not tool-name sets. Todo entries become ledger-readable (harness-blind scratchpad retired).
10. Enforcement: `scripts/check-ledger-writes.sh` — no steps/scratchpad/plan mutation outside ledger appenders.

**Verify:** durable resume/replay equivalence tests; switch tests; compaction property tests (protected classes survive; context strictly shrinks or event fires); **[LH-AMEND] lh-1 cell + rw-8 partial-completion cell (1-of-3-files must NOT pass)**. **Exit:** steps/scratchpad/plan-state have single source of truth **and `artifacts()`/`outstanding()` are queryable mid-run**.

## Phase 5 — Control Plane (pillar 8)

1. `ControlProposal = { actor, action (redirect|switch|abstain|budget|steer|stop), priority, reason }`.
2. Loop detector, RI dispatcher, guards, budget monitor, F1/F3 all emit proposals; nothing acts directly.
3. Arbitrator (existing 6-evaluator chain generalized) resolves ONE action per iteration with a documented total order — abstention outranks strategy-switch (kills the P5 race by construction); steering proposals carry remedy metadata (fixes F3 wrong-remedy).
4. Trace event per resolution: proposals in, action out, why.

**[LH-AMEND] Scope additions (audit 02):**
5. One shared `evidenceDelta` progress currency consulted by ALL proposal emitters — successful substantive observations reset staleness everywhere (today only 5 of 23 mechanisms distinguish gathering from stuck).
6. Windowed/decaying counters replace run-cumulative ones (veto counters currently never decay — iteration-2 stumbles veto iteration-28 answers).
7. Steer-never-deliver until the final quartile; harness-pass spend separated from the model's iteration budget.

**Verify:** P5 race regression test (abstain vs loop-switch same iteration); bench; **[LH-AMEND] long-gathering false-positive test (15 distinct successful calls / 15 iterations accumulates zero termination pressure)**. **Exit:** grep-zero direct control-flow mutation outside the resolver (`scripts/check-control-plane.sh`).

## Phase 6 — Policy Compiler (pillar 6) — the dynamic-harness payoff

1. `HarnessPlan`: compiled per-run config — strategy default, gateway budget profile, guard thresholds, tool-surface inputs, meta-tool set (todo/checker on/off), scaffold depth, verifier tier (deterministic > checker > self-critique by stakes).
2. Compiler inputs: capability table + calibration (exists), task classification (exists: complexity/category/tool-need), user overrides (withers become overrides ON the plan, not scattered flags).
3. `.withAdaptiveHarness()` opt-in: compile at build; **recompile mid-run** on ledger evidence (repeated failure → deepen scaffold; clean trajectory → stay lean; escalation = recompile, not teardown) — "a harness that adapts or builds with the agent."
4. Acceptance test = the A1 thesis inverted: `ra-adaptive ≥ max(ra-minimal, ra-full)` on BOTH qwen3:14b (strong-thinking) and cogito:8b (weak) per task class. Cross-tier ablation → lift gate → default-on decision (warden veto stands).

**[LH-AMEND] Scope additions (audits 04/05/06):**
5. `horizon` classification axis + `horizonProfile` in HarnessPlan — first UPWARD consumer of comprehend signals (today complexity only shrinks; shape decorative). Sizes iterations, replan cadence (every-N progress self-audit on reactive), checkpoint frequency.
6. Pace bands joining budget to remaining work (today: zero coupling, warn = log line): green → economize(0.60) → triage(0.80, steer against unmet requirements) → terminal(0.95, forced synthesis at `generous`).
7. Purpose→tier routing via the gateway's per-request model field: gathering cheap/local, synthesis strong.

**Exit:** one bench matrix where adaptive dominates or ties both static configs on both models — **[LH-AMEND] matrix spans rw-1..9 AND lh-1; long-horizon class gated on cost-per-verified-deliverable, not raw token overhead.**

## Phase 7 — Strategy → Policy (pillar 1)

Only after 1–6 hollow the strategies: plan-execute first (most duplication: 2 synthesis prompts, own gate, own retries — all now services), then blueprint, reflexion, ToT as policy parameterizations of the one loop. Registry keeps the same public strategy names — zero API break.

**Exit:** one loop implementation; strategies are data + small policy hooks; every invariant holds by construction.

## Execution rules (binding, unchanged)

- Each phase: single-cell verifies during dev → full-session bench + `rax eval gate` + ledger entry before merge-to-default.
- No big-bang: every phase ships behind the existing API; wither surface unchanged until Phase 6 makes flags into plan-overrides.
- Default-on ONLY via cross-tier lift rule; ablation-warden veto.
- Sequencing is dependency-driven: 1 and 2 are independent (parallelizable); 3 needs 1; 4 unblocks 5's ledger-backed proposals and retires patches from P4/todo; 6 needs 2+3+4 signal surfaces; 7 strictly last.
- Publication (launch-gate item 5) can ship after re-run #2 verdict — it does NOT wait for the overhaul.

## Effort sketch (sessions, not calendar)

| Phase | Size | Parallelizable |
|---|---|---|
| 1 Gateway | M (mechanical after design) | with 2 — **SHIPPED** |
| 2 Tool Surface | M | with 1 — **SHIPPED** |
| 3 Terminal Authority | M | after 1 — **SHIPPED** |
| 3.6 LH hotfix wave [LH-AMEND] | S (6 fixes, 0.5-class) | after 3 |
| 3.5 LH instrument [LH-AMEND] | S (lh-1 + guard profile + lift-rule) | with 3.6 |
| 4 Ledger (amended) | L (the big one) | after 3.5 gate exists |
| 5 Control Plane (amended) | S–M | after 4 |
| 6 Policy Compiler (amended) | M + ablation time | after 2,3,4 |
| 7 Strategy→Policy | L (amortized per strategy) | last |

**[LH-AMEND] Durability rule:** every remaining phase ships its grep-able enforcement script (check-tool-surface, check-ledger-writes, check-control-plane, check-policy-compiler, check-single-loop, check-deliverable-truth). A phase without its invariant script is not done.
