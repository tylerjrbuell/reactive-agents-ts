# Adoption Readiness Audit — Design Spec

**Date:** 2026-03-11
**Audience:** Developer-first (A) + Local-first/Hobbyist (C)
**Approach:** Launch-critical first, then iterate — fix the gaps that cause users to bounce in the first 30 minutes, then address depth items before launch.

---

## Problem Statement

Reactive Agents has strong architecture (1,773 tests, 20 packages, Effect-TS composition, 5 reasoning strategies, 6 providers) but user-facing gaps in discoverability, error handling, configuration exposure, and documentation will cause adoption friction. The framework promises "control, not magic" but several control knobs are hardcoded or invisible.

Additionally, the framework lacks dynamic strategy switching — when an agent gets stuck, the only outcomes are max iterations or circuit breaker failure. There's no adaptive fallback to a different reasoning strategy.

**Target audiences:**
- **A — Developer-first (HN/Reddit):** Clone repo, read architecture, judge on DX + control surface
- **C — Local-first/Hobbyist (Ollama):** Run agents on own hardware, care about model-adaptive performance

---

## Cross-Cutting Concerns

These apply to ALL items and must be addressed as part of each:

1. **Tests required for every code change.** Each item that modifies source code must include tests. Minimum expectations noted per item. Items that are docs-only are exempt.
2. **Starlight sidebar config.** Every new docs page (items 1.4, 1.5, 1.6, 2.1, 2.3, 2.4, 2.7, 3.6) must update `apps/docs/astro.config.mjs` sidebar configuration to ensure pages are navigable.
3. **CLAUDE.md and CHANGELOG updates.** New builder methods, new services, and API changes must be reflected in CLAUDE.md per the existing "Documentation Update Requirements" table.
4. **Index re-exports.** Items that create new public APIs must update the relevant package's `index.ts` and, if user-facing, the main `reactive-agents` package exports.

---

## Scope

### Tier 1 — Bounce Prevention (first 30 minutes)

These are the gaps that cause a new user to close their terminal and move on.

#### 1.1 Actionable Error Messages

**Problem:** Errors surface as nested `FiberFailure` stack traces from Effect-TS. No remediation hints. Users don't know what went wrong or how to fix it.

**Design:**
- Add `.context()` method to all primary error types (`ExecutionError`, `MaxIterationsError`, `GuardrailViolationError`, `BudgetExceededError`, `KillSwitchTriggeredError`, `BehavioralContractViolationError`, `HookError`) returning `{ lastStep, executionState, suggestion }`.
- `unwrapError()` enhanced to produce a single human-readable line + optional `.context()` for details.
- Each error type gets a static `suggestion` string:
  - `MaxIterationsError` → "Consider: (1) simpler prompt, (2) increase maxIterations, (3) enable adaptive strategy"
  - `BudgetExceededError` → "Budget limit: {type}={limit}. Increase via .withCostTracking({ budget: ... })"
  - `GuardrailViolationError` → "Input blocked by {guardrailType}. Adjust thresholds or rephrase input."
  - `BehavioralContractViolationError` → "Contract violation: {rule}. Adjust via .withBehavioralContracts()"
  - `HookError` → "Hook failed at phase {phase}: {cause}. Check your .withHook() handler."
- `agent.run()` catches FiberFailure at the facade level and re-throws clean Error with message + suggestion.

**Tests:** Unit tests for `.context()` on each error type. Integration test verifying `agent.run()` produces clean errors (not FiberFailure) on known failure paths (missing tool, budget exceeded, guardrail block). ~10-15 tests.

**Files:** `packages/core/src/errors.ts`, `packages/runtime/src/reactive-agent.ts`, `packages/runtime/src/execution-engine.ts`

#### 1.2 Build-Time Provider Validation

**Problem:** Missing API key errors surface at execution time, not build time. Model/provider mismatches silently fall back to defaults.

**Design:**
- `ReactiveAgentBuilder.build()` validates:
  - API key present for selected provider (check `process.env[keyName]`)
  - Model is valid for provider (maintain `VALID_MODELS` map per provider, warn on mismatch)
  - Emit build-time log: `"✓ Provider: anthropic | Model: claude-sonnet-4-20250514 | API key: sk-ant-...***"`
- Validation is soft by default (warnings), with `.withStrictValidation()` builder method to make it hard-fail.
- Ollama provider skips API key check (local, no key needed).
- Test provider skips all validation.

**Tests:** Tests for: missing API key warning, missing API key + strict = throw, model/provider mismatch warning, Ollama skips key check, Test skips validation. ~8 tests.

**Files:** `packages/runtime/src/builder.ts`, `packages/llm-provider/src/providers/`

#### 1.3 Builder Convenience Methods

**Problem:** Users read "control-first" but can't find the knobs. Key configuration requires reaching into nested config objects.

**Note:** `.withMaxIterations()` already exists in the builder. It needs documentation, not implementation. `.withLogging()` is deferred to item 3.3 (Structured Logging) where it gets the full design it deserves. `.withFallbackStrategy()` is consolidated into item 2.8 (Dynamic Strategy Switching) as part of `.withReasoning()` config to avoid API confusion.

**Design — new builder methods:**

| Method | Type | Default | Maps To |
|--------|------|---------|---------|
| `.withTimeout(ms)` | `number` | none | New: per-execution timeout via `Effect.timeout` |
| `.withRetryPolicy({ maxRetries, backoffMs })` | `object` | `{ maxRetries: 0 }` | New: LLM call retry with exponential backoff |
| `.withCacheTimeout(ms)` | `number` | `3_600_000` | `SemanticCache.DEFAULT_TTL_MS` |
| `.withGuardrailThresholds({ injection?, pii?, toxicity? })` | `object` | provider defaults | Guardrail detection score thresholds |
| `.withStrictValidation()` | `boolean` | `false` | Build-time validation mode (see 1.2) |

Each method is a thin setter on the internal config. No new packages.

**Tests:** Builder chain test for each new method (sets config correctly). Integration test for timeout (execution aborts after N ms). Integration test for retry (retries on transient failure). ~8 tests.

**Files:** `packages/runtime/src/builder.ts`, `packages/runtime/src/types.ts`

#### 1.4 Defaults Table & Configuration Reference

**Problem:** `maxIterations=10`, `cacheTTL=1hr`, guardrail thresholds — all invisible to users.

**Design:**
- Add "Configuration Reference" page to docs site at `apps/docs/src/content/docs/reference/configuration.md`
- Single table with: builder method, config path, default value, type, description
- Include all environment variables (required vs optional)
- Include all hardcoded values with rationale
- Update Starlight sidebar to include reference section

**Files:** `apps/docs/src/content/docs/reference/configuration.md`, `apps/docs/astro.config.mjs`

#### 1.5 Local Model Guidance

**Problem:** Ollama users install the framework, pick a random model, get garbage output. No guidance on which model for which task.

**Design:**
- Add "Local Models Guide" at `apps/docs/src/content/docs/guides/local-models.md`
- Decision tree: task complexity → recommended model + tier
- Table: model name, parameter count, context window, recommended tier, best-for
- Cover: qwen3 (4b/8b/14b), llama3.1 (8b/70b), cogito (8b/14b), phi-4, mistral
- Include context profile recommendations per model
- Common pitfalls: models that hallucinate tool calls, models that can't follow ReAct format
- Strategy recommendations per model size (small models struggle with Plan-Execute and ToT)

**Files:** `apps/docs/src/content/docs/guides/local-models.md`, `apps/docs/astro.config.mjs`

#### 1.6 Hook System Visibility

**Problem:** 10-phase lifecycle hooks are a key differentiator but absent from README, quick-start, and examples.

**Design:**
- Add "Lifecycle Hooks" section to README (after "Add Capabilities")
- Show 2 practical examples: custom logging hook, cost-alert hook
- Add hook example: `apps/examples/src/advanced/26-lifecycle-hooks.ts`
- Create hooks guide: `apps/docs/src/content/docs/guides/hooks.md`
- Document hook ordering guarantees (sequential, same-phase hooks run in registration order)
- Document available phases and their timing (before/after/error for each of 10 phases)

**Files:** `README.md`, `apps/examples/src/advanced/26-lifecycle-hooks.ts`, `apps/docs/src/content/docs/guides/hooks.md`, `apps/docs/astro.config.mjs`

#### 1.7 TSDoc on All Public Interfaces & APIs

**Problem:** IDE autocomplete is the primary discovery mechanism for the A+C audience. Without TSDoc comments on builder methods, config types, error types, and result types, users have to read source code or docs to understand what things do. This is unacceptable for a "great DX" framework.

**Design:**
- Add JSDoc/TSDoc comments to all public-facing interfaces, types, and methods across the framework:
  - **Builder API** (`builder.ts`): Every `.with*()` method gets `@param`, `@returns`, `@example`, and `@default` tags
  - **Config types** (`types.ts` in runtime, reasoning, tools, etc.): Every field gets a description + default value note
  - **Error types** (`errors.ts`): Every error class gets `@description` explaining when it fires + example
  - **Result types** (`AgentResult`, `ChatReply`, `AgentDebrief`, etc.): Every field documented
  - **Service interfaces** (`LLMService`, `ToolService`, `MemoryService`, etc.): Method signatures documented with `@param`/`@returns`
  - **Event types** (`AgentEvent` union, all event interfaces): Each event documented with when it fires
- Priority order: builder.ts (highest user contact) → config types → error types → result types → service interfaces → event types
- Follow existing TSDoc conventions in the codebase (some files already have partial docs)
- Do NOT add TSDoc to internal/private implementation details — only public API surface

**Scope check:** This is a documentation-in-code pass, not a refactor. No logic changes. No new files. Just comments on existing exports.

**Files:** `packages/runtime/src/builder.ts`, `packages/runtime/src/types.ts`, `packages/core/src/types.ts`, `packages/core/src/errors.ts`, `packages/tools/src/types.ts`, `packages/reasoning/src/types.ts`, `packages/llm-provider/src/types.ts`, `packages/memory/src/types.ts`, and all other packages with public type exports.

#### 1.8 Memory Tier Naming Cleanup

**Problem:** `.withMemory("1")` vs `.withMemory("2")` vs `.withMemory({ tier: "standard" })` — confusing overloads.

**Design:**
- Keep object-form as primary: `.withMemory({ tier: "standard" })` and `.withMemory({ tier: "enhanced" })`
- Deprecate string-form `"1"` and `"2"` with console warning: `"⚠ withMemory("1") is deprecated. Use withMemory({ tier: "standard" }) instead."`
- Add `.withMemory()` (no args) as shorthand for `{ tier: "standard" }` — simplest path
- Document that "enhanced" tier requires embedding provider config (`EMBEDDING_PROVIDER` + `EMBEDDING_MODEL` env vars)

**Tests:** Test deprecated string form emits warning. Test no-args defaults to standard. Test object form works unchanged. ~4 tests.

**Files:** `packages/runtime/src/builder.ts`

---

### Tier 2 — Credibility & Control (first week of use)

#### 2.1 Migration Guide (LangChain)

**Problem:** Developers with existing agents in LangChain.js can't translate their mental model.

**Design:**
- "Migrating from LangChain.js" guide at `apps/docs/src/content/docs/guides/migrating-from-langchain.md`
- Side-by-side API comparison table (Agent → ReactiveAgent, Tool → ToolDefinition, Chain → reasoning strategy, Memory → 4-layer memory)
- Code translation examples: agent creation, tool registration, callbacks → hooks, memory setup
- Conceptual mapping: LangChain's implicit reasoning vs. RA's explicit 10-phase lifecycle

**Files:** `apps/docs/src/content/docs/guides/migrating-from-langchain.md`, `apps/docs/astro.config.mjs`

#### 2.2 Streaming Progress & Cancellation

**Problem:** No iteration count during streaming. No way to cancel mid-execution. Can't build progress UIs.

**Design:**
- New stream event: `IterationProgress` with `{ iteration, maxIterations, toolsCalledThisStep?, status }` — emitted at end of each kernel loop iteration
- `runStream(prompt, options?)` gains `options.signal?: AbortSignal` — on abort, sets kill switch and emits `StreamCancelled` event
- `StreamCompleted` metadata enhanced with `toolSummary: Array<{ name, calls, avgMs }>`

**Dependency:** Must complete BEFORE item 2.8 (both modify `kernel-runner.ts`). These two items CANNOT be parallelized.

**Tests:** Test `IterationProgress` events emitted during streaming. Test AbortSignal cancels execution. Test `StreamCompleted` includes tool summary. ~8 tests.

**Files:** `packages/runtime/src/streaming/`, `packages/reasoning/src/kernel/kernel-runner.ts`

#### 2.3 Production Deployment Checklist

**Problem:** "Production-grade" claimed but no guidance on what to enable before deploying.

**Design:**
- One-page checklist at `apps/docs/src/content/docs/guides/production-checklist.md`
- Sections: Security (guardrails, identity, behavioral contracts), Reliability (kill switch, circuit breaker, max iterations), Cost (budget enforcement, cost tracking), Observability (logging, metrics, tracing), Error Handling (global error handler, graceful shutdown)
- Each item: what it does, how to enable, what happens if you skip it

**Files:** `apps/docs/src/content/docs/guides/production-checklist.md`, `apps/docs/astro.config.mjs`

#### 2.4 Sub-Agent Context Forwarding Documentation

**Problem:** Known limitation — sub-agents don't inherit parent context. Not documented with workarounds.

**Design:**
- Add "Working with Sub-Agents" guide at `apps/docs/src/content/docs/guides/sub-agents.md` (under guides, not cookbook — the `cookbook/` directory doesn't exist in the current docs structure)
- Explain what context IS forwarded (parent tool results + working memory, max 2000 chars)
- Show workaround: parent writes key findings to scratchpad, sub-agent reads via system prompt
- Document `tools` whitelist parameter on spawn-agent
- Show static vs dynamic sub-agent decision tree
- List known limitation: context truncation at 2000 chars, no scratchpad forwarding

**Files:** `apps/docs/src/content/docs/guides/sub-agents.md`, `apps/docs/astro.config.mjs`

#### 2.5 Tool Registration Builder Helper

**Problem:** Tool parameter definition requires verbose `ToolParameter[]` arrays.

**Design:**
- New `ToolBuilder` helper class:
  ```typescript
  const myTool = new ToolBuilder("analyze")
    .description("Analyze a dataset")
    .param("url", "string", "Dataset URL", { required: true })
    .param("format", "string", "Output format", { enum: ["json", "csv"] })
    .handler((params) => Effect.succeed({ result: "..." }))
    .build();
  ```
- Exported from `@reactive-agents/tools` and re-exported from `reactive-agents`
- Existing `ToolDefinition` format still works — ToolBuilder is sugar, not replacement

**Tests:** Test builder produces valid ToolDefinition. Test required/optional params. Test enum params. Test handler integration. ~6 tests.

**Files:** `packages/tools/src/tool-builder.ts` (new), `packages/tools/src/index.ts`, `packages/reactive-agents/src/index.ts` (re-export)

#### 2.6 Global Error Handler

**Problem:** Users must hook every phase individually for error handling.

**Design:**
- `.withErrorHandler(handler)` builder method — receives all uncaught errors with execution context
- Handler signature: `(error: AgentError, context: { taskId, phase, iteration, lastStep }) => void`
- Runs after phase-specific `on-error` hooks but before error propagation
- Can log, report, but cannot recover (recovery is a Tier 3 concern)

**Tests:** Test handler is called on execution error. Test handler receives correct context. Test handler doesn't prevent error propagation. ~4 tests.

**Files:** `packages/runtime/src/builder.ts`, `packages/runtime/src/execution-engine.ts`

#### 2.7 Reasoning Strategy Decision Tree

**Problem:** Users don't know when to use Plan-Execute vs ToT vs ReAct.

**Design:**
- Decision tree in docs: "Choosing a Reasoning Strategy"
- Flow: Is task single-step? → No reasoning needed. Multi-step with tools? → ReAct. Structured plan with dependencies? → Plan-Execute. Quality-critical output? → Reflexion. Creative/open-ended? → Tree-of-Thought. Mixed/unsure? → Adaptive.
- Include performance characteristics: token cost, latency, iteration count per strategy
- Local model recommendations per strategy (some strategies work poorly on small models)

**Files:** `apps/docs/src/content/docs/guides/choosing-strategies.md`, `apps/docs/astro.config.mjs`

#### 2.8 Dynamic Strategy Switching

**Problem:** When an agent gets stuck (loop detection, diminishing progress), the only outcome is failure. No adaptive fallback to a different reasoning strategy.

**Dependency:** Item 2.2 must complete first (shared file: `kernel-runner.ts`).

**Design:**

The strategy switching is injected into the kernel runner's existing loop detection path. When the circuit breaker would normally fire "loop detected → fail," it instead triggers an evaluation step.

**Architecture:**

```
Normal flow:     Think → Act → Observe → Think → ... → Done
Stuck detection: Think → Act → Observe → Think → [stuck] → FAIL

New flow:        Think → Act → Observe → Think → [stuck] → Evaluate → Switch → Think → ... → Done
```

**Components:**

1. **StrategyEvaluator** — small structured LLM call that assesses current progress and recommends next strategy:
   - Input: task description, steps taken so far (summarized), current strategy, reason for stuck detection, available strategies
   - Output (structured): `{ shouldSwitch: boolean, recommendedStrategy: string, reasoning: string }`
   - Uses the structured output pipeline already built for Plan-Execute (prompt → repair → validate → retry)

2. **Strategy switch in kernel-runner** — when loop detection fires:
   - Instead of `status: "failed"`, set `status: "evaluating"`
   - Call `StrategyEvaluator` with current state
   - If `shouldSwitch: true`: serialize current steps/observations into a handoff context, re-initialize kernel with new strategy, inject handoff as system context ("Previous approach tried X. Observations so far: Y. Now try Z strategy.")
   - If `shouldSwitch: false`: proceed with normal failure (circuit breaker fires as before)
   - Max 1-2 switches per execution (configurable via `maxStrategySwitches`, default 1)

3. **State handoff format** — strategy-agnostic summary carried between strategies:
   ```typescript
   interface StrategyHandoff {
     originalTask: string;
     previousStrategy: string;
     stepsCompleted: number;
     toolsCalled: string[];
     keyObservations: string[];   // extracted from observation steps
     failureReason: string;       // why switch was triggered
     switchNumber: number;        // 1-based, for max switch enforcement
   }
   ```
   This avoids the heavy "canonical state" conversion — we just carry forward the useful information as context, not the full kernel state.

4. **Builder integration:**
   ```typescript
   .withReasoning({
     defaultStrategy: "reactive",
     enableStrategySwitching: true,      // default: false
     maxStrategySwitches: 1,             // default: 1
     fallbackStrategy: "plan-execute-reflect",  // optional: explicit fallback instead of LLM eval
   })
   ```
   Note: `fallbackStrategy` here is the ONLY place strategy fallback is configured. No separate `.withFallbackStrategy()` method — keeps the API surface clean.

5. **EventBus events:**
   - `StrategySwitchEvaluated` — emitted when evaluator runs (includes recommendation)
   - `StrategySwitched` — emitted when switch actually happens (from → to, reason)

**What we're NOT doing:**
- Not rewriting strategies as policies (too heavy, unnecessary)
- Not supporting mid-loop switching (only at stuck detection boundary)
- Not converting kernel state formats (handoff is a summary, not a state transfer)
- Not allowing switches back to already-tried strategies (prevents loops)

**Tests:** Test stuck detection triggers evaluator. Test evaluator recommends switch. Test handoff carries observations. Test max switches enforced. Test no switch when evaluator says no. Test EventBus events emitted. Test `fallbackStrategy` skips evaluator and goes direct. ~12-15 tests.

**Files:** `packages/reasoning/src/strategies/shared/strategy-evaluator.ts` (new), `packages/reasoning/src/strategies/shared/kernel-runner.ts`, `packages/reasoning/src/types.ts`, `packages/runtime/src/builder.ts`

---

### Tier 3 — Depth & Polish (pre-launch stretch goals)

#### 3.1 Chat Session Persistence

**Problem:** Multi-turn sessions are in-memory only. Lost on restart.

**Design:**
- Optional `SessionStore` service backed by SQLite (same DB as memory/debrief)
- Table: `chat_sessions` with `session_id, agent_id, messages JSON, created_at, updated_at`
- `agent.session({ persist: true })` enables persistence
- `agent.session({ id: "existing-session-id" })` resumes a prior session
- Auto-cleanup: sessions older than 30 days pruned on startup (configurable)

**Tests:** Test session persists to SQLite. Test session resumes from ID. Test auto-cleanup. ~6 tests.

**Files:** `packages/runtime/src/chat/session-store.ts` (new), `packages/runtime/src/chat/index.ts` (re-export), `packages/memory/src/stores/`

#### 3.2 Graceful Degradation & Fallbacks

**Problem:** Provider times out → error. Model rate-limited → error. No graceful mode reduction.

**Design:**
- `.withFallbacks({ provider?, model? })` builder method — distinct from strategy switching (2.8), this handles provider/model-level failures
- Provider fallback: if primary provider errors 3x consecutively (tracked in LLM provider wrapper), switch to fallback provider for remainder of execution
- Model fallback: if primary model rate-limited (429 response), try cheaper model from same provider
- Fallback chain is ordered (try each in sequence)
- Does NOT include strategy fallback (that's handled by 2.8's `enableStrategySwitching`)

**Implementation location:** Provider error counting in `packages/llm-provider/src/` (wraps `complete()`/`stream()` calls). Fallback chain evaluation in `packages/runtime/src/execution-engine.ts`.

**Tests:** Test provider fallback after 3 errors. Test model fallback on 429. Test fallback chain ordering. ~6 tests.

**Files:** `packages/runtime/src/builder.ts`, `packages/runtime/src/execution-engine.ts`, `packages/llm-provider/src/`

#### 3.3 Structured Logging

**Problem:** No `.withLogging()`, no log levels, no file output. Observability = metrics dashboard only.

**Design:**
- `.withLogging({ level, format, output })` where:
  - `level`: "debug" | "info" | "warn" | "error" (default: "info")
  - `format`: "text" | "json" (default: "text")
  - `output`: "console" | "file" | WritableStream (default: "console")
- Logger auto-subscribes to EventBus and filters by level
- User code can access logger: `agent.logger.info("custom message")`
- File output writes JSONL with rotation (max 10MB per file, 5 files)
- This is the canonical home for logging configuration — no other builder method touches logging.

**Tests:** Test log level filtering. Test JSON format output. Test file output with rotation. Test EventBus integration. ~8 tests.

**Files:** `packages/observability/src/logging/`, `packages/runtime/src/builder.ts`

#### 3.4 Testing Package Expansion

**Problem:** No streaming assertions, no scenario fixtures.

**Design:**
- `expectStream(generator).toEmitTextDeltas()` — assertion helper
- `expectStream(generator).toComplete({ within: 5000 })` — timeout assertion
- Scenario fixtures: `createGuardrailBlockScenario()`, `createBudgetExhaustedScenario()`, `createMaxIterationsScenario()`
- Each fixture returns a pre-configured agent + expected error type

**Tests:** Self-testing — each assertion helper and fixture is tested. ~10 tests.

**Files:** `packages/testing/src/assertions/` (new dir), `packages/testing/src/fixtures/` (new dir), `packages/testing/src/index.ts` (re-export)

#### 3.5 Framework Integration Examples

**Problem:** Product builders can't wire agents into existing apps.

**Design:**
- `apps/examples/src/integrations/nextjs-streaming.ts` — App Router route handler with SSE streaming, shows `AgentStream.toSSE()` in a Next.js API route, includes browser EventSource client code in comments
- `apps/examples/src/integrations/hono-agent-api.ts` — Hono HTTP API with streaming agent endpoint, health check route, and graceful shutdown
- `apps/examples/src/integrations/express-middleware.ts` — Express middleware wrapping agent.run() with error handling, shows how to mount agent as a route handler

**Files:** `apps/examples/src/integrations/`

#### 3.6 Cost Estimation Guide

**Problem:** "$10/month budget — which model?" not answered.

**Design:**
- Guide at `apps/docs/src/content/docs/guides/cost-optimization.md`
- Table: provider x model → cost per 1K tokens (input/output)
- Budget calculator: "X requests/day x Y avg tokens → $Z/month"
- Recommendations by budget tier ($5, $25, $100, $500/month)
- Local model as $0 option with performance trade-offs

**Files:** `apps/docs/src/content/docs/guides/cost-optimization.md`, `apps/docs/astro.config.mjs`

#### 3.7 CLI Interactive Mode

**Problem:** No guided agent creation experience.

**Design:**
- `rax create --interactive` walks through: name → provider → model → features → tools → output file
- Each step is a prompted selection (uses existing CLI prompt library)
- Generates a complete agent file based on selections
- Falls back to non-interactive if stdin is not a TTY

**Tests:** Test non-interactive fallback. Test generated file is valid TypeScript. ~4 tests.

**Files:** `apps/cli/src/commands/create.ts`

#### 3.8 Health Checks in Builder

**Problem:** `@reactive-agents/health` exists but not wired into builder.

**Design:**
- `.withHealthCheck()` builder method
- `agent.health()` returns `{ status: "healthy" | "degraded" | "unhealthy", checks: { memory, provider, tools, budget } }`
- Each check reports: status, latency, last error
- Useful for production readiness probes (k8s liveness/readiness)

**Tests:** Test health check returns correct status. Test degraded when provider slow. Test unhealthy when provider down. ~4 tests.

**Files:** `packages/runtime/src/builder.ts`, `packages/health/src/`

---

## Execution Order

Work is ordered by impact and dependency. Items within the same phase can be parallelized UNLESS noted otherwise.

### Phase 1: Core DX Fixes (Tier 1)
All items can be parallelized:
1. **1.1** Actionable error messages
2. **1.2** Build-time provider validation
3. **1.3** Builder convenience methods
4. **1.4** Defaults table & configuration reference (docs)
5. **1.5** Local model guidance (docs)
6. **1.6** Hook system visibility (docs + examples)
7. **1.7** TSDoc on all public interfaces & APIs
8. **1.8** Memory tier naming cleanup

### Phase 2: Control & Credibility (Tier 2)
Parallelizable groups:
- **Group A** (docs, independent): 2.1, 2.3, 2.4, 2.7
- **Group B** (code, independent): 2.5, 2.6
- **Group C** (sequential dependency): 2.2 THEN 2.8 (both modify `kernel-runner.ts`)

### Phase 3: Depth (Tier 3)
All items can be parallelized:
- **3.1** Chat session persistence
- **3.2** Graceful degradation & fallbacks
- **3.3** Structured logging
- **3.4** Testing package expansion
- **3.5** Framework integration examples
- **3.6** Cost estimation guide (docs)
- **3.7** CLI interactive mode
- **3.8** Health checks in builder

---

## Success Criteria

- Every error type (7 total) includes a `.context()` method with a remediation suggestion — verified by unit test audit
- All ~40 builder methods documented with defaults in a single reference page (item 1.4)
- Local models guide covers at least 8 models with tier + strategy recommendations
- Build-time validation catches missing API keys and model/provider mismatches
- Dynamic strategy switching: run benchmark suite (20 tasks x 5 tiers) before and after; measure stuck-agent rate reduction (target: 50% fewer stuck failures)
- Hook system documented with 2+ examples in README and a dedicated guide
- All public builder methods, config types, error types, and result types have TSDoc comments visible in IDE autocomplete
- Migration guide covers agent creation, tool registration, hooks, and memory for LangChain.js users

---

## Out of Scope

- React/UI integration (`useAgent()` hooks) — v1.0+
- Docker code sandbox — separate workstream
- Programmatic tool calling (token reduction) — separate workstream
- Full A2A remote agent composition tutorial — after core adoption
- CHANGELOG / semantic versioning policy — after v1.0
- Meta-agent launch campaign — parallel workstream, separate spec

---

_Version: 2.0.0_
_Status: DESIGN SPEC (reviewed + revised)_
_Author: Tyler Buell + Claude_
