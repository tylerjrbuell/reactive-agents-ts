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

Re-verify counts and wiring before each audit (`wc -l`, `rg`); the bullets below were last aligned with the tree in **2026-04**.

1. **`KernelState.meta` is an open bag** — `meta: Readonly<Record<string, unknown>>` in `packages/reasoning/src/kernel/state/kernel-state.ts` forces `(state.meta as any).entropy` and related casts across `think.ts`, `act.ts`, `runner.ts`, `reactive-observer.ts`. High ROI: introduce a structured `KernelMeta` (or typed slices) and migrate call sites incrementally.

2. **`buildDynamicContext` is dead in the live kernel path** — Implemented and exported from `packages/reasoning/src/context/context-engine.ts`, but the think phase uses **`buildStaticContext` only**. Tests (`packages/reasoning/tests/strategies/kernel/phases/think-system-prompt.test.ts`) assert `think.ts` does not reference `buildDynamicContext`. **`buildStaticContext` is active**, not legacy. Decide: wire dynamic context into FC messages, or deprecate/remove the export and shrink the public surface.

3. **`context-engine.ts` size** — On the order of **~500 LOC** (not ~690). It holds scoring, environment/rules/tool-reference builders, **both** static and dynamic context builders, and helpers. The maintenance issue is the **unused dynamic path**, not “mostly dead file.”

4. **Provider adapter hooks — all seven wired** — `ProviderAdapter` in `packages/llm-provider/src/adapter.ts` is consumed in the kernel as follows (confirm with `rg` if paths move):
   - `systemPromptPatch`, `toolGuidance` → `packages/reasoning/src/kernel/capabilities/reason/think.ts`
   - `taskFraming` → `packages/reasoning/src/kernel/capabilities/attend/context-utils.ts`
   - `continuationHint`, `qualityCheck` → `think.ts`
   - `errorRecovery`, `synthesisPrompt` → `packages/reasoning/src/kernel/capabilities/act/act.ts`
   Do not file issues for “unwired hooks” without checking these files first.

5. **Adaptive meta-strategy defaults off** — Routing exists (`packages/reasoning/src/strategies/adaptive.ts`, selected when `config.adaptive.enabled` in `packages/reasoning/src/services/reasoning-service.ts`). **`defaultReasoningConfig` sets `adaptive.enabled: false`** in `packages/reasoning/src/types/config.ts`. That is a product/default choice, not absent multi-step routing code.

6. **Duplicated output-quality gate** — `enforceOutputQualityGate` is copy-pasted in `plan-execute.ts` and `reflexion.ts` with a behavioral drift risk (e.g. `stripThinking` on synthesized content in one path but not the other). Candidate for one shared kernel util module.

7. **`ContextProfile` vs runtime `maxTokens`** — Call sites use `(contextProfile as any)?.maxTokens` because `ContextProfileSchema` in `packages/reasoning/src/context/context-profile.ts` does not declare `maxTokens`. Optional schema field or adjacent limits type removes the cast.

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
