/**
 * /api/health — server health, versions and provider key presence.
 */
import { Elysia } from "elysia";
import { cortexVersionInfo } from "../services/cortex-version.js";
import { installedProviderKeyStore, storedKeyAppliesToAgents } from "../services/provider-key-store.js";

const SERVER_START_TIME = Date.now();

type ProviderStatus = "ok" | "missing";
type ProviderHealthResult = Record<string, ProviderStatus>;

/**
 * Whether each cloud provider has a key: in the environment, or stored through
 * Settings (`hasStored`, default: the server's installed key store).
 */
export function checkProviders(
  env: Record<string, string | undefined> = process.env,
  hasStored: (provider: string) => boolean = (p) =>
    storedKeyAppliesToAgents(p) && installedProviderKeyStore()?.storedKey(p) !== undefined,
): ProviderHealthResult {
  const status = (envSet: boolean, provider: string): ProviderStatus => (envSet || hasStored(provider) ? "ok" : "missing");
  return {
    anthropic: status(Boolean(env.ANTHROPIC_API_KEY), "anthropic"),
    openai: status(Boolean(env.OPENAI_API_KEY), "openai"),
    gemini: status(Boolean(env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY), "gemini"),
  };
}

export const healthRouter = new Elysia({ prefix: "/api/health" })
  .get(
    "/",
    () => {
      const uptimeMs = Date.now() - SERVER_START_TIME;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);
      const v = cortexVersionInfo();
      return {
        ok: true,
        /** Same as `cortexVersion` (kept for older clients). */
        version: v.cortexVersion,
        cortexVersion: v.cortexVersion,
        frameworkVersion: v.frameworkVersion,
        commit: v.commit,
        origin: v.origin,
        uptime: uptimeSeconds,
      };
    },
  )
  // Intentionally unauthenticated: Cortex is a single-user local tool; callers are on the same machine.
  .get("/providers", () => checkProviders());
