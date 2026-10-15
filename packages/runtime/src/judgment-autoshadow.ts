/**
 * Wave 7.1 auto-shadow — probe for a cheap local judgment backend.
 *
 * Shadow sites (`Effect.serviceOption(JudgmentService)`) sample NOTHING when
 * no service is wired, so a default-off world never accumulates the agreement
 * traffic inversion decisions need. This probe lets `build()` auto-enable a
 * purely-observational Ollama-backend service: shadow events fire, decisions
 * are never consumed.
 *
 * Keyless-safe by construction: explicit opt-out env, unreachable server, or
 * any probe error all resolve to `undefined` (no service, zero behavior
 * change) rather than failing the build. Never throws.
 */
export interface AutoShadowBackend {
  readonly backend: "ollama";
  readonly baseUrl: string;
}

const optOut = (): boolean => process.env.REACTIVE_AGENTS_NO_AUTO_SHADOW === "1";

const resolveEndpoint = (): string =>
  process.env.OLLAMA_ENDPOINT ?? process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE ?? "http://localhost:11434";

export const probeAutoShadow = async (): Promise<AutoShadowBackend | undefined> => {
  if (optOut()) return undefined;
  const endpoint = resolveEndpoint();
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return undefined;
    return { backend: "ollama", baseUrl: endpoint };
  } catch {
    return undefined;
  }
};
