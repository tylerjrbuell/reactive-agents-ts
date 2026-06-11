---
type: design-spec
status: proposed
created: 2026-06-10
tags: [v0.12.0, durable-execution, resume, HITL, checkpoint]
---

# Durable Execution — crash-resume + durable HITL (v0.12.0 track 1)

> **Why:** 2026 table stakes — LangGraph checkpoints, Pydantic-AI+Temporal, OpenAI Agents SDK, Vercel Workflow DevKit all ship it; evaluators filter on "resume-after-crash + HITL pause/resume" before differentiators are even considered. Source: `wiki/Research/Audit-Reports-2026-06-10/v0.12.0-leverage-audit.md` (lever #1).

## 1. Current state (code-verified 2026-06-10)

| Primitive | Location | What it does | Durable? |
|---|---|---|---|
| `RunHandle.pause/resume/stop/terminate` | `runtime/src/run-controller.ts` | in-process control plane; kernel awaits `checkpoint()` at iteration boundary | ❌ dies with process |
| Auto-checkpoint | `reasoning/src/kernel/loop/auto-checkpoint.ts` | one-shot snapshot on context pressure, FiberRef in-memory | ❌ |
| `.withProgressCheckpoint(every)` | `builder.ts:1605` | **stores config only — kernel wiring admitted missing** ("PlanStore write execution is pending V1.1", `builder.ts:1595`) | ❌ documented-but-unwired (honesty issue) |
| Snapshot/Replay | `packages/replay/` | deterministic re-execution from recorded trace (tool table + frozen results) | ✅ but replay ≠ resume — rebuilds the past, doesn't continue live |
| Gateway sessions | SQLite SessionStore | per-sender chat history | ✅ but chat-scope, not run-scope |
| `requireApprovalFor` killswitch | `packages/compose/` | synchronous approver gate on tool calls | ❌ blocks in-process; approval can't outlive process |
| `KernelState` | `kernel/state/kernel-state.ts:310` | steps/messages/scratchpad/toolsUsed/meta/iteration/tokens — plain data, no closures in persisted core | ✅ serializable (Map/Set need codec) |

**Gap:** persistence of live run state + a way to reconstruct a running kernel from it.

## 2. Design

### 2.1 RunStore (new, `@reactive-agents/runtime` internal service; SQLite via runtime-shim)

```
runs(run_id TEXT PK, agent_id, task TEXT, status TEXT, -- running|paused|awaiting-approval|completed|failed
     config_hash TEXT, created_at, updated_at)
run_checkpoints(run_id, iteration INT, state_json TEXT, created_at, PK(run_id, iteration))
run_pending(run_id PK, kind TEXT, -- approval
            payload_json TEXT)    -- {toolName, args, callId}
```

- `state_json` = codec-serialized `KernelState` core (messages[], steps[], scratchpad, toolsUsed, meta, iteration, tokens/cost counters). Functions/services are NOT persisted — they re-materialize from builder config at resume (same pattern as `toConfig()`/`fromJSON()` round-trip, which already exists).
- Default path `~/.reactive-agents/<agentId>/runs.db`; honor existing memory dir conventions. Opt-in only (see 2.5) — no surprise writes (consistent with memory-default-OFF decision).

### 2.2 Checkpoint wiring (closes the `withProgressCheckpoint` lie)

- Kernel already has the seam: `RunController.checkpoint()` is awaited at the top of the while-loop (`runner.ts`). Extend the controller contract with an optional `onCheckpoint(state)` callback wired by runtime when durability is enabled; every N iterations (`every` from `withProgressCheckpoint`) serialize → `run_checkpoints`.
- Write is fire-and-forget Effect with non-silent failure (triple-surface per R11 precedent).

### 2.3 Resume API

```ts
const agent = await builder.build()
const handle = await agent.resume(runId)   // → RunHandle, continues from last checkpoint
// or list: await agent.listRuns({ status: 'paused' | 'awaiting-approval' | ... })
```

- `resume(runId)`: load latest checkpoint → validate `config_hash` matches current builder config (mismatch = typed error, not silent drift) → seed `KernelInput` with restored messages/steps/meta/iteration → re-enter `runKernel` mid-stream. Token counters restored so budgets stay honest.
- Tool results from completed steps are NOT re-executed (they're in restored messages). Side-effect-safety note in docs: resume does not replay tools.

### 2.4 Durable HITL

- New approval mode: when `requireApprovalFor` matcher fires and approver is the durable variant, persist `run_pending` + checkpoint, set status `awaiting-approval`, end the process-local run cleanly (emit `StreamPaused` event, new).
- `agent.approve(runId, callId)` / `agent.deny(runId, callId, reason?)` → records verdict → `resume(runId)` continues with the approved tool call executing first (deny injects a tool-error observation).
- This makes the existing killswitch composable with process death — the demo: agent asks for approval, process killed, CLI restarted next day, `approve()` → finishes.

### 2.5 Surface (minimal, anti-scaffold §9 — every piece ships with its consumer)

- `.withDurableRuns({ dir?, checkpointEvery? })` — single opt-in builder method (folds `withProgressCheckpoint` semantics in; old method delegates + deprecation note).
- `agent.resume / listRuns / approve / deny`.
- Cortex consumer in same release: runs page shows paused/awaiting-approval runs with resume/approve buttons (Track B synergy).

## 3. E2E acceptance gates (the story we market)

1. **Crash-resume:** integration test — run 10-iteration multi-tool task with `checkpointEvery: 2`, hard-kill the process (subprocess + SIGKILL) mid-run, new process `resume(runId)`, task completes; final output equals uninterrupted-run output on deterministic test provider.
2. **Durable HITL:** approval requested → process exits → `approve(runId, callId)` in new process → run completes; deny path produces graceful failure.
3. **Honesty:** `withProgressCheckpoint` docstring no longer says "pending V1.1"; config-hash mismatch surfaces typed error.
4. Zero overhead when disabled (no RunStore wiring, no extra writes) — verified by existing perf gates.

## 4. Phases

| Phase | Scope | Warden |
|---|---|---|
| A | KernelState codec (serialize/deserialize round-trip test, Map/Set handling) + RunController `onCheckpoint` seam | kernel-warden |
| B | RunStore service + `.withDurableRuns()` + checkpoint writes | runtime-warden |
| C | `resume()` reconstruction + config-hash guard + e2e crash test | runtime-warden |
| D | Durable HITL (`run_pending`, approve/deny, StreamPaused event) | runtime-warden + compose-warden |
| E | Cortex resume/approve UI + docs page ("kill it, resume it") | main thread (apps/) |

Risks: (1) KernelState meta may carry strategy-specific non-serializable entries — codec must whitelist + warn, not crash; (2) provider conversation thread restore must respect provider-specific message shapes (already normalized as KernelMessage — verify per provider in Phase C); (3) mid-run service state (memory layer) is rebuilt fresh — acceptable, document.

## 5. Open questions for review

1. SQLite default vs pluggable store interface day-1? (Recommend SQLite-only v0.12.0; interface extraction when a second backend exists — anti-scaffold.)
2. Should `runStream()` auto-checkpoint on `pause()` when durable runs enabled (pause = durable by default)? (Recommend yes — makes pause survive restarts for free.)
3. Event additions (`StreamPaused`, `ApprovalRequired`) — additive to `AgentStreamEvent` union; confirm no UI package breakage.
