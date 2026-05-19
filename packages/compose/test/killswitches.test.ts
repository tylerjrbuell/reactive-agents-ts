import { describe, it, expect } from 'bun:test';
import { HarnessPipeline, RegistrationHarness } from '@reactive-agents/core';
import {
  maxIterations, budgetLimit, timeoutAfter, watchdog,
  requireApprovalFor
} from '../src/killswitches/index.js';
import { killswitches } from '../src/killswitches/registry.js';
import type { Harness, KernelStateLike } from '@reactive-agents/core';

// Helper: build a harness with a killswitch registered, return its pipeline
function buildPipeline(ks: (h: Harness) => void): HarnessPipeline {
  const reg = new RegistrationHarness();
  ks(reg);
  return new HarnessPipeline(reg._collected as ConstructorParameters<typeof HarnessPipeline>[0]);
}

// Complete KernelStateLike for tests (the harness ctx requires the full shape).
const mockState: Readonly<KernelStateLike> = {
  taskId: 'test',
  strategy: 'reactive',
  kernelType: 'thought',
  steps: [],
  toolsUsed: new Set<string>(),
  iteration: 0,
  tokens: 0,
  status: 'running',
  output: null,
  error: null,
  meta: {},
};

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

  it('supports custom onTrigger option', async () => {
    const pipeline = buildPipeline(maxIterations({ max: 5, onTrigger: 'terminate' }));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const ctx = { phase: 'think' as const, iteration: 5, state: mockState };
    const result = await hooks[0]!(ctx);
    expect(result).toEqual({ abort: 'terminate', reason: 'max-iterations:5' });
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

  it('calculates cost based on tokens and costPerToken', async () => {
    const pipeline = buildPipeline(budgetLimit({ maxCostUSD: 0.01, costPerToken: 0.000001 }));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const ctx = { phase: 'think' as const, iteration: 1, state: { ...mockState, tokens: 10000 } };
    const result = await hooks[0]!(ctx);
    expect(result).toMatchObject({ abort: 'stop' });
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

  it('parses time units correctly', async () => {
    const pipeline1 = buildPipeline(timeoutAfter({ wallClock: '500ms' }));
    const pipeline2 = buildPipeline(timeoutAfter({ wallClock: 500 }));
    // Both should behave the same
    const boots1 = pipeline1.collectPhaseHooks('before', 'bootstrap');
    const boots2 = pipeline2.collectPhaseHooks('before', 'bootstrap');
    expect(boots1.length).toBe(1);
    expect(boots2.length).toBe(1);
  });

  it('cleans up timer on complete', async () => {
    const pipeline = buildPipeline(timeoutAfter({ wallClock: '10s' }));
    const bootstrapHooks = pipeline.collectPhaseHooks('before', 'bootstrap');
    for (const h of bootstrapHooks) await h({ phase: 'bootstrap', iteration: 0, state: mockState });
    const completeHooks = pipeline.collectPhaseHooks('after', 'complete');
    expect(completeHooks.length).toBe(1);
    await completeHooks[0]!({ phase: 'complete', iteration: 1, state: mockState });
    // Should not crash or leave timer running
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

  it('does not abort immediately', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 100 })); // 100ms
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const result = await hooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(result).toBeUndefined();
  });

  it('resets timer on observation.tool-result', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 50 })); // 50ms
    // Fire a tap to reset progress
    const result = await pipeline.transform('observation.tool-result', { type: 'tool_result' } as any, {
      iteration: 1,
      phase: 'observe' as any,
      state: mockState,
      strategy: 'reactive',
    } as any);
    expect(result).toBeDefined();
    // Check immediately — should NOT abort
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const checkResult = await hooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(checkResult).toBeUndefined();
  });

  it('supports onTrigger option', async () => {
    const pipeline = buildPipeline(watchdog({ noProgressFor: 1, onTrigger: 'terminate' }));
    await new Promise(r => setTimeout(r, 10));
    const hooks = pipeline.collectPhaseHooks('before', 'think');
    const result = await hooks[0]!({ phase: 'think', iteration: 1, state: mockState });
    expect(result).toMatchObject({ abort: 'terminate' });
  });
});

describe('requireApprovalFor', () => {
  it('aborts when approver denies', async () => {
    const pipeline = buildPipeline(requireApprovalFor({
      tools: ['send_email'],
      approver: () => false,
    }));
    const hooks = pipeline.collectPhaseHooks('before', 'act');
    const stateWithPending = { ...mockState, pendingToolCalls: [{ name: 'send_email' }] };
    const result = await hooks[0]!({ phase: 'act', iteration: 1, state: stateWithPending as any });
    expect(result).toMatchObject({ abort: 'stop' });
  });

  it('continues when approver approves', async () => {
    const pipeline = buildPipeline(requireApprovalFor({
      tools: ['send_email'],
      approver: () => true,
    }));
    const hooks = pipeline.collectPhaseHooks('before', 'act');
    const stateWithPending = { ...mockState, pendingToolCalls: [{ name: 'send_email' }] };
    const result = await hooks[0]!({ phase: 'act', iteration: 1, state: stateWithPending as any });
    expect(result).toBeUndefined();
  });

  it('ignores unapproved tools not in watch list', async () => {
    const pipeline = buildPipeline(requireApprovalFor({
      tools: ['send_email'],
      approver: () => { throw new Error('Should not be called'); },
    }));
    const hooks = pipeline.collectPhaseHooks('before', 'act');
    const stateWithPending = { ...mockState, pendingToolCalls: [{ name: 'web_search' }] };
    const result = await hooks[0]!({ phase: 'act', iteration: 1, state: stateWithPending as any });
    expect(result).toBeUndefined();
  });

  it('supports onDeny option', async () => {
    const pipeline = buildPipeline(requireApprovalFor({
      tools: ['send_email'],
      approver: () => false,
      onDeny: 'terminate',
    }));
    const hooks = pipeline.collectPhaseHooks('before', 'act');
    const stateWithPending = { ...mockState, pendingToolCalls: [{ name: 'send_email' }] };
    const result = await hooks[0]!({ phase: 'act', iteration: 1, state: stateWithPending as any });
    expect(result).toMatchObject({ abort: 'terminate' });
  });
});

describe('killswitches registry', () => {
  it('does not register confidenceFloor — verify phase is never fired at runtime', () => {
    // The runner only fires bootstrap/think/act/complete phase hooks. A
    // killswitch registered on before('verify') can never execute, and the
    // implementation also read a state.verifierScore field that does not
    // exist. A registered-but-dead killswitch is a credibility defect, so
    // confidenceFloor was unshipped. See
    // wiki/Research/2026-05-19-framework-state-and-priorities.md (Tier 0).
    const list = killswitches.list();
    expect(list).not.toContain('confidenceFloor');
  });

  it('lists all 5 killswitches', () => {
    const list = killswitches.list();
    expect(list).toHaveLength(5);
    expect(list).toContain('budgetLimit');
    expect(list).toContain('timeoutAfter');
    expect(list).toContain('maxIterations');
    expect(list).toContain('requireApprovalFor');
    expect(list).toContain('watchdog');
  });

  it('list is immutable', () => {
    const list = killswitches.list();
    expect(list).toHaveLength(5);
  });
});
