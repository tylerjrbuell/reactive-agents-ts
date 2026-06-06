---
title: Cortex Agent-Building Audit — drift from current reactive-agents builder/config API
date: 2026-06-06
type: audit
status: read-only-findings
scope: apps/cortex/server/services/* vs packages/runtime/src/{builder.ts,builder/*,agent-config.ts,compose.ts}
---

# Cortex Agent-Building Audit (2026-06-06)

READ-ONLY. No code changed. Evidence cites framework API that proves each gap.

## Summary

Cortex builds agents through a hand-rolled `BuildCortexAgentParams` → `cortexParamsToAgentConfig()` → `agentConfigToBuilder()` → overlay chain. The mapping is careful and mostly correct, but it has drifted from the current framework surface in three ways:

1. **One real silent-correctness bug in the framework mapper** that Cortex's careful `temperature: 0` handling cannot save: `agentConfigToBuilder` gates `temperature`/`maxTokens`/`thinking` entirely behind `if (config.model)`, so **any** config supplying those params without an explicit model drops them. Cortex's `draft.model = ""` sentinel is a confused no-op (empty string is still falsy at the gate).
2. **Schema gaps**: `numCtx` is supported by `ModelParams` + builder state + `serializeBuilder`, but is absent from `AgentConfigSchema`, so Cortex's config-driven path structurally cannot thread it (confirming the separately-tracked numCtx work needs a schema field, not just a wither). Tracing has no AgentConfig representation either.
3. **Wiring gaps / under-use of the API**: ~30 public withers Cortex never exposes. The sharpest: Cortex is a gateway host (`GatewayProcessManager`) but reimplements cron/tick in-process and never uses `AgentConfig.gateway` / `withGateway`. Cortex also can't toggle tracing (default-ON), and never adopts the Compose API (`compose.ts` `agentFn`/`pipe`/`parallel`) or `@reactive-agents/compose` killswitches.

Construction is functionally sound for the fields it does map; the issues are (a) the temperature-drop correctness bug, (b) schema-blocked params, and (c) breadth — many framework capabilities are simply unreachable from a stored Cortex config.

## Construction Path (how it works today)

Three call sites converge on one builder function:

- **`runner-service.ts:122`** — ad-hoc `POST /api/runs` desk launches. Threads the full param surface.
- **`gateway-process-manager.ts:255`** — scheduled/gateway runs. Reads the stored JSON `config` blob → `normalizeCortexAgentConfig()` (coerces string→number, fixes `temperature:0` truthiness, renames `react`→`reactive`) → threads params.
- **`chat-session-service.ts:220,269`** — desk chat (stream + non-stream). Narrower surface; sets `streaming`/`testScenario`; deliberately omits MCP/agentTools/skills/metaTools/fallbacks.

All three call **`buildCortexAgent()`** (`build-cortex-agent.ts:125`):

1. `cortexParamsToAgentConfig(params)` → `AgentConfig`, validated by `Schema.decodeUnknownSync(AgentConfigSchema)`. Maps schema-covered fields (model params, reasoning, execution, tools.allowedTools, memory tier, guardrails, persona, observability+logging, fallbacks, mcpServers, healthCheck feature).
2. `agentConfigToBuilder(agentConfig)` (framework, `agent-config.ts:320`) → `ReactiveAgentBuilder`.
3. **Overlay** of Cortex-only fields with no AgentConfig slot: `agentId`, `testScenario`, default `withMemory()`, a `withReasoning` re-merge for `contextSynthesis`, agentTools/remoteAgents, dynamicSubAgents, terminal tools + `ShellExecuteConfig`, taskContext, skills, minIterations, progressCheckpoint, verificationStep, `withVerification`, metaTools (default-on), streaming, `withKillSwitch()` (always).

Tool allowlisting is hand-built via `mergeCortexAllowedTools` + a hardcoded `CORTEX_FRAMEWORK_ALLOWED_TOOLS` list (`cortex-agent-config.ts:370`) rather than framework tool-resolution.

## Findings

| id | file:line | issue | severity | fix |
|----|-----------|-------|----------|-----|
| C1 | `agent-config.ts:330-341` (framework); triggered from `cortex-to-agent-config.ts:25-33` | `agentConfigToBuilder` gates temperature/maxTokens/thinking behind `if (config.model)`. Any Cortex config with temperature/maxTokens but no explicit model silently drops them — Cortex's `!= null` preservation of `temperature:0` is correct but wasted downstream. | p1 | In `agentConfigToBuilder`, apply temperature/maxTokens/thinking independent of `config.model` (call `withModel({model, ...})` whenever any param is set, or apply params even when model is absent). |
| C2 | `cortex-to-agent-config.ts:28-33` | `draft.model = ""` sentinel is a confused no-op: empty string is falsy at the `if (config.model)` gate (C1), so it neither carries the model nor un-gates the params. Misleads readers into thinking temperature is handled. | p2 | Remove the `draft.model = ""` block; the real fix is C1 in the framework mapper. |
| C3 | `agent-config.ts:199-273` (AgentConfigSchema) vs `to-config.ts:102`, `types.ts:401` | `numCtx` is in `ModelParamsSchema`, builder `_numCtx` state, and `serializeBuilder` output, but **absent from `AgentConfigSchema`**. Cortex's config-path (`cortexParamsToAgentConfig`) therefore cannot thread numCtx even if the UI captured it. Confirms the separate numCtx effort needs a schema field, not just a wither. | p2 | Add `numCtx: Schema.optional(Schema.Number)` to AgentConfigSchema + map it in `agentConfigToBuilder` (into `withModel({ numCtx })`); then add a Cortex param. |
| C4 | `cortex-agent-config.ts:199-201` + `chat-session-service.ts:156` | `streamReasoningSteps` is normalized in `normalizeCortexAgentConfig` and read by desk chat for stream density, but is **never threaded into `buildCortexAgent`/the builder** on the gateway path — dead config for non-chat runs (the normalize branch has no consumer there). | p3 | Either drop the normalize branch for the gateway path, or thread it as the runStream density on gateway runs (gateway currently uses `agent.run`, so density is moot — prefer dropping). |
| C5 | `gateway-process-manager.ts` (entire) vs `withGateway` / `GatewayConfigSchema` (`agent-config.ts:124`) | Cortex is a gateway host but reimplements cron parse + minute-tick + fire loop in-process and never sets `AgentConfig.gateway` or calls `withGateway`. The framework gateway (crons, heartbeat, token-budget policies, webhooks) is entirely unused. | p2 | Drift, likely partly deliberate (in-process scheduling). At minimum adopt `gateway.policies.dailyTokenBudget`/`maxActionsPerHour` and `heartbeat` rather than re-implementing; evaluate `withGateway` for cron. |
| C6 | `build-cortex-agent.ts` (no `withTracing`/`withoutTracing` call) vs `builder.ts:~ _tracingConfig default-ON` | Tracing is default-ON in the builder (for `rax diagnose`), and has no AgentConfig field, so Cortex cannot disable it or set the trace dir per agent. No user-facing control. | p2 | Add a Cortex observability sub-option that maps to `withoutTracing()` / `withTracing(dir)`; needs an AgentConfig field or an overlay flag. |
| C7 | `cortex-agent-config.ts:370-391` `CORTEX_FRAMEWORK_ALLOWED_TOOLS` | Hardcoded builtin/meta tool allowlist duplicates framework tool knowledge; drifts when the framework adds/renames builtins (already carries provisional names like `gws-cli`). Not config-driven. | p3 | Source the baseline builtin set from the framework tool registry instead of a hand-maintained const, or document it as an intentional allow-floor. |
| C8 | `build-cortex-agent.ts:140-142` | `withMemory()` is force-enabled ("legacy parity", possibly deliberate) whenever the desk didn't map memory tiers. Cortex offers **no way to run memory-less** — no surface maps to `withoutMemory()`. Combined with `agentConfigToBuilder` calling `withMemory` when `config.memory` set, memory is effectively always on. | p3 | If memory-less runs are ever wanted, add an opt-out signal; otherwise document the force-on as intentional. |
| C11 | `cortex-to-agent-config.ts:37-42` + `build-cortex-agent.ts:164-165`; vs `ReasoningConfigSchema:34-47`, `MemoryConfigSchema:63-75`, `FallbackConfigSchema:179-183` | **Partial AgentConfig sub-object population** — several framework-mapped fields are unreachable from any Cortex surface: (a) **reasoning** sets only `defaultStrategy`+`enableStrategySwitching`; `maxStrategySwitches`/`fallbackStrategy` have no `BuildCortexAgentParams` field — and the re-merge at `build-cortex-agent.ts:164-165` reads `r?.maxStrategySwitches`/`r?.fallbackStrategy` which are **always undefined** (dead defensive code masquerading as coverage). (b) **memory** maps only `tier`; `maxEntries`/`capacity`/`evictionPolicy`/`retainDays`/`importanceThreshold` (all mapped by `agentConfigToBuilder`) are unreachable. (c) **fallbacks** maps `providers`/`errorThreshold` but not `models`. | p2 (strategy options), p3 (memory/fallbacks) | Add `BuildCortexAgentParams` + AgentConfig-derived fields for `maxStrategySwitches`/`fallbackStrategy` first (task-named "strategy options"); expose the memory tuning + `fallbacks.models` as roadmap. |
| C9 | overlay never calls: `withBudget`, `withCircuitBreaker`/`withoutCircuitBreaker`, `withRateLimiting`, `withCalibration`, `withContextProfile`, `withLeanHarness`, `withHarness`/`withProfile`, `withModelPricing`/`pricingRegistry`, `withChannels`, `withSkillPersistence`, `withCustomTermination`, `withOutputValidator`, `withCostTracking`, `withBehavioralContracts`, `withContract`, `withRequiredTools` | ~18 public withers (verified present in `builder.ts`) Cortex never exposes. Highest-value for a dev console: `withBudget` (token caps), `withCircuitBreaker`/`withRateLimiting` (reliability), `withCalibration` (per-model tool-calling adapt), `withModelPricing` (cost accuracy). | p2 (budget/circuit/rate/calibration/pricing), p3 (rest) | Add Cortex params + AgentConfig fields for the reliability/cost cluster first; treat the rest as roadmap. |
| C10 | `gateway-process-manager.ts:231,247,311,316` + `runner-service.ts:231,246,267` | Several `as any` casts around `result.debrief` and synthetic `DebriefCompleted`/`AgentCompleted` events; comments note "DebriefCompleted not yet wired in the execution engine." Cortex hand-emits framework events. Likely-stale workaround per memory (`getLastDebrief()` accessor shipped). | p3 | Re-check whether the engine now emits DebriefCompleted / `ReactiveAgent.getLastDebrief()` exists; drop the `as any` synthetic-event path if so. |

## Compose Adoption

- **Cortex does not use the Compose API at all.** `grep` for `agentFn`/`@reactive-agents/compose`/`killswitches` in `apps/cortex/server/` returns nothing.
- The framework offers two relevant surfaces built after Cortex:
  - `packages/runtime/src/compose.ts` — `agentFn()`, `pipe()`, `parallel()`, `race()`. `agentFn(config, customize)` takes exactly the `Partial<AgentConfig> & {name,provider}` + a builder-customize callback that Cortex already constructs by hand in the overlay.
  - `packages/compose/src/` — `killswitches` registry (compose killswitches).
- **Where adoption would simplify:** `buildCortexAgent`'s "config + overlay-callback" shape is precisely `agentFn(config, (b) => …overlay…)`. Cortex could replace the bespoke build/run/dispose plumbing in runner + gateway with `agentFn`, getting lazy build + `dispose()` + `.config` introspection for free. The hand-rolled `parallel`/sequencing for agentTools/dynamicSubAgents could lean on `pipe`/`parallel` rather than custom wiring. This is a simplification, not a correctness fix — schedule after C1/C3.

## Recommended Next Passes (prioritized)

1. **C1 + C2 (p1/p2, framework + Cortex):** Fix the temperature/maxTokens drop in `agentConfigToBuilder` (un-gate from `config.model`), then delete Cortex's dead `model:""` sentinel. Single highest-impact correctness fix; add a test that builds with `{temperature:0}` and no model and asserts the builder state carries `0`.
2. **C3 + C6 (p2, schema):** Add `numCtx` (and a tracing toggle representation) to `AgentConfigSchema` + `agentConfigToBuilder`, so config-driven Cortex can thread them — closes the structural blocker behind the separate numCtx effort.
3. **C11 strategy options + C9 reliability/cost cluster (p2):** Expose `maxStrategySwitches`/`fallbackStrategy` (and remove the dead re-merge reads), plus `withBudget`, `withCircuitBreaker`, `withRateLimiting`, `withCalibration`, `withModelPricing` via Cortex params + AgentConfig fields. These are the dev-console-relevant capabilities currently unreachable.
4. **C5 (p2, design):** Decide gateway story — adopt `gateway.policies`/`heartbeat` (token budget, action caps) even if in-process scheduling stays; stop reinventing budget/heartbeat.
5. **Compose adoption (p3, simplification):** Migrate `buildCortexAgent` callers to `agentFn(config, overlay)`; retire bespoke build/run/dispose where it duplicates compose primitives.
6. **C4, C7, C8, C10 (p3, cleanup):** Drop dead `streamReasoningSteps` gateway branch; re-source the tool allow-floor; make memory default opt-out; re-verify and remove stale `DebriefCompleted` `as any` synthetic-event workaround.
