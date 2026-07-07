# Adaptive Harness Overhaul — Implementation Plan (2026-07-07)

**Authority:** [[../../Decisions/2026-07-07-adaptive-harness-architecture-ratified|ratified decision]] + [[../../Architecture/Design-Specs/2026-07-07-ideal-harness-architecture|9-pillar spec]].
**Evidence base:** every phase below maps to a root cause PROVEN in the 2026-07-07 fix waves — no speculative work.
**Goal:** a harness that is dynamic — composed per model + task at build time, recomposable mid-run on evidence — for an OS that creates robust, capable, performant agents of all kinds.

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

## Phase 4 — Evidence Ledger (pillar 4)

1. `RunLedger`: append-only typed entries — tool-invocation(+result), claim, verdict, harness-signal, compaction-marker, checkpoint-marker. Grown FROM `steps[]` (steps become a projection, preserving the two-record insight).
2. Projections: LLM-visible messages (curator), strategy views, receipts + honesty labels (queries — closes P7), trace (the ledger IS the trace source).
3. Scratchpad keys ledger-backed and run-scoped by construction — deletes the shared-Ref cross-run leak class (todo key-clear hack retired).
4. Strategy switch = new policy over the same ledger — P4 carryover patch retired; nothing to carry because nothing is lost.
5. Compaction (pillar 9 folds in): single path = re-projection with protected entry classes + post-compaction size self-check.

**Verify:** durable resume/replay equivalence tests; switch tests; compaction property tests (protected classes survive; context strictly shrinks or event fires). **Exit:** steps/scratchpad/plan-state have single source of truth.

## Phase 5 — Control Plane (pillar 8)

1. `ControlProposal = { actor, action (redirect|switch|abstain|budget|steer|stop), priority, reason }`.
2. Loop detector, RI dispatcher, guards, budget monitor, F1/F3 all emit proposals; nothing acts directly.
3. Arbitrator (existing 6-evaluator chain generalized) resolves ONE action per iteration with a documented total order — abstention outranks strategy-switch (kills the P5 race by construction); steering proposals carry remedy metadata (fixes F3 wrong-remedy).
4. Trace event per resolution: proposals in, action out, why.

**Verify:** P5 race regression test (abstain vs loop-switch same iteration); bench. **Exit:** grep-zero direct control-flow mutation outside the resolver.

## Phase 6 — Policy Compiler (pillar 6) — the dynamic-harness payoff

1. `HarnessPlan`: compiled per-run config — strategy default, gateway budget profile, guard thresholds, tool-surface inputs, meta-tool set (todo/checker on/off), scaffold depth, verifier tier (deterministic > checker > self-critique by stakes).
2. Compiler inputs: capability table + calibration (exists), task classification (exists: complexity/category/tool-need), user overrides (withers become overrides ON the plan, not scattered flags).
3. `.withAdaptiveHarness()` opt-in: compile at build; **recompile mid-run** on ledger evidence (repeated failure → deepen scaffold; clean trajectory → stay lean; escalation = recompile, not teardown) — "a harness that adapts or builds with the agent."
4. Acceptance test = the A1 thesis inverted: `ra-adaptive ≥ max(ra-minimal, ra-full)` on BOTH qwen3:14b (strong-thinking) and cogito:8b (weak) per task class. Cross-tier ablation → lift gate → default-on decision (warden veto stands).

**Exit:** one bench matrix where adaptive dominates or ties both static configs on both models.

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
| 1 Gateway | M (mechanical after design) | with 2 |
| 2 Tool Surface | M | with 1 |
| 3 Terminal Authority | M | after 1 |
| 4 Ledger | L (the big one) | after 3 |
| 5 Control Plane | S–M | after 4 |
| 6 Policy Compiler | M + ablation time | after 2,3,4 |
| 7 Strategy→Policy | L (amortized per strategy) | last |
