---
title: API Stability & Versioning
description: SemVer commitments, stability tiers, what's stable vs experimental in v0.10, and the deprecation policy.
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

## What's stable in v0.10

The following surfaces are tier-1 stable. We will not break these without a major bump.

- **Builder entry point** — `ReactiveAgents.create()` and the `.with*()` chain syntax
- **Provider selection** — `.withProvider("anthropic" | "openai" | "google" | "ollama" | "litellm" | "local")` and the `LLMProvider` interface
- **Reasoning core** — `.withReasoning()` with the documented `ReasoningOptions` shape; the five strategies (`ReAct`, `Reflexion`, `Plan-Execute`, `Tree-of-Thought`, `Adaptive`)
- **Tool surface** — `.withTools()`, `defineTool()`, MCP attachment via `.withMCP()`, and the `Tool` interface
- **Event bus** — All event tags consumed by the public observability layer (`ToolCallStarted`, `ToolCallCompleted`, `LLMExchangeEmitted`, `StrategySwitched`, `VerifierVerdictEmitted`, plus the 30+ tags listed in `event-bus.ts`)
- **Lifecycle hooks** — `.withHook(phase, timing, fn)` for the 12 phases and `before` / `after` / `on-error` timings
- **Compose API** — `.compose()` (alias: `.withHarness()`) for harness composition; `.on()`, `.tap()`, `.before()`, `.after()`, `.onError()` transforms and hooks; all 12-phase composition and tag pattern matching
- **AgentResult shape** — `.run()` and `.runStream()` return values
- **Raw provider clients** — `AnthropicProviderLive`, `OpenAIProviderLive`, `LocalProviderLive`, `GeminiProviderLive`, `LiteLLMProviderLive` exported as standalone Effect Layers (you can skip the harness entirely)

## What's `@unstable` in v0.10

These work, but the **shape may change** in `0.11`. Pin exact versions if you depend on them.

- **`KernelHooks` interface** — the inner-loop event taps (`onThought`, `onAction`, `onObservation`, etc.). The 12-phase outer hooks are stable; the inner kernel taps may consolidate.
- **Healing pipeline stages** — `runHealingPipeline` and the 4 built-in stages are exported, but the stage list is not user-extensible yet. A `.withHealing(stages)` builder is planned for 0.11.
- **Context curator internals** — `withContextProfile` is stable; the curator's compression strategy is not user-replaceable yet.
- **Arbitrator** — `withCustomTermination(predicate)` is stable for boolean overrides; full `withArbitrator(impl)` for replacing the termination pipeline is Phase 2.
- **Verifier strategy** — `withVerification(options)` accepts options today; replaceable verifier impl is Phase 2.
- **Cost router policy** — `withCostTracking()` records spend (stable); routing policy itself is not user-replaceable yet.
- **Strategy switcher heuristic** — toggleable via `ReasoningOptions.strategySwitching` (stable); the heuristic itself is not yet replaceable.
- **Calibration field schema** — fields are growing; consumer count is small. Expect additions and possible renames.

## What's `@experimental` in v0.10

Use at your own risk. Will change.

- **A2A protocol surface** (`packages/a2a`) — wire format and JSON-RPC method names may change as the spec evolves
- **Reactive observer / entropy scoring tunables** — thresholds, scoring functions
- **Living Skills runtime in Cortex** — UI and persistence schema not finalized
- **Sub-agent delegation API** — `.withSubAgents()` shape under iteration

## Deprecation policy

When a stable surface is being replaced:

1. The old API stays functional and gets `@deprecated` JSDoc with a pointer to the replacement
2. A console warning fires at runtime (suppressible via `RA_SUPPRESS_DEPRECATION=1`)
3. Removal happens **no sooner than** one full minor cycle later (e.g., deprecated in 0.11 → removed earliest in 0.12)
4. The CHANGELOG lists the migration step for every removal

We will **never** silently change the behavior of a stable API. If a bugfix changes observable behavior, it ships behind a flag or in a major bump.

## How to depend on Reactive Agents

| Risk tolerance | Recommendation |
|---|---|
| Production app, low-touch upgrades | Pin patch versions (`"reactive-agents": "0.10.2"`). Consume only `@stable` APIs. |
| Active development, monthly upgrades | Pin minor (`"~0.10.0"`). Read the CHANGELOG before bumping. `@unstable` OK if covered by your tests. |
| Following main, contributing | Pin to a commit SHA or use `workspace:*`. `@experimental` is fair game. |

## What we want feedback on

If you've adopted Reactive Agents and want a specific component promoted from `@unstable` to `@stable`, [open an issue](https://github.com/tylerjrbuell/reactive-agents-ts/issues). The promotion criteria are: 30+ days at current shape with no reported design issues, and at least one production user.

We'd rather under-promise on stability today than break your code tomorrow.
