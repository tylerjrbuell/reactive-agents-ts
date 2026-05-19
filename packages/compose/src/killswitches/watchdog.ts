import type { Harness } from '@reactive-agents/core';

export interface WatchdogOptions {
  noProgressFor: string | number;  // '30s' | milliseconds
  onTrigger?: 'stop' | 'terminate';
}

function parseMs(s: string): number {
  const match = s.match(/^(\d+(?:\.\d+)?)(ms|s|m|h)$/);
  if (!match) throw new Error(`Invalid duration: ${s}`);
  const [, n, unit] = match;
  const m: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 };
  return parseFloat(n!) * (m[unit!] ?? 1000);
}

export function watchdog(options: WatchdogOptions): (harness: Harness) => void {
  const ms = typeof options.noProgressFor === 'number'
    ? options.noProgressFor
    : parseMs(options.noProgressFor);
  const onTrigger = options.onTrigger ?? 'stop';
  return (harness: Harness) => {
    let lastProgress = Date.now();

    // Progress = a tool batch executed. Tracked on after('act'), which the
    // runner actually fires (act.ts). The original observation.tool-result
    // tap was dead — that tag has no runtime emit site (v0.12 deferred
    // pass-through), so the timer never reset and watchdog aborted healthy
    // long-running agents.
    harness.after('act', () => {
      lastProgress = Date.now();
    });

    harness.before('think', () => {
      const elapsed = Date.now() - lastProgress;
      if (elapsed >= ms) {
        return { abort: onTrigger, reason: `watchdog:no-progress-for:${elapsed}ms` };
      }
      return undefined;
    });
  };
}
