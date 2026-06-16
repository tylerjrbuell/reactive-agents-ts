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

## Status (2026-06-16)

- **Phase E1 + E2 SHIPPED** (commits `9fff4053`, `2ed3235d`, `46f36eec`):
  - `buildCortexAgent` + LaunchParams + RunConfigBody accept `durableRuns`
    ({ enabled, checkpointEvery?, dir?, approvalPolicy? }) → `.withDurableRuns()` /
    `.withApprovalPolicy()`.
  - Runner retains agents paused at `awaiting-approval` (skips dispose) +
    `listPendingApprovals`/`approveApproval`/`denyApproval`.
  - REST: `GET /api/runs/pending-approvals`, `POST /api/runs/:runId/approve|deny`.
  - UI: `run-store` approve/deny + `ApprovalPanel.svelte` (polls pending, mounted
    on the Execution-Trace page).
  - Tests: build-cortex-agent-durable + api-runs durable endpoints/passthrough;
    cortex suite 402/402. **Live playwright verify of the panel still pending.**
  - **Follow-up:** cross-restart resume needs per-run launch-config persistence
    (rebuild a matching durable agent by config-hash); only in-process/live-session
    approve/deny is wired today.

- **Phase E LIVE-VERIFIED + 2 BUGS FIXED** (`65b7ffde`, ollama gemma4:e4b end-to-end):
  launch durable run → pauses on the gated tool (NOT executed) → ApprovalPanel /
  listPendingApprovals shows it → approve → resume executes the tool → pending
  clears. Bugs found only via live run (deterministic tests passed but the engine
  path differed):
  1. **Cortex ran inline-think, not the reasoning kernel.** Cortex enabled
     reasoning only when strategy/synthesis/audit was set; otherwise the engine
     used the inline-think fallback, which has NEITHER the durable checkpoint seam
     NOR the approval gate (both live only in the reasoning kernel). Fix: force
     `.withReasoning()` whenever `durableRuns.enabled`.
  2. **Pending-approval key mismatch.** Runner retained the paused agent keyed by
     the cortex taskId, but listPendingApprovals/approve/deny use the DURABLE runId
     (runDurable mints its own). Fix: key `pendingRef` by `pendingApproval.runId`.

  > **NOTE for the live dev server:** `bun run server/index.ts` has NO watch — a
  > running studio must be restarted (`bun start`) to pick up these server fixes.

- **✅ RESOLVED — reasoning kernel ON by default + toggle** (`ebd29cd9`):
  `cortexParamsToAgentConfig` now sets `features.reasoning = true` by default, so
  cortex agents run as standard Reactive Agents (calibration, healing, strategy,
  durable seam). `useReasoning: false` opts into inline-think; durable runs force
  reasoning on. Threaded through runs + chat bodies (drift parity) + an
  AgentConfigPanel "Reasoning kernel" toggle. Live-verified (gemma4:e4b): a
  default run emits ReasoningStepCompleted; `useReasoning:false` does not.

- **✅ DONE — durable runs launchable from the UI** (`282ce5b8`): config panel
  "Durable execution" toggle + per-tool approval-gate chips →
  `durableRuns`/`approvalPolicy` in the run body. Full UI-shape E2E live-verified:
  launch → pause on gated tool → Approval panel → approve → resume → clear.

- **✅ Phase S — structured output SHIPPED + live-verified** (`edba7278`, `8a6ed23e`):
  - `json-schema-output.ts` wraps a raw JSON Schema as a lenient Standard Schema
    (StandardJSONSchemaV1 `~standard.jsonSchema.output` extension) → no
    JSON-Schema→Effect-Schema conversion needed. `.withOutputSchema()` steers
    extraction; lenient (objectError, never throws).
  - Threaded outputSchema through buildCortexAgent + LaunchParams + RunConfigBody +
    post-body. Runner emits synthetic `StructuredOutputExtracted` event.
  - UI: AgentConfigPanel schema editor (live validity) + run-store handling +
    RunFinalDeliverable typed-object viewer.
  - Live-verified (gemma4:e4b): object schema → `{ name:"Ada Lovelace",
    role:"mathematician", born:1815 }` (typed). cortex 416/416.

- **Phase C (budget caps / grounding / calibration config surface): NOT STARTED** —
  next increment.
