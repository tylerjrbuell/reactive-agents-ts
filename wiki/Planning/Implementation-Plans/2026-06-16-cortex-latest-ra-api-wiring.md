---
title: Cortex ↔ latest RA API wiring (durable Phase E + offerings audit)
date: 2026-06-16
status: in-progress
tags: [cortex, durable-execution, hitl, structured-output, v0.12]
---

# Cortex ↔ latest RA API wiring

**Goal:** wire Cortex (Bun/Elysia server + SvelteKit UI) to the current Reactive
Agents API surface, and make the UI exploit the framework's offerings — with
durable execution Phase E (resume + approval UI) as the headline.

## Gap audit (RA API ↔ Cortex usage, 2026-06-16)

`buildCortexAgent` (apps/cortex/server/services/build-cortex-agent.ts) wires ~18
builder methods: agentId, memory, reasoning, agentTool, remoteAgent,
dynamicSubAgents, tools, terminalTools, taskContext, skills, minIterations,
progressCheckpoint, verificationStep, verification, metaTools, streaming,
killSwitch.

**Missing (relevant) RA surface:**

| RA API | Kind | Cortex gap | Priority |
|---|---|---|---|
| `.withDurableRuns()` + `agent.resumeRun`/`listRuns` | durable crash-resume | not built; `/:runId/resume` is IN-PROCESS FiberRef resume, not durable | **P0 (Phase E1)** |
| `.withApprovalPolicy()` + `approveRun`/`denyRun`/`listPendingApprovals` | durable HITL | none | **P0 (Phase E2)** |
| `.withOutputSchema()` + `result.object` / `streamObject()` | structured output | none | P1 |
| `.withBudget()` | cost caps | only `withProgressCheckpoint` | P1 |
| `.withGrounding()` | evidence grounding | none | P2 |
| `.withCalibration()` | per-model calibration | none (auto in runtime) | P2 |
| effect-free `.withHook()` | lifecycle hooks | none | P2 |
| `.withObservability({...})` consolidated | observability facade | uses WS ingest; no facade config | P3 |
| `.withContract()` / `.withBehavioralContracts()` / `.withExperienceLearning()` / `.withSkillPersistence()` | advanced | none | P3 |

**UI gaps:** no durable-runs list / resume control, no pending-approval panel,
no structured-output schema editor + typed-object viewer, no budget/cost-cap
config, no grounding/calibration toggles in `AgentConfigPanel`.

## Phases

### Phase E1 — Durable runs + crash-resume (P0)
- **Server:** `buildCortexAgent` accepts `durableRuns?: { enabled; checkpointEvery?; dir? }` → `.withDurableRuns(...)`. Runner keeps the built agent (already does) so `resumeRun` reuses identity. New endpoints on `runsRouter`:
  - `GET /api/durable-runs?status=` → `agent.listRuns({status})`
  - `POST /api/runs/:runId/durable-resume` → `agent.resumeRun(runId)` (distinct from the existing in-process `/resume`).
- **UI:** `run-store` gains `durableRuns` + `loadDurableRuns()`/`resumeDurable(runId)`; `RunOverview`/`runs` page shows a "Resumable" section (status `awaiting-approval`/`paused`/crashed) with a Resume button.
- **Test:** `server/tests/api-durable-runs.test.ts` — list + resume round-trip against a real `.withDurableRuns` agent (test provider, SIGKILL-free: create→persist→resume).

### Phase E2 — Durable HITL (P0)
- **Server:** `durableRuns` config also accepts `approvalPolicy?: { tools?; requireFor?; mode? }` → `.withApprovalPolicy(...)`. Endpoints:
  - `GET /api/pending-approvals` → `agent.listPendingApprovals()`
  - `POST /api/runs/:runId/approve` (body `{reason?}`) → `agent.approveRun`
  - `POST /api/runs/:runId/deny` (body `{reason}`) → `agent.denyRun`
- **UI:** `ApprovalPanel.svelte` — lists pending approvals (runId, gate, tool, args), Approve/Deny buttons; surfaced when a run is `awaiting-approval`.
- **Test:** approve + deny round-trip; run reaches `awaiting-approval` then completes after approve.

### Phase S — Structured output (P1)
- **Server:** `RunConfigBody` accepts `outputSchema?` (JSON Schema) → `.withOutputSchema`. Surface `result.object`/`objectError` in the run record + live message.
- **UI:** schema editor in `AgentConfigPanel`; typed-object viewer in `RunFinalDeliverable`/`RunDetail`.

### Phase C — Config surface (P1/P2)
- `AgentConfigPanel` + `RunConfigBody` expose: budget caps (`.withBudget`), grounding (`.withGrounding`), calibration hint, verification mode. Each wired in `buildCortexAgent`.

## Verification
- Server phases: deterministic Elysia route tests (`server/tests/`), test provider.
- UI phases: `cd ui && bun test src/lib` for stores; playwright against `bun start` for the panels.

## Order
E1 → E2 (durable headline, P0) → S → C. Build server + store + test per phase, then UI panels, then live-verify.
