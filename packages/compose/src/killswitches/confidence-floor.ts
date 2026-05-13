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
      const state = ctx.state as unknown as { steps?: unknown[]; verifierScore?: number };
      const stepCount = (state.steps?.length ?? 0) as number;
      const score = (state.verifierScore ?? 0) as number;
      if (stepCount >= minSteps && score >= threshold) {
        // Signal: confidence floor met — allow immediate completion
        // This is a 'stop' (graceful done), not terminate
        return { abort: 'stop', reason: `confidence-floor:score:${score}>=${threshold}` };
      }
      return undefined;
    });
  };
}
