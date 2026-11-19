---
title: Core, model and profiles
description: >-
  Builder reference for identity, prompts, model and provider selection, HarnessProfile presets and harness-level toggles.
sidebar:
  order: 2
topic: config-reference
related:
  - reference/builder-api
  - reference/configuration
  - guides/choosing-a-stack
---

Methods that decide who the agent is and which model runs it: identity and prompts, model and provider, and the profile and harness toggles that set the baseline capability set. Part of the [builder reference](/reference/builder-api/).

## Identity & prompts

| Method             | Signature                                   | Description                                                                                             |
| ------------------ | ------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `withName`         | `(name: string) => this`                    | Display name / `agentId` basis                                                                          |
| `withAgentId`      | `(id: string) => this`                      | Pin a **stable** `agentId` instead of the generated `${name}-${Date.now()}`. All memory and run data keyed on `agentId` accumulates across builds that share the ID (e.g. a UUID or Cortex session ID) |
| `withPersona`      | `(persona: AgentPersona) => this`           | Structured steering: `{ name?, role?, background?, instructions?, tone? }`                              |
| `withSystemPrompt` | `(prompt: string) => this`                  | Custom system prompt; if persona is set, persona text is prepended                                      |
| `withEnvironment`  | `(context: Record<string, string>) => this` | Extra key/value context merged into the system prompt (framework already injects date/time/tz/platform) |

## Model & Provider

| Method         | Signature                                                                                    | Description                                                                |
| -------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `withModel`    | `(model: string, params?: Omit<ModelParams, "model">) => this`                               | Set the LLM model by name (e.g., `"claude-sonnet-4-6"`), optionally with `thinking`, `temperature`, `maxTokens`, `numCtx` |
| `withModel`    | `(params: ModelParams) => this`                                                              | Set model with advanced parameters: `thinking`, `temperature`, `maxTokens`, `numCtx`. `model` may be omitted to keep the provider default |
| `withThinking` | `(options?: boolean \| ThinkingOptions) => this`                                             | Enable native thinking / reasoning mode with optional effort + budget. The rich-config home for thinking; `.withModel({ thinking })` remains the quick boolean. `true` / absent enables, `false` disables, or pass `{ effort, budgetTokens }`. Off unless enabled. |
| `withProvider` | `(provider: "anthropic" \| "openai" \| "ollama" \| "gemini" \| "groq" \| "xai" \| "litellm" \| "test") => this` | Set the LLM provider                                                       |

### ModelParams

```typescript
interface ModelParams {
    model: string // Model identifier (provider-specific)
    thinking?: boolean // Enable thinking/reasoning mode (auto-detected if omitted)
    temperature?: number // Sampling temperature 0.0–1.0
    maxTokens?: number // Maximum output tokens
    numCtx?: number // Exact provider context window (Ollama num_ctx); ignored by providers without a context knob
}
```

<!-- docs-skip-typecheck -->
```typescript
// String form — simple model selection
.withModel("claude-opus-4-8")

// ModelParams form — local model with thinking mode
.withModel({ model: "qwen3:14b", thinking: true, temperature: 0.7 })

// ModelParams form — cap token budget
.withModel({ model: "gpt-4o", maxTokens: 2048 })

// ModelParams form — pin the exact context window sent to the provider
.withModel({ model: "qwen3:14b", numCtx: 32768 })

// (model, params) form — same as the line above
.withModel("qwen3:14b", { numCtx: 32768 })
```

Both forms accept only the `ModelParams` keys listed above. A key outside that
list (for example `provider`, which belongs in `.withProvider()`), a
wrongly-shaped argument, or a second argument after a params object throws
`ModelOptionError` (exported from `reactive-agents`) when the builder method is
called, so a typo fails at the call site instead of being silently dropped.

`numCtx` overrides the assumed/maximum context length with the exact window the
provider receives. Honored by providers that expose a context-window knob
(Ollama maps it to `num_ctx`); cloud providers that don't expose one ignore it.
It is also a first-class [`AgentConfig`](/reference/configuration/) field, so it
round-trips through `toConfig()` / `fromJSON()` and the config-driven path.

### ThinkingOptions

`.withThinking()` is the rich-config home for native reasoning mode across all
providers. `.withModel({ thinking: true })` remains the quick boolean shortcut.
Thinking stays **off unless explicitly enabled** — `undefined` never
auto-enables.

```typescript
interface ThinkingOptions {
    enabled?: boolean // Tri-state mirror of the thinking flag
    effort?: "low" | "medium" | "high" // OpenAI reasoning_effort; advisory for other providers
    budgetTokens?: number // Explicit thinking budget in tokens (still clamped)
}
```

<!-- docs-skip-typecheck -->
```typescript
// Boolean form — enable / disable
.withThinking()            // enable
.withThinking(false)       // disable

// Rich form — effort + budget
.withThinking({ effort: "high", budgetTokens: 4096 })
```

## Profiles, harness and prompts

| Method                               | Description                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `withProfile(profile)`               | Apply a `HarnessProfile` preset (`lean()` / `balanced()` / `intelligent()`) — the canonical one-line capability composition. Later `.withX()` calls override the preset.                                                                                                                                                                                                                                       |
| `withHarness(fn)`                    | Alias for `.compose(fn)` — attach a harness transform over tagged chokepoints. See [Compose API](/reference/compose-api/).                                                                                                                                                                                                                                                                                    |
| `withLeanHarness()`                  | Disable the default harness capabilities. **Superseded by `HarnessProfile.lean()`**, which additionally disables reactive intelligence (this method does not). Still functional.                                                                                                                                                                                                                              |
| `withCalibration(mode, options?)`    | Per-model calibration. `mode`: `"auto"` (shipped calibration for the model id), `"skip"` (no lookup; honored even when reasoning is on) or a `ModelCalibration` object (used as given; `options` ignored). `options`: `{ learned?: boolean; community?: boolean }`, both default `false` (opt-in tiers: local run observations, and a community profile fetch). When unset, `"auto"` applies if reasoning is on and both tiers stay off. There is no `"off"` mode. See [Model Calibration](/features/llm-providers/#model-calibration). |
| `withAdaptiveHarness()`              | **Opt-in and experimental.** Mode toggle (no arguments). A policy compiler derives the run's harness (strategy, budget class, guard/horizon profile, tool surface, memory posture) at run-start from the model's capability tier + calibration, the compiled contract's horizon, and the task classification; the plan supplies DEFAULTS while any explicit `.withX()` you set OVERRIDES the corresponding field. Mid-run it recompiles on live progress evidence — deepening scaffolding when the run struggles, leaning when it flows. **Under active validation:** the cross-tier ablation was inconclusive (n=1 dev-hardware noise), so it is **not default-on** and sits under the project lift-gate veto. Zero cost when not called. |
| `withPrompts(options?)`              | `{ templates?: PromptTemplate[] }`                                                                                                                                                                                                                                                                                                                                                                           |
