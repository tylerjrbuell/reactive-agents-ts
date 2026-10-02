---
type: register
status: active
created: 2026-10-02
updated: 2026-10-02
tags: [declarative-api, createAgent, agent-config, docs-parity, backlog]
---

# Declarative Config-Key Parity Register

> **Purpose:** track every `ReactiveAgentBuilder` method that has **no declarative
> `createAgent(config)` equivalent** in `AgentConfigSchema` / `agentConfigToBuilder`
> (`packages/runtime/src/agent-config.ts`). When a key is added, the docs pages that
> currently carry a "builder-only" note must be updated to show the dual-syntax tabs.
>
> **Origin:** compiled 2026-10-02 during the dual-syntax tabbed-code rollout across
> `apps/docs/src/content/docs/guides/`. Pattern reference for the doc tabs:
> `apps/docs/src/content/docs/guides/your-first-agent.mdx`.
> Classifications below were verified against `builder.ts` signatures + option types,
> not assumed.

## How to use this register

- **Adding a key:** add it to `AgentConfigSchema`, wire it in `agentConfigToBuilder`,
  regenerate the reference tables (`bun run docs:gen:api`), then update every doc page
  listed in "Doc pages flagging this" to add the Declarative tab, and move the row to
  the Resolved table.
- **The drift gate is the authority:** `packages/runtime/src/config-serialization-drift.test.ts`
  guards the round-trip; anything expressible in the builder should eventually be
  expressible here unless classified Builder-bound below.
- **Docs convention while unresolved:** builder-only examples get a one-line note
  ("functions aren't JSON-serializable" / "no declarative config key exists") — do NOT
  fabricate config keys in doc tabs.

## Class 1 — CANDIDATES: pure/near-pure data, missing config key

These are the actionable backlog. All payloads are serializable (or near-serializable) —
a config key is feasible without API redesign.

| Builder method (evidence: `packages/runtime/src/builder.ts`) | Payload shape | Suggested config key | Doc pages flagging this | Notes |
|---|---|---|---|---|
| `withSkills({paths, activate})` (L2367) | `{ paths: readonly string[]; activate?: readonly string[] }` — fully JSON | `skills: { paths, activate }` | `guides/agent-skills.mdx` | Highest-value gap; skills-as-data is the package's own pitch. |
| `withAgentTool(name, descriptor)` (L784) | descriptor is `{name, description?, provider?, model?, ...}` data — verify `tools`/handler members | `subAgents: [{ ... }]` | `guides/sub-agents.md` | Declarative sub-agent specs. Check descriptor for function members before wiring. |
| `withDynamicSubAgents(options)` (L812) | `{ maxIterations?, maxRecursionDepth? }` — JSON | fold into `subAgents.dynamic` | `guides/sub-agents.md` | Trivial once `subAgents` exists. |
| `withMetaTools(config)` (L2401) | `MetaToolsConfig` — boolean flags + nested data configs (`runtime/src/types.ts:1008`) | `tools.metaTools` or top-level `metaTools` | `guides/production-checklist.mdx`, `guides/tools.md` | Verify `harnessSkill`/`findConfig`/`pulseConfig`/`recallConfig` leaves have no functions. |
| `withContract(contract)` (L2123) | `TaskContract` (`packages/core/src/contracts/task-contract.ts:95`) — typed data | `contract` | docs on deliverables/contract (features/harness-control) | Cross-check `outputSchemaOptions` precedent (options serialize, schema objects don't). |
| `withModelRouting(options)` (L1270) | `ModelRoutingOptions` — model-ID strings | `modelRouting` | `guides/cost-optimization.mdx` | Cost-aware routing tier pins are pure data. |
| `withCalibration(mode)` (L572) | `CalibrationMode = "auto" \| "skip" \| ModelCalibration` — literal union plus a plain-data object (`runtime/src/types.ts:27`) | `calibration` | — | Trivial; JSON-safe including the object arm. |
| `withEnvironment(context)` (L718) | `Record<string, string>` — JSON | `environment` | — | Trivial. |
| `withRemoteAgent(name, url)` (L831) | two strings | `remoteAgents: [{ name, url }]` | `features/a2a-protocol.md` | Pairs naturally with `withA2A`. |
| `withA2A(options)` (L734) | `A2AOptions` — verify leaves are data | `a2a` | `features/a2a-protocol.md` | |
| `withChannels(config)` (L766) | `ChannelsConfig` — webhook/transport config data | `channels` (note: gateway config already renamed `channels` → `accessControl`, pick non-colliding placement) | `guides/messaging-channels.mdx` | Page currently declares messaging features declaratively via `gateway.*` only. |
| `withJudgment(options)` (L1113) | `JudgmentBuilderOptions` — apiKey/baseUrl/model/timeoutMs/confidenceFloor (secrets caveat) | `judgment` | features/judgment-layer.md | Same apiKey-in-config caveat as provider keys (env-var interpolation expected). |
| `withLlmTimeout(ms)` (L2153) | number | `execution.llmTimeoutMs` | `guides/production-checklist.mdx` | `execution.timeoutMs` exists; LLM-call-level timeout missing. |
| `withLazyValidation()` (L2096) | toggle | `execution.strictValidation: false` (tri-state, see Class 3) | — | Currently only "strict" is expressible. |
| `withLeanHarness()` (L1488) | toggle | likely redundant with `profile: "lean"` — verify equivalence, then deprecate or alias | — | |
| `withUserInteraction()` (L1321) | no-arg enable | `features.userInteraction` | — | Trivial flag. |
| `withEvents()` (L1889) | no-arg enable | `features.events` | — | Trivial flag. |
| `withCortex(url?)` (L1674) | optional string; `observability.cortex` boolean exists | extend `observability.cortex` to `boolean \| { url }` | features/cortex.mdx | Partial today: URL pin is builder-only. |
| `withLearning({tier, dbPath})` (L985) | data, overlaps `memory.experienceLearning` | clarify semantics vs `memory` then expose or deprecate | — | Possible duplicate surface — audit before adding a key. |
| `withContextProfile(profile)` (L1909) | `Partial<ContextProfile>` data, but a cross-field overlay | `contextProfile` or fold into `profile` | `guides/local-models.mdx`, `guides/context-engineering.md` | Overlay `kind` per `capability/builder-methods.ts`; profile-precedence rules needed if config-exposed. |
| `withBehavioralContracts(contract)` (L1810) | `BehavioralContract` (guardrails) — inspect for predicate functions | `guardrails.behavioralContracts` if data-only | `guides/guardrails.mdx`, `guides/security-hardening.md` | |
| `withTestScenario(turns)` (L2062) | `TestTurn[]` = `{match?, text}` — JSON-able | `testScenario` | `guides/your-first-agent.mdx` (currently noted builder-only) | Low priority: config files carrying mock responses is unusual but harmless; enables declarative fixture-driven examples. |
| `withReceiptSigning(options)` (L1158) | `{ privateKeyJwk: JsonWebKey }` — JSON but a SECRET | prefer `receiptSigning: { privateKeyPath }` (indirection), never inline key material | features/process-model.md | Security review required before any config key lands. |

## Class 2 — HYBRID: declarative subset possible, function members stay builder

| Builder method | Data members (declarable) | Function/code members (builder-bound) | Doc pages flagging this |
|---|---|---|---|
| `withApprovalPolicy(policy)` (L1756) — `AuthoredApprovalPolicy = Partial<ConfiguredApprovalPolicy>` | `mode: "block" \| "detach"` | `requireFor`, `onApprove` predicates — could gain declarative sugar: `requireForTools: string[]` | `guides/durable-hitl.md`, `guides/production-checklist.mdx` |
| `withMCP(servers)` — `mcpServers` key EXISTS | name/transport/command/args/env round-trip | OAuth `auth`/`tokenStore` callback has no schema fields | `guides/tools.mdx` (MCP OAuth blocks) |
| `withReasoning(options)` — `reasoning` key EXISTS | defaultStrategy, switching, fallbackStrategy, auditRationale, harness | `adaptive: { enabled }` sub-flag and per-strategy `strategies.*` bundles are in builder `ReasoningOptions` but NOT in `ReasoningConfigSchema` | `guides/choosing-strategies.mdx`, `guides/reasoning.mdx` |
| `withMemory(...)` — `memory` key EXISTS | tier/dbPath/capacity/eviction... | `memoryConsolidation` expressible only as boolean; custom thresholds builder-only | `guides/memory.mdx` |
| `withOutputSchema(schema, options)` | `outputSchemaOptions` key EXISTS | schema objects are not JSON — permanent (documented in `AgentConfigSchema` comment, L418-425) | `guides/structured-output.mdx` |
| `withTools(options)` + programmatic tools | allowedTools/focusedTools/builtins/terminal round-trip | `defineTool()` registrations, `adaptFunction`, ToolBuilder — permanent | `guides/tools.mdx`, cookbook |

## Class 3 — DESIGN GAP: tri-state booleans

`features.*` and toggle keys are checked truthy-only in `agentConfigToBuilder`; an
explicit `false` cannot disable a default-on capability (`withoutMemory` L956,
`withoutObservability` L1658, `withoutCircuitBreaker` L1414 IS covered via
`circuitBreaker: false`, but memory/observability are not). Fix by making the relevant
keys tri-state (`boolean | undefined` with `=== false` → call the `without*` method).

## Class 4 — BUILDER-BOUND FOREVER (functions/layers/live objects; no config key planned)

`compose`, `withHook` (handlers), `withErrorHandler`, `withCustomTermination`,
`withToolIntent`, `withOutputValidator`, `withVerificationStep`, `withLayers`,
`withReplayLLM`, `withDynamicPricing` (takes a `PricingProvider` interface),
`withTestScenario` if Class-1 route is declined, `withOutputSchema` (schema itself),
programmatic tool registration (`defineTool`), `agent.fork`/`attach` (process model, not
construction).

Doc pages should keep a one-line "builder-only: functions aren't serializable" note for
these; they are NOT parity failures.

## Verification commands (for whoever picks this up)

```bash
# The crosswalk (source of truth): grep config.* inside agentConfigToBuilder
sed -n '536,825p' packages/runtime/src/agent-config.ts | grep -oE 'config\.[a-zA-Z0-9]+' | sort -u
# Builder surface census:
grep -oE '^    (with|compose)[A-Za-z0-9]*\(' packages/runtime/src/builder.ts | sort -u
# Generated reference tables (must be regenerated after adding keys):
bun run docs:gen:api
# Doc examples gate (tabs must typecheck against the real schema):
bun run scripts/check-doc-examples.ts <changed-doc-basename>
```

## Resolved

| Date | Key added | Builder method | Docs updated |
|---|---|---|---|
| _(none yet)_ | | | |
