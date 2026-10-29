---
type: implementation-plan
status: completed (Phase 1)
created: 2026-10-28
updated: 2026-10-28
tags: [implementation-plan, planning, checklist, meta-loop, ledger, durable-runs, cortex, tui, ui-core]
spec: "[[2026-10-28-plan-and-goal-primitives]]"
---

# Plan and Goal Primitives — Phase 1 (Checklist on the Meta-Loop Spine) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> - Tasks marked **Owner: <warden>** MUST be dispatched to that warden via `Agent`, with a MissionBrief (`.claude/skills/mission-brief`), and logged in `wiki/Research/Pilots/2026-05-23-team-ownership-dev-contract/log.md`.
> - Tasks marked **Owner: main** are done by the dispatcher or a general subagent.
> - Rows marked **parent** inside a warden task are edits outside that warden's authority. The dispatcher lands them in the same commit.

**Goal:** A live, durable checklist for every run, shown in the TUI, `AgentStream`, `ui-core` and Cortex. It is projected from the same contract and ledger facts that the terminal gate judges and the model is shown. The `todo` tool moves onto that spine.

**Architecture:** This work extends the ratified meta-loop (RunContract → RunLedger → RunAssessment → Control → Actuators → Projector) and builds nothing beside it.
- **Ledger:**
  - Requirement facts become self-describing.
  - A new `checklist-item` fact records the model's advisory `todo` items.
  - The process-global scratchpad list is retired.
- **Projector:** one pure projector in core, `projectChecklist(facts)`, folds those facts.
- **Runtime:** the projection layer derives a `ChecklistUpdated` snapshot from `LedgerEntryAppended`. The kernel publishes nothing new.
- **TUI:** folds the same bus facts with the same projector.
- **Cortex:** persists the snapshot in its existing turn trace.
- **Durability:** the ledger is run-scoped and rides checkpoints, so durability, strategy-switch survival and multi-pass continuity come for free.

**Tech Stack:** TypeScript (strict, no `any`), Effect-TS, Bun test, SvelteKit (Cortex UI), Elysia (Cortex server).

**Spec:** `wiki/Architecture/Design-Specs/2026-10-28-plan-and-goal-primitives.md` (revision 2). Executors read both documents.

## Scope

- **This plan fully specifies Phase 1 of the spec.**
- **Plan family:** this plan is 3 of 3, split on 2026-10-28.
  - [[2026-10-28-cortex-reliability-and-providers]] runs first and is independent.
  - [[2026-10-28-cortex-run-visibility]] must land before this plan, which consumes two of its pieces:
    - its Task 1: `makeRunTree` in core, the one delegation-tree resolver;
    - its Task 2: the runtime's single stream scope resolver, `routeScoped`, in `engine/stream-scope.ts`.
- **Phases 2–4** get their own plans, written after Phase 1 ships. "Later phases" below records the interfaces they inherit.
- **Revision 1 was withdrawn after an adversarial alignment review.** It moved plan-execute's `Plan` into core, added a kernel-published `PlanUpdated` event, and added a `.withPlanning()` opener. The rev-1 file is kept in the session scratchpad for reference only.

## Decisions this plan makes (owner may overturn)

1. **Checklist = projection.** The checklist has two row kinds:
   - **Requirement rows** come from contract `requirement` facts. Their status is gate truth: `declared` → pending, `satisfied` → done, `blocked` → blocked.
   - **Advisory rows** come from `checklist-item` facts written by `todo`. They are labelled advisory and never count toward done-ness. `ChecklistSnapshot.done` is derived from requirement rows only, and advisory progress is reported separately.
2. **No new kernel event.** Kernel changes are ledger facts only. The runtime projection layer derives the snapshot, and the TUI folds bus facts. This follows ruling C1: the ledger is the spine, and other surfaces are projections.
3. **Toggle home: `.withObservability({ checklist })` and `AgentConfig.observability.checklist`.** This adds no wither, so the ratchet (`builder-wither-ratchet.test.ts`, ceiling 87) is unchanged. The toggle is display-only and gates only the runtime snapshot and the TUI. It defaults to `true`, subject to the Task 0 ruling.
4. **Kernel needs no toggle.** Because the toggle never reaches the kernel, no RunEnvelope field is added. The kernel always writes facts.
5. **`todo` becomes a fold of the run ledger.** The list is computed from `checklist-item` facts plus the facts still pending in the current round. It is never kept in separate state, so there is one truth.
   - The global `scratchpadStoreRef` list and the runner's per-run reset are deleted.
   - Several `todo` calls in one turn compose, through the round-local pending facts.
6. **The model-facing `todo` contract stays byte-identical**: description, parameters, rendered text and numeric ids. The one intended model-visible delta is that `brief`'s recall-key list drops `_todo:<taskId>`. Task 0 rules on it.
7. **`todo` stays opt-in everywhere, including Cortex chat (`todo: false` plus a settings toggle).** The local-model probe (`wiki/Research/Harness-Reports/2026-10-28-todo-surface-probe.md`) ran 90 cells: 3 local tiers, 2 arms, 3 task classes, n=5.
   - The capable tiers (qwen3:14b, gemma4:12b) never called `todo` in 30 arm-B runs.
   - qwen3:4b called it only with invalid actions.
   - Exposing it cost a fixed +50 to +59 prompt tokens per LLM call, which is over 15% on the trivial task on 2 of 3 tiers.
   - No success lift appeared.

   The checklist therefore stays display-only. In Phase 1 it gets its rows from contract requirements, which every run has, so it is useful without `todo`.
   - Gating `todo` by triage or task length is a Phase 2 candidate. It first needs a probe on long, sequential tasks with at least one frontier tier.
   - Task 0 records this as ablation-warden's ruling.
8. **Snapshot density: full only**, per the spec's ContextPressure precedent. Cortex chat already streams at full density.
9. **Resume repaint.** Both projections start from the restored ledger.
   - On resume the runner publishes the restored ledger once, as `LedgerEntryAppended` with a new optional `restored: true` flag.
   - Projections fold that batch as their seed.
   - The existing public `LedgerEntry` chunk projection skips restored batches, so chunks are never duplicated.
10. **Maintained strategies are not touched in Phase 1** (north-star §7). plan-execute keeps its own `Plan`. Its runs still show requirement rows, because the contract is compiled for every run.
12. **Parallel and delegated work reuses the existing delegation substrate.** Nothing new is built for it.
   - **Provenance is the grouping key.** Entries merged from a sub-agent already carry `pass: "sub-agent:<name>"` (`mergePassLedger`, `sub-agent-executor.ts:680-688`). Retry and continuation passes carry their pass name (`run-ledger-scope.ts`).
   - **The projector groups facts by provenance:**
     - the primary run and its own passes form one group;
     - each `sub-agent:<name>` forms its own nested group, recursively, because grandchild stamps are preserved.
   - **Only the root group's requirement rows decide the run's done-ness.** A child's requirements belong to the child's contract and are shown with its group.
   - **Live children.** A running child publishes its own `LedgerEntryAppended` on the parent's shared bus under its own taskId. Projections attach it to the tree with `makeRunTree` from plan 2, which is built on the `rootRunId`/`parentRunId` correlation that already exists.
   - **Completed children.** When a child completes, its merged `sub-agent:<name>` facts in the parent ledger **replace** that child's live group, so nothing is counted twice.
   - **Parallel children** (`spawn-agents`, `Effect.all({ concurrency })`, `spawn-handlers.ts:178`) are simply sibling groups updating concurrently.
   - **Parallel advisory work.** Several advisory items may be `in_progress` at once, so the snapshot carries `activeAdvisoryIds` (plural).
   - **A child interrupted by a crash** never merged, so after resume it shows as not run. That is honest; it is not invented progress.
13. **Naming.** The canonical names are `Checklist*`. The word "Plan" already means `HarnessPlan` and `PlanSource` (`policy/harness-plan.ts:63`) and plan-execute's `Plan`, so it is not reused.

## Global Constraints

- **Types.** No `any`, no `as any`, no new `as unknown as`. JSDoc on every new public export.
- **Effect-TS.** Follow `CODING_STANDARDS.md` and `effect-ts-patterns`: no `throw` in new code, tagged errors where a failure is possible, and handlers typed `Effect.Effect<…, never>`.
- **Meta-loop law.**
  - Ledger facts are minted only by helpers in `packages/reasoning/src/kernel/ledger/` (`scripts/check-ledger-writes.sh`).
  - The one-directional DAG holds.
  - The kernel never imports UI concerns.
- **File-size ratchet (`scripts/check-file-size.sh`).** Ceilings are exact:
  - `builder.ts` 2224, `builder/types.ts` 1339, `kernel-state.ts` 1473, `act.ts` 1267, `runner.ts` 953, `execution-engine.ts` (check the current ledger), `agent-config.ts` (unpinned).
  - Kernel edits stay at or under ceiling using the offsets named in Tasks 2 and 4.
  - Wardens never edit `scripts/`. The dispatcher (parent) lands ledger edits.
  - The only pre-ratified raise is `builder/types.ts` by at most +4, for the `ObservabilityOptions.checklist` field and its JSDoc. It must equal the measured growth.
- **Wither ratchet.** The number of `with*` / `without*` methods does not grow.
- **Commits.** No `Co-Authored-By` trailer (`.githooks/commit-msg` rejects it). Conventional messages, one concern per commit, and every commit keeps workspace typecheck green.
- **Tests.**
  - Use `bun test <path> --timeout 15000`, scoped. CI has no keys and no Ollama.
  - New test files need `bun run --cwd apps/docs metrics` and `metrics:sync-readme` in the same commit.
  - A failing-first step whose red signal is a type error uses `bunx turbo run typecheck` as the red check, because `bun test` strips types.
- **Cortex** imports packages from `dist`. Run `bunx turbo run build --filter=<pkg>...` before Cortex tests.
- **Honest claims.** Docs say "live checklist" and "progress visibility". Advisory rows are never described as completion.

## Review Focus

1. **The checklist never claims done when the gate disagrees.** A run whose `todo` items are all ticked, but whose contract requirement is unsatisfied, shows not-done. Pinned in Tasks 1, 6 and 10.
2. **Resume from an old checkpoint.** The checkpoint has `_todo:*` scratchpad keys (possibly several, from other tasks) and no `checklist-item` facts. Expected:
   - the list is migrated into facts once;
   - every `_todo:*` key is removed;
   - the resume repaint shows it.

   Pinned in Task 4.
3. **Turn shapes the old global Ref made safe.** Each of these keeps every update, and none duplicates:
   - several `todo` calls in one turn;
   - `todo` together with `final-answer` in one turn;
   - a killswitch abort mid-round;
   - a strategy switch;
   - a verification retry or a continuation pass.

   Pinned in Task 4.
4. **Malformed and no-op `todo` calls** produce rendered text and `ok` identical to today, and add no fact. This covers the string id `"2"`, `"abc"`, a missing id, an unknown id, empty `items`, an unknown action, and `done` on an item that is already done. Pinned in Tasks 3 and 4.
5. **Checklist off, or `"tokens"` density** gives zero `ChecklistUpdated` events and a blank TUI suffix. LLM requests are identical with the checklist on and off. Pinned in Tasks 6, 8 and 11.

6. **Delegated and parallel work.** Parallel sub-agents, nested sub-agents and retry/continuation passes appear as provenance groups. Expected:
   - no row is ever counted twice when a live child is superseded by its merged facts;
   - children never change the root's done-ness;
   - foreign runs on a shared bus never leak in.

   Pinned in Tasks 1, 6, 8 and 10.
---

## File Structure

| File | Responsibility | Owner |
|---|---|---|
| `packages/core/src/types/checklist.ts` (new) | fact wire types, `Checklist`, `projectChecklist`, `foldAdvisory`, snapshot | main |
| `packages/core/src/types/events/harness-events.ts` | `LedgerEntryAppendedEvent.restored?` | main |
| `packages/reasoning/src/kernel/ledger/run-ledger.ts`, `emit.ts` | self-describing `requirement`, new `checklist-item` fact + emitters | kernel-warden |
| `packages/reasoning/src/strategies/adaptive.ts`, `packages/runtime/tests/config-field-census.test.ts` | one-row registrations for the new kind | parent |
| `packages/tools/src/skills/todo.ts` | `todo` over advisory items (pure), legacy kept until Task 5 | tools-warden |
| `packages/reasoning/src/kernel/capabilities/act/{meta-tool-handlers,act,checklist-round (new)}.ts` | round-local facts, commit on every exit | kernel-warden |
| `packages/reasoning/src/kernel/loop/runner.ts`, `kernel/state/checklist-migrate.ts` (new) | drop Ref reset, legacy migration, restored publish | kernel-warden |
| `packages/runtime/src/builder/types.ts`, `builder/withers/observability-exporters.ts`, `agent-config.ts`, `builder/to-config.ts` | `checklist` display option | runtime-warden |
| `packages/runtime/src/engine/checklist-stream.ts` (new), `engine/execute-stream.ts`, `stream-types.ts`, `execution-engine.ts` | `ChecklistUpdated` projection; root task id to TUI | runtime-warden |
| `packages/ui-core/src/protocol/events.ts`, `state/run-machine.ts`, `state/turn-trace.ts` | wire event + run state + persisted trace | main |
| `packages/observability/src/logging/checklist-status.ts` (new), `status-renderer.ts` | TUI suffix + ticks | main |
| `apps/cortex/server/**`, `apps/cortex/ui/src/**` | config parity, persisted checklist, plan card | main |

---

### Task 0: Lift-rule rulings (uses the local-model probe)

**Owner:** ablation-warden (read-only). Main records the result.

**Input:** `wiki/Research/Harness-Reports/2026-10-28-todo-surface-probe.md`. It covers 90 valid cells and found no lift and a fixed per-call token tax. The probe already answers ruling 2 directionally (keep `todo` opt-in, Cortex chat `false`). Ablation-warden ratifies it or overrides it.

**Note for user docs.** `.withMetaTools({ todo: true })` means exactly what is named, so it drops `recall` (`builder/withers/tools.ts:143`). Docs and examples must spell out the full set. Plan 1 Task 7 adds a notice for this.

- [ ] **Step 1: Dispatch** ablation-warden for four written verdicts.
  1. May `observability.checklist` default `true`, given that it changes no LLM request? Task 11 later proves that with a test.
  2. May `todo` be offered by default, either framework-wide or on Cortex chat only, given the probe evidence? If yes, under which condition: always, or gated by a horizon/length signal?
  3. Is removing `_todo:<taskId>` from `brief`'s recall keys acceptable without ablation?
  4. Is anything in the probe a reason to change the `todo` model contract in Phase 1? The plan's default answer is no.
- [ ] **Step 2: Record** the verdicts under a "Lift-rule rulings" heading in this plan. Then apply them:
  - A "no" to 1 flips the Task 6 default to `false`.
  - The answer to 2 sets the Task 9 Cortex default (`todo: true` on chat, or `false`).
  - A "no" to 3 adds a compatibility recall key in Task 4.
- [ ] **Step 3: Commit** `docs(plan): lift-rule rulings for checklist phase 1`. Log the warden task.

#### Lift-rule rulings (ablation-warden, 2026-10-28, confidence 0.8)

1. **V1 — `observability.checklist` default `true`: YES, conditional.** Display-only, never reaches the kernel, so lift/overhead do not apply. The Task 11 byte-identity test is a hard gate; if it cannot be written or fails, the default flips to `false`. Wiring the toggle into the kernel or prompt voids the ruling.
2. **V2 — `todo` offered by default: NO** (framework-wide and Cortex chat). Decision 7 ratified: Cortex chat `todo: false` plus a settings toggle. Evidence: no lift, +50/+59 prompt tokens per call (>15% on the trivial task on 2 of 3 tiers), capable tiers 0/30 calls, qwen3:4b misuse. Horizon/length gating is not approved: it is a new mechanism needing its own ablation (long sequential tasks, at least one frontier tier plus two local tiers, n large enough to resolve 3pp).
3. **V3 — drop `_todo:<taskId>` from `brief` recall keys: YES, no ablation needed.** No compat recall key (it would reintroduce a second truth). Task 4's `brief` golden pins that this is the only delta. Any other model-visible delta found in Tasks 4–5 voids this and reopens ablation.
4. **V4 — change the `todo` model contract in Phase 1: NO.** Byte-identical. Better error text or action-synonym healing for small tiers is a deferred candidate needing its own ablation.

- **2026-10-28 owner override of V2:** Cortex chat default `todo=true` (new sessions only; framework default unchanged, still opt-in).
- Not lift-measured on a frontier tier; chat default also sets `metaTools.enabled=true` with brief/find/pulse/recall/harnessSkill all off.
- Revert = flip `metaTools` in `apps/cortex/ui/src/lib/chat-defaults.ts` (`chatDefaultConfig`).

- **2026-10-29 owner override of V4/V5-wording:** `todo` description and result text changed after user-observed failures (models called `update`/`set` + items; left items open). Result lines now end with an explicit loop-closing line; `update`/`set` + `items`|`id`+`status` heal deterministically.
- **2026-10-29 V5 ablation outcome — REWORK (both mechanisms stay opt-in, default off):** 200 cells, cogito:14b + qwen3:14b, n=5/task/arm (report `wiki/Research/Harness-Reports/2026-10-28-todo-guidance-ablation.md`). No lift on any tier (consistent final todo state 0/20 in 7 of 8 tier-arm cells); system line cost +32% tokens pooled (+99% cogito), cogito over-planned a single-step control 5/5 and regressed on the long sequential task (5/5 → 1/5). Frontier tier not run; n too small to resolve 3pp. Next cycle candidate: derive progress in the UI from tool-call events instead of relying on the model's todo calls.
- Not lift-measured; justified by observed failures. Golden definition test deliberately updated.
- Revert = restore the prior `todoTool.description` (commit history of `packages/tools/src/skills/todo.ts`) and drop `closingLine` from `applyTodoChecklistAction`.

**Task 11 confirmation (ablation-warden, 2026-10-28, confidence 0.85):**
- **V1 — PASS (condition met).** `packages/runtime/tests/checklist-model-invisible.test.ts` verified non-vacuous by mutation. Scratch edit in `packages/runtime/src/engine/execute-stream.ts` appended `" [MUTATION-CHECKLIST-ON]"` to `task.input.question` when `config.checklistDisplay !== false`. Result: test RED (`expect(JSON.stringify(off.requests)).toBe(JSON.stringify(on1.requests))`, 0 pass / 1 fail; marker visible in user message and system prompt). Mutation reverted (`git checkout` of that single file; `git diff --stat` empty); test green after revert (1 pass / 0 fail). Default `true` stands. Residual: the test uses the `test` provider and one todo scenario; it pins request bytes, not provider-side shaping.
- **V4 — PASS.** `todo` contract pinned byte-identical by `packages/tools/tests/skills/todo-checklist.test.ts` (lockstep golden vs legacy + full `todoTool` definition `toEqual`). Not re-mutated.

Side-findings routed (outside this plan): repetitionGuard distinct-arg cap on user tools (kernel-warden); `harnessSkill:true` no-op under default meta-tools (runtime/kernel-warden); `.withMetaTools({todo:true})` drops `recall` (runtime-warden, already noted).

Effect on later tasks: Task 6 default stays `true`; Task 9 Cortex default is `todo: false`; Task 4 needs no compat recall key.

#### V5 — todo status guidance (ablation-warden, 2026-10-28, confidence 0.75)

**Input:** `wiki/Research/Harness-Reports/2026-10-28-todo-status-compliance.md` (n=2-3 per cell, qualitative only; no qwen3 arm B, no gpt-5-mini). Evidence is a diagnosis, not a lift measurement. Nothing below is default-on for the framework; every mechanism is gated on `todo` being in the tool surface (zero cost when absent).

| Mechanism | Verdict | Reason |
|---|---|---|
| M4 / M2-aliases: tolerant `action` aliases (`create`/`append`->`add`, `mark_done`/`complete`/`finish`->`done`, `begin`/`in_progress`->`start`) in `applyTodoChecklistAction` | **PASS** (ships; no tier ablation) | Deterministic healing, same class as shipped `ParamNameHealer`. Adds zero prompt tokens; request bytes unchanged. Only effect: an input that returned an error now succeeds. Narrows V4: V4 deferred "action-synonym healing" pending ablation; this ruling lifts that for aliases only. Conditions: `todoTool` definition golden stays byte-identical; alias table closed and unit-pinned; each healed call emits a trace/event field (`healedFrom`) so it is visible; ledger records the canonical action only. Does NOT cover unknown actions beyond the table (still error). |
| M2-wording: edit the `todo` description / `action` param text ("action must be exactly one of add\|start\|done\|list") | **REJECT as default; fold into M1 arm if tested** | Changes the model-visible contract that V4 pins, on every call where todo is registered, to fix a failure M4 already heals deterministically. Redundant once M4 ships; spend no ablation on it. |
| M1: one stable system-prompt line when `todo` registered | **CONDITIONAL: opt-in only (Cortex chat setting), ablation before any default** | Model-visible, adds roughly 20-30 tokens per call on top of the already-measured +50/+59 todo tax; that tax was >15% on trivial tasks on 2 of 3 tiers. Report shows zero unprompted use on 3 tiers, so it targets the real root cause (todo inert), and is the only mechanism that can fix it. Arm B in the report (explicit "use todo") is not a valid proxy for the line: it is a user instruction, not a system rule. Must be byte-stable across turns (cache-friendly) and rendered only when todo is in the visible surface. |
| M3-terminal: reminder/retry when rows are open at final-answer time | **REJECT** | A non-blocking reminder after the model has already produced a final answer needs another LLM iteration, i.e. a verify-retry. That is the M3 REWORK pattern (commit `051c22be`). Also contradicts advisory-never-gates. Open rows at finish are reported by display only. |
| M3-midrun: `PendingGuidance` line when advisory rows are open and status is stale | **CONDITIONAL: opt-in (Cortex chat), ablation before default** | Fires only on divergence, so zero overhead on runs that track correctly or never use todo. Must be deterministic, rendered through `PendingGuidance` (Pitfall 9, no USER messages), advisory, non-gating. Design below keeps it out of the terminal-retry shape. Risk: wasted iterations, nudge loops, small-tier confusion; caps below bound it. |

**Minimal design (for tools-warden + kernel-warden; runtime-warden for the Cortex toggle):**

1. *tools-warden* (`packages/tools/src/skills/todo.ts`): add `normalizeTodoAction(raw): {action, healedFrom?}` with the closed alias table; call it at the top of `applyTodoChecklistAction`; healed call result text gets no extra prose (keep result bytes identical to canonical call). Return `healedFrom` in the result so the kernel handler can put it on the tool-call trace. Tests: each alias, unknown still errors, `todoTool` `toEqual` golden untouched.
2. *kernel-warden* (`think.ts` + `GuidanceContext`/`PendingGuidance`): add `checklistReminder?: string` to `PendingGuidance`, rendered in `Guidance:`. Producer (post-act, pure function over ledger-folded advisory items and `state.steps`): set only if (a) `todo` is in the visible tool surface, (b) at least one advisory row is `pending`/`in_progress`, (c) the last 2 consecutive completed iterations each ran a non-`todo` tool and made no todo status change, (d) fewer than 2 reminders already emitted this run. Text: "Todo: N open ([id] title ...). Mark finished items done (todo action done, id) before continuing." Never fires on the iteration that produced a final answer. Emit via existing signal ledger (`signalLedger`) so `classifySignalEffect` measures whether a todo call followed: that is the built-in effect metric.
3. *runtime-warden / Cortex*: M1 line and M3-midrun are two independent flags under the Cortex chat config (default off), both inert unless `metaTools.todo`. Nothing is added to `chatDefaultConfig` defaults until the ablation clears.
4. Wire-and-pin: a test must show the reminder is consumed (guidance text appears in the next `ProviderRequest`) and that with `todo` absent, request bytes are identical (extend `checklist-model-invisible.test.ts` style).

**Probe protocol (validates M1, M3-midrun; M4 needs only unit tests plus a count of healed calls):**
- Tiers: cogito:14b, qwen3:14b (local), gpt-4o-mini (frontier; gpt-5-mini only after Cortex server restart past commit `8502a9111`, otherwise it errors `llm_error` 400 and is invalid).
- Arms, same tasks/seeds, M4 on in all: A0 baseline (todo registered, current behavior); A1 +M1; A2 +M3-midrun; A3 +M1+M3-midrun. Fresh session per cell, `POST /api/chat/sessions` as in the report, sequential, GPU check (`ollama ps`) first.
- Tasks: at least 4 distinct 3-6 step tasks (include 2 that genuinely need web-search, 1 trivial 3-step with no tool, 1 long sequential), plus 1 single-step control (todo should NOT be used: guards against over-planning).
- n >= 5 per cell per tier (Bernoulli SE note: gaps <26pp at n=5 per task are noise; pool tasks, target >=20 cells per arm per tier, to resolve 3pp lift would need far more, so report effect with CIs and call anything below that INCONCLUSIVE, not PASS).
- Primary metric: share of runs where final advisory rows are consistent with progress (rows used = done count matches steps delivered; no row left pending/in_progress after a delivered answer; at least one add on multi-step tasks). Secondary: valid-call rate, task correctness (unchanged or better), iterations, over-planning rate on the control task.
- Token overhead: total prompt+completion tokens per run vs A0, must be <=15%; report per-tier.
- Verdict rule: PASS default-on only for >=2 tiers (ideally 3) with >=3pp lift and <=15% overhead, no task-correctness regression, no cross-tier divergence. Lift on one tier or overhead 15-30% = stays opt-in. No lift, >30%, or divergence = REWORK.
- Instrument first (feedback_instrument_before_conclusion): print the system prompt and `toolSchemaNames` per arm and confirm the M1 line and reminder actually appear before reading any outcome.

**What stays unsupported:** the claim that any of this makes small models track todo reliably. The report shows cogito:14b misuses actions; M4 removes only the naming failure, not the planning failure. Cortex "behaves like Claude Code" is not an honest claim until the probe above passes.


---

### Task 1: Core checklist types and the one projector

**Owner:** main

**Files:**
- Create: `packages/core/src/types/checklist.ts`
- Modify: `packages/core/src/types/events/harness-events.ts`, adding `readonly restored?: true` to `LedgerEntryAppendedEvent` with JSDoc: "Seed batch republished once at resume; incremental consumers must not re-count it."
- Modify: `packages/core/src/index.ts` (exports)
- Test: `packages/core/src/types/__tests__/checklist.test.ts`

**Interfaces** (all exported from `@reactive-agents/core`):
- Fact wire types. The structural mirror of the reasoning ledger entries; reasoning pins assignability in Task 2.
  - `interface RequirementFact { readonly kind: "requirement"; readonly seq: number; readonly iteration: number; readonly pass?: string; readonly requirementId: string; readonly status: "declared" | "satisfied" | "blocked"; readonly description?: string; readonly requirementKind?: string; readonly reason?: string }`. `pass` mirrors `LedgerEntryBase.pass`.
  - `type ChecklistItemStatus = "pending" | "in_progress" | "completed"`
  - `type ChecklistItemOp = { readonly op: "add"; readonly items: readonly { readonly id: string; readonly title: string }[] } | { readonly op: "status"; readonly id: string; readonly status: ChecklistItemStatus }`
  - `interface ChecklistItemFact { readonly kind: "checklist-item"; readonly seq: number; readonly iteration: number; readonly pass?: string; readonly change: ChecklistItemOp; readonly toolCallId?: string }`
  - `type ChecklistFact = RequirementFact | ChecklistItemFact`
  - `isChecklistFact(entry: Readonly<Record<string, unknown>>): entry is ChecklistFact`. This structural guard is used by consumers that receive `Record<string, unknown>` ledger entries from the bus or stream.
- Model:
  - `interface AdvisoryItem { readonly id: string; readonly seq: number; readonly title: string; readonly status: ChecklistItemStatus }`
  - `interface ChecklistRow { readonly id: string; readonly kind: "requirement" | "advisory"; readonly title: string; readonly status: "pending" | "in_progress" | "done" | "blocked"; readonly reason?: string }`
  - `interface ChecklistGroup { readonly key: string; readonly label: string; readonly rows: readonly ChecklistRow[]; readonly requirements: { readonly done: number; readonly total: number }; readonly advisory: { readonly done: number; readonly total: number }; readonly activeAdvisoryIds: readonly string[]; readonly children: readonly ChecklistGroup[]; readonly live?: boolean }`
    - `key` is `"root"` for the primary run, `"sub-agent:<name>"` for a child, and nested paths for deeper descendants.
    - Facts from `verification-retry` and `continuation` passes fold into the group of the run that owns them.
  - `interface ChecklistSnapshot { readonly root: ChecklistGroup; readonly lastSeq: number }`. Done-ness is `root.requirements` only.
- Pure functions:
  - `foldAdvisory(facts: readonly ChecklistFact[]): readonly AdvisoryItem[]`
    - Ids are `String(seq)`, and a new `add` assigns `seq = max(seq, 0) + 1` onward.
    - A same-status change is a no-op.
    - It is used by `todo` and by the projector.
  - `projectChecklist(facts: readonly ChecklistFact[], live?: ReadonlyMap<string, readonly ChecklistFact[]>): ChecklistSnapshot`
    - Facts are grouped by `pass` provenance into the group tree.
    - `live` holds a running child's own facts, keyed by group key. A live group is used only until merged `sub-agent:<name>` facts for that key appear in `facts`, which then replace it.
    - Within each group, requirement rows come first, in declaration order, followed by advisory rows.
    - A requirement row's title is its `description`; with no description it falls back to its `requirementKind` and then its id.
    - The latest status wins.
  - `nextAdvisoryIds(items: readonly AdvisoryItem[], count: number): readonly string[]`
  - `checklistChanged(prev: ChecklistSnapshot | undefined, next: ChecklistSnapshot): boolean` returns true when any row or status differs. A change in `lastSeq` alone does not count.
  - `makeChecklistTracker(rootTaskId: string): { track(event: { _tag: string } & Readonly<Record<string, unknown>>): ChecklistSnapshot | undefined }`. It is built on `makeRunTree`, which plan 2's Task 1 adds to core. It does not re-implement tree logic.
    - This pure accumulator is the ONE implementation of the live-tree rule (Decision 12). The runtime stream (Task 6) and the TUI (Task 8) both use it.
    - It accepts `LedgerEntryAppended` (including `restored`), `AgentStarted` and `AgentCompleted`, and ignores anything outside this root's delegation tree.
    - It returns a snapshot only when `checklistChanged`.

- [ ] **Step 1: Write the failing tests:**

```ts
const req = (seq: number, id: string, status: RequirementFact["status"], description?: string): RequirementFact =>
  ({ kind: "requirement", seq, iteration: 0, requirementId: id, status, ...(description ? { description } : {}) });
const item = (seq: number, change: ChecklistItemOp): ChecklistItemFact => ({ kind: "checklist-item", seq, iteration: 1, change });

test("requirement rows carry gate truth; advisory ticks never complete the run", () => {
  const s = projectChecklist([
    req(0, "r1", "declared", "Answer the question"),
    item(1, { op: "add", items: [{ id: "1", title: "a" }] }),
    item(2, { op: "status", id: "1", status: "completed" }),
  ]);
  expect(s.root.rows.map((r) => [r.kind, r.title, r.status])).toEqual([
    ["requirement", "Answer the question", "pending"], ["advisory", "a", "done"],
  ]);
  expect(s.root.requirements).toEqual({ done: 0, total: 1 });
  expect(s.root.advisory).toEqual({ done: 1, total: 1 });
});

test("latest requirement status wins; blocked carries reason", () => {
  const s = projectChecklist([req(0, "r1", "declared", "x"), { ...req(3, "r1", "blocked"), reason: "no tool" }]);
  expect(s.root.rows[0]).toMatchObject({ status: "blocked", reason: "no tool" });
});

test("advisory fold: ids from max seq, same-status no-op, gaps preserved", () => {
  const items = foldAdvisory([
    item(1, { op: "add", items: [{ id: "1", title: "a" }, { id: "3", title: "b" }] }),
    item(2, { op: "status", id: "1", status: "in_progress" }),
  ]);
  expect(items.map((i) => [i.id, i.status])).toEqual([["1", "in_progress"], ["3", "pending"]]);
  expect(nextAdvisoryIds(items, 2)).toEqual(["4", "5"]);
});

test("sub-agent facts group by provenance; only root requirements decide done; merged replaces live", () => {
  const child = (f: ChecklistFact): ChecklistFact => ({ ...f, pass: "sub-agent:research" });
  const merged = [req(0, "r1", "declared", "Root"), child(req(1, "c1", "declared", "Child")), child({ ...req(2, "c1", "satisfied") })];
  const s = projectChecklist(merged);
  expect(s.root.requirements).toEqual({ done: 0, total: 1 });
  expect(s.root.children.map((g) => [g.key, g.requirements.done, g.requirements.total])).toEqual([["sub-agent:research", 1, 1]]);
  const liveOnly = projectChecklist([req(0, "r1", "declared", "Root")], new Map([["sub-agent:research", [req(0, "c1", "declared", "Child")]]]));
  expect(liveOnly.root.children[0]).toMatchObject({ key: "sub-agent:research", live: true });
  const both = projectChecklist(merged, new Map([["sub-agent:research", [req(0, "c1", "declared", "Child")]]]));
  expect(both.root.children).toHaveLength(1);
  expect(both.root.children[0]!.live).toBeUndefined();
  expect(both.root.children[0]!.requirements.done).toBe(1);
});

test("retry/continuation passes fold into the owning group; parallel advisory items can both be active", () => {
  const s = projectChecklist([
    item(1, { op: "add", items: [{ id: "1", title: "a" }, { id: "2", title: "b" }] }),
    { ...item(2, { op: "status", id: "1", status: "in_progress" }), pass: "continuation" },
    item(3, { op: "status", id: "2", status: "in_progress" }),
  ]);
  expect(s.root.children).toHaveLength(0);
  expect(s.root.activeAdvisoryIds).toEqual(["1", "2"]);
});

test("tracker builds the live tree from bus events and ignores foreign runs", () => {
  const t = makeChecklistTracker("root");
  t.track({ _tag: "LedgerEntryAppended", taskId: "root", entries: [req(0, "r1", "declared", "Root")] });
  t.track({ _tag: "AgentStarted", taskId: "c1", rootRunId: "root", parentRunId: "root", agentDisplayName: "research" });
  const s = t.track({ _tag: "LedgerEntryAppended", taskId: "c1", entries: [req(0, "x", "declared", "Child")] });
  expect(s!.root.children.map((g) => [g.key, g.live])).toEqual([["sub-agent:research", true]]);
  expect(t.track({ _tag: "LedgerEntryAppended", taskId: "other", entries: [req(0, "z", "declared", "Z")] })).toBeUndefined();
});

test("guard accepts only checklist facts", () => {
  expect(isChecklistFact({ kind: "requirement", seq: 0, iteration: 0, requirementId: "r", status: "declared" })).toBe(true);
  expect(isChecklistFact({ kind: "tool-result", seq: 1 })).toBe(false);
});
```

- [ ] **Step 2: Run** `bun test packages/core/src/types/__tests__/checklist.test.ts --timeout 15000`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test and `bunx turbo run typecheck --filter=@reactive-agents/core`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(core): checklist fact types and the projectChecklist projector`.

---

### Task 2: Ledger facts — self-describing requirements and `checklist-item`

**Owner:** kernel-warden. Parent rows: `strategies/adaptive.ts`, `packages/runtime/tests/config-field-census.test.ts`.

**Files:**
- Modify: `packages/reasoning/src/kernel/ledger/run-ledger.ts`.
  - `RequirementEntry` gains `readonly description?: string; readonly requirementKind?: RequirementKind`, set on `declared` only.
  - Add `ChecklistItemEntry { kind: "checklist-item"; change: ChecklistItemOp; toolCallId?: string }`.
- Modify: `packages/reasoning/src/kernel/ledger/emit.ts`.
  - `RequirementRef` gains `description` and `kind`. `recordRequirementsDeclared` copies them onto the entry.
  - `recordChecklistItems(ledger, facts: readonly { iteration: number; change: ChecklistItemOp; toolCallId?: string }[]): RunLedger` is added.
- Modify: the runner call site of `recordRequirementsDeclared`, passing `description` and `kind` from the compiled contract's `TaskRequirement.spec.description` and `.kind`. LOC-neutral.
- Parent edits:
  - `strategies/adaptive.ts:507-518`: add `"checklist-item": true` to the exhaustive `Record<LedgerEntryKind, true>`.
  - `config-field-census.test.ts`: add the `KIND_PRODUCERS` row `"checklist-item": "packages/reasoning/src/kernel/ledger/emit.ts (recordChecklistItems)"`.
- Test: `packages/reasoning/src/kernel/ledger/checklist-facts.test.ts`

**Interfaces:**
- Consumes: Task 1 `ChecklistItemOp`, `RequirementFact`, `ChecklistItemFact`.
- Produces:
  - `recordChecklistItems`.
  - Self-describing declared requirements.
  - A type-level pin: `Extract<LedgerEntry, {kind:"requirement"}>` is assignable to `RequirementFact`, and the `checklist-item` entry to `ChecklistItemFact`.

- [ ] **Step 1: Write the failing tests:**
  - `recordRequirementsDeclared` with `{ id, description: "produce ./r.md", kind: "artifact-produced" }` mints an entry with both fields set, and stays idempotent on replay.
  - `recordChecklistItems` appends dense seqs in order.
  - Type pin (a red typecheck): `const f: RequirementFact = entry` and `const g: ChecklistItemFact = itemEntry` compile, including `pass`.
  - Provenance: a child ledger with `checklist-item` and `requirement` entries, merged through `mergePassLedger(…, "sub-agent:x")`, keeps every entry with `pass: "sub-agent:x"`. A grandchild stamp survives, as `run-scope.ts` already guarantees for other kinds.
  - Model-invisibility: a ledger holding `checklist-item` entries renders through `assembly/project.ts` (the path `think` uses) with no occurrence of `checklist-item` or any advisory title. The standing frame filters by kind (`standing-frame.ts:146`), and this test pins that.
  - The contract run end to end: a runner test-provider run's ledger has `declared` entries carrying the compiled descriptions.
- [ ] **Step 2: Run** `bunx turbo run typecheck --filter=@reactive-agents/reasoning`, then `bun test packages/reasoning/src/kernel/ledger/checklist-facts.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.** Parent lands the two registration rows in the same commit.
- [ ] **Step 4: Run**:
  - the test;
  - `bun test packages/reasoning/src/kernel/ledger --timeout 15000`;
  - `bun test packages/runtime/tests/config-field-census.test.ts --timeout 15000`;
  - typecheck;
  - `bash scripts/check-ledger-writes.sh` and `bash scripts/check-file-size.sh`.

  Expected: PASS.
- [ ] **Step 5: Commit** `feat(kernel): self-describing requirement facts and checklist-item ledger fact`. Log the warden task.

---

### Task 3: `todo` as a pure tool over advisory items (additive)

**Owner:** tools-warden

**Files:**
- Modify: `packages/tools/src/skills/todo.ts`, `packages/tools/src/index.ts`. Add new exports and keep the legacy ones until Task 5.
- Test: `packages/tools/tests/skills/todo-checklist.test.ts`

**Interfaces:**
- Consumes: core `AdvisoryItem`, `ChecklistItemOp`, `foldAdvisory`, `nextAdvisoryIds`.
- Produces:
  - `applyTodoChecklistAction(items: readonly AdvisoryItem[], args: Record<string, unknown>): { readonly rendered: string; readonly ok: boolean; readonly changes: readonly ChecklistItemOp[] }`.
    - It is pure. `changes` is empty for `list`, every error, and same-status no-ops.
    - Input hygiene (string, newline split, trim, the `item`/`text` aliases) is applied exactly as in the legacy code.
    - The target is found with `String(Number(args.id))`. Error text keeps the raw `String(args.id)`.
  - `renderTodoChecklist(items: readonly AdvisoryItem[]): string`. Byte-identical to the legacy `renderTodoList` for the equivalent list.
  - `todoTool` is unchanged byte-for-byte.

- [ ] **Step 1: Write the failing equivalence tests.**
  - **Lockstep golden.** Run the live legacy `applyTodoAction` over a serialized list against `items = foldAdvisory(changes so far)` plus `applyTodoChecklistAction`, step by step. Assert `rendered` and `ok` are equal at every step. Cover every legacy branch:
    - `add` given as an array, as a newline string `"a\n b \n\n"`, and via `item` and `text`;
    - `add ["", 3, "a"]`, which keeps `""` and `"a"`;
    - `add []`;
    - `action` missing, and `action` not a string;
    - ids `1`, `"2"`, `"2.0"`, `true`, `"abc"`, missing, and `9`;
    - `start` on an unknown id;
    - `done` twice;
    - `start` after `done`;
    - `add` after all items are done;
    - `frobnicate`;
    - `list`.
  - **Property test.** Use fast-check (already a tools devDependency) to generate random 1–20 action sequences over those shapes. Assert the same equalities, and that no status outside the three ever appears.
  - **Changes contract.** `changes` is non-empty exactly when the legacy list changed. An `add` uses ids from `nextAdvisoryIds`.
  - **Tool definition.** `todoTool` `toEqual`s an inline literal copied from `todo.ts:118-153` before any edit.
- [ ] **Step 2: Run** `bun test packages/tools/tests/skills/todo-checklist.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test, `bun test packages/tools --timeout 15000`, and `bunx turbo run typecheck --filter=@reactive-agents/tools --filter=@reactive-agents/reasoning`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(tools): todo as a pure tool over ledger-folded advisory items (legacy API kept)`. Log the warden task.

---

### Task 4: The kernel writes `todo` to the ledger; the global list is retired

**Owner:** kernel-warden. Parent row: the `packages/reasoning/src/index.ts` export, if any.

**Design:**
- **Round-local facts.** `act.ts` keeps a round-local `pending: ChecklistItemOp[]` for the round. Each `todo` handler call sees `foldAdvisory(ledger facts + pending)`, so several calls in one turn compose in order.
- **Commit on every exit.** Every exit path of the round commits `pending` via `recordChecklistItems` into the ledger it returns. That covers the normal path, the accepted-final-answer early return (`act.ts:524-547`), and the killswitch returns (`:1048`, `:1118`, `:1142`, `:1209`). Facts are stamped `state.iteration + 1`, matching the round's step-derived entries (`act.ts:1231`).
- **No global state.**
  - `handleTodoTool` no longer touches `scratchpadStoreRef`.
  - The runner's `_todo` reset (`runner.ts:304-313`) is deleted. Strategy switches already carry the ledger (`strategy-switch.ts:181-224`), and passes merge into the run ledger.
- **Legacy migration.** `migrateLegacyTodo(state, taskId)` in a new `kernel/state/checklist-migrate.ts` runs once at resume:
  - **Source key.** It parses the exact `_todo:<taskId>` key. If that key is absent and there is exactly one `_todo:*` key, it uses that one, keeping the legacy filtering of malformed entries.
  - **Minting.** It mints one `add` fact whose `items` keep the legacy ids, followed by the status facts. It skips when the ledger already holds `checklist-item` facts.
  - **Cleanup.** It deletes every `_todo:*` key.
- **Restored publish.** On resume, after migration, the runner publishes the restored ledger once as `LedgerEntryAppended { restored: true }` through the existing hook path. The tap watermark (`runner.ts:337`) is unchanged, so restored entries are never re-sent as increments.
- **LOC offsets.**
  - `act.ts`: delete the stale M7-E note at `:373-375` and the history comment at `:968-976`. Fold logic goes in a new `act/checklist-round.ts`.
  - `runner.ts`: the deleted reset (10 lines) pays for the migrate call and the restored publish. Drop `Ref` and `scratchpadStoreRef` from the imports in place.

**Files:**
- Modify: `act/meta-tool-handlers.ts`, `act/act.ts`, `kernel/loop/runner.ts`, `kernel/state/kernel-hooks.ts` (publishing the restored batch reuses `onLedgerAppend` with a flag; no new hook method).
- Create: `act/checklist-round.ts`, with `startRound()`, `stageChanges(round, changes, toolCallId)`, `viewItems(round, ledger)` and `commitRound(round, ledger, iteration): RunLedger`.
- Create: `kernel/state/checklist-migrate.ts`.
- Test: `act/todo-ledger-integration.test.ts`, `act/checklist-round.test.ts` (a direct-import seam test), `kernel/state/checklist-migrate.test.ts`

- [ ] **Step 1: Write the failing tests.** All use the test provider with `todo` enabled.
  - **Sequential turns:** `add ["a","b"]`, then `start 1`, then `done 1`, then `done 1` again, then `done 9`, then the final answer. Assert the ledger has exactly 3 `checklist-item` facts and that `foldAdvisory` of them gives item 1 `completed`.
  - **One turn, `add` + `start 1`:** item 1 ends `in_progress`.
  - **One turn, `todo done 2` + `final-answer`:** the fact is in the final ledger.
  - **Killswitch abort mid-round:** staged facts are committed, and nothing is lost or duplicated.
  - **Forced loop-detect strategy switch mid-list:** `todo list` afterwards shows the prior items.
  - **Verification retry pass:** the merged run ledger still folds to the full list.
  - **Fresh run on the `"default"` taskId after a previous run in the same process:** `todo list` renders the empty text.
  - **Mid-run checkpoint** (RunController `onCheckpoint` after `start 1`), then resume:
    - exactly one `restored` batch is published, before any new increment;
    - the folded list shows item 1 `in_progress`;
    - no completed item's scripted tool is called again.
  - **Legacy checkpoint** holding the keys `_todo:t1` and `_todo:t2`, resumed as `t1`:
    - the list from `t1` is migrated;
    - both keys are gone;
    - migrating a second time is a no-op.
  - **`brief` golden:** the response is identical to today's except that the `_todo:<taskId>` recall key is absent.
  - **`checklist-round.test.ts`:** fold order across three staged calls. `commitRound` with nothing staged returns the ledger by identity.
- [ ] **Step 2: Run** the three test files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `bun test packages/reasoning --timeout 15000`, typecheck for reasoning and tools, `bash scripts/check-file-size.sh`, `bash scripts/check-ledger-writes.sh`, and the docs metrics sync. Expected: PASS.
- [ ] **Step 5: Commit** `feat(kernel): todo writes checklist-item facts; global todo Ref retired; legacy migration + resume seed`. Log the warden task.

---

### Task 5: Retire the legacy `todo` list API

**Owner:** tools-warden. Runs immediately after Task 4 removes the last caller.

- **Files:**
  - `packages/tools/src/skills/todo.ts` and `index.ts`: delete `applyTodoAction`, `parseTodoList`, `renderTodoList`, `TodoItem` and `TodoActionResult`.
  - `packages/tools/tests/todo-tool.test.ts`: port every assertion to the new API. The malformed-entry parse case is re-pinned by Task 4's `checklist-migrate.test.ts`; leave a comment naming it.
  - `todo-checklist.test.ts`: freeze the legacy function inline as the lockstep oracle.
- [ ] **Step 1:** Freeze the oracle, then delete the legacy exports.
- [ ] **Step 2: Run** `grep -rn "applyTodoAction\|parseTodoList\|renderTodoList\|TodoItem\b" packages apps --include=*.ts --include=*.svelte`. Expected: hits only in the test oracle.
- [ ] **Step 3: Run** `bun test packages/tools --timeout 15000` and typecheck for tools and reasoning. Expected: PASS.
- [ ] **Step 4: Commit** `refactor(tools)!: remove the legacy todo list API`. Log the warden task.

---

### Task 6: Runtime — display option and the `ChecklistUpdated` projection

**Owner:** runtime-warden. Parent rows:
- the `scripts/check-file-size.sh` raise for `builder/types.ts` (+4 at most);
- the `packages/reactive-agents/src/index.ts` re-export, if one is needed;
- `bun run docs:gen:api`.

**Files:**
- Modify:
  - `packages/runtime/src/builder/types.ts`: `ObservabilityOptions.checklist?: boolean`, with JSDoc: "Live checklist (TUI + AgentStream full density). Display only — never changes what the model sees. Default true."
  - `agent-config.ts`: add `ObservabilityConfigSchema.checklist`.
  - `builder/to-config.ts` and `agentConfigToBuilder`: serialize the option only when it was set.
  - `tests/config-serialization-drift.test.ts`: set `MAXIMAL_CONFIG.observability.checklist = false`.
- Create: `packages/runtime/src/engine/checklist-stream.ts`, holding two functions:
  - `subscribeChecklistStream(eb, queue, taskId): Effect.Effect<void, never>`.
    - It feeds `LedgerEntryAppended`, `AgentStarted` and `AgentCompleted` into core's `makeChecklistTracker(taskId)`, the one implementation of the delegation-tree rule. It adds no folding logic of its own.
    - It emits `ChecklistUpdated` for each snapshot the tracker returns.
  - `toChecklistStreamEvent(snapshot, iteration): AgentStreamEvent`.
- Modify: `engine/execute-stream.ts`. Add one guarded call, active when `density === "full"` and the checklist option is not `false`, routed through plan 2's `routeScoped`. Add no new taskId filter. The existing `LedgerEntry` chunk projection skips batches with `restored: true`.
- Modify: `stream-types.ts`. Add a full-density variant `{ _tag: "ChecklistUpdated"; checklist: ChecklistSnapshot; iteration: number }`.
- Modify: `execution-engine.ts` (~830). Pass the root task id and the option to `makeStatusRenderer` (Task 8).
- Test: `packages/runtime/tests/checklist-stream.test.ts`, `packages/runtime/tests/checklist-option.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - **Unit (direct import):**
    - folding three batches emits an update per changed snapshot;
    - an unchanged snapshot emits nothing;
    - a `restored` batch reseeds;
    - a batch for another taskId is ignored.
  - **End to end** (full density, todo-scripted test provider):
    - updates arrive in order, the last one before `StreamCompleted`;
    - the requirement rows match the compiled contract's descriptions;
    - **Review Focus 1:** a scenario that ticks every advisory item but leaves the contract's artifact requirement unsatisfied produces a final snapshot with `root.requirements.done < total`.
    - **Delegation:** a run that uses `spawn-agents` to start two children in parallel (test provider, `.withDynamicSubAgents()`).
      - While the children run, two live sibling groups appear.
      - After they complete, each group is replaced by its merged facts.
      - The final snapshot has exactly two child groups.
      - The root's done-ness ignores the children's requirements.
      - No row is duplicated.
  - **Gating:** density `"tokens"` and `checklist: false` each emit 0 updates.
  - **Restored batches:** `LedgerEntry` chunks are not duplicated.
  - **Option round-trip:** `.withObservability({ checklist: false }).toConfig().observability.checklist === false`. Unset means absent. `await agentConfigToBuilder(...)` round-trips it.
  - **Ratchet:** the wither ratchet test still passes, and the method count is unchanged.
- [ ] **Step 2: Run** the two tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**:
  - `bun test packages/runtime/tests --timeout 15000`, including `builder-wither-ratchet`, `config-serialization-drift`, `docs-gen-drift`, `api-correspondence` and `config-field-census`;
  - typecheck;
  - `bash scripts/check-file-size.sh` and `bash scripts/check-cross-cutting.sh`;
  - the metrics sync.

  Expected: PASS.
- [ ] **Step 5: Commit** `feat(runtime): observability.checklist + ChecklistUpdated projected from ledger facts`. Log the warden task.

---

### Task 7: `ui-core` — wire event, run state, persisted turn trace

**Owner:** main

**Files:**
- `packages/ui-core/src/protocol/events.ts`:
  - add the structural mirrors `ChecklistSnapshotWire`, `ChecklistGroupWire` (recursive `children`) and `ChecklistRowWire`;
  - add `interface ChecklistUpdated { _tag: "ChecklistUpdated"; checklist: ChecklistSnapshotWire; iteration: number }` to `UiStreamEvent`. It is additive, so there is no version bump.
- `state/run-machine.ts`: `RunState.checklist?`. The event with the highest `lastSeq` wins; stale events are ignored.
- `state/turn-trace.ts`: `TurnTraceState.checklist?` and `TurnTrace.checklist?`. `finishTurnTrace` returns a trace whenever a checklist exists.
- Test: `packages/ui-core/tests/checklist-state.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - A stale-`lastSeq` event is ignored.
  - A stream with only `ChecklistUpdated` and `StreamCompleted` finishes as `{ reasoningSteps: [], toolCalls: [], checklist }`.
  - Existing no-checklist fixtures finish exactly as before.
  - A JSON fixture of the runtime variant parses via `parseUiStreamEvent` and narrows.
- [ ] **Step 2: Run** `bun test packages/ui-core --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the ui-core suite and `bun test packages/react packages/svelte packages/vue --timeout 15000`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(ui-core): ChecklistUpdated wire event, RunState.checklist, persisted TurnTrace.checklist`.

---

### Task 8: TUI checklist

**Owner:** main

**Files:**
- Create: `packages/observability/src/logging/checklist-status.ts`, which holds two functions:
  - `formatChecklistSuffix(s: ChecklistSnapshot, maxWidth: number): string`. It shows requirement progress first, e.g. `☑ 1/2`, then advisory progress, e.g. `· todo 3/5 · <active title…>`, and never exceeds `maxWidth`.
  - `newlyFinished(prev, next)`: rows that just became `done` or `blocked`.
- Modify: `status-renderer.ts`.
  - `makeStatusRenderer` takes `{ rootTaskId?: string; checklist?: boolean }`.
  - It subscribes to `LedgerEntryAppended` and `AgentStarted`, using the same tree-building rule as Task 6 (core `makeRunTree`).
    - Extract that rule into core as `ChecklistTracker`, a pure accumulator: `track(event) → ChecklistSnapshot | undefined`. The runtime and the TUI share it, so the rule exists once.
    - A `restored` batch reseeds.
    - Unrelated runs on a shared bus are ignored.
  - It prints each finished row once to scrollback: `✓` for a requirement, `·✓` for an advisory item, `!` for blocked.
  - With `checklist: false` it shows nothing.
- Test: `packages/observability/tests/checklist-status.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - The suffix width stays at or under `maxWidth` for widths 10–80.
  - Requirement progress is always shown before advisory progress.
  - The suffix shows root progress plus `· 2 agents` while children are live. Each child's finished rows print once, prefixed by the child name.
  - `newlyFinished` reports transitions only.
  - Driving the renderer through a fake `EbLike`:
    - a sub-agent's batch, with a different taskId, changes nothing;
    - `checklist: false` renders no suffix.
- [ ] **Step 2: Run** `bun test packages/observability/tests/checklist-status.test.ts --timeout 15000`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the observability suite. Then do a manual check in a real TTY, using a scratchpad script (not in the repo) that sets:
  - `.withTestScenario([todo …, final])`;
  - `.withMetaTools({ todo: true })`;
  - logging `mode: "status"`.

  Record what you observed in the commit body. (`rax run` has no scenario or meta-tool flags.)
- [ ] **Step 5: Commit** `feat(observability): live checklist in the TUI status renderer`.

---

### Task 9: Cortex server — config parity, chat default, persisted checklist

**Owner:** main

**Files** (per the `apps/cortex/AGENTS.md` parity checklist):
- `cortex-agent-config.ts`:
  - add `observability.checklist` and `CortexMetaToolsConfig.todo`;
  - in `mergeCortexAllowedTools` (~516), add `todo` to `allowedTools` when it is enabled. Today it is never added, so the model would never see it.
- `normalizeCortexAgentConfig` and `cortex-to-agent-config.ts`.
- `build-cortex-agent.ts`:
  - `.withObservability({ …, checklist })`;
  - `todo: params.metaTools?.todo ?? false`.
- `chat-session-service.ts`: pass the chat default for `todo`, as ruled in Task 0. Lab runs and gateway agents stay `false`.
- `api/runs.ts` body schema, runner-service `LaunchParams`, `gateway-process-manager.ts`, and `ui/src/lib/cortex-runs-post-body.ts`.
- `tests/config-parity.test.ts`: `FULL_CONFIG_BODY` and its assertions.
- Test: `apps/cortex/server/tests/chat-checklist-persist.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - Parity: `observability.checklist: false` and `metaTools.todo` survive the round trip from POST through normalize, build and agent config.
  - Defaults: `todo` is `false` on every path unless the setting enables it.
  - With `todo` enabled, the built agent's `allowedTools` contains `todo`.
  - A streamed chat turn persists `trace.checklist`, and with the checklist off it persists none.
- [ ] **Step 2: Run** `bunx turbo run build --filter=@reactive-agents/runtime... --filter=@reactive-agents/ui-core`, then the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** `TurnTraceRecorder` needs no change, because it uses the ui-core fold.
- [ ] **Step 4: Run** `bun test apps/cortex/server --timeout 15000`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(cortex): checklist + todo config parity; chat persists the turn checklist`.

---

### Task 10: Cortex UI — live plan card and settings

**Owner:** main. Load `frontend-design:frontend-design` before building the card.

**Files:**
- Create: `apps/cortex/ui/src/lib/checklist-view.ts`. `checklistView(s: ChecklistSnapshotWire)` returns:
  - `progressPct`, from requirement rows, or from advisory rows when the run has no requirements;
  - `label`;
  - `sections: { requirements; advisory }`;
  - `collapsedByDefault`.
- Create: `components/ChatPlanCard.svelte`.
  - It shows two labelled sections: "Goal checks", which are gate truth, and "Agent's to-do", which is advisory.
  - Each sub-agent group renders as a nested, collapsible block under its name, with its own progress. Live children get a running indicator. Parallel children appear side by side in start order.
  - The active row is highlighted, and blocked rows show their reason.
  - It collapses by default once every requirement is done.
  - The expand control is keyboard-focusable, and the card respects `prefers-reduced-motion`.
- Modify:
  - `stores/chat-store.ts`: `ChatTurn.checklist?`; `hydrateTurn` restores it from `trace.checklist`.
  - `stores/chat-stream.ts`: fold `ChecklistUpdated` with a `lastSeq` guard.
  - `ChatPanel.svelte`: mount the card.
  - `AgentConfigPanel.svelte`: add two toggles, "Show task checklist" and "Let the agent keep a to-do list".
- Test: `apps/cortex/ui/src/lib/checklist-view.test.ts`, `apps/cortex/ui/src/lib/stores/chat-stream.checklist.test.ts`

- [ ] **Step 1: Write the failing tests.**
  - With every advisory item done but a requirement still pending, `progressPct < 100` and the card does not collapse (Review Focus 1).
  - With no requirements, progress comes from advisory rows and the label says "to-do".
  - A blocked row carries its `reason`.
  - Two child groups render nested, each with its own progress, and the root progress ignores them.
  - A stale event is ignored.
  - An old turn without a checklist hydrates unchanged.
- [ ] **Step 2: Run** the two tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the tests and `bun run --cwd apps/cortex/ui check`. Then do a browser check:
  - a turn that uses `todo` shows both sections live, and they survive a reload;
  - turning the toggle off hides the card on the next turn;
  - take screenshots in both themes.
- [ ] **Step 5: Commit** `feat(cortex): live plan card (goal checks + agent to-do) with settings`.

---

### Task 11: Prove the checklist is model-invisible; docs and changeset

**Owner:** runtime-warden for the test. ablation-warden confirms it (read-only). Main does the docs.

**Files:**
- Create: `packages/runtime/tests/checklist-model-invisible.test.ts`.
- Docs:
  - `apps/docs/.../reference/builder-api.md`: regenerate it, plus prose for `observability.checklist`.
  - `features/cortex.md`.
  - A "Live checklist" section in the guide that documents `AgentStreamEvent`. Explain requirement vs advisory rows, and that `withMetaTools` is overlay-only.
  - `README.md`: update it if it enumerates the options.
- Create: `.changeset/checklist-primitive.md` (minor for core, tools, reasoning, runtime, ui-core, observability and reactive-agents). It covers:
  - the breaking tools removals (`applyTodoAction`, `parseTodoList`, `renderTodoList`, `TodoItem`, `TodoActionResult`) and their replacements;
  - the `brief` delta;
  - the full-density-only snapshot.
- Wiki: the spec frontmatter becomes `status: approved`; `Planning-Index.md`; the pilot log entries.

- [ ] **Step 1: Write the test.**
  - Capture requests with `.withReplayLLM(capturingLayer(captured))`, copying the helper at `packages/runtime/tests/builder-seam-behavioral.test.ts:39-55`. Do not use `.withLayers`, which captures nothing.
  - Use a fresh agent and a fresh `TestLLMService` per arm, run in the order ON, OFF, ON.
  - Compare the projection `{ messages, systemPrompt, tools, purpose, model, maxTokens, temperature, stopSequences }`. Drop `traceContext`, which carries the per-run taskId.
  - Assert that ON₁ equals ON₂, which controls for process-global state.
  - Assert that ON equals OFF.
  - Vacuity guard: the ON arm emitted at least one `ChecklistUpdated`, and the requests contain the `todo` tool result.
- [ ] **Step 2: Run** it. Expected: PASS. A failure means a prompt leak; fix it in the owning task first.
- [ ] **Step 3: Send** the result to ablation-warden to confirm the Task 0 premise. Record the confirmation in the changeset and the spec.
- [ ] **Step 4: Run** `bun run docs:gen:api`, the metrics sync, the full `bun test --timeout 15000`, and `bun run build`. Expected: green. Report the counts.
- [ ] **Step 5: Commit** `docs: live checklist primitive (observability.checklist, ChecklistUpdated, Cortex plan card) + changeset`.

---

## Later phases (each gets its own plan, built on the meta-loop)

**Phase 2 — Triage and Decompose.**
- Add `needs` and `verifiability` to `TaskClassification` (`comprehend/task-classification.ts`), next to `horizon`.
- Deterministic rules come first, then a judgment `Choice` as a typed classifier signal (invariant I7).
- `compileHarnessPlan` gains a planning posture: offer `todo`, suggest a goal. That behavior change goes through the lift rule.
- Decompose proposes contract requirements and deliverables (`PostCondition` / `SuccessCriterion` vocabulary) plus suggested advisory items. Callers accept or edit them before the contract freezes.

**Phase 3 — Goals.**
- A goal is `TaskContract`, extended to hold several criteria, plus a budget (tokens, cost, wall-clock, segments).
- `agent.pursue(contract, budget)` returns a proposal first; a second step accepts it and runs. `autoAccept` defaults to off.
- Segments are ordinary durable runs over one run ledger. The standing frame does the handoff.
- The verdict is the terminal gate plus a judgment checker tier (achieved | progressing | stalled | blocked), mapped to `goalAchieved: true | false | null`.
- Stall means no evidence delta and no requirement transition for N segments, read from the assessment.
- The budget is checked at segment boundaries. Existing in-run limits bound each segment; no mid-segment kill.
- With no judge, use the LLM-emulation backend. When no model call is allowed, use deterministic tiers only and report `null` when undecided.
- Cortex gets `/goal`, `/plan` and a goal bar. Segment queueing respects `ChatSessionBusyError`.

**Phase 4 — Strategies as policies, after 09 Steps 2–3.**
- plan-execute and the other maintained strategies hollow into policies of the one loop.
- plan-execute's `Plan` moves onto checklist facts at that point, not before.
- Core's types stay free of execution fields.

## Execution notes

- **Prerequisite.** Plan 2's Tasks 1–2 are merged. Check that `makeRunTree` is exported from `@reactive-agents/core` and that `engine/stream-scope.ts` exists.
- **Order:** 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11.
  - Task 7 needs only Task 1, so it can overlap with Tasks 2–5.
  - Task 8 needs Tasks 1 and 6.
  - Task 0 needs the probe report at `wiki/Research/Harness-Reports/2026-10-28-todo-surface-probe.md`.
- **Warden dispatches.** Each warden gets a MissionBrief whose authority paths equal the task's Files list.
  - Task 0: ablation-warden.
  - Tasks 2 and 4: kernel-warden.
  - Tasks 3 and 5: tools-warden.
  - Task 6 and the Task 11 test: runtime-warden.
- **Parent-owned edits inside warden tasks:**
  - `scripts/**`;
  - `strategies/adaptive.ts`;
  - `packages/runtime/tests/config-field-census.test.ts`;
  - `packages/reactive-agents/src/index.ts`;
  - generated docs.
- **Execution flow.** Run it subagent-driven: a fresh implementer per task, then a fresh reviewer per task, then a whole-branch review. Every commit keeps the workspace typecheck green. Apply the dispatcher FSM, and never re-prompt a warden to review its own work.

## Open questions for the owner

1. **Sequencing against 09.** 09 §8 holds WIP = 1, and Hot.md shows other open threads.
   - Phase 1 is a projection (C1/C7-shaped) and changes no model-visible default.
   - Is it cleared to run now, or does it queue behind the active 09 step?
   - Plans 1 and 2 (Cortex reliability and visibility) are app-level and arguably outside the WIP rule. Plan 2 does touch the runtime stream (scope resolver).
2. **Advisory rows.** Advisory rows never count toward done (the spec author's call). Confirm.
3. **`todo` default.** The probe says to keep it opt-in, and the plan now encodes that (Decision 7). Overrule it only if you want Cortex chat to expose it anyway.

## Review record (2026-10-28)

- **Revision 1:** four read-only reviews (kernel, runtime and tools wardens, plus a spec/SOLID reviewer). Their findings were folded in.
- **Adversarial alignment review:** returned MISALIGNED for revision 1. Its findings:
  - a fourth task list;
  - a kernel `PlanUpdated` as a second channel beside the ledger;
  - `.withPlanning()` breaking the wither ratchet (verified: ceiling 87, `builder-wither-ratchet.test.ts:47`);
  - triage duplicating `TaskClassification` and `HarnessPlan`;
  - goal checks duplicating contract vocabulary;
  - a UI toggle placed in envelope rails;
  - plan-execute features against north-star §7 (verified);
  - a `PlanSource` name collision (verified, `harness-plan.ts:63`).
- **Revision 2** (this document) and spec revision 2 resolve all of them:
  - the checklist is a projection of contract and ledger facts;
  - no kernel event;
  - the toggle lives on `.withObservability`;
  - maintained strategies are untouched;
  - Phases 2–3 are re-specified on `TaskClassification`, `HarnessPlan`, `TaskContract`, `RunContract`, the terminal gate and the assessment.
- **Retained from revision 1:**
  - retiring the global todo Ref;
  - replayable facts;
  - the byte-identical `todo` contract and the model-invisibility test;
  - the additive-then-delete migration;
  - Task 0 before any default;
  - all four reviewers' turn-shape and resume test cases.
- **Split (2026-10-28, owner request).**
  - The Cortex/provider tasks moved to [[2026-10-28-cortex-reliability-and-providers]].
  - The visibility tasks (cost, traces, sub-agents, Beacon) moved to [[2026-10-28-cortex-run-visibility]].
  - `makeRunTree` moved to plan 2's Task 1 so that both plans share one resolver.
