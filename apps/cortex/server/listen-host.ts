/**
 * Which network interface the Cortex server binds.
 *
 * Cortex has no authentication, and its API can list directories
 * (`/api/workspace/browse`), read skill files and start agent runs. So it binds the
 * loopback interface by default: only this computer can reach it. Exposing it to the
 * network is an explicit opt-in: `CORTEX_HOST` (env) or `hostname` in the
 * `startCortexServer` config.
 */

/** The default bind address: loopback only. */
export const DEFAULT_CORTEX_HOST = "127.0.0.1";

/**
 * The hostname to bind: an explicit config value wins, then `CORTEX_HOST`, then
 * {@link DEFAULT_CORTEX_HOST}. Blank values count as unset.
 */
export function resolveCortexHostname(
  explicit: string | undefined,
  env: Readonly<Record<string, string | undefined>>,
): string {
  const fromConfig = explicit?.trim();
  if (fromConfig) return fromConfig;
  const fromEnv = env.CORTEX_HOST?.trim();
  if (fromEnv) return fromEnv;
  return DEFAULT_CORTEX_HOST;
}

/** True when `hostname` only accepts connections from this computer. */
export function isLoopbackHost(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "::1" || /^127(\.\d{1,3}){3}$/.test(h);
}
