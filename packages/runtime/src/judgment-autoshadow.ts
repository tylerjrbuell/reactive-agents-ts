/**
 * Wave 7.1 auto-shadow — probe for a cheap local judgment backend.
 *
 * Shadow sites (`Effect.serviceOption(JudgmentService)`) sample NOTHING when
 * no service is wired. Auto-shadow lets `build()` wire a purely-observational
 * Ollama-backend service so shadow events fire; decisions are never consumed.
 *
 * OPT-IN (2026-11-18). Auto-shadow used to run on every `build()` that could
 * reach Ollama: hidden model calls, an unchecked model, and a growing
 * `~/.reactive-agents/judgment-shadow.db`. It now runs only when asked for:
 * `.withJudgment({ shadow: true })` or `REACTIVE_AGENTS_AUTO_SHADOW=1`.
 * `REACTIVE_AGENTS_NO_AUTO_SHADOW=1` and `.withJudgment(false)` still turn it
 * off, and both win over the env opt-in.
 *
 * Keyless-safe by construction: unreachable server, model not installed, or
 * any probe error all resolve to `undefined` (no service, zero behavior
 * change) rather than failing the build. Never throws.
 */
export interface AutoShadowBackend {
  readonly backend: "ollama";
  readonly baseUrl: string;
  readonly model: string;
}

/**
 * Observation-only form of `.withJudgment()`: `.withJudgment({ shadow: true })`.
 *
 * At `build()` the builder probes a local Ollama server. If `model` is
 * installed it wires a `JudgmentService` on that model so harness shadow
 * sites sample it and write agreement rows to the shadow DB
 * (`REACTIVE_AGENTS_SHADOW_DB`, default `~/.reactive-agents/judgment-shadow.db`).
 * Decisions are never consumed, and `agent.judge()` still needs the explicit
 * form. Server unreachable or model absent: no service, build unchanged.
 */
export interface JudgmentShadowOptions {
  /** Opt into auto-shadow sampling. */
  readonly shadow: true;
  /** Ollama model to sample with; must be installed. Default: `"nimble"`. */
  readonly model?: string;
  /** Ollama server root. Default: `OLLAMA_ENDPOINT` / `OLLAMA_HOST` / `OLLAMA_BASE` / `http://localhost:11434`. */
  readonly baseUrl?: string;
}

/** Judgment model the shadow probe looks for when none is configured (the Ollama judgment backend's default). */
export const DEFAULT_SHADOW_MODEL = "nimble";

/**
 * Decide whether `build()` should run the auto-shadow probe.
 *
 * @param requested - Builder-level choice: `true` from `.withJudgment({ shadow: true })`,
 *   `false` from `.withJudgment(false)`, `undefined` when never set.
 * @returns `true` only on an explicit opt-in that no opt-out overrides.
 */
export const autoShadowRequested = (requested: boolean | undefined): boolean => {
  if (process.env.REACTIVE_AGENTS_NO_AUTO_SHADOW === "1") return false;
  return requested ?? process.env.REACTIVE_AGENTS_AUTO_SHADOW === "1";
};

const resolveEndpoint = (): string =>
  process.env.OLLAMA_ENDPOINT ?? process.env.OLLAMA_HOST ?? process.env.OLLAMA_BASE ?? "http://localhost:11434";

/** Ollama tags `nimble` as `nimble:latest`; an untagged name matches its `:latest` tag. */
const modelMatches = (installed: string, wanted: string): boolean =>
  installed === wanted || (!wanted.includes(":") && installed === `${wanted}:latest`);

const installedModels = (body: unknown): readonly string[] => {
  if (typeof body !== "object" || body === null || !("models" in body)) return [];
  const models = body.models;
  if (!Array.isArray(models)) return [];
  return models.flatMap((m: unknown): string[] => {
    if (typeof m !== "object" || m === null) return [];
    const names: string[] = [];
    if ("name" in m && typeof m.name === "string") names.push(m.name);
    if ("model" in m && typeof m.model === "string") names.push(m.model);
    return names;
  });
};

/**
 * Probe a local Ollama server for the shadow judgment model. Call only after
 * {@link autoShadowRequested} returns `true`.
 *
 * @param options.model - Model that must be installed. Default: {@link DEFAULT_SHADOW_MODEL}
 * @param options.baseUrl - Ollama server root. Default: `OLLAMA_ENDPOINT` / `OLLAMA_HOST` / `OLLAMA_BASE` / `http://localhost:11434`
 * @returns The backend to wire, or `undefined` when the server is unreachable or the model is absent.
 */
export const probeAutoShadow = async (
  options: { readonly model?: string; readonly baseUrl?: string } = {},
): Promise<AutoShadowBackend | undefined> => {
  const endpoint = options.baseUrl ?? resolveEndpoint();
  const model = options.model ?? DEFAULT_SHADOW_MODEL;
  try {
    const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!res.ok) return undefined;
    const body: unknown = await res.json();
    if (!installedModels(body).some((name) => modelMatches(name, model))) return undefined;
    return { backend: "ollama", baseUrl: endpoint, model };
  } catch {
    return undefined;
  }
};
