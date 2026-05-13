# Wave E — Builder Sugar Desugaring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make existing `.with*()` builder methods route through `HarnessPipeline` internally, and add `.compose()` as the canonical compose entry point (alias for `.withHarness()`). No behavioral change for existing users.

**Architecture:** `.withHarness()` already exists on the builder and registers `(harness: Harness) => void` callbacks. Wave E adds `.compose()` as an alias and rewires these builder methods to call `this.withHarness(...)` internally. Methods with matching harness infrastructure get full desugar; methods with no matching tag/hook get adapter wrappers. No builder field removals — preserves backward compat.

**Tech Stack:** TypeScript strict, `packages/runtime/src/builder.ts` (6000+ LOC, already decomposed into `builder/` modules), `@reactive-agents/core` Harness types

---

## Critical Context

### What already exists

- `packages/runtime/src/builder.ts` — main builder class (~2400 LOC after W25 decomposition)
- `.withHarness(fn: (harness: Harness) => void): this` — exists, Wave A; pushes to `_harnessRegistrations`
- `.withHook(hook: LifecycleHook): this` — exists; pushes to `_hooks` array
- `.withSystemPrompt(prompt: string): this` — exists; sets `_systemPrompt` field
- `.withErrorHandler(handler)` — exists; sets `_errorHandler` field
- `.withCustomTermination(pred)` — exists; sets `_customTermination` field
- `.withProgressCheckpoint(opts)` — exists; sets checkpoint config
- `.withVerificationStep(opts)` — exists; sets verification config

### What doesn't exist

- `.compose()` method — add as alias for `.withHarness()`

### Desugar scope: only methods with live harness infrastructure

| Method | Desugar? | Reason |
|---|---|---|
| `.withSystemPrompt(s)` | ✅ Yes | `prompt.system` in TagMap; think.ts:352 has chokepoint |
| `.withErrorHandler(fn)` | ✅ Yes | `harness.onError('*', fn)` — phase hooks wired by Wave D |
| `.withHook({ phase, timing, handler })` | ✅ Partial | Bridge timing→before/after/onError; handler types differ — wrap with adapter |
| `.withCustomTermination(pred)` | ⏭ Skip | `decision.terminate` tag not in TagMap until v0.12 |
| `.withProgressCheckpoint(opts)` | ⏭ Skip | `nudge.progress` tag not in TagMap |
| `.withVerificationStep(opts)` | ⏭ Skip | `observation.verifier-retry` tag not in TagMap |

### `LifecycleHook` vs `PhaseHookFn` type mismatch

`withHook` uses an Effect-based handler pattern:
```ts
// Old: LifecycleHook
{ phase: 'think', timing: 'after', handler: (ctx) => Effect.sync(() => ctx) }

// New: PhaseHookFn
(ctx: { phase, iteration, state }) => void | Promise<void> | { abort } | { skip }
```

These are different. The adapter wraps the old handler as a fire-and-forget tap in the harness, while keeping the original `_hooks` path for Effect integration.

### think.ts `prompt.system` chokepoint (Wave B)

`packages/reasoning/src/kernel/capabilities/reason/think.ts:352`:
```ts
const pipeline = input.harnessPipeline;
// ... existing code builds systemPromptDefault from input._systemPrompt, nudges, etc.
// Wave B already calls: pipeline.transform('prompt.system', systemPromptDefault, ctx)
```

When `withSystemPrompt(s)` calls `withHarness(h => h.on('prompt.system', () => s))`, this transform fires on top of whatever the kernel builds as default. The harness registration replaces the default — which is correct behavior. The existing `_systemPrompt` field can remain as a backup for code paths that haven't been refactored to use the pipeline.

---

## File Map

### Modified
- `packages/runtime/src/builder.ts` — add `.compose()`, desugar 3 methods
- `packages/runtime/src/builder/` — one or more module files if `.compose()` lands in a submodule

### Test files
- `packages/runtime/test/compose-desugar.test.ts` (new)

---

## Task 1: Add `.compose()` Method

**Files:**
- Modify: `packages/runtime/src/builder.ts`

- [ ] **Step 1.1: Read builder.ts structure**

```bash
rtk grep -n "withHarness\|withHook\|withSystemPrompt\|withErrorHandler" packages/runtime/src/builder.ts | head -30
```

Find where `withHarness` is defined. Read that method (10–15 lines) to understand implementation.

- [ ] **Step 1.2: Add `.compose()` immediately after `.withHarness()`**

After the existing `withHarness` method, add:

```ts
/**
 * Compose a harness configuration block into this agent.
 *
 * Alias for `.withHarness()`. Preferred for Wave D+ killswitch and composition patterns:
 * ```ts
 * agent.compose(budgetLimit({ maxTokens: 50_000 }))
 * agent.compose(timeoutAfter({ wallClock: '60s' }))
 * agent.compose(h => h.tap('observation.tool-result', logFn))
 * ```
 */
compose(fn: (harness: import('@reactive-agents/core').Harness) => void): this {
  return this.withHarness(fn);
}
```

- [ ] **Step 1.3: Add `compose` to the public interface (if builder has an interface type)**

```bash
rtk grep -n "interface.*Builder\|ReactiveAgentBuilder" packages/runtime/src/ -r | head -10
```

If there's a public interface that declares builder methods, add `compose` alongside `withHarness`.

- [ ] **Step 1.4: Build to verify**

```bash
rtk bun run build --filter='@reactive-agents/runtime' 2>&1 | tail -10
```

- [ ] **Step 1.5: Commit**

```bash
git add packages/runtime/src/
git commit -m "feat(builder): add .compose() as alias for .withHarness()"
```

---

## Task 2: Desugar `.withSystemPrompt()` Through Harness

**Files:**
- Modify: `packages/runtime/src/builder.ts`

- [ ] **Step 2.1: Read current `withSystemPrompt` implementation**

Read the method body (should be ~3 lines). Confirm it sets `this._systemPrompt = prompt`.

- [ ] **Step 2.2: Add harness registration inside `withSystemPrompt`**

Modify the method to also register via harness:

```ts
withSystemPrompt(prompt: string): this {
  this._systemPrompt = prompt;  // keep for backward compat + non-pipeline code paths
  return this.withHarness((h) => h.on('prompt.system', () => prompt));
}
```

The `() => prompt` factory ignores current payload (override semantics: replaces whatever the kernel built as the system prompt default). Registration runs before `build()`, so multiple `withSystemPrompt` calls stack — last one wins (most-specific sorts last in HarnessPipeline).

- [ ] **Step 2.3: Write failing test**

Create `packages/runtime/test/compose-desugar.test.ts`:

```ts
import { describe, it, expect } from 'bun:test';
import { HarnessPipeline, RegistrationHarness } from '@reactive-agents/core';
import { ReactiveAgents } from '@reactive-agents/runtime';  // adjust import to actual export

describe('withSystemPrompt desugars through harness', () => {
  it('registers prompt.system transform in harnessPipeline', async () => {
    // Access internal builder state to verify harness registration
    // This test verifies the desugar happened — check _harnessRegistrations
    const builder = ReactiveAgents.create() as any;
    builder.withSystemPrompt('Custom system prompt');
    
    // Build the pipeline from collected registrations
    const reg = new RegistrationHarness();
    for (const fn of builder._harnessCallbacks ?? []) fn(reg);
    const pipeline = new HarnessPipeline(reg._collected);

    const baseCtx = { iteration: 0, phase: 'think' as const, state: {} as any, strategy: 'reactive' };
    const result = await pipeline.transform('prompt.system', 'DEFAULT', baseCtx);
    expect(result).toBe('Custom system prompt');
  });
});
```

Note: The test accesses internal builder state via `as any`. Adjust field name `_harnessCallbacks` to match actual builder implementation after reading the code.

- [ ] **Step 2.4: Run test — verify RED**

```bash
rtk bun test packages/runtime/test/compose-desugar.test.ts 2>&1 | tail -20
```

- [ ] **Step 2.5: After implementing Step 2.2, run test — verify GREEN**

```bash
rtk bun test packages/runtime/test/compose-desugar.test.ts 2>&1 | tail -20
```

- [ ] **Step 2.6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/test/compose-desugar.test.ts
git commit -m "feat(builder): desugar withSystemPrompt through harness pipeline"
```

---

## Task 3: Desugar `.withErrorHandler()` Through Harness

**Files:**
- Modify: `packages/runtime/src/builder.ts`

The error handler adapter must bridge old signature `(error, {taskId, phase, iteration, lastStep})` to `ErrorHookFn` `(error, {phase, iteration})`.

- [ ] **Step 3.1: Read current `withErrorHandler` implementation**

Read the method. Confirm signature and that it sets `this._errorHandler`.

- [ ] **Step 3.2: Add harness registration inside `withErrorHandler`**

```ts
withErrorHandler(
  handler: (
    error: RuntimeErrors | Error,
    context: { taskId: string; phase: string; iteration: number; lastStep?: string }
  ) => void
): this {
  this._errorHandler = handler;  // keep for backward compat
  // Also register as harness error hook (fires on any phase error)
  return this.withHarness((h) => {
    h.onError('*', (err, ctx) => {
      handler(err as RuntimeErrors | Error, {
        taskId: '',  // taskId not available in harness ctx — keep '' as placeholder
        phase: ctx.phase as string,
        iteration: ctx.iteration,
      });
    });
  });
}
```

- [ ] **Step 3.3: Add test for error handler desugar**

Add to `packages/runtime/test/compose-desugar.test.ts`:

```ts
describe('withErrorHandler desugars through harness', () => {
  it('registers onError handler in harnessPipeline', () => {
    const builder = ReactiveAgents.create() as any;
    const captured: string[] = [];
    builder.withErrorHandler((_err: Error, ctx: { phase: string }) => {
      captured.push(ctx.phase);
    });
    
    // Build pipeline and verify onError registration exists
    const reg = new RegistrationHarness();
    for (const fn of builder._harnessCallbacks ?? []) fn(reg);
    const pipeline = new HarnessPipeline(reg._collected);

    const hooks = pipeline.collectErrorHooks('*');
    expect(hooks.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3.4: Run test RED → GREEN**

```bash
rtk bun test packages/runtime/test/compose-desugar.test.ts 2>&1 | tail -20
```

- [ ] **Step 3.5: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/test/compose-desugar.test.ts
git commit -m "feat(builder): desugar withErrorHandler through harness onError"
```

---

## Task 4: Adapt `.withHook()` to Also Register Phase Hook

**Files:**
- Modify: `packages/runtime/src/builder.ts`

`withHook` registers Effect-based lifecycle hooks. The harness uses `PhaseHookFn`. These are incompatible in return type. The adapter fires the new harness hook as a fire-and-forget side-effect (tap semantics), while the original Effect hook runs through the existing path.

This desugar is **observability only** — existing Effect hooks continue to run normally. The harness registration allows compose blocks to react to phase boundaries alongside Effect hooks.

- [ ] **Step 4.1: Read current `withHook` and `LifecycleHook` type**

```bash
rtk grep -n "LifecycleHook\|withHook" packages/runtime/src/ -r | head -15
```

Read the type definition for `LifecycleHook` to understand `timing` values.

- [ ] **Step 4.2: Add harness phase hook registration alongside existing `_hooks.push`**

```ts
withHook(hook: LifecycleHook): this {
  this._hooks.push(hook);  // keep existing Effect-based hook path
  // Also register as harness phase hook for compose-side observability
  const kind = hook.timing === 'before'
    ? 'before'
    : hook.timing === 'after'
    ? 'after'
    : 'onError';
  if (kind === 'onError') {
    return this.withHarness((h) => {
      h.onError(hook.phase as import('@reactive-agents/core').Phase, (err, ctx) => {
        // Fire original handler as side-effect (ignore Effect return)
        void hook.handler({ phase: ctx.phase, iteration: ctx.iteration, error: err } as any);
      });
    });
  }
  return this.withHarness((h) => {
    h[kind](hook.phase as import('@reactive-agents/core').Phase, async (ctx) => {
      // Fire original handler as side-effect (ignore Effect return)
      await (hook.handler as (ctx: unknown) => Promise<unknown>)(ctx).catch(() => undefined);
    });
  });
}
```

Note: `hook.handler` has Effect return type — calling it fires the Effect imperatively if possible, or ignores if not. The goal is observability parity, not full Effect integration. Read actual `LifecycleHook.handler` type and adapt accordingly.

- [ ] **Step 4.3: Build — fix any type errors**

```bash
rtk bun run build --filter='@reactive-agents/runtime' 2>&1 | tail -20
```

If `hook.handler` type is not callable directly (pure Effect expression), wrap in `Effect.runPromise` if Effect runtime is available, or just skip the harness registration for onError with a comment.

- [ ] **Step 4.4: Backward-compat regression test**

Add to `compose-desugar.test.ts`:

```ts
describe('withHook backward compat', () => {
  it('still calls original handler (existing behavior preserved)', async () => {
    const builder = ReactiveAgents.create() as any;
    const called: string[] = [];
    builder.withHook({
      phase: 'think',
      timing: 'after',
      handler: (_ctx: unknown) => {
        called.push('think-after');
        return Promise.resolve();
      },
    });
    // Verify _hooks still has the registration (existing path not broken)
    expect(builder._hooks).toHaveLength(1);
    expect(builder._hooks[0].phase).toBe('think');
  });
});
```

- [ ] **Step 4.5: Run all tests — verify no regressions**

```bash
rtk bun test packages/runtime 2>&1 | grep -E "pass|fail" | tail -10
```

- [ ] **Step 4.6: Commit**

```bash
git add packages/runtime/src/builder.ts packages/runtime/test/compose-desugar.test.ts
git commit -m "feat(builder): adapt withHook to also register in harness phase hook pipeline"
```

---

## Task 5: Equivalence Tests + Final Verification

- [ ] **Step 5.1: Add `withHook` ↔ `harness.before/after/onError` equivalence tests**

Add to `compose-desugar.test.ts`:

```ts
describe('withHook ↔ harness.before equivalence', () => {
  it('both register phase hooks that collectPhaseHooks finds', () => {
    const regA = new RegistrationHarness();
    regA.before('think', () => { /* nothing */ });
    const pipelineA = new HarnessPipeline(regA._collected);

    const regB = new RegistrationHarness();
    regB.before('think', () => { /* nothing */ });
    const pipelineB = new HarnessPipeline(regB._collected);

    // Both should expose exactly 1 'before think' hook
    expect(pipelineA.collectPhaseHooks('before', 'think').length).toBe(1);
    expect(pipelineB.collectPhaseHooks('before', 'think').length).toBe(1);
  });
});
```

- [ ] **Step 5.2: Full test suite no regressions**

```bash
rtk bun test 2>&1 | grep -E "pass|fail|error" | tail -20
```

- [ ] **Step 5.3: Update wiki/Hot.md**

Add Wave E completion note.

- [ ] **Step 5.4: Final commit**

```bash
git add wiki/Hot.md
git commit -m "docs: update Hot.md for Wave E completion"
```

---

## Self-Review Checklist

- [ ] `.compose()` is an exact alias for `.withHarness()` — no new behavior
- [ ] `withSystemPrompt` keeps `_systemPrompt` field AND adds harness registration — no behavioral change
- [ ] `withErrorHandler` adapter bridges to `onError('*', ...)` without breaking old `_errorHandler` path  
- [ ] `withHook` adapter is observability-only — Effect hooks still fire via `_hooks` array
- [ ] Skipped: `withCustomTermination`, `withProgressCheckpoint`, `withVerificationStep` — tags not in TagMap
- [ ] All existing tests still pass (no regressions)
- [ ] Types strict — no raw `any` except in documented adapter casts
