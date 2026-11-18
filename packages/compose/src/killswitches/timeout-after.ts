import type { Harness, KernelStateLike } from '@reactive-agents/core';

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

/**
 * The run's identity on a hook ctx: the live run spend meter
 * (`state.meta.runBudgetMeter`). The runtime arms one meter per run
 * (`run-budget-arm.ts`, every run, budget or not) and the kernel runner stores
 * that reference on state.meta before it fires bootstrap. Every kernel pass of
 * a run (primary, continuations, verification retry, plan-execute steps)
 * carries the same object; a new run carries a new one. Read structurally:
 * compose must not import from `@reactive-agents/reasoning`.
 */
function runKeyOf(state: Readonly<KernelStateLike>): object | undefined {
  const meter = state.meta['runBudgetMeter'];
  return typeof meter === 'object' && meter !== null ? meter : undefined;
}

/**
 * Stop a run once its wall time reaches `wallClock`.
 *
 * The clock starts at the run's first kernel bootstrap and is checked before
 * each think turn. Continuation passes do not restart it, so a multi-pass run
 * stops at its declared timeout. A new run on the same agent gets a new clock.
 * Without a run meter (a kernel driven outside the runtime) the clock starts
 * at each bootstrap.
 */
export function timeoutAfter(options: TimeoutAfterOptions): (harness: Harness) => void {
  const ms = parseMs(options.wallClock);
  const onTrigger = options.onTrigger ?? 'stop';
  return (harness: Harness) => {
    // Start time per run, keyed by the run meter; entries go with the run.
    const runStarts = new WeakMap<object, number>();
    // Fallback when no run meter is on state: the latest bootstrap's start.
    let passStart: number | undefined;

    harness.before('bootstrap', (ctx) => {
      const key = runKeyOf(ctx.state);
      if (key === undefined) {
        passStart = Date.now();
      } else if (!runStarts.has(key)) {
        runStarts.set(key, Date.now());
      }
      return undefined;
    });

    harness.before('think', (ctx) => {
      const key = runKeyOf(ctx.state);
      const startedAt = key === undefined ? passStart : runStarts.get(key);
      if (startedAt !== undefined && Date.now() - startedAt >= ms) {
        return { abort: onTrigger, reason: `timeout-after:${options.wallClock}` };
      }
      return undefined;
    });
  };
}
