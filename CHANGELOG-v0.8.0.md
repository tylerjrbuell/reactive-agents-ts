# Changelog — v0.8.0

**Release Date:** March 15, 2026
**Test Count:** 1,773 (v0.7.5) → 2,194 tests across 288 files (+421 tests, +71 files)
**Packages:** 22 packages + 2 apps

---

## New Features

### Reactive Intelligence Layer (`@reactive-agents/reactive-intelligence`) — NEW PACKAGE

The headline feature of v0.8.0: a complete entropy-aware intelligence pipeline that monitors agent reasoning quality in real time and takes corrective action automatically.

#### Phase 1 — Entropy Sensor
- **5 entropy source scorers**: Token entropy (logprob distribution), structural entropy (response format consistency), semantic entropy (meaning drift via cosine similarity), behavioral entropy (action pattern repetition), and context pressure (budget consumption rate). Each scorer produces a normalized 0–1 signal.
- **Composite entropy scorer** with adaptive weights that combines all 5 sources into a single entropy reading, adjusting source importance based on data availability.
- **Entropy trajectory classifier** that analyzes entropy over time and classifies the trend as converging, flat, diverging, v-recovery, or oscillating — enabling forward-looking decisions rather than point-in-time checks.
- **Model registry** with prefix-match fallback for per-model calibration parameters (temperature baselines, token budget norms).
- **Conformal calibration** with SQLite persistence — learns per-model prediction intervals from historical runs so entropy thresholds adapt to each model's characteristics.
- **EntropySensorService** Effect-TS service with full builder integration via `.withReactiveIntelligence()`.
- **65-example validation dataset** with accuracy gates to verify scorer quality.

#### Phase 2 — Reactive Controller
- **Early-stop evaluator (2A)**: Detects when the agent has converged on a stable answer and can stop early, saving tokens and time.
- **Context compression evaluator (2C)**: Triggers context compaction when pressure scores indicate the context window is becoming saturated.
- **Strategy switch evaluator (2D)**: Recommends switching reasoning strategies (e.g., ReAct to plan-execute-reflect) when entropy patterns indicate the current strategy is stuck.
- **ReactiveControllerService** wired into the KernelRunner so all evaluators run automatically after each reasoning step.

#### Phase 3 — Learning Engine
- **Thompson Sampling bandit** with SQLite-backed persistence for choosing optimal strategies per task category. Learns from success/failure outcomes across runs.
- **Task category classifier** using keyword heuristics to bucket tasks (coding, research, analysis, etc.) for per-category learning.
- **Conformal calibration updates** — the learning engine feeds completed run data back into the calibration model to improve entropy threshold accuracy over time.
- **Skill synthesis** — extracts reusable procedural patterns from successful runs.

#### Phase 4 — Telemetry Client
- **RunReport types** defining the structured telemetry payload (entropy readings, strategy decisions, outcome metrics).
- **Fire-and-forget POST** to `api.reactiveagents.dev` with HMAC-signed payloads for tamper resistance.
- **Install-ID generation** for anonymous, per-installation identification (no PII collected).
- **First-run notice** informing users about telemetry on initial use.

#### KernelRunner Integration
- EntropySensorService runs post-kernel scoring on every reasoning iteration, making entropy data available to the controller evaluators without any user configuration beyond `.withReactiveIntelligence()`.

#### EventBus-Driven Entropy Scoring
- **Unified entropy scoring across ALL reasoning strategies** via EventBus subscriber. Subscribes to `ReasoningStepCompleted` events and scores thoughts, covering strategies like plan-execute-reflect that bypass the kernel-runner's inline scoring.
- Deduplication with kernel-runner inline scoring via `(taskId, iteration)` pair tracking — no double-scoring.
- Zero strategy modifications required — works automatically for any current or future strategy that publishes `ReasoningStepCompleted` events.

#### Telemetry Pipeline Integration
- **RunReport telemetry** automatically built and sent post-execution. Includes entropy trace, strategy used, tools called, outcome, and timing.
- Telemetry data feeds into `api.reactiveagents.dev` for aggregate model performance profiles.
- Gated on `enableReactiveIntelligence` — no data sent unless opted in.

---

### Test Scenario Provider (`withTestScenario`)
- **`withTestScenario(TestTurn[])`** replaces the old `withTestResponses` API for deterministic testing. Each turn can be a `text`, `toolCall`, `toolCalls`, `json`, or `error` response, with optional match guards for conditional responses.
- Automatically sets the provider to `"test"` and wires through RuntimeOptions and the builder.
- Enables tool loop testing — define multi-turn sequences where the test LLM requests tools and receives results, verifying the full ReAct cycle.
- All existing tests migrated from `withTestResponses` to `withTestScenario`.

---

### Adoption Readiness — Builder Hardening

- **`withStrictValidation()`**: Throws at build time if required configuration (provider, model) is missing, rather than failing silently at runtime.
- **`withTimeout(ms)`**: Sets an execution timeout that is enforced at the runtime level — agents that exceed the timeout are terminated cleanly.
- **`withRetryPolicy({ maxRetries, backoffMs })`**: Configures automatic retry on transient LLM errors with configurable backoff interval in milliseconds.
- **`withCacheTimeout(ms)`**: Sets the TTL for the semantic cache, controlling how long cached LLM responses remain valid.
- **`withGuardrails({ injectionThreshold, piiThreshold, toxicityThreshold })`**: Consolidated guardrail configuration replacing separate threshold parameters.
- **`withErrorHandler((err, ctx) => ...)`**: Global error callback for logging, monitoring, or alerting on agent errors.
- **`withFallbacks({ providers, models, errorThreshold })`**: Provider and model fallback chain — if the primary provider fails N times, automatically switches to the next.
- **`withLogging({ level, format, output })`**: Structured logging with level filtering, JSON or text format, and file output with rotation.
- **`withHealthCheck()`**: Enables `agent.health()` probe returning `{ status, checks }` for readiness monitoring.
- **`errorContext()` and `unwrapErrorWithSuggestion()`** added to all error types for better developer debugging experience.
- **Deprecated string memory tiers** in favor of structured configuration.

---

### Strategy Switching
- **Automatic strategy switching** via `.withReasoning({ enableStrategySwitching: true })` — when loop detection or entropy analysis indicates the current reasoning strategy is stuck, the agent automatically switches to a fallback strategy (e.g., ReAct to plan-execute-reflect).
- **`onStrategySwitchEvaluated` hook** for observability into switch decisions.
- **`onIterationProgress` hook** emits `IterationProgress` events with current iteration count and max iterations on every step.

---

### Session Persistence (`SessionStoreService`)
- **SQLite-backed chat session persistence** via `SessionStoreService` — conversations with `agent.chat()` and `agent.session()` are now durable across process restarts.
- Wired into the runtime layer and builder with session persistence configuration.
- `AgentSession.onSave` callback for custom persistence hooks.

---

### FallbackChain (`@reactive-agents/llm-provider`)
- **`FallbackChain`** for graceful provider/model degradation — define a prioritized list of providers and models, and the chain automatically falls back on errors.
- Tracks error counts per provider and switches when the threshold is exceeded.

---

### ToolBuilder Fluent API
- **`ToolBuilder`** provides a fluent, chainable API for defining tools without writing raw JSON Schema objects. Reduces boilerplate and improves type safety for tool definitions.

---

### Structured Logger (`makeLoggerService`)
- **`makeLoggerService()`** creates a structured logging service with configurable level filtering (debug/info/warn/error), JSON or text format output, file output support, and automatic log rotation.

---

### Stream Testing (`expectStream`)
- **`expectStream()`** assertion helpers for testing streaming agents — verify event sequences, text deltas, and completion events in test scenarios.
- Scenario fixtures for error path testing (stream cancellation, provider failures).

---

### Observability Dashboard Upgrade
- **Rewrote `formatMetricsDashboard()`** using `chalk` and `boxen` for professional terminal UI with colored borders, aligned columns, and proper box drawing.
- **New "Reasoning Signal" section** displaying entropy metrics: grade (A–F), signal status (converged/flat/diverging/oscillating), actionable summary in plain English, efficiency metric (tokens per % entropy reduced), source breakdown, per-iteration sparkline with bar charts, and specific recommendations based on signal patterns.
- **Entropy-informed alerts**: diverging entropy warning, flat+high loop detection, low entropy success confirmation.
- Fixed border alignment issues with emoji icons.
- CLI `demo.ts` wired to use the observability dashboard directly, removing duplicate `DashboardData` types.

---

### LLM Provider — Logprobs Support
- **Logprobs support** added to `CompletionRequest` and `CompletionResponse` types, with implementations in the Ollama and OpenAI adapters. This enables the token entropy scorer in the Reactive Intelligence pipeline.

---

### CLI Improvements
- **`rax create agent --interactive`**: Interactive agent creation with readline prompts for name, provider, features, and configuration.
- Input validation for interactive mode prompts.
- CLI `run` command polished with fallback provider wiring.

---

## Bug Fixes

- **`fix(runtime)`**: Entropy sensor plumbing — composite step early exit and deterministic debrief output.
- **`fix(guardrails)`**: Removed phantom `thresholds` option from `GuardrailsOptions` that was defined in types but never wired.
- **`fix(runtime)`**: Resolved `strategySwitching` type errors when threading config through runtime options.
- **`fix(runtime)`**: Aligned `withFallbacks()` field names (`providers`/`models` plural) with the `FallbackConfig` interface.
- **`fix(runtime)`**: Resolved TypeScript DTS build errors in `errors.ts` and added new config fields to `RuntimeOptions`.
- **`fix(cli,testing)`**: Fixed interactive input validation and corrected guardrail error tag.
- **`fix(cli)`**: Added missing features prompt to interactive mode.
- **`fix(adoption)`**: Clarified `withEvents()`, fixed type exports, and fixed README examples.
- **`fix(adoption)`**: Wired `withLogging`, `withHealthCheck`, and `IterationProgress` event correctly.
- **`fix(observability)`**: Fixed boxen border alignment — removed icons from header to prevent misalignment.
- **`fix(docs)`**: Removed right-border characters from terminal box content lines.
- **`fix(tests)`**: Migrated 3 missed test files to the new TestTurn scenario API.
- **`fix(publish)`**: Multiple publish fixes for workspace:* resolution (v0.7.6, v0.7.7, v0.7.8).
- **`fix(cli)`**: Moved benchmarks to devDependencies (not published to npm), removed broken dependency.
- **`fix(publish)`**: Marked health package as private, removed from changeset ignore list.

---

## Performance Improvements

- **Early-stop controller** can terminate reasoning loops up to 40% faster when entropy analysis detects convergence, avoiding unnecessary iterations.
- **Context compression evaluator** triggers compaction before the context window fills, preventing degraded performance from oversized contexts.
- **Strategy switching** automatically escapes stuck loops rather than exhausting max iterations.

---

## Breaking Changes

- **`withTestResponses()` removed** — replaced by `withTestScenario(TestTurn[])`. All tests migrated to the new API.
- **String memory tier names deprecated** — use structured configuration objects instead.
- **`GuardrailsOptions.thresholds` removed** — use `withGuardrails({ injectionThreshold, piiThreshold, toxicityThreshold })` directly.

---

## Documentation

- Added CODING_STANDARDS.md and FRAMEWORK_INDEX.md for contributor onboarding.
- Added Reactive Intelligence Layer spec, implementation plans (Phases 1-4), and telemetry server spec.
- Added cost optimization guide with pricing table, budget calculator, and tier recommendations.
- Added 4 cookbook recipes (streaming, tools, chat/sessions, error handling).
- Added observability cookbook and dashboard upgrade spec.
- Added configuration reference, local models guide, and lifecycle hooks guide.
- Added Next.js, Hono, and Express integration examples.
- Added Phase 1-3 adoption readiness implementation plans.
- Redesigned docs landing page with FeatureCarousel and new panel styles.
- Adopted changesets workflow for versioning and publishing.
- Updated CLAUDE.md, AGENTS.md, and all skill files throughout.
- Updated all docs URLs to custom domain `docs.reactiveagents.dev`.

---

## Tests

- **+421 new tests** (1,773 → 2,194) across **+71 new test files** (217 → 288).
- Reactive Intelligence: Full pipeline integration tests, 65-example validation dataset with accuracy gates, per-scorer unit tests.
- Test Scenario Provider: TestTurn resolution unit tests, tool loop behavioral tests.
- Adoption Readiness: Behavioral contract tests for timeout, retry, fallback, and IterationProgress.
- Kernel Runner: Strategy switch evaluation hook emission tests, iteration progress tests.
- Coverage: Observability gap tests, session persistence tests.

---

## Infrastructure / Chores

- Adopted changesets for versioning and publishing (`@changesets/cli`).
- Added `chalk` and `boxen` dependencies to observability package for terminal UI.
- Synced telemetry signing key with reactive-telemetry server.
- Removed outdated skills and duplicate dashboard types.
- Refactored CLI to wire `demo.ts` through observability `formatMetricsDashboard`.
- Multiple publish workflow fixes for workspace:* dependency resolution.
- Updated CONTRIBUTING.md with detailed guidelines.
- General code structure refactoring for readability.
