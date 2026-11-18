import { describe, it, expect } from 'bun:test';
import { HarnessPipeline, RegistrationHarness } from '@reactive-agents/core';
import type { Harness, KernelStateLike } from '@reactive-agents/core';
import { timeoutAfter, watchdog } from '../src/killswitches/index.js';

// Run-scoped clocks for the wall-time killswitches.
//
// A run is not a pass. The runtime can run the kernel several times in one
// `agent.run()`: the primary pass, post-think continuations (withMinIterations,
// customTermination, validator, reflect-REVISE), the verification retry, and
// each plan-execute step sub-kernel. Every kernel run fires
// before('bootstrap') again (runner.ts), so a clock armed there reset per pass
// and a multi-pass run was never stopped at its declared timeout.
//
// The run's identity on the hook ctx is `state.meta.runBudgetMeter`: the
// runtime arms ONE meter per run (`run-budget-arm.ts`, every run, budget or
// not) and the kernel runner stores that LIVE reference on state.meta before
// it fires bootstrap. Every pass of a run carries the same object; a new run
// carries a new one.
//
// These tests replay the hook order the kernel runner fires per pass:
// before(bootstrap) -> after(bootstrap) -> before(think) per turn ->
// after(think) -> after(complete) (terminal-pipeline.ts).

function buildPipeline(ks: (h: Harness) => void): HarnessPipeline {
  const reg = new RegistrationHarness();
  ks(reg);
  return new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);
}

/** Structural mirror of reasoning's `RunBudgetMeter` (compose must not import reasoning). */
type RunMeter = { tokens: number; cost: number };

function passState(meter: RunMeter | undefined, iteration = 0): Readonly<KernelStateLike> {
  return {
    taskId: 'run-clock',
    strategy: 'reactive',
    kernelType: 'thought',
    steps: [],
    toolsUsed: new Set<string>(),
    iteration,
    tokens: 0,
    status: 'running',
    output: null,
    error: null,
    meta: meter === undefined ? {} : { runBudgetMeter: meter },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fire one pass's bootstrap hooks, as runner.ts does before the loop. */
async function bootstrap(p: HarnessPipeline, state: Readonly<KernelStateLike>): Promise<void> {
  for (const h of p.collectPhaseHooks('before', 'bootstrap')) await h({ phase: 'bootstrap', iteration: 0, state });
  for (const h of p.collectPhaseHooks('after', 'bootstrap')) await h({ phase: 'bootstrap', iteration: 0, state });
}

/** Fire the before(think) gate; return the first abort verdict, if any. */
async function beforeThink(p: HarnessPipeline, state: Readonly<KernelStateLike>, iteration: number) {
  for (const h of p.collectPhaseHooks('before', 'think')) {
    const r = await h({ phase: 'think', iteration, state });
    if (r && typeof r === 'object' && 'abort' in r) return r;
  }
  return undefined;
}

/** Fire the after(think) and after(complete) hooks that close a pass. */
async function closePass(p: HarnessPipeline, state: Readonly<KernelStateLike>, iteration: number): Promise<void> {
  for (const h of p.collectPhaseHooks('after', 'think')) await h({ phase: 'think', iteration, state });
  for (const h of p.collectPhaseHooks('after', 'complete')) await h({ phase: 'complete', iteration, state });
}

describe('timeoutAfter measures the run, not the pass', () => {
  it('fires in pass 2 when two passes, each under the timeout, together exceed it', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: 150 }));
    const meter: RunMeter = { tokens: 0, cost: 0 };

    // Pass 1 (primary): ~100ms of work, under the 150ms timeout.
    const s1 = passState(meter);
    await bootstrap(pipeline, s1);
    expect(await beforeThink(pipeline, s1, 0)).toBeUndefined();
    await sleep(100);
    await closePass(pipeline, s1, 1);

    // Pass 2 (continuation of the SAME run): bootstrap fires again.
    const s2 = passState(meter);
    await bootstrap(pipeline, s2);
    await sleep(80); // total ~180ms > 150ms, pass 2 alone ~80ms < 150ms
    expect(await beforeThink(pipeline, s2, 0)).toEqual({ abort: 'stop', reason: 'timeout-after:150' });
  });

  it('a new run (new meter) starts a fresh clock on the same agent', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: 100 }));
    const run1 = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, run1);
    await sleep(130);
    expect(await beforeThink(pipeline, run1, 0)).toMatchObject({ abort: 'stop' });

    // The agent is reused: run 2 must not inherit run 1's elapsed time.
    const run2 = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, run2);
    expect(await beforeThink(pipeline, run2, 0)).toBeUndefined();
  });

  it('a single short run is unaffected', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: '10s' }));
    const s = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, s);
    expect(await beforeThink(pipeline, s, 0)).toBeUndefined();
    expect(await beforeThink(pipeline, s, 1)).toBeUndefined();
    await closePass(pipeline, s, 2);
  });

  it('without a run meter (kernel driven outside the runtime) the clock starts at bootstrap', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: 20 }));
    const s = passState(undefined);
    await bootstrap(pipeline, s);
    expect(await beforeThink(pipeline, s, 0)).toBeUndefined();
    await sleep(40);
    expect(await beforeThink(pipeline, s, 1)).toMatchObject({ abort: 'stop' });
  });
});

describe('watchdog progress clock starts with the run', () => {
  it('does not fire on the first turn of a run that starts long after the agent was built', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 50 }));
    await sleep(80); // agent built, idle before run() is called
    const s = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, s);
    expect(await beforeThink(pipeline, s, 0)).toBeUndefined();
  });

  it('does not fire on run 2 after an idle gap longer than the threshold', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 50 }));
    const run1 = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, run1);
    expect(await beforeThink(pipeline, run1, 0)).toBeUndefined();
    await closePass(pipeline, run1, 1);
    await sleep(80); // idle between runs
    const run2 = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, run2);
    expect(await beforeThink(pipeline, run2, 0)).toBeUndefined();
  });

  it('still fires when a run stalls past the threshold', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 30 }));
    const s = passState({ tokens: 0, cost: 0 });
    await bootstrap(pipeline, s);
    await sleep(60);
    expect(await beforeThink(pipeline, s, 0)).toMatchObject({ abort: 'stop' });
  });
});
