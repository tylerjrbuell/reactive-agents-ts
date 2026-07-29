/**
 * A2A killswitch resolution — the one place that decides what
 * `RA_AGENT_STRICT_EGRESS` means, mirroring the pattern in
 * `packages/reasoning/src/harness-flags.ts`.
 *
 * Task 15 ablatability audit (2026-07-28): this flag was read directly at TWO
 * sites — `client/discovery.ts` and (in the dependent package)
 * `packages/runtime/src/builder/build-effect/remote-agent-tools.ts` — the
 * same multi-site-read shape `RA_LAZY_TOOLS` had, just not yet multi-directional.
 *
 * It cannot be routed through `packages/reasoning/src/harness-flags.ts`
 * instead: `packages/a2a` does not depend on `packages/reasoning` (nor the
 * reverse), so importing it would be a new package edge for one flag. It
 * lives here because `packages/runtime` already depends on `packages/a2a`
 * (never the reverse), so this direction is the only one that does not
 * introduce a cycle.
 */

/**
 * Strict A2A egress — refuse private-network peer targets (loopback,
 * RFC-1918) in addition to the always-blocked cloud-metadata / link-local
 * ranges.
 *
 * Default OFF (private peers ALLOWED): A2A discovery peers are
 * operator-configured, and a local peer is a legitimate multi-agent
 * deployment pattern (F15). `RA_AGENT_STRICT_EGRESS=1` also refuses private
 * targets.
 */
export function agentStrictEgressEnabled(): boolean {
  return process.env.RA_AGENT_STRICT_EGRESS === "1";
}
