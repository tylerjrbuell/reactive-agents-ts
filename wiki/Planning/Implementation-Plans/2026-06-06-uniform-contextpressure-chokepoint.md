# Uniform ContextPressure via observable-llm chokepoint (2026-06-06)

Branch: `fix/cortex-uniform-trace-events-2026-06-06`

## Problem (user-reported)

1. Plan-Execute-Reflect shows context in Cortex only near run-end; Reactive tracks realtime.
2. Gauge must use the **exact** numCtx the provider received (honor user `numCtx` overrides), not the model's assumed/max context length.
3. (separate, untouched) status bar sometimes shows invalid `18/10` iteration count.

User directives (verbatim intent):
- "Lets make sure all strategies paths emit these events uniformly."
- "Ensure we have proper a mechanism to allow important data like this to flow out of the providers to allow best transparency."

## Empirical root cause (probe-verified, qwen3.5 + ollama, GREEN runs)

ContextPressure (CP) was emitted only from kernel-hooks `onThought`. Probe findings:

- **Reactive (top kernel):** has EventBus → hooks fire → CP every think. Realtime. ✓
- **Plan-execute:** emits **ZERO** CP. Reasons:
  - Step sub-kernels run via `executeReActKernel` with **no eventBus** → `buildKernelHooks(None)` → all hooks no-op. Per-strategy hooks **cannot** reach sub-kernels.
  - plan-gen (`extractStructuredOutput`), analysis steps (`step-executor.ts:273` `complete()`), and reflect (`runCritiquePass` `complete()`) are **direct LLM calls** that never had hooks.

The one layer ALL calls flow through is **`observable-llm.ts` `makeObservableLLM`** (applied at `runtime.ts:528`, wraps LLMService). It uses **ambient** `Effect.serviceOption(EventBus)` (not an explicit param), so it fires even inside eventBus-less sub-kernels — **probe-confirmed: chokepoint fired for every plan-execute phase**. This is the "mechanism to flow data out of providers" the user asked for.

### Correlation gate

Chokepoint reads `request.traceContext?.taskId`. Only `think.ts:619` (kernel stream) sets it today. Non-kernel calls fall back to `"llm-direct"`. Gating CP emission on `traceContext.taskId` present:
- gives a real taskId (Cortex correlation), AND
- filters out aux calls (intent classifier, synthesis) that should NOT drive the gauge.

So we **thread traceContext into the reasoning calls we want** (plan-gen, analysis step, reflect); tool_call/composite steps already carry it via think.ts (sub-kernel `state.taskId` = parent taskId).

### Provider transparency (bug 2 — already shipped on branch)

`local.ts` populates `resolvedParams.contextWindow` = the exact resolved `num_ctx` (`request.numCtx ?? config.explicitNumCtx ?? capability.recommendedNumCtx ?? config.defaultNumCtx`). Probe confirmed `win=32768` (real, honors override). `types.ts` carries `resolvedParams` on `CompletionResponse` + StreamEvent `usage` variant.

## Design

Single emission point: `observable-llm.ts` `emitForRequest`. After `emitLLMExchange`, also emit `ContextPressure` when:
`traceContext?.taskId` present AND `usage.inputTokens > 0` AND `resolvedParams.contextWindow > 0`.
Compute util/level identically to the old kernel-hooks helper. Use the same `Effect.serviceOption(EventBus)` pattern so the Layer stays `R = never`.

Capture `resolvedParams.contextWindow`:
- complete path: from `response.resolvedParams`.
- stream path: from the `usage` StreamEvent into the accum, passed in fullResponse.

### Remove the now-redundant scattered mechanism (avoid double-emit on reactive)

- `kernel-hooks.ts`: delete `contextPressureEvent` + the `onThought` CP block (revert onThought to publish only ReasoningStepCompleted).
- `think.ts`: delete `accumulatedContextWindow` capture, `resolvedParams` threading into `thoughtResponse`, and the `lastContextTokens`/`lastContextWindow` meta writes (now dead — only consumer was kernel-hooks).
- `kernel-state.ts`: remove `lastContextTokens`/`lastContextWindow` KernelMeta fields.

### Leave alone

- `inline-think.ts`: keeps its own CP (sets no traceContext → chokepoint won't double-emit; mutually-exclusive path from kernel).

### Known gap (surface to user, do not hide under "uniform")

When a provider uses **native JSON mode**, plan-gen routes through `completeStructured` which returns parsed data only (no usage) → chokepoint cannot emit CP for that one call. The gauge populates once steps start. (For qwen3.5 here plan-gen used prompt-mode `complete()` and WAS covered.)

## File map

Kernel-scope (route via **kernel-warden**):
- `packages/reasoning/src/kernel/observable-llm.ts` — capture resolvedParams + emit CP (gated).
- `packages/reasoning/src/kernel/state/kernel-hooks.ts` — remove CP.
- `packages/reasoning/src/kernel/capabilities/reason/think.ts` — remove dead meta plumbing.
- `packages/reasoning/src/kernel/state/kernel-state.ts` — remove dead fields.
- `packages/reasoning/src/kernel/capabilities/verify/critique.ts` — add optional `traceContext`, set on `complete()`.

Non-kernel (direct):
- `packages/reasoning/src/structured-output/pipeline.ts` — thread traceContext into completeStructured + complete.
- `packages/reasoning/src/strategies/plan-execute/step-executor.ts` — traceContext on analysis `complete()`.
- `packages/reasoning/src/strategies/plan-execute.ts` — pass traceContext to extractStructuredOutput + runCritiquePass.
- `packages/llm-provider/src/types.ts`, `providers/local.ts` — resolvedParams contract + population (DONE on branch).

## Verification

- Probe (temporary, deleted): reactive CP realtime ✓, exact window 32768 ✓.
- After build: plan-execute emits correlated CP across plan/execute/reflect (re-run a GREEN plan-execute-reflect, assert ≥3 CP events with real taskId).
- Unit: chokepoint emits CP when traceContext+usage+window present; none when traceContext absent.
- Update `kernel-hooks.test.ts` (CP assertions removed), keep `reactive-events.test.ts` integration guard green (CP now from chokepoint).
- `bunx turbo run typecheck` + reasoning suite green.

## Out of scope

Bug 3 (`18/10` iteration display) — separate fix.
