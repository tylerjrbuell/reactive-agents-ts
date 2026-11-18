---
title: API Stability & Versioning
description: >-
  SemVer commitments, stability tiers, what's stable vs experimental as of
  v0.18, and the deprecation policy.
topic: releases
related:
  - guides/whats-new
  - reference/builder-api
---

This page is the honest answer to "is this safe to depend on?"

Reactive Agents follows **Semantic Versioning** (`major.minor.patch`). The framework is currently in `0.x`, which under SemVer means **minor bumps may include breaking changes**. We list each break per release in the [CHANGELOG](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/CHANGELOG.md) and [What's New](/guides/whats-new/) and ship a migration note for anything user-facing. The tiers below say which surfaces are safest: stable-tier surfaces get a deprecation cycle where one is possible; the others can change between minors.

## Stability tiers

Every public surface falls into one of three tiers. The tier is recorded on this page and, per package, in the repo's `stability.json` (each package README repeats it, and a check keeps them equal). Where a single export is less settled than its package, it carries an `@unstable` JSDoc tag. Stable has no per-export tag. A "stable (scoped)" package (`compose`, `llm-provider`, `prompts`, `reasoning`, `runtime`, `tools`) is stable only for the entry points named in the list below; the rest of that package follows the unstable list.

| Tier | Promise | Breaks allowed |
|---|---|---|
| **Stable** | Intended to stay source-compatible across `0.x` minor bumps; exceptions are listed per release. Behavior changes get a deprecation warning + one minor cycle before removal. | Patch versions only fix bugs. |
| **Unstable** | API may change between minor versions with a CHANGELOG note. Suitable for production if you pin exactly. | Yes, between minors, with a migration note. |
| **Experimental** | Active R&D. May change shape between any release. Use at your own risk; expect to update code on each upgrade. | Anytime, including patch. |

## What's stable as of v0.18

The following surfaces are tier-1 stable: the safest to depend on. We aim to keep them source-compatible across `0.x` minors, with a deprecation cycle where possible; any exception is listed in that release's notes.

- **Entry points** — `createAgent(config)` (declarative front door) and `ReactiveAgents.create()` + the `.with*()` chain syntax. Both are the same API in two syntaxes, generated from and validated against `AgentConfigSchema` (the single source of truth); anything expressible in one is expressible in the other.
- **Provider selection** — `.withProvider("anthropic" | "openai" | "gemini" | "groq" | "xai" | "ollama" | "litellm" | "test")`, `.withModel(model)` (string) / `.withModel({ provider, model, numCtx? })` (object), and the `LLMProvider` interface
- **Reasoning core** — `.withReasoning()` with the documented `ReasoningOptions` shape; the canonical strategies — `reactive` (ReAct), `reflexion`, `plan-execute-reflect`, `tree-of-thought`, and `adaptive` (auto-routes among them). `direct` (single-shot) is the no-reasoning fallback. `blueprint` is also registered (aliases: `react` → `reactive`, `rewoo` → `blueprint`; full registry in [Choosing a Reasoning Strategy](/guides/choosing-strategies/)); `code-action` is experimental — see below.
- **Prompt templates** *(scoped, `@reactive-agents/prompts`)* — `.withPrompts()` and the template service API (`PromptService`, template ids and variable interpolation). `ExperimentService` and the wording of the built-in prompts are unstable, see below.
- **Compose API** *(scoped, `@reactive-agents/compose`)* — `.compose()` and the callback form of `.withHarness((h) => ...)` (the same call), the `.on()`, `.tap()`, `.before()`, `.after()`, `.onError()` transforms and hooks, 12-phase composition, tag pattern matching, `RunHandle`, and the `killswitches` helpers (`maxIterations`, `budgetLimit`, `timeoutAfter`, `watchdog`, `requireApprovalFor`). `.withBudget` and the `HarnessConfig` fields of `.withHarness({ ... })` are unstable, see below.
- **Tool surface** — `.withTools()`, `defineTool()` / `tool()`, MCP attachment via `.withMCP()`, and the `Tool` interface
- **Typed structured output** *(new in 0.12)* — `.withOutputSchema(schema, options?)` and the result fields `result.object` / `result.objectError`; `agent.streamObject(task)` yielding `{ object: DeepPartial<T> }`. Standard Schema (Zod / Valibot / ArkType) and Effect Schema are all accepted.
- **Harness composition** *(new in 0.12)* — `HarnessProfile.lean() | balanced() | intelligent()` applied via `.withProfile(...)`. Supersedes `.withLeanHarness()`, which remains functional.
- **Event bus** — All event tags consumed by the public observability layer (`ToolCallStarted`, `ToolCallCompleted`, `LLMExchangeEmitted`, `StrategySwitched`, `VerifierVerdictEmitted`, plus the 30+ tags listed in `event-bus.ts`)
- **Lifecycle hooks** — `.withHook(hook)` accepting a `LifecycleHook` (a plain sync/async function or the Effect form) for the 12 phases and `before` / `after` / `on-error` timings
- **Snapshot & Replay** — `@reactive-agents/replay` package: `loadRecordedRun`, `replay`, `makeReplayController`, `makeReplayToolLayer`, `diffTraces`, `computeArgsHash`. The `ToolCallCompleted` event payload's `args`, `result`, `error`, `resultTruncated` fields are also stable.
- **AgentResult shape** — `.run()` and `.runStream()` return values
- **Raw provider clients** — `AnthropicProviderLive`, `OpenAIProviderLive`, `LocalProviderLive`, `GeminiProviderLive`, `GroqProviderLive`, `XAIProviderLive`, `LiteLLMProviderLive` exported as standalone Effect Layers (you can skip the harness entirely)

## What's unstable as of v0.18

These work, but the **shape may change** in a later minor. Pin exact versions if you depend on them.

- **Channel router** — `.withChannels({ adapters, routes, agents })` and `createChannelRouter` (`@reactive-agents/channels`): flat `RouteSpec` rules, fail-closed access per route, one agent per (route, role), and a `senderTools` surface that defaults to `ReadOnly` for non-owners (mutating, MCP and unclassified tools are removed before the agent is built). The router events (`ChannelRouteMatched`, `ChannelRouteDenied`, `ChannelUnrouted`, `ChannelTurn*`, `ChannelOwnershipChanged`) and `agent.channelRouterStatus()` ship with it. Shipped as "slice one", so the route and adapter shapes are still growing.
- **Structured `request_user_input`** — the `questions` form (text, single/multi-choice, boolean, number) with typed, id-keyed answers, validation errors the agent can retry on, and a typed timeout outcome; the legacy `kind` / `prompt` / `schema` call still works and is normalized to the same shape. Hosts must use `parseRequest` / `validateAnswers` / `timeoutAnswer` to take part.
- **Read-only tool marking** — `mutatesExternalState` on `defineTool` / `ToolDefinition`, `isReadOnlyTool` / `readOnlyTools`, and the MCP server config `readOnly` / `trustAnnotations`. A tool counts as read-only only when it declares so and needs no approval; tools that omit the flag are treated as mutating.
- **Web search explicit keys** — `makeWebSearchHandler({ apiKeys?, providers? })` and `WEB_SEARCH_PROVIDERS`. Explicit per-agent keys win over environment variables; default behavior is unchanged.
- **Pinned fetch** — `fetchPinned` and `resolvePublicUrl` (`@reactive-agents/runtime-shim`): resolve once, validate against the egress blocklist, connect to the validated address, and re-pin every redirect hop (closes the DNS-rebinding gap). Refusals throw the tagged `PublicUrlError`.

- **`KernelHooks` interface** — the inner-loop event taps (`onThought`, `onAction`, `onObservation`, etc.). The 12-phase outer hooks are stable; the inner kernel taps may consolidate.
- **Healing pipeline stages** — `runHealingPipeline` and the 4 built-in stages are exported, but the stage list is not user-extensible yet (no builder for custom stages).
- **Task contracts** — `.withContract(taskContract)` (required/forbidden tools, fixtures, model floor, success oracle) is wired and enforced at `build()`, but the `TaskContract` shape is still growing.
- **Prompt experiments and built-in wording** — `ExperimentService` / `ExperimentServiceLive` (A/B prompt variants, `@unstable`) and the text of the built-in prompts in `@reactive-agents/prompts` may change between minors.
- **Budget killswitch** — `.withBudget({ tokenLimit?, costLimit? })` enforces a cumulative ceiling in-loop; the limits shape may gain fields.
- **Cross-run learning** — `.withLearning({ tier?, dbPath? })` and `.withSkillPersistence(enabled?)` persist experience/skills across runs; the store schema is still settling.
- **Evidence grounding** — `.withGrounding({ mode })` (default off) and the `provenance` / `confidence` / `abstained` result fields.
- **Context curator internals** — `.withContextProfile(...)` is stable; the curator's compression strategy is not user-replaceable yet.
- **Arbitrator** — `.withCustomTermination(predicate)` is stable for boolean overrides; a full `withArbitrator(impl)` for replacing the termination pipeline is not shipped yet.
- **Verifier strategy** — `.withVerification(options)` accepts options today; a replaceable verifier impl is not shipped yet.
- **Cost router policy** — `.withCostTracking()` records spend (stable); the complexity-routing primitives in `@reactive-agents/cost` (`analyzeComplexity`, `routeToModel`) are exported but the policy is not yet a builder method.
- **Strategy switcher** — toggled via `ReasoningOptions.enableStrategySwitching`, which has been off by default since v0.18 (it did not pay for its extra tokens in the 2026-11-05 ablation); the heuristic itself is not replaceable.
- **Calibration field schema** — fields are growing; consumer count is small. Expect additions and possible renames.
- **Harness config object** — `.withHarness({ ... })` with a config object is a separate call from the `.compose()` callback form (typed harness-mechanism settings); its `HarnessConfig` fields are still growing.
- **Durable execution** — `.withDurableRuns()`, `agent.resumeRun(runId)` and `agent.listRuns({ status? })`. Moved down from stable: the durable code kept changing through v0.17 and v0.18. The durable human-in-the-loop gates (see [Durable HITL](/guides/durable-hitl/)) are unstable too.
- **`create-reactive-agent`** — the scaffolder. Templates and generated project shape change with each minor.

## What's experimental as of v0.18

Use at your own risk. Will change.

- **`code-action` strategy** — the LLM emits a TypeScript IIFE run in a Worker sandbox; sandbox contract and tool-binding shape may change
- **`agent.plan()`** — plan-then-execute review (see [Plan then execute](/guides/plan-then-execute/)); new in 0.19
- **`@reactive-agents/identity`** — dormant: no `.withIdentity()` builder method and nothing in the runtime reads it yet
- **`@reactive-agents/judgment`** — opt-in via `.withJudgment()`, added in v0.17
- **`@reactive-agents/reactive-intelligence`** — default-on, but the last ablation is from 2026-05-23; the package stays experimental until it is re-verified
- **A2A protocol surface** (`packages/a2a`) — serving is shipped (`.withA2A()`, `rax serve`) and hardened (request-size cap, bounded task store, egress-guarded discovery), but the wire format and JSON-RPC method names may change as the spec evolves
- **Cortex channel hub** (`apps/cortex`) — one channel router for all messaging channels, with channels and routes stored in the Cortex database, `/api/channels` endpoints and `CORTEX_CHANNEL_HUB=off` to restore per-agent hosting. The storage schema and endpoints are not frozen.
- **Sub-agent delegation API** — the delegation surface (`.withAgentTool()`, `.withRemoteAgent()`, `.withDynamicSubAgents()`) is functional but its shape is still under iteration
- **Reactive observer / entropy scoring tunables** — thresholds, scoring functions
- **Living Skills runtime in Cortex** — UI and persistence schema not finalized
- **MCP registry resolution** — `.withMCP("name")` / `.withMCP(["a","b"])` / `.withMCP("name", options)` resolving a public catalog entry (Docker Hub's `mcp/*` namespace is the first supported registry, chosen via the `registry` option) into a connect-ready server. The digest used by the approval gate is a placeholder (the image name, not a real content digest) until real digest pinning lands; `MCPRegistry` as a pluggable interface is settled, but the registry-id lookup mechanism and additional registries beyond Docker Hub may change shape.

## Deprecation policy

When a stable surface is being replaced:

1. The old API stays functional and gets `@deprecated` JSDoc with a pointer to the replacement
2. A console warning fires at runtime naming the replacement
3. Removal happens **no sooner than** one full minor cycle later (e.g., deprecated in 0.12 → removed earliest in 0.13)
4. The CHANGELOG lists the migration step for every removal

We will **never** silently change the behavior of a stable API. If a bugfix changes observable behavior, it ships behind a flag or in a major bump.

## How to depend on Reactive Agents

| Risk tolerance | Recommendation |
|---|---|
| Production app, low-touch upgrades | Pin patch versions (`"reactive-agents": "0.18.0"`). Consume only stable-tier APIs. |
| Active development, monthly upgrades | Pin minor (`"~0.18.0"`). Read the CHANGELOG before bumping. Unstable surfaces are OK if covered by your tests. |
| Following main, contributing | Pin to a commit SHA or use `workspace:*`. Experimental surfaces are fair game. |

## What we want feedback on

If you've adopted Reactive Agents and want a specific component promoted from unstable to stable, [open an issue](https://github.com/tylerjrbuell/reactive-agents-ts/issues). The promotion criteria are: 30+ days at current shape with no reported design issues, and at least one production user.

We'd rather under-promise on stability today than break your code tomorrow.
