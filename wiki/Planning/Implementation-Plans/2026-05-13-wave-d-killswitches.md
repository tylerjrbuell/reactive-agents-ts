# Wave D — packages/compose + 6 Killswitches Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create `packages/compose` with 6 prebuilt killswitch compositions AND wire `harnessPipeline.collectPhaseHooks()` into `runner.ts` (the blocker that makes phase hooks functional).

**Architecture:** Task 0 is a blocker — without it, `before/after` phase hooks registered via `withHarness()` are stored but never called. Task 0 wires them into the main kernel loop. Tasks 1–4 create the new `packages/compose` package with 6 killswitches built on top of the now-wired phase hook infrastructure.

**Tech Stack:** TypeScript (strict, no `any`), Bun test runner, Effect for generator yields in runner.ts, existing `HarnessPipeline` / `PhaseHookFn` APIs from `packages/core`

---

## Critical Context

### The Blocker (Task 0)

`HarnessPipeline.collectPhaseHooks()` and `collectErrorHooks()` are defined at:
- `packages/core/src/services/harness-pipeline.ts:134` — `collectPhaseHooks(kind, phase)`
- `packages/core/src/services/harness-pipeline.ts:146` — `collectErrorHooks(phase)`

**Zero call sites exist anywhere in the codebase.** Phase hooks are registered and silently discarded. Task 0 fixes this.

### PhaseHookFn return values (NOT `harness.stop()`)

The spec shows `harness.stop()` inside hooks — but `Harness` interface has no `stop()` method. The actual API:

```ts
// packages/core/src/services/harness-types.ts
type PhaseHookFn<_Ph extends Phase> = (ctx: {
  readonly phase: _Ph;
  readonly iteration: number;
  readonly state: Readonly<KernelStateLike>;
}) =>
  | void
  | Promise<void>
  | { readonly skip: true }           // skip this iteration (loop continues)
  | { readonly abort: 'stop' | 'terminate'; readonly reason?: string };  // break loop
```

All killswitches MUST use `return { abort: 'stop' }` or `return { abort: 'terminate' }`. Never `harness.stop()`.

### Available Tags (Wave D constraint)

Only these 7 tags exist in TagMap — killswitches must not reference others:
```
'prompt.system' | 'nudge.loop-detected' | 'nudge.healing-failure' |
'message.tool-result' | 'observation.tool-result' | 'lifecycle.failure' |
'control.strategy-evaluated'
```

`cost.tracked`, `decision.terminate` — NOT in TagMap yet. Killswitches use phase hooks instead.

### Key file locations

- `packages/reasoning/src/kernel/loop/runner.ts:616` — main while loop
- `packages/reasoning/src/kernel/loop/runner.ts:649–657` — phase log + `kernel()` call
- `packages/reasoning/src/kernel/state/kernel-state.ts:430` — `KernelInput.harnessPipeline?: HarnessPipeline`
- `packages/reasoning/src/kernel/capabilities/act/act.ts:1023` — `pipeline = input.harnessPipeline`
- `packages/guardrails/` — reference layout for new package scaffolding

---

## File Map

### Modified
- `packages/reasoning/src/kernel/loop/runner.ts` — wire `collectPhaseHooks` for 'bootstrap', 'think', 'complete'
- `packages/reasoning/src/kernel/capabilities/act/act.ts` — wire `collectPhaseHooks` for 'act'

### Created
```
packages/compose/
  package.json
  tsconfig.json
  src/
    killswitches/
      budget-limit.ts
      timeout-after.ts
      max-iterations.ts
      require-approval-for.ts
      watchdog.ts
      confidence-floor.ts
    index.ts
  test/
    killswitches.test.ts
```

---

## Task 0: Wire Phase Hooks in runner.ts (BLOCKER)

**Files:**
- Modify: `packages/reasoning/src/kernel/loop/runner.ts`

This task unblocks everything. Without it, all `harness.before/after` registrations are silently discarded.

- [ ] **Step 0.1: Read runner.ts loop section**

Read lines 580–700 to understand full loop context (variable scope, imports, state type).

- [ ] **Step 0.2: Add helper function to run before/after hooks**

Immediately after the existing imports at the top of runner.ts, add a typed helper. Find where `HarnessPipeline` is (or isn't) imported and add if missing:

```ts
import type { HarnessPipeline, Phase } from '@reactive-agents/core'
```

Then add this helper near other local helpers (before the exported `run` function):

```ts
/** Runs before/after phase hooks; returns abort signal if any hook requests it. */
async function runPhaseHooks(
  pipeline: HarnessPipeline | undefined,
  kind: 'before' | 'after',
  phase: Phase,
  iteration: number,
  state: KernelStateLike,
): Promise<{ abort: 'stop' | 'terminate'; reason?: string } | undefined> {
  if (!pipeline) return undefined;
  const hooks = pipeline.collectPhaseHooks(kind, phase);
  for (const hook of hooks) {
    const result = await hook({ phase, iteration, state });
    if (result && typeof result === 'object' && 'abort' in result) {
      return result as { abort: 'stop' | 'terminate'; reason?: string };
    }
  }
  return undefined;
}
```

- [ ] **Step 0.3: Wire 'bootstrap' hooks (once, before while loop)**

Locate the line just before `while (state.status !== "done" && ...)` at line ~616. Insert:

```ts
// Fire 'bootstrap' phase hooks once before the loop starts.
{
  const harnessPipeline = effectiveInput.harnessPipeline;
  const bootstrapAbort = await runPhaseHooks(harnessPipeline, 'before', 'bootstrap', 0, state);
  if (bootstrapAbort) {
    state = transitionState(state, {
      status: bootstrapAbort.abort === 'terminate' ? 'failed' : 'done',
      output: state.output ?? '',
    });
  }
}
```

Note: `runPhaseHooks` is an async function but runner.ts uses Effect generators (`yield*`). Wrap with `yield* Effect.promise(...)`:

```ts
const harnessPipeline = effectiveInput.harnessPipeline;
const bootstrapAbort = yield* Effect.promise(() =>
  runPhaseHooks(harnessPipeline, 'before', 'bootstrap', 0, state)
);
if (bootstrapAbort) {
  state = transitionState(state, {
    status: bootstrapAbort.abort === 'terminate' ? 'failed' : 'done',
    output: state.output ?? '',
  });
}
```

- [ ] **Step 0.4: Wire 'think' before/after hooks around kernel() call**

Current lines 649–657:
```ts
const kernelPhaseStart = Date.now();
yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });
state = yield* kernel(state, currentContext);
yield* emitLog({
  _tag: "phase_complete",
  phase: "think",
  ...
});
```

Replace with:
```ts
const kernelPhaseStart = Date.now();
yield* emitLog({ _tag: "phase_started", phase: "think", timestamp: new Date() });

// 'before think' hooks — may abort iteration
const beforeThinkAbort = yield* Effect.promise(() =>
  runPhaseHooks(effectiveInput.harnessPipeline, 'before', 'think', state.iteration, state)
);
if (beforeThinkAbort) {
  state = transitionState(state, {
    status: beforeThinkAbort.abort === 'terminate' ? 'failed' : 'done',
    output: state.output ?? '',
  });
  break;
}

state = yield* kernel(state, currentContext);

// 'after think' hooks
yield* Effect.promise(() =>
  runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'think', state.iteration, state)
);

yield* emitLog({
  _tag: "phase_complete",
  phase: "think",
  duration: Date.now() - kernelPhaseStart,
  status: state.status === "failed" ? "error" : "success",
});
```

- [ ] **Step 0.5: Wire 'complete' hooks after the while loop**

Find where the loop exits and final output is assembled (around line 1550+). After the loop ends, add:

```ts
// Fire 'complete' phase hooks once after loop exits normally.
yield* Effect.promise(() =>
  runPhaseHooks(effectiveInput.harnessPipeline, 'after', 'complete', state.iteration, state)
);
```

- [ ] **Step 0.6: Wire 'act' phase hooks in act.ts**

Read `packages/reasoning/src/kernel/capabilities/act/act.ts` around line 1023 where `const pipeline = input.harnessPipeline` is set. Find the act execution entry point and add before/after act hooks:

```ts
const pipeline = input.harnessPipeline;

// 'before act' hooks
if (pipeline) {
  const beforeActHooks = pipeline.collectPhaseHooks('before', 'act');
  for (const hook of beforeActHooks) {
    const result = await hook({ phase: 'act', iteration: state.iteration, state });
    if (result && typeof result === 'object' && 'abort' in result) {
      return { ...state, status: result.abort === 'terminate' ? 'failed' : 'done' };
    }
  }
}
```

Note: act.ts may use different return patterns — read existing code and match the pattern it uses for early returns.

- [ ] **Step 0.7: Build and verify no regressions**

```bash
rtk bun run build --filter='@reactive-agents/reasoning' 2>&1 | tail -20
rtk bun test packages/reasoning --timeout=30000 2>&1 | tail -30
```

Expected: no new type errors, all existing tests pass.

- [ ] **Step 0.8: Commit Task 0**

```bash
git add packages/reasoning/src/kernel/loop/runner.ts packages/reasoning/src/kernel/capabilities/act/act.ts
git commit -m "feat(kernel): wire harness phase hooks into runner loop and act phase"
```

---

## Task 1: Scaffold packages/compose

**Files:**
- Create: `packages/compose/package.json`
- Create: `packages/compose/tsconfig.json`
- Create: `packages/compose/src/index.ts` (stub)

- [ ] **Step 1.1: Read reference package layout**

```bash
cat packages/guardrails/package.json
cat packages/guardrails/tsconfig.json
```

- [ ] **Step 1.2: Create package.json**

Mirror `packages/guardrails/package.json`. Key fields:

```json
{
  "name": "@reactive-agents/compose",
  "version": "0.1.0",
  "description": "Prebuilt killswitch compositions for reactive agents",
  "type": "module",
  "exports": {
    ".": {
      "bun": "./src/index.ts",
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    },
    "./killswitches": {
      "bun": "./src/killswitches/index.ts",
      "import": "./dist/killswitches/index.js",
      "types": "./dist/killswitches/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "bun test"
  },
  "dependencies": {
    "@reactive-agents/core": "workspace:*"
  },
  "devDependencies": {
    "typescript": "workspace:*"
  }
}
```

- [ ] **Step 1.3: Create tsconfig.json**

Mirror `packages/guardrails/tsconfig.json`. Key settings: `strict: true`, `noUncheckedIndexedAccess: true`.

- [ ] **Step 1.4: Create stub src/index.ts**

```ts
export * from './killswitches/index.js';
export { killswitches } from './killswitches/registry.js';
```

- [ ] **Step 1.5: Add to workspace root turbo pipeline**

Check `turbo.json` and `package.json` (root) to see if new packages are auto-discovered or need explicit registration. Add `@reactive-agents/compose` if needed.

- [ ] **Step 1.6: Commit scaffold**

```bash
git add packages/compose/
git commit -m "feat(compose): scaffold packages/compose package"
```

---

## Task 2: Implement 6 Killswitches

**Files:**
- Create: `packages/compose/src/killswitches/budget-limit.ts`
- Create: `packages/compose/src/killswitches/timeout-after.ts`
- Create: `packages/compose/src/killswitches/max-iterations.ts`
- Create: `packages/compose/src/killswitches/require-approval-for.ts`
- Create: `packages/compose/src/killswitches/watchdog.ts`
- Create: `packages/compose/src/killswitches/confidence-floor.ts`
- Create: `packages/compose/src/killswitches/index.ts`
- Create: `packages/compose/src/killswitches/registry.ts`

Each killswitch is `(harness: Harness) => void`. Import from `@reactive-agents/core`.

**Important:** All killswitches use `return { abort: 'stop' | 'terminate' }` from `PhaseHookFn`, NOT `harness.stop()`.

- [ ] **Step 2.1: Implement max-iterations.ts (simplest — start here)**

```ts
import type { Harness } from '@reactive-agents/core';

export interface MaxIterationsOptions {
  max: number;
  onTrigger?: 'stop' | 'terminate';
}

export function maxIterations(options: number | MaxIterationsOptions): (harness: Harness) => void {
  const max = typeof options === 'number' ? options : options.max;
  const onTrigger = typeof options === 'number' ? 'stop' : (options.onTrigger ?? 'stop');
  return (harness: Harness) => {
    harness.before('think', (ctx) => {
      if (ctx.iteration >= max) {
        return { abort: onTrigger, reason: `max-iterations:${max}` };
      }
    });
  };
}
```

- [ ] **Step 2.2: Implement budget-limit.ts**

`cost.tracked` is not in TagMap. Use `before('think', ...)` and read cost from state. Check `KernelStateLike` fields for token/cost tracking (look at `packages/reasoning/src/kernel/state/kernel-state.ts`).

```ts
import type { Harness } from '@reactive-agents/core';

export interface BudgetLimitOptions {
  maxTokens?: number;
  maxCostUSD?: number;
  /** Per-token cost in USD. Default: 0.000001 (rough frontier estimate). */
  costPerToken?: number;
  onTrigger?: 'stop' | 'terminate';
}

export function budgetLimit(options: BudgetLimitOptions): (harness: Harness) => void {
  const { maxTokens, maxCostUSD, costPerToken = 0.000001, onTrigger = 'stop' } = options;
  return (harness: Harness) => {
    harness.before('think', (ctx) => {
      const tokens = (ctx.state as { tokens?: number }).tokens ?? 0;
      if (maxTokens !== undefined && tokens >= maxTokens) {
        return { abort: onTrigger, reason: `budget-limit:tokens:${tokens}/${maxTokens}` };
      }
      if (maxCostUSD !== undefined) {
        const estimatedCost = tokens * costPerToken;
        if (estimatedCost >= maxCostUSD) {
          return { abort: onTrigger, reason: `budget-limit:cost:${estimatedCost.toFixed(4)}/${maxCostUSD}` };
        }
      }
    });
  };
}
```

Note: Read actual `KernelStateLike` interface to use correct field name for token count (likely `tokens`).

- [ ] **Step 2.3: Implement timeout-after.ts**

The spec calls for a `setTimeout` in `before('bootstrap', ...)`. Since `timeoutAfter` fires asynchronously (callback after hook returns), use a shared closure flag that `before('think', ...)` checks:

```ts
import type { Harness } from '@reactive-agents/core';

export interface TimeoutAfterOptions {
  wallClock: string | number;  // '60s' | '5m' | milliseconds
  onTrigger?: 'stop' | 'terminate';
}

function parseMs(wallClock: string | number): number {
  if (typeof wallClock === 'number') return wallClock;
  const match = wallClock.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) throw new Error(`Invalid wallClock: ${wallClock}`);
  const [, n, unit] = match;
  const multipliers: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return parseFloat(n!) * (multipliers[unit!] ?? 1000);
}

export function timeoutAfter(options: TimeoutAfterOptions): (harness: Harness) => void {
  const ms = parseMs(options.wallClock);
  const onTrigger = options.onTrigger ?? 'stop';
  return (harness: Harness) => {
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    harness.before('bootstrap', () => {
      timer = setTimeout(() => { timedOut = true; }, ms);
    });

    harness.before('think', () => {
      if (timedOut) {
        return { abort: onTrigger, reason: `timeout-after:${options.wallClock}` };
      }
    });

    harness.after('complete', () => {
      if (timer !== undefined) clearTimeout(timer);
    });
  };
}
```

- [ ] **Step 2.4: Implement watchdog.ts**

```ts
import type { Harness } from '@reactive-agents/core';

export interface WatchdogOptions {
  noProgressFor: string | number;  // '30s' | milliseconds
  progressSignal?: 'observation.tool-result';  // currently only this tag in TagMap
  onTrigger?: 'stop' | 'terminate';
}

export function watchdog(options: WatchdogOptions): (harness: Harness) => void {
  const ms = typeof options.noProgressFor === 'number'
    ? options.noProgressFor
    : parseMs(options.noProgressFor);
  const onTrigger = options.onTrigger ?? 'stop';
  return (harness: Harness) => {
    let lastProgress = Date.now();

    harness.tap('observation.tool-result', () => {
      lastProgress = Date.now();
    });

    harness.before('think', () => {
      const elapsed = Date.now() - lastProgress;
      if (elapsed >= ms) {
        return { abort: onTrigger, reason: `watchdog:no-progress-for:${elapsed}ms` };
      }
    });
  };
}

// reuse parseMs — in practice extract to shared utils.ts
function parseMs(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: ${s}`);
  const [, n, unit] = match;
  const m: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return parseFloat(n!) * (m[unit!] ?? 1000);
}
```

- [ ] **Step 2.5: Implement require-approval-for.ts**

No `pause()` in current API. Implement as async `before('act', ...)` hook — approver denies → abort:

```ts
import type { Harness } from '@reactive-agents/core';

export interface RequireApprovalForOptions {
  tools: string[];
  approver: (ctx: { toolName: string; iteration: number }) => Promise<boolean>;
  onDeny?: 'stop' | 'terminate';
}

export function requireApprovalFor(options: RequireApprovalForOptions): (harness: Harness) => void {
  const { tools, approver, onDeny = 'stop' } = options;
  const toolSet = new Set(tools);
  return (harness: Harness) => {
    harness.before('act', async (ctx) => {
      // ctx.state has pending tool calls — extract next tool name if available
      const pendingTools = (ctx.state as { pendingToolCalls?: Array<{ name?: string }> })
        .pendingToolCalls ?? [];
      for (const call of pendingTools) {
        if (call.name && toolSet.has(call.name)) {
          const approved = await approver({ toolName: call.name, iteration: ctx.iteration });
          if (!approved) {
            return { abort: onDeny, reason: `require-approval-for:denied:${call.name}` };
          }
        }
      }
    });
  };
}
```

Note: `pendingToolCalls` field name — verify against actual `KernelStateLike` in `kernel-state.ts`. Adjust if different.

- [ ] **Step 2.6: Implement confidence-floor.ts**

`decision.terminate` is not in TagMap. Use `before('complete', ...)` to check verifier score from state:

```ts
import type { Harness } from '@reactive-agents/core';

export interface ConfidenceFloorOptions {
  verifier: number;   // threshold 0–1
  minSteps?: number;  // minimum steps before early exit allowed
  earlyExit?: boolean;
}

export function confidenceFloor(options: ConfidenceFloorOptions): (harness: Harness) => void {
  const { verifier: threshold, minSteps = 1, earlyExit = true } = options;
  return (harness: Harness) => {
    if (!earlyExit) return;  // no-op if earlyExit disabled
    harness.before('verify', (ctx) => {
      const state = ctx.state as { steps?: unknown[]; verifierScore?: number };
      const stepCount = state.steps?.length ?? 0;
      const score = state.verifierScore ?? 0;
      if (stepCount >= minSteps && score >= threshold) {
        // Signal: confidence floor met — allow immediate completion
        // This is a 'stop' (graceful done), not terminate
        return { abort: 'stop', reason: `confidence-floor:score:${score}>=${threshold}` };
      }
    });
  };
}
```

Note: Check actual `KernelStateLike` field for verifier score. May be `verifierScore`, `quality`, or similar. Read `kernel-state.ts` to confirm.

- [ ] **Step 2.7: Create killswitches/index.ts**

```ts
export { budgetLimit } from './budget-limit.js';
export { timeoutAfter } from './timeout-after.js';
export { maxIterations } from './max-iterations.js';
export { requireApprovalFor } from './require-approval-for.js';
export { watchdog } from './watchdog.js';
export { confidenceFloor } from './confidence-floor.js';
export type { BudgetLimitOptions } from './budget-limit.js';
export type { TimeoutAfterOptions } from './timeout-after.js';
export type { MaxIterationsOptions } from './max-iterations.js';
export type { RequireApprovalForOptions } from './require-approval-for.js';
export type { WatchdogOptions } from './watchdog.js';
export type { ConfidenceFloorOptions } from './confidence-floor.js';
```

- [ ] **Step 2.8: Create killswitches/registry.ts**

```ts
const KILLSWITCH_NAMES = [
  'budgetLimit',
  'timeoutAfter',
  'maxIterations',
  'requireApprovalFor',
  'watchdog',
  'confidenceFloor',
] as const;

export type KillswitchName = typeof KILLSWITCH_NAMES[number];

export const killswitches = {
  list: (): readonly KillswitchName[] => KILLSWITCH_NAMES,
} as const;
```

- [ ] **Step 2.9: Build to verify types**

```bash
rtk bun run build --filter='@reactive-agents/compose' 2>&1 | tail -20
```

Fix any type errors before moving to tests.

- [ ] **Step 2.10: Commit killswitch implementations**

```bash
git add packages/compose/src/
git commit -m "feat(compose): implement 6 killswitch compositions (budgetLimit, timeoutAfter, maxIterations, requireApprovalFor, watchdog, confidenceFloor)"
```

---

## Task 3: Tests

**Files:**
- Create: `packages/compose/test/killswitches.test.ts`

Tests must exercise the actual `HarnessPipeline.collectPhaseHooks()` path — not just call the factory function.

- [ ] **Step 3.1: Write failing tests**

```ts
import { describe, it, expect } from 'bun:test';
import { HarnessPipeline, RegistrationHarness } from '@reactive-agents/core';
import {
  maxIterations, budgetLimit, timeoutAfter, watchdog,
  requireApprovalFor, confidenceFloor
} from '../src/killswitches/index.js';
import { killswitches } from '../src/killswitches/registry.js';

// Helper: build a harness with a killswitch registered, return its pipeline
function buildPipeline(ks: (h: Harness) => void): HarnessPipeline {
  const reg = new RegistrationHarness();
  ks(reg);
  return new HarnessPipeline(reg._collected);
}

// Minimal KernelStateLike for tests
const mockState = { tokens: 0, steps: [], iteration: 0, status: 'running' } as const;

describe('maxIterations', () => {
  it('aborts when iteration >= max', async () => {
    const pipeline = buildPipeline(maxIterations(3));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    expect(hooks.length).toBe(1);

    const ctx = { phase: 'think' as const, iteration: 3, state: mockState };
    const result = await hooks[0]!(ctx);
    expect(result).toEqual({ abort: 'stop', reason: 'max-iterations:3' });
  });

  it('does not abort below max', async () => {
    const pipeline = buildPipeline(maxIterations(3));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const ctx = { phase: 'think' as const, iteration: 2, state: mockState };
    const result = await hooks[0]!(ctx);
    expect(result).toBeUndefined();
  });
});

describe('budgetLimit', () => {
  it('aborts when tokens >= maxTokens', async () => {
    const pipeline = buildPipeline(budgetLimit({ maxTokens: 1000 }));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const ctx = { phase: 'think' as const, iteration: 1, state: { ...mockState, tokens: 1000 } };
    const result = await hooks[0]!(ctx);
    expect(result).toMatchObject({ abort: 'stop' });
  });

  it('does not abort below limit', async () => {
    const pipeline = buildPipeline(budgetLimit({ maxTokens: 1000 }));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const ctx = { phase: 'think' as const, iteration: 1, state: { ...mockState, tokens: 500 } };
    const result = await hooks[0]!(ctx);
    expect(result).toBeUndefined();
  });
});

describe('timeoutAfter', () => {
  it('aborts when timed out', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: 1 })); // 1ms
    // Fire bootstrap hooks to start timer
    const bootstrapHooks = pipeline.collectPhaseHooks('before', 'bootstrap');
    for (const h of bootstrapHooks) await h({ phase: 'bootstrap', iteration: 0, state: mockState });
    // Wait for timeout
    await new Promise(r => setTimeout(r, 10));
    const thinkHooks = pipeline.collectPhaseHooks('before', 'think');
    const result = await thinkHooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(result).toMatchObject({ abort: 'stop' });
  });

  it('does not abort before timeout', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: '10s' }));
    const bootstrapHooks = pipeline.collectPhaseHooks('before', 'bootstrap');
    for (const h of bootstrapHooks) await h({ phase: 'bootstrap', iteration: 0, state: mockState });
    const thinkHooks = pipeline.collectPhaseHooks('before', 'think');
    const result = await thinkHooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(result).toBeUndefined();
  });
});

describe('watchdog', () => {
  it('aborts when no progress for threshold', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 1 })); // 1ms
    await new Promise(r => setTimeout(r, 10));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const result = await hooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(result).toMatchObject({ abort: 'stop' });
  });

  it('resets timer on observation.tool-result', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 50 })); // 50ms
    // Fire a tap to reset progress
    const ctx = { iteration: 1, phase: 'observe' as const, state: mockState, strategy: 'reactive' };
    await pipeline.transform('observation.tool-result', { type: 'tool_result' }, ctx as any);
    // Check immediately — should NOT abort
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const result = await hooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(result).toBeUndefined();
  });
});

describe('requireApprovalFor', () => {
  it('aborts when approver denies', async () => {
    const pipeline = buildPipeline(requireApprovalFor({
      tools: ['send_email'],
      approver: async () => false,
    }));
    const hooks = pipeline.collectPhaseHooks('before', 'act');
    const stateWithPending = { ...mockState, pendingToolCalls: [{ name: 'send_email' }] };
    const result = await hooks[0]!({ phase: 'act', iteration: 1, state: stateWithPending });
    expect(result).toMatchObject({ abort: 'stop' });
  });

  it('continues when approver approves', async () => {
    const pipeline = buildPipeline(requireApprovalFor({
      tools: ['send_email'],
      approver: async () => true,
    }));
    const hooks = pipeline.collectPhaseHooks('before', 'act');
    const stateWithPending = { ...mockState, pendingToolCalls: [{ name: 'send_email' }] };
    const result = await hooks[0]!({ phase: 'act', iteration: 1, state: stateWithPending });
    expect(result).toBeUndefined();
  });
});

describe('killswitches registry', () => {
  it('lists all 6 killswitches', () => {
    const list = killswitches.list();
    expect(list).toHaveLength(6);
    expect(list).toContain('budgetLimit');
    expect(list).toContain('timeoutAfter');
    expect(list).toContain('maxIterations');
    expect(list).toContain('requireApprovalFor');
    expect(list).toContain('watchdog');
    expect(list).toContain('confidenceFloor');
  });
});
```

- [ ] **Step 3.2: Run tests — verify they FAIL (RED)**

```bash
rtk bun test packages/compose/test/killswitches.test.ts 2>&1 | tail -30
```

Expected: failures because implementations not hooked into working pipeline yet (Task 0 wiring needed).

- [ ] **Step 3.3: Run tests — verify GREEN after Task 0 + Task 2**

After both Task 0 and Task 2 are complete:

```bash
rtk bun test packages/compose 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 3.4: Commit tests**

```bash
git add packages/compose/test/
git commit -m "test(compose): add killswitch unit tests"
```

---

## Task 4: Full Build Verification + Wiki Update

- [ ] **Step 4.1: Full build**

```bash
rtk bun run build 2>&1 | tail -30
```

Expected: zero errors.

- [ ] **Step 4.2: Full test suite — no regressions**

```bash
rtk bun test 2>&1 | grep -E "pass|fail|error" | tail -20
```

Expected: all existing tests still pass, new compose tests added to count.

- [ ] **Step 4.3: Update wiki/Hot.md**

Add Wave D completion to recent context cache:
```
## Recent: Wave D Complete (2026-05-13)
- packages/compose created with 6 killswitches
- harness phase hooks wired in runner.ts + act.ts
- Tags: budgetLimit, timeoutAfter, maxIterations, requireApprovalFor, watchdog, confidenceFloor
```

- [ ] **Step 4.4: Final commit**

```bash
git add wiki/Hot.md
git commit -m "docs: update Hot.md for Wave D completion"
```

---

## Self-Review Checklist

- [ ] Task 0 wires `collectPhaseHooks` — previously 0 call sites
- [ ] `runPhaseHooks` helper handles abort/skip return values correctly
- [ ] 'bootstrap' hooks fire once before loop; 'complete' hooks fire once after
- [ ] All killswitches use `return { abort }` not `harness.stop()`
- [ ] `budgetLimit` reads from `state.tokens` (not `cost.tracked` tag — not in TagMap)
- [ ] `confidenceFloor` uses `before('verify', ...)` not `decision.terminate` tag
- [ ] `watchdog` uses closure variable, resets on `observation.tool-result` tap
- [ ] `timeoutAfter` uses closure flag, no Race condition (flag checked in `before('think')`)
- [ ] All types strict (no `any` except intentional cast with comment)
- [ ] Tests verify abort/continue behavior directly against pipeline hooks
