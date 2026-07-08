# Architecture Sweep 2026-07-08 — 04 Goal Decomposition & Progress Tracking

READ-ONLY audit. Builds on [[../Audit-Reports-2026-07-07/04-reasoning-strategies|04-reasoning-strategies]] and [[../Harness-Reports/2026-07-07-capability-gap-synthesis|capability-gap synthesis]] (requirement-coverage, P3, P6a). Question: does the agent (and harness) KNOW what sub-goals exist, which are done, which remain, and when the whole goal is met?

**Headline verdict:** RA has exactly ONE typed sub-goal ledger (`Plan`/`PlanStep`), and it is locked inside plan-execute/blueprint, projected outward only as prose. On the reactive path, "requirement" is spelled "tool name": the sole quantitative live tracker is successful-tool-call counts vs `requiredTools`/`requiredToolQuantities`. Nothing anywhere tracks whether a *question was answered* or a *constraint held*. The rw-1 failure ("identify conflicts" silently dropped while reflect declared SATISFIED) is the canonical signature, and the 2026-07-07 fix was a *prompt*, not a data structure.

---

## 1. Mechanism inventory

### 1.1 plan-execute — the only real progress data structure

| Mechanism | Where | Notes |
|---|---|---|
| Typed plan | `packages/reasoning/src/types/plan.ts:63-105` | `PlanStep{id:s1..sN, status: pending/in_progress/completed/failed/skipped, retries, tokensUsed, result/fullResult, startedAt/completedAt}`; `Plan{goal, mode, steps[], status, version}` |
| Hydration | `plan.ts:118-150` (`hydratePlan`) | LLM output (`LLMPlanOutputSchema`) → typed steps with sequential ids |
| Wave scheduling | `plan.ts:242-271` (`computeWaves`) + `extractDependencies :220` | dependency waves from `dependsOn` + `{{from_step:sN}}` refs; **cycle → silent sequential fallback** (`plan-verify.ts:116` note) |
| Ref projection | `plan.ts:172-210` (`resolveStepReferences`) | FM#3/FM#3b distill + `:summary`/`:full` projections |
| Required-tool plan repair | `plan-execute.ts:314-366` | synthetic `tool_call` steps injected for missing requiredTools (file-write gets path-guessing smart args) |
| Quantity enforcement | `plan-execute.ts:368-395` | deficit vs `requiredToolQuantities` → synthetic steps appended |
| Execution ledger updates | `plan-execute.ts:611-612, 704-725` | `step.status`/`result`/`fullResult`/timestamps mutated in place; `completedSteps[]` carried across refinements; `computeWaves` skips completed |
| Persistence (opt-in) | `plan-execute.ts:398-402` (`savePlan`), `:716-720, :737-741` (`updateStepStatus`) via `PlanStoreService` | ONLY when memory layer enabled; blueprint does NOT persist at all |
| Reflect (requirement decomposition) | `strategies/planning/plan-prompts.ts:414-443` | rw-1 fix at `:430-435`: "Decompose the GOAL into its explicit requirements… SATISFIED only if EVERY requirement is addressed". **Output is free text** — first line `SATISFIED:`/`UNSATISFIED:` parsed by `isSatisfied()`; the requirement list is never captured as data |
| Grounded terminal | `plan-execute.ts:1031-1049, 1263-1286` (`evaluateGroundedSatisfaction`) → `evaluateTerminalGate` | covered = COMPLETED tool_call step names; redirect once → abstain |
| Refine | `planning/plan-mutation.ts:75` (`patchPlan`), `:130` (`augmentPlan`) | patch rewrites failed+pending; augment appends new steps from reflection feedback (free text in, steps out) |
| Outer-loop controller | `plan-execute.ts:872-1023` | entropy + RI dispatch per refinement; `early-stop` breaks loop |

**Who else can read plan progress?** Effectively nobody, in typed form:
- Events: `ReasoningStepCompleted` with `[PLAN]`, `[SCHEDULE]`, `[STEP i/N]`, `[EXEC sK ✓/✗]`, `[REFLECT]`, `[AUGMENT]` **prose in thought/observation strings** (`plan-execute.ts:571-599, 615-623, 785-804`); `ReasoningIterationProgress{iteration, maxIterations}` per step (`:797-804`). No typed plan payload ever leaves the strategy.
- The engine's stream drops even the little that exists: `ReasoningStepCompleted.totalSteps` is discarded at `packages/runtime/src/.../execute-stream.ts:194` (child audit 2). Public progress surface = `IterationProgress{iteration, maxIterations}` only.
- PlanStore rows (`plan_steps` with status) persist when memory is on, but on resume they re-enter only as a **prose hint** (`reasoning-think.ts:181-200`); KernelState checkpoints carry **no plan-step status** (auto-checkpoint content = successful tool observations, `kernel/loop/auto-checkpoint.ts:46+`).
- `EventLog goal_state.remaining` exists but is internal-only (`assembly/event-log.ts:7`). No `percent`/`remaining` field exists anywhere in RunResult/RunHandle/receipts/ui-core (`StepEvent` reserved, unemitted).

### 1.2 blueprint (ReWOO) — plan without a progress loop

- `verifyPlan` (`strategies/blueprint/plan-verify.ts`) is deterministic PRE-execution structural verification: DAG validity, tools exist, refs resolve, requiredTools/quantities present (`:322`); repairs fixable, degrades to reactive on unfixable (`blueprint.ts:327`).
- Progress visibility is deliberately human-oriented prose: `progress-format.ts` (`formatPlanListing`, `formatStepAttempt "▶ Step k/N"`) emitted in event thought strings (`blueprint.ts:261`, `worker.ts:160`).
- Worker (`worker.ts:424`) runs `computeWaves` over the DAG, mutates step statuses internally, patch-once on failure — but there is **no reflect loop, no post-execution requirement check, and the SOLVE synthesis ships ungated** (invariant table, 07-07 audit F5). Blueprint also never touches PlanStore. A blueprint run's sub-goal state is invisible after the fact except via prose events.

### 1.3 reactive/adaptive long runs — tool-name proxies + model memory

| Mechanism | Where | What it tracks |
|---|---|---|
| Requirement-coverage ledger | `kernel/capabilities/verify/requirement-state.ts:30-144` | **the only quantitative live tracker**: successful tool-call counts (incl. delegated credit) vs `requiredTools` with `requiredToolQuantities` floors; permanently-failed tools excluded from nudges (`:116-144`) |
| Quantity inference | `structured-output/infer-required-tools.ts:228-296` | classifier maps task entities → per-tool min call counts (e.g. `{web-search: 4}`) |
| Per-round progress prose | `kernel/capabilities/act/conversation-assembly.ts:142-186` | after each tool round, appends "what you did / what's missing (with counts)" + research→produce transition synthesis prompt — prose into the model's context |
| Terminal gate | `kernel/capabilities/decide/terminal-gate.ts:136-221` | ONE ordered pipeline: exemption → grounding (F1) → **coverage = requiredTools − coveredTools set difference (tool NAMES)** → checker slot (inert). 4 call sites: `arbitrator.ts:308` (end-turn evaluator, covered=ATTEMPTED), `arbitrator.ts:945` (grounded-terminal), `plan-execute.ts:1274`, `reflexion.ts:447` |
| final-answer hard gate (FC) | `kernel/capabilities/act/act.ts:410-437` | requires quantity-aware coverage + non-meta grounding; calls `detectCompletionGaps` once (`:427`) |
| Completion-gap detector | `packages/tools/src/skills/completion-gaps.ts:10-106` | **NOT dead** (old-audit claim falsified): live at `act.ts:427` and `think-guards.ts:259` (`guardCompletionGaps`, wired at `think.ts:1094`). But it is a shallow heuristic: MCP-namespace mentions + exactly 3 action-verb regexes (web-search / file-write / file-read). It cannot see "answer 10 questions" |
| pulse meta-tool | `packages/tools/src/skills/pulse.ts` | model-PULL self-diagnostic; `checkReadiness` lists required-tool blockers — only if the model asks |
| todo meta-tool (P6a) | see 1.4 | model-maintained checklist |
| Reflexion PostConditions | `strategies/reflexion.ts:414-436` + condition module | the one LIVE typed-requirement spine: union `{ToolCalled, ArtifactProduced, OutputContains}`, `deriveConditions` + `verify()` — reflexion-only |
| Strategy sizing | adaptive/comprehend | **shrink-only**: complexity forces reactive on trivial (`adaptive.ts:511`), ToT skips BFS (`tree-of-thought.ts:207`). Nothing sizes UP for long-horizon work |

### 1.4 todo meta-tool — verdict: text scratchpad, harness-blind

- Pure core `packages/tools/src/skills/todo.ts:73-116` (`applyTodoAction`: add/start/done/list; render includes `(k/N done)` and "All items done — deliver your final answer now").
- Kernel inline handler `kernel/capabilities/act/meta-tool-handlers.ts:144-158`: state lives in shared scratchpad key `_todo:<taskId>`; cleared at run start (`kernel/loop/runner.ts:257-263`); folded into `KernelState.scratchpad` → survives crash-resume.
- Wiring: opt-in `.withMetaTools({todo:true})` (`runtime/src/builder/build-effect/runtime-construction.ts:288`, "stays opt-in until it passes the cross-tier lift gate" `:253`); schema appended at `tool-capabilities.ts:78`.
- **Is it a progress ledger?** No. Grep `_todo` → the ONLY reader/writer is the handler itself. No gate, no arbitrator, no reflect, no trace event, no receipt consults it. It is structured (typed `TodoItem[]` in the scratchpad) but *harness-invisible* — a private notebook the model shows itself.
- **What nudges the model to USE it?** Only the tool description (`todo.ts:120-126`: "Call ONCE at the start of any task with 3+ distinct steps… Finish every item before delivering your final answer"). No system-prompt nudge, no guidance injection, no staleness detection, no terminal-gate cross-check ("you have 3 unchecked items — deliver anyway?").

### 1.5 terminal-gate.ts — coverage is tool-name-level by construction

`terminal-gate.ts:174-196`: `missing = requiredTools.filter(t => !coveredTools.has(t))`. The docstring itself scopes it: "requirement coverage (B1/P3): some required tools never succeeded". Calling web-search 5× satisfies `{web-search: 5}` while answering none of the 10 research questions. The structure is friendly to extension: it is an *ordered pure pipeline* with an explicit inert P6b checker slot (`:198-218`) — a requirement-satisfaction check would slot in as check 2.5 between coverage and checker, consuming typed requirement state instead of a tool-name set (see Q2/Q3).

### 1.6 comprehend/task-classification — decorative for long-horizon

Child audit 1: `complexity` LIVE but shrink-only (trivial→reactive `adaptive.ts:511`, ToT BFS skip `tree-of-thought.ts:207`); `TaskClassification.intent` decorative on the live path (re-derived via `extractOutputFormat` at `runner.ts:243` / `finalize.ts:73`); `shape` fully decorative (zero consumers). plan-execute even annotates its own input field "currently unused, kept for forward compat" (`plan-execute.ts:121-122`). **No signal modulates iterations, replan cadence, checkpoint frequency, or budgets upward for a big goal.**

### 1.7 runtime/trace/UI — no progress projection

Child audit 2: `totalSteps` dropped at `execute-stream.ts:194`; only `IterationProgress{iteration, maxIterations}` is public; no `percent`/`remaining` field in RunResult/receipt/RunHandle; checkpoint/resume carries no plan-step status (PlanStore rows → prose hint at `reasoning-think.ts:181-200`); ui-core `StepEvent` reserved/unemitted; `EventLog goal_state.remaining` internal-only (`event-log.ts:7`).

---

## 2. The four questions

### Q1 — Reactive strategy, 10-requirement research goal: what tracks per-requirement completion?

Complete enumeration:
1. `requiredTools` + `requiredToolQuantities` successful-call counting (`requirement-state.ts`) — IF the classifier inferred them (`infer-required-tools.ts`). Tool-name granularity: knows "web-search called ≥4×", not which questions got answered.
2. End-of-round prose progress summary into the model's own context (`conversation-assembly.ts:142-186`).
3. `detectCompletionGaps` heuristics — namespace mentions + 3 verb regexes; blind to content requirements.
4. Terminal-gate coverage check at end_turn/final-answer — same tool-name set difference.
5. `todo` (opt-in) — model-maintained, harness-blind.
6. `pulse` — pull-only, and its readiness check is again requiredTools.

**Blunt answer: per-REQUIREMENT completion is tracked by the model's own context window and nothing else.** Every harness mechanism above is a tool-usage proxy or a prose echo back into that same context window. If requirement #7 of 10 is "identify conflicts between sources", no data structure in the live path ever represents it, so nothing can notice it was skipped — exactly the rw-1 trace. The 07-07 fix (reflect/synthesis COMPLETION CHECK prompts, `plan-prompts.ts:430-435`, `plan-execute.ts:447/1083`) asks the model to decompose requirements *in free text, at the terminal, on plan-execute only*; reactive got only the synthesis-prompt variant, and the decomposition is never parsed back.

### Q2 — Typed requirement objects: what exists in eval land that could migrate?

Live today (tool-level only): `requiredTools` ALL-OF + quantities. Migratable machinery, ranked:

1. **Reflexion's PostCondition spine — already live, already typed.** Union `{ToolCalled, ArtifactProduced, OutputContains}` + `deriveConditions` (task → conditions) + `verify()` (conditions × steps/output → unmet). This IS the typed-requirement foundation; it's just imprisoned in one strategy and its vocabulary lacks `question-answered`/`constraint-held`.
2. **Judge criterion-decomposition (2026-07-07 partial-credit protocol)** — proves the decomposition pattern (goal → per-requirement layers, scored independently) but is prompt-driven with free-text `layerName`, no schema. The *pattern* migrates (a structured-output decomposition call producing typed requirements at run START, not judge time); the code doesn't.
3. **Bench task definitions** — rw-* tasks carry explicit criteria + deterministic verify functions; they are the ground-truth shape a live `TaskContract` should let users declare.
4. **evaluateLiftGate / RunDiagnosis / ImprovementLedger** — stay eval-side (need cross-run aggregates / ground truth); not live-path candidates.

Concrete migration: `TaskRequirement = {id, kind: "question-answered" | "artifact-produced" | "constraint-held" | "tool-coverage", text, evidence?: {kind, ref}}`. Derivation seam already exists: `infer-required-tools.ts` is *already* an LLM structured-output classifier over the goal — extend its schema from `{required, relevant, quantities}` to also emit requirement objects (one call, no new cost). Verification seam: generalize reflexion's `verify()` (deterministic for artifact/tool kinds; model-claim or P6b-checker for question/constraint kinds) and make plan-execute's reflect return structured `{requirements: [{id, satisfied, evidence}]}` via `extractStructuredOutput` instead of a SATISFIED first line.

### Q3 — Where should goal-progress live for the Phase-4 evidence ledger?

Proposed ledger entry types (append-only, evidence-ref discipline mirroring receipts):

- `requirement-declared {reqId, kind, text, source: "classifier" | "planner" | "user-contract" | "model-todo"}`
- `requirement-satisfied {reqId, evidenceRef (stepId | observationId | artifactPath | planStepId), verifier: "deterministic" | "model-claim" | "independent-checker"}`
- `requirement-blocked {reqId, reason, attempts, lastError?}`

Emitters that exist today and would need only the emit call:
| Entry | Emitter |
|---|---|
| declared | `infer-required-tools.ts` (classifier output); `hydratePlan` call sites (each plan step = declared sub-goal); todo `add` handler (`meta-tool-handlers.ts:154`, source `model-todo`); user `TaskContract` at builder |
| satisfied | `requirement-state.ts` count-floor crossings (tool-coverage kind, deterministic); plan-execute step-completion block (`plan-execute.ts:704-714`, evidenceRef = planStepId); reflexion `verify()` pass; structured reflect verdict (model-claim); P6b checker (independent) |
| blocked | `getPermanentlyFailedRequiredTools` transitions (`requirement-state.ts:116`); grounded abstention paths (`plan-execute.ts:1045-1048`, arbitrator §7.5); patch-exhaustion in blueprint worker |

The terminal gate then stops recomputing set differences and instead reads the ledger: ship only when every declared requirement is satisfied or explicitly blocked-and-disclosed. Trace/UI progress % becomes a pure projection (`satisfied / declared`), fixing the runtime-exposure hole (1.7) as a side effect — and receipts gain a per-requirement evidence table, which is the strongest possible "receipts" artifact for the launch story.

### Q4 — Cheapest replan/checkpoint cadence for reactive long runs

Current cadences: plan-execute reflects once per refinement iteration (after a full wave pass, ≤ maxRefinements); blueprint never; reactive **never** — `auto-checkpoint.ts:15-28` fires on token-pressure only (soft zone below hard gate), not iteration count; there is no periodic goal re-anchor.

Cheapest mechanism (all parts exist): an **every-N-iterations progress self-audit guard** in the think-guard chain (pattern: `guardCompletionGaps`, `think.ts:1094`), firing on `iteration % N === 0` (N from complexity signal — first genuine long-horizon USE for comprehend) or on entropy flat/diverging:
1. Zero-LLM tier: inject a harness observation = `renderTodoList(scratchpad)` + `getEffectiveMissingRequiredTools` counts + "Re-read the goal. Update your todo. State in one line what remains." — pure prompt injection via the existing `pendingGuidance` channel; costs only tokens the model was going to burn drifting.
2. Optional escalation: if todo is empty/stale after 2 audits on a task classified multi-step, ONE cheap structured call to decompose the goal into requirements (Q2 machinery) and seed the todo — turning the model's private notebook into a declared-requirement ledger the gate can read.
This keeps reactive's identity (no plan phase) while giving it the one thing plan-execute has and it lacks: a periodic, externalized "what remains" checkpoint that survives context pressure (scratchpad → KernelState → checkpoint → resume).

---

## 3. Phase 4/6 requirements extracted

- **R1 (Phase 4, ledger):** `TaskRequirement` typed schema + the three ledger entry types of Q3; emitters per Q3 table. Ledger is the single source the gate, receipts, traces, and UI project from.
- **R2 (terminal authority):** add requirement-satisfaction check to `evaluateTerminalGate` (check 2.5, between coverage and checker) reading ledger state; tool-name coverage becomes just the `tool-coverage` requirement kind.
- **R3 (P6a hardening):** make todo harness-readable — gate cross-checks unchecked items at terminal; staleness nudge; `requirement-declared(source:model-todo)` mirroring. Prereq for todo's default-on lift gate to mean anything.
- **R4 (observability):** typed `plan-created`/`plan-step-status` events; stop dropping `totalSteps` (`execute-stream.ts:194`); expose `progress {satisfied, declared, percent}` on RunHandle/receipt; persist plan-step + requirement state in checkpoints (today only the todo scratchpad survives resume).
- **R5 (Phase 6, policy compiler):** replan/self-audit cadence as compiled policy — complexity/category signals (today shrink-only/decorative) size N, checker involvement, and decomposition depth. First upward-sizing consumer of comprehend.
- **R6 (blueprint parity):** post-execution requirement gate before SOLVE ships (blueprint currently verifies structure pre-exec, then ships ungated); persist blueprint plans to PlanStore like plan-execute.
- **R7 (correction to prior audit):** `detectCompletionGaps` is NOT dead — live at `act.ts:427` + `think-guards.ts:259`/`think.ts:1094`; treat it as the heuristic floor that R1/R2 subsume, then retire.

**One-sentence synthesis:** every layer of the stack currently answers "am I done?" with a different proxy (tool names, step statuses, free-text SATISFIED, model memory) and none of them share a data structure — the Phase-4 requirement ledger is the missing spine, and almost every emitter it needs already exists.
