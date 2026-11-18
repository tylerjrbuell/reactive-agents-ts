import { describe, it, expect } from 'bun:test';
import { HarnessPipeline, RegistrationHarness } from '@reactive-agents/core';
import type { Harness, KernelStateLike } from '@reactive-agents/core';
import { requireApprovalFor, timeoutAfter, watchdog } from '../src/killswitches/index.js';

// Edge-case pins for killswitch behavior the main suite does not cover:
// the text-parse approval path (Wave 6.3), approver call contract, mixed
// tool batches, and duration-string validation / boundary semantics.

function buildPipeline(ks: (h: Harness) => void): HarnessPipeline {
  const reg = new RegistrationHarness();
  ks(reg);
  return new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);
}

function stateWith(meta: KernelStateLike['meta']): Readonly<KernelStateLike> {
  return {
    taskId: 'edge',
    strategy: 'reactive',
    kernelType: 'thought',
    steps: [],
    toolsUsed: new Set<string>(),
    iteration: 0,
    tokens: 0,
    status: 'running',
    output: null,
    error: null,
    meta,
  };
}

async function runBeforeAct(pipeline: HarnessPipeline, meta: KernelStateLike['meta'], iteration = 1) {
  const hooks = pipeline.collectPhaseHooks('before', 'act');
  return hooks[0]!({ phase: 'act', iteration, state: stateWith(meta) });
}

describe('requireApprovalFor edges', () => {
  it('denies a watched tool on the text-parse path (pendingToolCalls only)', async () => {
    const pipeline = buildPipeline(
      requireApprovalFor({ tools: ['send_email'], approver: () => false }),
    );
    const result = await runBeforeAct(pipeline, { pendingToolCalls: [{ name: 'send_email' }] });
    expect(result).toMatchObject({
      abort: 'stop',
      reason: 'require-approval-for:denied:send_email',
    });
  });

  it('passes toolName and iteration to the approver', async () => {
    const seen: Array<{ toolName: string; iteration: number }> = [];
    const pipeline = buildPipeline(
      requireApprovalFor({
        tools: ['send_email'],
        approver: (c) => {
          seen.push(c);
          return true;
        },
      }),
    );
    await runBeforeAct(pipeline, { pendingToolCalls: [{ name: 'send_email' }] }, 7);
    expect(seen).toEqual([{ toolName: 'send_email', iteration: 7 }]);
  });

  it('denies when a watched tool is mixed into a batch with unwatched tools', async () => {
    const asked: string[] = [];
    const pipeline = buildPipeline(
      requireApprovalFor({
        tools: ['send_email'],
        approver: (c) => {
          asked.push(c.toolName);
          return false;
        },
      }),
    );
    const result = await runBeforeAct(pipeline, {
      pendingToolCalls: [{ name: 'web_search' }, { name: 'send_email' }],
    });
    expect(result).toMatchObject({ abort: 'stop', reason: 'require-approval-for:denied:send_email' });
    expect(asked).toEqual(['send_email']); // unwatched tool never reaches the approver
  });

  it('does not abort and never calls approver when no calls are pending', async () => {
    const pipeline = buildPipeline(
      requireApprovalFor({
        tools: ['send_email'],
        approver: () => {
          throw new Error('approver must not run');
        },
      }),
    );
    expect(await runBeforeAct(pipeline, {})).toBeUndefined();
    expect(await runBeforeAct(pipeline, { pendingToolCalls: [] })).toBeUndefined();
  });

  it('ignores pending calls with no name', async () => {
    const pipeline = buildPipeline(
      requireApprovalFor({ tools: ['send_email'], approver: () => false }),
    );
    expect(await runBeforeAct(pipeline, { pendingToolCalls: [{}] })).toBeUndefined();
  });
});

describe('duration validation', () => {
  it('timeoutAfter rejects an unparseable wallClock at construction', () => {
    expect(() => timeoutAfter({ wallClock: 'soon' })).toThrow('Invalid wallClock: soon');
    expect(() => timeoutAfter({ wallClock: '10' })).toThrow('Invalid wallClock');
    expect(() => timeoutAfter({ wallClock: '5d' })).toThrow('Invalid wallClock');
  });

  it('watchdog rejects an unparseable noProgressFor at construction', () => {
    expect(() => watchdog({ noProgressFor: 'forever' })).toThrow('Invalid duration: forever');
    expect(() => watchdog({ noProgressFor: '-5s' })).toThrow('Invalid duration');
  });

  it('accepts fractional and every supported unit', () => {
    for (const d of ['250ms', '1.5s', '2m', '1h', '0.5m']) {
      expect(() => timeoutAfter({ wallClock: d })).not.toThrow();
      expect(() => watchdog({ noProgressFor: d })).not.toThrow();
    }
  });
});

describe('timing boundaries', () => {
  it('timeoutAfter reports the configured wallClock in the abort reason', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: 1, onTrigger: 'terminate' }));
    for (const h of pipeline.collectPhaseHooks('before', 'bootstrap')) {
      await h({ phase: 'bootstrap', iteration: 0, state: stateWith({}) });
    }
    await new Promise((r) => setTimeout(r, 20));
    const think = pipeline.collectPhaseHooks('before', 'think');
    const result = await think[0]!({ phase: 'think', iteration: 1, state: stateWith({}) });
    expect(result).toEqual({ abort: 'terminate', reason: 'timeout-after:1' });
  });

  it('timeoutAfter never fires if bootstrap never ran (timer never armed)', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: 1 }));
    await new Promise((r) => setTimeout(r, 20));
    const think = pipeline.collectPhaseHooks('before', 'think');
    expect(await think[0]!({ phase: 'think', iteration: 1, state: stateWith({}) })).toBeUndefined();
  });

  it('watchdog abort reason carries elapsed ms and honors onTrigger=terminate', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 5, onTrigger: 'terminate' }));
    await new Promise((r) => setTimeout(r, 30));
    const think = pipeline.collectPhaseHooks('before', 'think');
    const result = await think[0]!({ phase: 'think', iteration: 1, state: stateWith({}) });
    expect(result).toMatchObject({ abort: 'terminate' });
    expect((result as { reason: string }).reason).toMatch(/^watchdog:no-progress-for:\d+ms$/);
  });

  it('watchdog state is per-harness: one instance stalling does not affect another', async () => {
    const stale = buildPipeline(watchdog({ noProgressFor: 5 }));
    await new Promise((r) => setTimeout(r, 30));
    const fresh = buildPipeline(watchdog({ noProgressFor: 5 }));
    const think = fresh.collectPhaseHooks('before', 'think');
    expect(await think[0]!({ phase: 'think', iteration: 1, state: stateWith({}) })).toBeUndefined();
    const staleThink = stale.collectPhaseHooks('before', 'think');
    expect(
      await staleThink[0]!({ phase: 'think', iteration: 1, state: stateWith({}) }),
    ).toMatchObject({ abort: 'stop' });
  });
});
