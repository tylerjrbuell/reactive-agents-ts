import { describe, it, expect } from 'bun:test';
import { HarnessPipeline, RegistrationHarness } from '@reactive-agents/core';
import { ReactiveAgents } from '@reactive-agents/runtime';

describe('Wave E: Builder Sugar Desugaring', () => {
  describe('.compose() alias for .withHarness()', () => {
    it('compose is an alias for withHarness', () => {
      const builder = ReactiveAgents.create() as any;
      const builder2 = ReactiveAgents.create() as any;

      const testFn = (h: any) => h.tap('prompt.system', () => {});

      builder.compose(testFn);
      builder2.withHarness(testFn);

      // Both should have the same number of registrations
      expect(builder._harnessRegistrations.length).toBe(1);
      expect(builder2._harnessRegistrations.length).toBe(1);
    });
  });

  describe('withSystemPrompt desugars through harness', () => {
    it('registers prompt.system transform in harnessPipeline', async () => {
      const builder = ReactiveAgents.create() as any;
      builder.withSystemPrompt('Custom system prompt');

      // Build the pipeline from collected registrations
      const reg = new RegistrationHarness();
      for (const fn of builder._harnessRegistrations ?? []) fn(reg);
      const pipeline = new HarnessPipeline(reg._collected);

      const baseCtx = { iteration: 0, phase: 'think' as const, state: {} as any, strategy: 'reactive' };
      const result = await pipeline.transform('prompt.system', 'DEFAULT', baseCtx);
      expect(result).toBe('Custom system prompt');
    });

    it('keeps _systemPrompt field for backward compatibility', () => {
      const builder = ReactiveAgents.create() as any;
      builder.withSystemPrompt('My Prompt');
      expect(builder._systemPrompt).toBe('My Prompt');
    });

    it('multiple withSystemPrompt calls stack (last one wins)', async () => {
      const builder = ReactiveAgents.create() as any;
      builder.withSystemPrompt('First');
      builder.withSystemPrompt('Second');

      const reg = new RegistrationHarness();
      for (const fn of builder._harnessRegistrations ?? []) fn(reg);
      const pipeline = new HarnessPipeline(reg._collected);

      const baseCtx = { iteration: 0, phase: 'think' as const, state: {} as any, strategy: 'reactive' };
      const result = await pipeline.transform('prompt.system', 'DEFAULT', baseCtx);
      // Last registration wins (most-specific semantics)
      expect(result).toBe('Second');
    });
  });

  describe('withErrorHandler desugars through harness', () => {
    it('registers onError handler in harnessPipeline', () => {
      const builder = ReactiveAgents.create() as any;
      const captured: string[] = [];
      builder.withErrorHandler((_err: Error, ctx: { phase: string }) => {
        captured.push(ctx.phase);
      });

      // Build pipeline and verify onError registration exists
      const reg = new RegistrationHarness();
      for (const fn of builder._harnessRegistrations ?? []) fn(reg);
      const pipeline = new HarnessPipeline(reg._collected);

      // withErrorHandler registers with phase '*' (catch-all for all phases)
      const hooks = pipeline.collectErrorHooks('*');
      expect(hooks.length).toBeGreaterThan(0);
    });

    it('keeps _errorHandler field for backward compatibility', () => {
      const handler = (err: Error, ctx: any) => {};
      const builder = ReactiveAgents.create() as any;
      builder.withErrorHandler(handler);
      expect(builder._errorHandler).toBe(handler);
    });
  });

  describe('withHook backward compat', () => {
    it('still pushes to _hooks array (existing behavior preserved)', () => {
      const builder = ReactiveAgents.create() as any;
      const hook = {
        phase: 'think',
        timing: 'after',
        handler: (_ctx: unknown) => Promise.resolve(),
      };
      builder.withHook(hook);
      expect(builder._hooks).toHaveLength(1);
      expect(builder._hooks[0].phase).toBe('think');
    });

    it('also registers in harness phase hook pipeline', () => {
      const builder = ReactiveAgents.create() as any;
      builder.withHook({
        phase: 'think',
        timing: 'after',
        handler: (_ctx: unknown) => Promise.resolve(),
      });

      const reg = new RegistrationHarness();
      for (const fn of builder._harnessRegistrations ?? []) fn(reg);
      const pipeline = new HarnessPipeline(reg._collected);

      const hooks = pipeline.collectPhaseHooks('after', 'think');
      expect(hooks.length).toBeGreaterThan(0);
    });

    it('maps timing values correctly (before, after, on-error)', () => {
      const builder1 = ReactiveAgents.create() as any;
      builder1.withHook({
        phase: 'think',
        timing: 'before',
        handler: (_ctx: unknown) => Promise.resolve(),
      });

      const builder2 = ReactiveAgents.create() as any;
      builder2.withHook({
        phase: 'think',
        timing: 'after',
        handler: (_ctx: unknown) => Promise.resolve(),
      });

      const builder3 = ReactiveAgents.create() as any;
      builder3.withHook({
        phase: 'think',
        timing: 'on-error',
        handler: (_ctx: unknown) => Promise.resolve(),
      });

      // All three should register correctly
      expect(builder1._hooks).toHaveLength(1);
      expect(builder2._hooks).toHaveLength(1);
      expect(builder3._hooks).toHaveLength(1);

      // Verify harness registrations exist
      const reg1 = new RegistrationHarness();
      for (const fn of builder1._harnessRegistrations ?? []) fn(reg1);
      const pipeline1 = new HarnessPipeline(reg1._collected);

      const reg2 = new RegistrationHarness();
      for (const fn of builder2._harnessRegistrations ?? []) fn(reg2);
      const pipeline2 = new HarnessPipeline(reg2._collected);

      const reg3 = new RegistrationHarness();
      for (const fn of builder3._harnessRegistrations ?? []) fn(reg3);
      const pipeline3 = new HarnessPipeline(reg3._collected);

      expect(pipeline1.collectPhaseHooks('before', 'think').length).toBeGreaterThan(0);
      expect(pipeline2.collectPhaseHooks('after', 'think').length).toBeGreaterThan(0);
      // collectErrorHooks with specific phase gets hooks registered for that phase
      expect(pipeline3.collectErrorHooks('think').length).toBeGreaterThan(0);
    });
  });
});
