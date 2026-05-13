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
      return undefined;
    });

    harness.after('complete', () => {
      if (timer !== undefined) clearTimeout(timer);
    });
  };
}
