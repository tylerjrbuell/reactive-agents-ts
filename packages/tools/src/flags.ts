/**
 * Tools-package killswitch resolution — the one place that decides what each
 * `RA_*` env flag means for `@reactive-agents/tools`, mirroring the pattern
 * in `packages/reasoning/src/harness-flags.ts`.
 *
 * Task 15 ablatability audit (2026-07-28): `RA_SANDBOX` was read directly at
 * TWO sites (`skills/code-execution.ts`, `skills/shell-execution.ts`) — the
 * same multi-site-read shape `RA_LAZY_TOOLS` had. `RA_HTTP_ALLOW_PRIVATE` was
 * a single-site direct read, folded in here for the same reason: one flag,
 * one resolver, regardless of how many call sites need it today.
 *
 * This does NOT live in `packages/reasoning/src/harness-flags.ts`:
 * `packages/tools` sits BELOW `packages/reasoning` in the dependency graph
 * (`reasoning` depends on `tools`, never the reverse), so importing
 * `harness-flags.ts` from here would be a circular package edge.
 */

/**
 * Opt-in Docker sandbox (F1b) — run code-execution / shell-execution inside a
 * hardened throwaway container (no network, non-root, read-only rootfs)
 * instead of a host subprocess.
 *
 * Default OFF (host subprocess). `RA_SANDBOX=docker` turns it on.
 */
export function sandboxDockerEnabled(): boolean {
  return process.env.RA_SANDBOX === "docker";
}

/**
 * HTTP egress guard bypass (F6). The URL an `http-get` tool call targets is
 * model-controlled, so it is validated (every redirect hop too) as public
 * before fetching, blocking cloud metadata (169.254.169.254) and internal
 * hosts.
 *
 * Default OFF (guard active — private/loopback targets refused).
 * `RA_HTTP_ALLOW_PRIVATE=1` permits trusted loopback/private targets.
 */
export function httpAllowPrivateEnabled(): boolean {
  return process.env.RA_HTTP_ALLOW_PRIVATE === "1";
}
