---
title: API Stability & Versioning
description: >-
  SemVer commitments, stability tiers, what's stable vs experimental in v0.12,
  and the deprecation policy.
---

This page is the honest answer to "is this safe to depend on?"

Reactive Agents follows **Semantic Versioning** (`major.minor.patch`). The framework is currently in `0.x`, which under SemVer means **minor bumps may include breaking changes** to anything not marked stable below. We document each break in the [CHANGELOG](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/CHANGELOG.md) and ship a migration note for anything user-facing.

## Stability tiers

Every public surface falls into one of three tiers. Tier is declared by JSDoc tag on the export — `@stable`, `@unstable`, `@experimental` — and summarized below.

| Tier | Promise | Breaks allowed |
|---|---|---|
| **Stable** (`@stable`) | Source-compatible across `0.x` minor bumps. Behavior changes get a deprecation warning + one minor cycle before removal. | Patch versions only fix bugs. |
| **Unstable** (`@unstable`) | API may change between minor versions with a CHANGELOG note. Suitable for production if you pin exactly. | Yes, between minors, with a migration note. |
| **Experimental** (`@experimental`) | Active R&D. May change shape between any release. Use at your own risk; expect to update code on each upgrade. | Anytime, including patch. |

## What's stable in v0.12

The following surfaces are tier-1 stable. We will not break these without a major bump.

- **Entry points** — `createAgent(config)` (declarative front door) and `ReactiveAgents.create()` + the `.with*()` chain syntax. Both are the same API in two syntaxes, generated from and validated against `AgentConfigSchema` (the single source of truth); anything expressible in one is expressible in the other.
- **Provider selection** — `.withProvider("anthropic" | "openai" | "google" | "groq" | "xai" | "ollama" | "litellm" | "local")`, `.withModel(model)` (string) / `.withModel({ provider, model, numCtx? })` (object), and the `LLMProvider` interface
- **Reasoning core** — `.withReasoning()` with the documented `ReasoningOptions` shape; the five canonical strategies — `reactive` (ReAct), `reflexion`, `plan-execute-reflect`, `tree-of-thought`, and `adaptive` (auto-routes among them). `direct` (single-shot) is the no-reasoning fallback.
- **Tool surface** — `.withTools()`, `defineTool()` / `tool()`, MCP attachment via `.withMCP()`, and the `Tool` interface
- **Typed structured output** *(new in 0.12)* — `.withOutputSchema(schema, options?)` and the result fields `result.object` / `result.objectError`; `agent.streamObject(task)` yielding `{ object: DeepPartial<T> }`. Standard Schema (Zod / Valibot / ArkType) and Effect Schema are all accepted.
- **Durable execution** *(new in 0.12)* — `.withDurableRuns()` plus `agent.resumeRun(runId)` and `agent.listRuns({ status? })`
- **Harness composition** *(new in 0.12)* — `HarnessProfile.lean() | balanced() | intelligent()` applied via `.withProfile(...)`. Supersedes `.withLeanHarness()`, which remains functional.
- **Event bus** — All event tags consumed by the public observability layer (`ToolCallStarted`, `ToolCallCompleted`, `LLMExchangeEmitted`, `StrategySwitched`, `VerifierVerdictEmitted`, plus the 30+ tags listed in `event-bus.ts`)
- **Lifecycle hooks** — `.withHook(hook)` accepting a `LifecycleHook` (a plain sync/async function or the Effect form) for the 12 phases and `before` / `after` / `on-error` timings
- **Compose API** — `.compose()` (alias: `.withHarness()`) for harness composition; `.on()`, `.tap()`, `.before()`, `.after()`, `.onError()` transforms and hooks; all 12-phase composition and tag pattern matching
- **Snapshot & Replay** — `@reactive-agents/replay` package: `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`. The `ToolCallCompleted` event payload's `args`, `result`, `error`, `resultTruncated` fields are also stable.
- **AgentResult shape** — `.run()` and `.runStream()` return values
- **Raw provider clients** — `AnthropicProviderLive`, `OpenAIProviderLive`, `LocalProviderLive`, `GeminiProviderLive`, `GroqProviderLive`, `XAIProviderLive`, `LiteLLMProviderLive` exported as standalone Effect Layers (you can skip the harness entirely)

## What's `@unstable` in v0.12

These work, but the **shape may change** in a later minor. Pin exact versions if you depend on them.

- **`KernelHooks` interface** — the inner-loop event taps (`onThought`, `onAction`, `onObservation`, etc.). The 12-phase outer hooks are stable; the inner kernel taps may consolidate.
- **Healing pipeline stages** — `runHealingPipeline` and the 4 built-in stages are exported, but the stage list is not user-extensible yet (no builder for custom stages).
- **Task contracts** — `.withContract(taskContract)` (required/forbidden tools, fixtures, model floor, success oracle) is wired and enforced at `build()`, but the `TaskContract` shape is still growing.
- **Budget killswitch** — `.withBudget({ tokenLimit?, costLimit? })` enforces a cumulative ceiling in-loop; the limits shape may gain fields.
- **Cross-run learning** — `.withLearning({ tier?, dbPath? })` and `.withSkillPersistence(enabled?)` persist experience/skills across runs; the store schema is still settling.
- **Evidence grounding** — `.withGrounding({ mode })` (default off) and the `provenance` / `confidence` / `abstained` result fields.
- **Context curator internals** — `.withContextProfile(...)` is stable; the curator's compression strategy is not user-replaceable yet.
- **Arbitrator** — `.withCustomTermination(predicate)` is stable for boolean overrides; a full `withArbitrator(impl)` for replacing the termination pipeline is not shipped yet.
- **Verifier strategy** — `.withVerification(options)` accepts options today; a replaceable verifier impl is not shipped yet.
- **Cost router policy** — `.withCostTracking()` records spend (stable); the complexity-routing primitives in `@reactive-agents/cost` (`analyzeComplexity`, `routeToModel`) are exported but the policy is not yet a builder method.
- **Strategy switcher heuristic** — toggleable via `ReasoningOptions.strategySwitching` (stable); the heuristic itself is not yet replaceable.
- **Calibration field schema** — fields are growing; consumer count is small. Expect additions and possible renames.

## What's `@experimental` in v0.12

Use at your own risk. Will change.

- **`code-action` strategy** — the LLM emits a TypeScript IIFE run in a Worker sandbox; sandbox contract and tool-binding shape may change
- **A2A protocol surface** (`packages/a2a`) — wire format and JSON-RPC method names may change as the spec evolves
- **Sub-agent delegation API** — the delegation surface (`.withAgentTool()`, `.withRemoteAgent()`, `.withDynamicSubAgents()`) is functional but its shape is still under iteration
- **Reactive observer / entropy scoring tunables** — thresholds, scoring functions
- **Living Skills runtime in Cortex** — UI and persistence schema not finalized

## Deprecation policy

When a stable surface is being replaced:

1. The old API stays functional and gets `@deprecated` JSDoc with a pointer to the replacement
2. A console warning fires at runtime (suppressible via `RA_SUPPRESS_DEPRECATION=1`)
3. Removal happens **no sooner than** one full minor cycle later (e.g., deprecated in 0.12 → removed earliest in 0.13)
4. The CHANGELOG lists the migration step for every removal

We will **never** silently change the behavior of a stable API. If a bugfix changes observable behavior, it ships behind a flag or in a major bump.

## How to depend on Reactive Agents

| Risk tolerance | Recommendation |
|---|---|
| Production app, low-touch upgrades | Pin patch versions (`"reactive-agents": "0.11.2"`). Consume only `@stable` APIs. |
| Active development, monthly upgrades | Pin minor (`"~0.11.0"`). Read the CHANGELOG before bumping. `@unstable` OK if covered by your tests. |
| Following main, contributing | Pin to a commit SHA or use `workspace:*`. `@experimental` is fair game. |

## What we want feedback on

If you've adopted Reactive Agents and want a specific component promoted from `@unstable` to `@stable`, [open an issue](https://github.com/tylerjrbuell/reactive-agents-ts/issues). The promotion criteria are: 30+ days at current shape with no reported design issues, and at least one production user.

We'd rather under-promise on stability today than break your code tomorrow.
