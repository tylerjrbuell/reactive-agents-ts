// File: src/kernel/capabilities/verify/noop-verifier.ts
//
// noopVerifier — research instrumentation for M3 ablation studies.
//
// Purpose: a Verifier implementation that unconditionally returns
// `verified: true` so a benchmark variant can isolate the verifier's
// contribution to end-task accuracy by removing only the verifier gate while
// leaving every other kernel mechanism intact.
//
// NOT FOR PRODUCTION: a noop verifier defeats the agent-took-action and
// grounding checks that catch synthesis failures. Use only for ablation
// runs (e.g., `ra-full-noop-verifier` benchmark variant) and never as the
// default for a deployed agent.

import type {
  Verifier,
  VerificationContext,
  VerificationResult,
} from "./verifier.js";

export const noopVerifier: Verifier = {
  verify(ctx: VerificationContext): VerificationResult {
    return {
      verified: true,
      checks: [{ name: "noop", passed: true }],
      summary: `${ctx.action}: noop (ablation)`,
      action: ctx.action,
    };
  },
};
