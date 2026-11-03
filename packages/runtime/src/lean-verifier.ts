/**
 * The noop verifier `withLeanHarness()` installs at the terminal gate. Lives in
 * its own module so the run-config snapshot can recognise lean mode by identity
 * (`config.verifier === leanModeVerifier`) without importing `runtime.ts`.
 */
import type { Verifier } from "@reactive-agents/reasoning";

export const leanModeVerifier: Verifier = {
  verify: (ctx) => ({
    verified: true,
    softFail: false,
    checks: [{ name: "noop", passed: true }],
    summary: `${ctx.action}: noop (lean harness)`,
    action: ctx.action,
  }),
};
