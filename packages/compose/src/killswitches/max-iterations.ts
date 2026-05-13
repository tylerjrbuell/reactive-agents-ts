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
      return undefined;
    });
  };
}
