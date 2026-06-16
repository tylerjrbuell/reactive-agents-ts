---
title: Durable Human-in-the-Loop (Approval Gates) — Design Spec
type: design-spec
created: 2026-06-16
status: approved
tags: [durable, hitl, approval, v0.12, runtime, kernel]
related:
  - "[[project_durable_execution_2026_06_12]]"
  - "2026-06-12-durable-execution-phase-c.md"
---

# Durable Human-in-the-Loop — Design Spec

**Goal:** An approval gate that survives process death. A run hits a flagged
action → persists `awaiting-approval` + the pending action → returns control (the
process may exit) → a human approves/denies from *any* process → the run resumes
from its checkpoint and runs to completion.

This is the last open functional gate for v0.12 "Durable & Honest" (Phase D).
Phases A–C (crash-resume: `RunStore`, `resumeRun`, `listRuns`) already shipped;
this spec extends those exact seams rather than building a new subsystem.

---

## 1. Background — what exists today

| Piece | Location | State |
| --- | --- | --- |
| `RunStore` (SQLite) | `packages/runtime/src/services/run-store.ts` | Persists run rows + per-iteration `KernelState` checkpoints. Status enum **already includes `"awaiting-approval"` but nothing writes it.** |
| `resumeRun(runId)` | `packages/runtime/src/reactive-agent.ts:749` | Loads latest checkpoint, re-runs to completion via `ResumeStateRef`. Crash-resume works. |
| `listRuns(filter)` | `reactive-agent.ts:788` | Enumerate runs by status. |
| Durable checkpoint write | `packages/runtime/src/engine/execute-stream.ts:165–214` | `installDurableCheckpointing(runController)` hooks `onCheckpoint`; writes each Nth iteration snapshot. Opt-in via `.withDurableRuns()`. |
| `terminatedBy` control signal | `packages/reasoning/src/kernel/loop/terminate.ts` | Single-owner loop finalizer; every termination declares a reason. |
| Resume re-entry | `packages/reasoning/src/kernel/loop/runner.ts:224` | `resumeState` restored **verbatim**, then the main loop re-enters at the top. |
| In-process approval gate | `packages/interaction/src/services/interaction-manager.ts:114` | `approvalGate()` blocks on an **in-memory** `Ref<Map<gateId, resolver>>`. Same-process only; lost on crash. |
| Tool `requiresApproval` flag | `packages/tools/src/types.ts:180` + ~6 tools | Declared on docker/shell/code-exec/file-write. **The run loop does not currently gate on it.** |
| Compose `requireApprovalFor` | `packages/compose/src/killswitches/require-approval-for.ts` | Synchronous in-process approver at `before('act')`. Not durable. |

**The gap:** no way to (a) persist "this run paused awaiting approval at gate G for
action A", (b) approve/deny from a *different* process, (c) resume from the
decision after the original process died.

---

## 2. Approach — reuse the crash-resume infra

Durable approval **is** crash-resume with a decision attached. The pause is a new
`terminatedBy` reason; the resume is `resumeRun` seeded with the decision. No new
loop, no new persistence engine, no cross-process polling/IPC — the SQLite
`RunStore` is the rendezvous point between processes.

```
run() ── kernel act ── pending tool call flagged? ──no──▶ execute normally
                              │ yes  (durable + detach mode)
                              ▼
            store pending call in state.meta.awaitingApprovalFor
            terminate(reason="awaiting-approval")
                              ▼
   engine: force final checkpoint, RunStore.setStatus(runId, "awaiting-approval"),
           RunStore.putApproval({runId, gateId, toolName, argsJson, status:"pending"})
                              ▼
   return AgentResult { status:"awaiting-approval",
                        pendingApproval:{runId, gateId, toolName, args} }
   ── process may now exit ──

approveRun(runId, opts?) / denyRun(runId, reason)        [ANY process]
        ▼  RunStore.decideApproval(runId, gateId, "approved"|"denied", reason)
        ▼  loadResumePayload(runId)  +  seed ApprovalDecisionRef
        ▼  resume: runner restores state.meta.awaitingApprovalFor; sees decision:
              approved → route straight to `act`, execute stored call (NO re-think)
              denied   → clear gate, inject denial observation, continue to think
        ▼  run to completion → RunStore.setStatus(runId, "completed")
```

---

## 3. The flexible core — one gate, three feeders

Per the approved "most flexible / not locked to one approval flow" decision: a
single decision point, fed by three independent sources that OR together.

**Decision point:** the kernel `act` capability, evaluated `before` a pending
tool call executes (the same chokepoint `requireApprovalFor` already uses).

**`shouldGate(call, ctx)` = true if ANY of:**

1. **Tool flag** — `call.definition.requiresApproval === true`. The primitive.
2. **Builder policy** — `.withApprovalPolicy({ tools?, requireFor? })`: the
   call's name is in `tools`, or `requireFor(ctx)` returns true.
3. **Compose killswitch** — `requireApprovalFor({ tools, approver })` continues to
   work; its predicate is folded into the same `shouldGate` evaluation.

**Pause only happens in durable detach mode** — i.e. the agent was built with
`.withDurableRuns()` AND approval is in `mode: "detach"` (default when durable).
Without durable runs, `shouldGate=true` falls back to the existing in-process
`approvalGate` (`mode: "block"`) so simple same-process cases are unchanged.

This keeps one enforcement path with three feeders; nothing is locked to a single
trigger flow.

---

## 4. Components & responsibilities

### 4.1 `run-store.ts` — durable approval records (runtime)

New table + three methods on the `RunStore` interface.

```ts
// New table (created idempotently alongside runs / run_checkpoints):
//   run_approvals (
//     run_id TEXT NOT NULL, gate_id TEXT NOT NULL,
//     tool_name TEXT NOT NULL, args_json TEXT NOT NULL,
//     status TEXT NOT NULL,            -- 'pending' | 'approved' | 'denied'
//     reason TEXT, created_at INTEGER NOT NULL, decided_at INTEGER,
//     PRIMARY KEY (run_id, gate_id)
//   )

export interface ApprovalRecord {
  readonly runId: string;
  readonly gateId: string;
  readonly toolName: string;
  readonly argsJson: string;
  readonly status: "pending" | "approved" | "denied";
  readonly reason?: string;
}

// Added to interface RunStore:
readonly putApproval: (r: {
  runId: string; gateId: string; toolName: string; argsJson: string;
}) => Effect.Effect<void, never>;
readonly getPendingApproval: (
  runId: string,
) => Effect.Effect<ApprovalRecord | undefined, never>;
readonly decideApproval: (
  runId: string, gateId: string,
  status: "approved" | "denied", reason?: string,
) => Effect.Effect<boolean, never>; // false if no pending row matched
```

`"awaiting-approval"` is already in the `RunStatus` enum — no enum change.

### 4.2 Kernel — gate check + new terminate reason (reasoning)

- **`packages/reasoning/src/kernel/state/kernel-state.ts`** — add optional
  `awaitingApprovalFor?: { gateId: string; toolName: string; args: unknown }` to
  `KernelMeta`. Serializable (codec already round-trips `meta`).
- **`packages/reasoning/src/kernel/capabilities/act/tool-gating.ts`** (or `act.ts`)
  — before executing a pending tool call, evaluate `shouldGate`. When it fires in
  detach mode: write `awaitingApprovalFor` into `state.meta`, then route to
  `terminate(reason: "awaiting-approval")`. **The pending call is NOT executed.**
- **`packages/reasoning/src/kernel/loop/terminate.ts`** — register
  `"awaiting-approval"` as a valid `terminatedBy` reason. It is a *non-failure*
  terminal state (distinct from `"done"`): the deliverable is empty, status is
  carried out to the engine.
- **`packages/reasoning/src/kernel/loop/runner.ts`** — resume re-entry: at loop
  top, if `state.meta.awaitingApprovalFor` is set AND `effectiveInput.approvalDecision`
  is present:
  - **approved** → skip `think`, execute the stored `awaitingApprovalFor` call via
    `act`, clear `awaitingApprovalFor`, continue the loop normally.
  - **denied** → clear `awaitingApprovalFor`, inject a denial observation step
    (`"Action <tool> was denied by a human: <reason>"`), continue to `think`.

  This is the deterministic re-entry that prevents a non-deterministic re-`think`
  from producing a different call than the one approved.

### 4.3 `ApprovalDecisionRef` — decision carrier (core → kernel input)

Mirrors `ResumeStateRef` **exactly** (which lives in
`packages/core/src/streaming.ts:72`, exported from `@reactive-agents/core`, read in
`reasoning-think.ts`, forwarded as a `KernelInput` field — the runner reads the
input field, never the `FiberRef` directly):

- **Define** `ApprovalDecisionRef = FiberRef.unsafeMake<ApprovalDecision | null>(null)`
  in `packages/core/src/streaming.ts`; export from `core/index.ts`. Type:
  `{ gateId: string; status: "approved" | "denied"; reason?: string }`.
- **Seed** in `reactive-agent.ts` `approveRun`/`denyRun` via
  `Effect.locally(pipeline, ApprovalDecisionRef, decision)` (alongside the existing
  `ResumeStateRef` locally).
- **Read + forward** in `reasoning-think.ts`: `yield* FiberRef.get(ApprovalDecisionRef)`
  → set `executeRequest.approvalDecision`. Null on every normal run (zero cost).
- **Consume** in `runner.ts` via `effectiveInput.approvalDecision`.
- **`KernelInput.approvalDecision?: ApprovalDecision`** added to `kernel-state.ts`
  next to `resumeState`.

### 4.4 `execute-stream.ts` — persist the pause (runtime)

In the `execute(task)` `.tap`/result handler: when the result's `terminatedBy ===
"awaiting-approval"`:
1. Force a final checkpoint of the serialized state (so the pending call survives).
2. `RunStore.setStatus(runId, "awaiting-approval")`.
3. `RunStore.putApproval({ runId, gateId, toolName, argsJson })` read from
   `state.meta.awaitingApprovalFor`.
4. Surface `pendingApproval` onto the `AgentResult`.

Guarded by the existing `config.durableRuns && options?.runController` block.

### 4.5 `durable-resume.ts` — decide + resume helper (runtime)

```ts
export const decideAndResume = (params: {
  dbPath: string; runId: string;
  decision: { gateId: string; status: "approved" | "denied"; reason?: string };
}) => Effect.Effect<void, DurableRunNotFoundError | ApprovalStateError>;
// 1. RunStore.getPendingApproval(runId) → guard exists & pending (else ApprovalStateError)
// 2. RunStore.decideApproval(...)
// (resume itself runs in reactive-agent.ts where the ManagedRuntime lives)
```

### 4.6 `reactive-agent.ts` — public API (runtime)

```ts
async approveRun(runId: string, opts?: { reason?: string }): Promise<AgentResult>;
async denyRun(runId: string, reason: string): Promise<AgentResult>;
async listPendingApprovals(): Promise<readonly PendingApproval[]>;
// PendingApproval = { runId; gateId; toolName; args; task; updatedAt }
```

`approveRun`/`denyRun`: require `_durableResume` (else throw, mirroring
`resumeRun`); call `decideAndResume`; then run the resume pipeline
(`loadResumePayload` + `Effect.locally(pipeline, ResumeStateRef, stateJson)` +
`Effect.locally(ApprovalDecisionRef, decision)`); flip status to `completed`/
`failed` exactly as `resumeRun` does. `listPendingApprovals` = `listRuns(status:
"awaiting-approval")` joined with `getPendingApproval` per run.

### 4.7 `builder.ts` — `.withApprovalPolicy(...)` (runtime)

```ts
withApprovalPolicy(policy: {
  tools?: readonly string[];
  requireFor?: (ctx: { toolName: string; iteration: number }) => boolean;
  mode?: "detach" | "block"; // default "detach" when durable, else "block"
}): this
```

Build-time guard: `mode: "detach"` without `.withDurableRuns()` → build error
(detach requires a durable store to persist the pause).

### 4.8 `AgentResult` — status surface (runtime types)

Add `status?: "completed" | "awaiting-approval" | "failed"` and optional
`pendingApproval?: { runId; gateId; toolName; args }`. Default `status` stays
`"completed"` for the overwhelming non-gated path (no behavior change).

---

## 5. Error handling

| Condition | Behavior |
| --- | --- |
| `approveRun`/`denyRun` on a run not in `awaiting-approval` | `ApprovalStateError` (new). Already-decided is idempotent → no-op, not a throw. |
| Config changed between pause and resume | Existing `DurableConfigMismatchError` from `loadResumePayload` — free, reused. |
| `.withApprovalPolicy({mode:"detach"})` without `.withDurableRuns()` | Build-time error. |
| Non-durable agent hits `shouldGate` | Falls back to existing in-process `approvalGate` (block mode) — unchanged. |
| Crash *during* resume after decision | Decision is already persisted; re-running `approveRun` is idempotent and re-resumes. |

---

## 6. Testing strategy

1. **Unit — RunStore approvals:** `putApproval`/`getPendingApproval`/
   `decideApproval` CRUD; decide on non-pending returns `false`.
2. **Unit — `shouldGate` OR-logic:** flag-only, policy-tools-only,
   policy-predicate-only, compose-only, and combinations each gate; none → no gate.
3. **Unit — runner re-entry:** restored `awaitingApprovalFor` + approved decision
   executes stored call without `think`; denied injects observation + continues.
4. **Integration — single process:** `run()` → `status:"awaiting-approval"` +
   `pendingApproval` populated; `approveRun` → completes with the tool executed;
   `denyRun` → completes without it, denial observation present.
5. **Cross-process e2e (the real proof, mirrors the crash-resume e2e):** process A
   runs to the gate and exits (`status:"awaiting-approval"` persisted); process B,
   fresh, calls `approveRun(runId)` → run completes. Hard-kill A before B starts.
6. **Governance:** no new `as any`; if a ceiling must move, justify + bump per the
   documented discipline (no metric-gaming).

---

## 7. Scope boundaries (YAGNI)

**In scope:** durable pause/approve/deny/resume for tool-call approval, three
feeders, cross-process e2e, public API, builder policy, docs.

**Out of scope (deferred):** approval UI/dashboard; approval *timeouts* in detach
mode (the in-process gate keeps its timeout; detached pauses wait indefinitely
until decided — a TTL/expiry policy is a follow-up); per-argument approval diffing;
multi-gate-per-iteration batching (one pending gate at a time — if a single
iteration parses multiple flagged calls, gate on the first, the rest re-surface on
resume).

---

## 8. Migration / compatibility

- Additive. Default `run()` path unchanged: `status` defaults to `"completed"`,
  `pendingApproval` absent, no new tables touched unless `.withDurableRuns()`.
- Existing in-process `approvalGate` / `requireApprovalFor` semantics preserved for
  non-durable agents.
- `run_approvals` table created idempotently; existing `runs.db` files upgrade in
  place on next durable run.

---

## 9. File-touch summary

| File | Change |
| --- | --- |
| `packages/runtime/src/services/run-store.ts` | `run_approvals` table + 3 methods |
| `packages/runtime/src/engine/durable-resume.ts` | `decideAndResume` helper |
| `packages/runtime/src/engine/execute-stream.ts` | persist pause on `terminatedBy="awaiting-approval"` |
| `packages/runtime/src/reactive-agent.ts` | `approveRun`/`denyRun`/`listPendingApprovals` + `ApprovalDecisionRef` seeding |
| `packages/runtime/src/builder.ts` (+ `builder/types.ts`) | `.withApprovalPolicy(...)` + build guard |
| `packages/runtime/src/types.ts` / runtime-types | `AgentResult.status` + `pendingApproval` |
| `packages/runtime/src/errors.ts` | `ApprovalStateError` |
| `packages/core/src/streaming.ts` (+ `core/index.ts`) | `ApprovalDecisionRef` FiberRef + export |
| `packages/runtime/src/engine/phases/agent-loop/reasoning-think.ts` | read `ApprovalDecisionRef` → forward `approvalDecision` |
| `packages/reasoning/src/kernel/state/kernel-state.ts` | `KernelMeta.awaitingApprovalFor` + `KernelInput.approvalDecision` |
| `packages/reasoning/src/kernel/capabilities/act/tool-gating.ts` | `shouldGate` + terminate-on-gate |
| `packages/reasoning/src/kernel/loop/terminate.ts` | register `"awaiting-approval"` reason |
| `packages/reasoning/src/kernel/loop/runner.ts` | resume re-entry (approved→act / denied→observe) |
