/**
 * /api/health — server health and uptime information.
 */
import { Elysia } from "elysia";
import pkg from "../../package.json" with { type: "json" };

/** The Cortex package version (stamped at release; Settings · About shows it). */
export const CORTEX_VERSION: string = pkg.version;
const SERVER_START_TIME = Date.now();

type ProviderStatus = "ok" | "missing";
type ProviderHealthResult = Record<string, ProviderStatus>;

export function checkProviders(env: Record<string, string | undefined> = process.env): ProviderHealthResult {
  return {
    anthropic: env.ANTHROPIC_API_KEY ? "ok" : "missing",
    openai: env.OPENAI_API_KEY ? "ok" : "missing",
    gemini: (env.GEMINI_API_KEY ?? env.GOOGLE_API_KEY) ? "ok" : "missing",
  };
}

export const healthRouter = new Elysia({ prefix: "/api/health" })
  .get(
    "/",
    () => {
      const uptimeMs = Date.now() - SERVER_START_TIME;
      const uptimeSeconds = Math.floor(uptimeMs / 1000);
      return {
        ok: true,
        version: CORTEX_VERSION,
        uptime: uptimeSeconds,
      };
    },
  )
  // Intentionally unauthenticated: Cortex is a single-user local tool; callers are on the same machine.
  .get("/providers", () => checkProviders());
