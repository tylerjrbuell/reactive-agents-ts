---
name: effect-abstraction-audit
description: Use when analyzing the Reactive Agents codebase for architectural improvements, abstraction opportunities, composability gaps, or Effect-TS engineering quality — before proposing refactors, during design reviews, or when codebase complexity is growing.
user-invocable: true
---

# Effect Abstraction Audit — Reactive Agents

Targeted architectural analysis for a TypeScript + Effect + Bun agentic framework. Goal: identify **high-value abstraction opportunities** that reduce accidental complexity, improve composability, and strengthen type guarantees — without hiding the Effect model.

> **Guiding Principle:** Prefer making Effects more explicit and composable over hiding them behind abstractions. If an abstraction reduces visibility into `Effect<A, E, R>`, it is likely a regression.

---

## When to Use

- Before proposing a refactor — validate the problem is real, not hypothetical
- When a module is growing past ~300 LOC
- When similar `pipe(...)` chains appear 3+ times across different files
- When `throw`, `as any`, or untyped `unknown` appears in domain logic
- When a new agent workflow is being designed

**Do NOT use for:** one-off fixes, simple feature additions, or performance-sensitive hot paths in Bun-optimized code.

## Wiki Integration

Before launching an audit, **query the wiki for prior abstraction work** to avoid duplicating effort. See [[wiki/Development/Wiki-Workflow|Wiki-Workflow.md]] for the canonical pattern.

```
claude-obsidian:wiki-query "<subsystem> abstraction effect-ts"
claude-obsidian:wiki-query "service layer composition <subsystem>"
```

This surfaces:
- Prior decisions in `wiki/Decisions/` that constrain abstractions
- Past audits in `wiki/Research/Audit-Reports-*/` covering the same area
- Architectural debt items in `wiki/Issues/Running Issues Log.md`
- Mechanism validations affecting abstraction choices in `wiki/Experiments/`

After the audit, persist findings:
- Significant abstraction opportunity identified → `claude-obsidian:save` to `wiki/Research/Audit-Reports-YYYY-MM-DD/effect-abstraction-<scope>.md`
- New architectural debt item → Edit `wiki/Issues/Running Issues Log.md`
- Decision to defer/reject → `claude-obsidian:save` to `wiki/Decisions/`

---

## Analysis Lens — 7 Signals

Scan for these patterns in order of ROI:

### A. Repeated Effect Pipelines
Similar `pipe(Effect.flatMap, Effect.map, ...)` chains across files. Repeated retry/timeout/logging patterns.
→ Candidate: **Composable domain-specific combinators**

### B. Ad Hoc Service Access
Direct imports instead of `Context.Tag` usage. Hidden dependencies inside functions.
→ Candidate: **Explicit service interfaces + Layer-based injection**

### C. Inconsistent Error Modeling
Mix of `throw`, `Effect.fail`, untyped `unknown`. Loss of domain error semantics.
→ Candidate: **Unified domain error algebra (tagged unions via `Data.TaggedError`)**

### D. Agent Workflow Duplication
Repeated patterns: tool selection, validation, retry loops, state transitions across strategies.
→ Candidate: **Composable `Phase[]` or `Guard[]` additions to the kernel pipeline**

### E. Conditional Explosion
Large `if/else` or `switch` blocks for tool handling, decision logic, provider routing.
→ Candidate: **Strategy pattern via tagged services or `MetaToolHandler` registry entries**

### F. Layer Fragmentation
Layers defined inconsistently or too locally. No clear composition root per package.
→ Candidate: **Centralized `createXxxLayer()` factory per package**

### G. Side-Effect Leakage
Logging, IO, or network calls mixed into business logic outside `Effect.tryPromise` / `Effect.sync`.
→ Candidate: **Effect encapsulation boundary at module edge**

---

## Evaluation Filter (Strict)

For each candidate, answer all three:

1. **Concrete issue today?** (duplication / type unsafety / hidden deps / workflow brittleness)
2. **Does it reduce** Effect complexity, cognitive load in pipelines, or risk of runtime failure?
3. **Does it align with Effect principles?** Explicit `R`, typed `E`, referential transparency?

**Reject if:**
- Hides the Effect model behind opaque helpers
- Reduces type visibility (narrows `E` to `never` without justification)
- Introduces "magic" initialization or implicit wiring

---

## Preferred Abstraction Forms

### 1. Domain Effect Combinator
```ts
// Before: repeated across 4 files
pipe(effect, Effect.retry(Schedule.exponential("100 millis")), Effect.withSpan("tool-exec"))

// After
const withToolExecution = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.retry(Schedule.exponential("100 millis")), Effect.withSpan("tool-exec"))
```

### 2. Tagged Service Interface
```ts
class ToolRouter extends Context.Tag("ToolRouter")<
  ToolRouter,
  { route: (call: ToolCall) => Effect.Effect<ToolOutput, ToolError> }
>() {}
```

### 3. New Kernel Phase
```ts
// phases/validate.ts — answers: "is this tool call safe AND well-formed?"
export const validate: Phase = (state, ctx) =>
  Effect.gen(function* () {
    // ... validation logic
    return state
  })

// Compose: makeKernel({ phases: [...defaultPhases, validate] })
```

### 4. MetaToolHandler Registry Entry (act.ts)
```ts
// For inline meta-tools — one-line addition to metaToolRegistry
metaToolRegistry.set("checkpoint", handleCheckpoint)
```

### 5. Typed Error Channel Consolidation
```ts
type KernelError =
  | { _tag: "ThinkFailed"; cause: LLMError }
  | { _tag: "GuardRejected"; tool: string; reason: string }
  | { _tag: "ActFailed"; cause: ToolError }
```

---

## Project-Specific Context

### Known Architecture Debt (audit these first)

Re-verify counts and wiring before each audit (`wc -l`, `rg`); the bullets below were last aligned with the tree on **2026-08-06**.

1. **`KernelState.meta` — typed but residual casts remain** — `KernelMeta` interface now exists and most sites access typed fields directly. Residual `as Record<string, unknown>` casts in `arbitrator.ts` and `iterate-pass.ts` were removed in the 2026-08-06 sweep (HS-206). **Remaining:** some `as unknown as` casts persist for import-cycle avoidance (e.g. `budgetLimits`). Medium ROI to resolve via re-export or shared types package.

2. ~~**`buildDynamicContext` is dead in the live kernel path**~~ — **RESOLVED.** `buildDynamicContext` was already removed prior to this audit refresh. `buildStaticContext` remains the sole active path.

3. **`context-engine.ts` size** — On the order of **~500 LOC** (not ~690). It holds scoring, environment/rules/tool-reference builders, static context builder, and helpers. Maintenance concern reduced after dynamic path removal.

4. **Provider adapter hooks — 4-hook system, all wired** — `ProviderAdapter` in `packages/llm-provider/src/adapter.ts` now has 4 guidance hooks + `parseToolCalls` (`taskFraming`/`toolGuidance`/`systemPromptPatch` were removed in v0.14), consumed in the kernel as follows (confirm with `rg` if paths move):
   - `continuationHint`, `qualityCheck` → `packages/reasoning/src/kernel/capabilities/reason/think-guards.ts`
   - `errorRecovery` → `packages/reasoning/src/kernel/capabilities/act/act.ts`
   - `synthesisPrompt` → `packages/reasoning/src/kernel/capabilities/act/conversation-assembly.ts`
   Do not file issues for “unwired hooks” without checking these files first.

5. **Adaptive meta-strategy defaults off** — Routing exists (`packages/reasoning/src/strategies/adaptive.ts`, selected when `config.adaptive.enabled` in `packages/reasoning/src/services/reasoning-service.ts`). **`defaultReasoningConfig` sets `adaptive.enabled: false`** in `packages/reasoning/src/types/config.ts`. That is a product/default choice, not absent multi-step routing code.

6. ~~**Duplicated output-quality gate**~~ — **RESOLVED.** `enforceOutputQualityGate` unified in `finalize.ts`. Both `plan-execute.ts` and `reflexion.ts` now call the shared version.

7. ~~**`ContextProfile` vs runtime `maxTokens`**~~ — **RESOLVED.** `ContextProfile.maxTokens` is now declared (zero `as any` casts for this field).

8. **`Layer<any, any>` on public builder API (HS-208) — PARTIALLY RESOLVED 2026-09-03.** 2 of 5 sites tightened:
   - `packages/reasoning/src/services/reasoning-service.ts:181` — `any` → `Layer.Layer<LLMService, never>`. Note: `Layer`'s `ROut` is contravariant, so the loosest type both `llmLayer` alone and the ToolService-merged layer satisfy is the narrower `LLMService`, not the `LLMService | ToolService` union (that union was tried first and rejected by the compiler — TS2322).
   - `packages/runtime/src/builder/withers/_state.ts:151` — `any,any,any` → `Layer.Layer<never, unknown, unknown>`, now matching the two other declarations of the same conceptual field (`builder.ts:384`, `runtime-construction.ts:152`).
   - Both packages' full test suites green after the change (reasoning 2806/2806, runtime 4792/4792 combined with llm-provider).
   **Still open, deliberately left alone:** `packages/runtime/src/runtime-types.ts:326` (`RuntimeOptions.extraLayers`) and the widening cast at `builder/build-effect/runtime-construction.ts:404-411` — the inline comment there explicitly scopes that cast to bridging `_state.ts`'s (now-fixed) narrow type into this still-`any` public option surface, and calls fixing `runtime-types.ts` itself "out of scope" at that call site. `agent-instantiation.ts:120`'s `Layer.Layer<any, never, never>` cast is heavily and correctly documented (collapses a 15+-conditional-optional-service union deliberately) — leave it, it already replaced 6 worse casts.

9. ~~**`FallbackChain` dead code**~~ — **RESOLVED 2026-09-03.** `packages/llm-provider/src/fallback-chain.ts` (plain OOP class, raw `throw`, no Ref/Tag/Layer) had zero live callers; its exact feature set (error-threshold provider switching, per-model chain) was already superseded by the Effect-native `cascadeWithTransitions` in `packages/runtime/src/llm-fallback-cascade.ts` (see that file's own comment: "P0-3: those knobs were removed because they were never wired"). Deleted source + test + `index.ts` export; llm-provider typecheck/build/tests (446/446) green after removal.

10. ~~**No `Effect.withSpan`/`Effect.fn` tracing anywhere**~~ — **INVESTIGATED AND RETRACTED 2026-09-03.** Original framing ("zero tracing infra, 3 competing systems") was wrong on both counts. `packages/observability/src/tracing/tracer.ts`'s `makeTracer`/`obs.withSpan` IS live and wired by default: called from `packages/runtime/src/engine/pipeline.ts:262,267` (phase spans) and `packages/runtime/src/execution-engine.ts:1709` (task execution span), auto-provided via `createObservabilityLayer` in `runtime.ts:824-842` whenever `enableObservability: true` (the default). `packages/observe`'s `OpenInferenceTracerLayer` is a deliberately separate, opt-in layer (flows through the `extraLayers` seam, see item 8) emitting OpenInference semantic-convention attributes for LLM-observability platforms (Arize Phoenix etc.) — different consumer, different export target, not a competitor; it's also mid-flight WS-4 Phase 3 work as of today (git log shows a same-day TDD red-phase commit), not legacy debt.
    **One real, much smaller item survives:** `tracer.ts`'s `makeTracer` hand-rolls parent/child span context via a manual `Ref<{traceId,spanId,parentSpanId}>` instead of Effect's built-in `Tracer` service + `FiberRef`-based automatic propagation. Swapping the internal plumbing (keep the same `obs.withSpan` public API) is a legitimate cleanup, but it's actively used and covered by 6 test files — Medium risk for Low-Medium reward, lower priority than anything else in this list. Not attempted this session.

11. **`console.log`/`console.warn` inside domain services — PARTIALLY RESOLVED 2026-09-03.** `packages/gateway/src/services/scheduler-service.ts:148,157` fixed (`console.log` → `yield* Effect.logDebug`/`Effect.logInfo`) — these sites were genuinely mechanical, already inside `Effect.gen`. Verified: gateway typecheck clean, build green, 123/123 tests pass, log line now carries fiber ID confirming it's routed through Effect's logger.
    **Still open, NOT mechanical (re-scoped):** `packages/reactive-intelligence/src/skills/skill-registry.ts:66,84` (`parseSimpleYamlBlock`, `buildInstalledSkillFromParsed`) and `skill-resolver.ts:118` (`mergeWithPrecedence`) are plain synchronous helper functions with zero Effect footprint — no surrounding `Effect.gen`/`yield*` to hook into. Fixing these properly means changing their signatures to return `Effect` and touching every caller (`discoverSkills`, `parseSKILLmd`, `reactive-agent.ts`), not a 1-line swap. Do NOT wrap with `Effect.runSync(Effect.logWarning(...))` as a shortcut — that bypasses the calling fiber's log-level/context, which is the exact problem this item exists to fix. Treat as a Medium-effort signature-change item if ever prioritized, not a quick win.

12. ~~**`completeStructured()` retry loop duplicated across all 5 LLM providers**~~ — **RESOLVED 2026-09-03.** `anthropic.ts`, `gemini.ts`, `litellm.ts`, `openai.ts`, `local.ts` each independently hand-rolled the identical skeleton (attempt loop, repair-prompt injection using the previous attempt's error, `JSON.parse` + `Schema.decodeUnknownEither`, `parseAttempts` accumulation, final `LLMParseError`) — only the actual API call + prompt wording differed. Extracted to `packages/llm-provider/src/structured-parse-retry.ts`'s `runStructuredParseWithRetry()`; each provider now supplies only a `runAttempt({attempt, lastError}) => Effect<string, LLMErrors>` closure with its provider-specific request-building. Note: this is NOT a `Schedule` candidate — `Effect.retry`/`Schedule` re-run the *same* effect on failure, but this loop feeds the previous error into the *next* request's messages, so the shared `for` loop inside `Effect.gen` is the correct idiom; `Schedule` was considered and rejected. New unit tests in `tests/structured-parse-retry.test.ts` (5 cases: first-attempt success, retry-with-error-threading, schema-decode-failure retry, exhaustion → `LLMParseError` with all attempts, non-parse-error passthrough) — no prior test coverage existed for this loop's internals at the provider level. Verified: typecheck clean on first pass all 5 files, full monorepo build green (37/37), llm-provider suite 451/451 (446 baseline + 5 new).

13. **`Layer.scoped` cleanup gap — INVESTIGATED 2026-09-03, NO GENUINE LEAK FOUND.** Checked `packages/tools/src/mcp/mcp-client.ts` (Docker container lifecycle) and `packages/runtime/src/agent/gateway-runner.ts` (`setInterval`). Both manage their resource entirely outside the `Layer` system (plain imperative modules, zero `Layer`/`acquireRelease`/`addFinalizer` usage) but both have real, working cleanup: `mcp-client.ts` via `cleanupConnectionEntry()` + `process.on("exit"/"SIGINT"/"SIGTERM")` handlers (deliberately hardened per HS-12 — "library code must not unilaterally call process.exit"); `gateway-runner.ts`'s timer via `getTimer()` cleared in `gateway-driver.ts:230`'s `buildGatewayHandle().stop()` chain. `packages/gateway/src/services/` has zero timer usage at all (cron is computed on-demand, not self-scheduled) — nothing there. **Recommendation: leave both alone.** Converting either to `Layer.scoped` would be a real idiom-consistency win but touches process-signal semantics specifically hardened against a past bug, for no leak-fixing benefit (nothing currently leaks) — Medium-High risk for Medium reward, lower priority than every other item in this list. Do not re-flag this as "missing Layer.scoped = bug" in future passes without checking the actual lifecycle first (naive grep for `setInterval`/docker-spawn without `Layer.scoped` nearby produces false positives here).

### Keeping this skill accurate

After large kernel or adapter changes, refresh the **Known Architecture Debt** section and the **Quick ROI** table so audits do not chase fixed problems.

### Kernel Extension Points (prefer these over new files)
- **New phase** → `packages/reasoning/src/kernel/capabilities/<cap>/<name>.ts`, insert via `makeKernel({ phases: [...] })`
- **New guard** → add `Guard` fn to `kernel/capabilities/act/guard.ts`, add to `defaultGuards[]`
- **New meta-tool** → one entry in `metaToolRegistry` in `kernel/capabilities/act/act.ts`

### Bun Constraints
- Fast startup → avoid over-layering at runtime initialization boundaries
- `bun:sqlite` is synchronous → always `Effect.sync(() => db.query(...))`, never `Effect.tryPromise`
- Native `fetch` / file I/O → wrap in `Effect.tryPromise` with typed `catch`
- ESM + bundling → avoid abstractions that break tree-shaking (no barrel re-exports of large modules)

---

## Anti-Abstraction Signals

Call out where abstraction should **NOT** be added:

| Pattern | Reason to Leave Alone |
|---------|----------------------|
| Single-use `Effect.gen` blocks | Inline is clearer than a named combinator |
| `think.ts` streaming loop | Hot path; abstraction adds call stack overhead |
| Provider-specific formatting in `*-adapter.ts` | Each adapter is intentionally isolated |
| `kernel-state.ts` core shape | Avoid opaque runtime wrappers around `KernelState`; **extending** declared types (e.g. structured `meta`) is good when it improves safety |
| Test helpers that call `Effect.runPromise` | Localized; not worth a shared util |

---

## Output Format

Structure findings as:

### 1. Executive Summary
One paragraph: what the most significant architectural gap is and why it matters now.

### 2. High-ROI Abstractions (Detailed)
For each:
- **Signal** (which of A–G)
- **Current Pattern (Before)** — exact file path + line range
- **Proposed Abstraction (After)** — typed code snippet
- **Why It Works** — Effect composability, type safety, testability
- **Impact** — duplication reduction, coverage improvement, refactor risk (low/medium/high)

### 3. Medium / Low ROI
Name + one-sentence rationale. No full treatment needed.

### 4. Anti-Abstraction Findings
Patterns that look like candidates but should stay inline.

### 5. Incremental Refactoring Plan
Ordered steps, each independently shippable. Each step must:
- Leave the build green (`bun run build` passes)
- Leave tests green (`bun test` passes)
- Not require coordinated changes across >3 packages simultaneously

---

## Quick ROI Reference

| Signal | Typical ROI | Refactor Risk |
|--------|-------------|---------------|
| Repeated Effect pipelines (3+ sites) | High | Low |
| Missing `Context.Tag` for injected deps | High | Medium |
| Dead code / unused exports (e.g. unused context builders) | High | Low |
| Untyped `KernelState.meta` forcing `as any` | High | Medium |
| Stale skill/docs claims vs actual wiring | Low | Low |
| Error channel consolidation | Medium | Low |
| Layer fragmentation | Medium | Medium |
| New phase extraction | Medium | Low |
| Conditional explosion in strategies | Low–Medium | High |
