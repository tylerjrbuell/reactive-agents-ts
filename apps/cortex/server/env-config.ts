/**
 * The server entry's environment, read in one place. `server/index.ts` takes every `CORTEX_*`
 * setting it needs from {@link cortexEnv} instead of touching `process.env`, so the variables are
 * documented here (and in `apps/cortex/AGENTS.md`), testable with an injected env, and counted by
 * `scripts/check-cortex-compliance.sh`. Other modules that read the environment are baselined in
 * that gate and move here as they are touched.
 */

/** The resolved entry-point settings. */
export interface CortexEnv {
  /** `CORTEX_URL`, trimmed; undefined when unset or blank. */
  readonly url: string | undefined;
  /** `CORTEX_TOKEN`, trimmed; undefined when unset or blank. */
  readonly token: string | undefined;
  /** `CORTEX_SPAWNED_BY_RAX=1`: the `rax cortex` CLI started the server and prints its own banner. */
  readonly spawnedByRax: boolean;
  /** `CORTEX_STATIC_PATH`, trimmed; undefined when unset or blank. */
  readonly staticPath: string | undefined;
  /** `CORTEX_PORT` (default 4321). */
  readonly port: number;
  /** False when `CORTEX_NO_OPEN=1`. */
  readonly openBrowser: boolean;
  /** The environment itself, for resolvers that take an `env` argument (`resolveCortexHostname`, `guardConfigFromEnv`). */
  readonly raw: Readonly<Record<string, string | undefined>>;
}

const trimmed = (value: string | undefined): string | undefined => {
  const t = value?.trim();
  return t ? t : undefined;
};

/** Read the entry-point settings from `env` (default `process.env`, read on every call). */
export function cortexEnv(env: Readonly<Record<string, string | undefined>> = process.env): CortexEnv {
  return {
    url: trimmed(env.CORTEX_URL),
    token: trimmed(env.CORTEX_TOKEN),
    spawnedByRax: env.CORTEX_SPAWNED_BY_RAX === "1",
    staticPath: trimmed(env.CORTEX_STATIC_PATH),
    port: parseInt(env.CORTEX_PORT ?? "4321", 10),
    openBrowser: env.CORTEX_NO_OPEN !== "1",
    raw: env,
  };
}
