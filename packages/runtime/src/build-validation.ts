import { resolveCanonical } from "@reactive-agents/llm-provider";

type ProviderName = "anthropic" | "openai" | "ollama" | "gemini" | "litellm" | "test" | "custom";

const PROVIDER_API_KEY_MAP: Record<string, string> = {
  anthropic: "ANTHROPIC_API_KEY",
  openai: "OPENAI_API_KEY",
  gemini: "GOOGLE_API_KEY",
  litellm: "OPENAI_API_KEY",
  ollama: "OLLAMA_API_KEY",
};

const PROVIDER_MODEL_PREFIXES: Record<string, string[]> = {
  anthropic: ["claude"],
  openai: ["gpt", "o1", "o3", "chatgpt"],
  gemini: ["gemini"],
  ollama: [],
  litellm: [],
  test: ["test"],
};

const NO_KEY_PROVIDERS = new Set(["ollama", "test"]);

export interface BuildValidationResult {
  warnings: string[];
  errors: string[];
  resolvedModel: string;
}

export function validateBuild(
  provider: ProviderName,
  model: string | undefined,
  defaultModel: string,
  strict: boolean,
): BuildValidationResult {
  const warnings: string[] = [];
  const errors: string[] = [];
  const resolvedModel = model ?? defaultModel;

  if (!NO_KEY_PROVIDERS.has(provider)) {
    const keyName = PROVIDER_API_KEY_MAP[provider];
    if (keyName && !process.env[keyName]) {
      const msg = `Missing ${keyName} for provider "${provider}". Set it in your environment or .env file.`;
      if (strict) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  if (model && provider !== "ollama" && provider !== "litellm" && provider !== "test") {
    const prefixes = PROVIDER_MODEL_PREFIXES[provider] ?? [];
    if (prefixes.length > 0) {
      const modelLower = model.toLowerCase();
      const matches = prefixes.some((p) => modelLower.startsWith(p));
      if (!matches) {
        warnings.push(
          `Model "${model}" may not be compatible with provider "${provider}". ` +
            `Expected model prefix: ${prefixes.join(", ")}. ` +
            `The provider's default model will be used if this model is unavailable.`,
        );
      }
    }
  }

  // Capability-source honesty gate (mirrors the bench preflight at agent build
  // time). When the canonical resolver finds no probe/cache/static-table entry,
  // it returns a conservative 2048-ctx fallback that silently under-sizes every
  // downstream context budget (root cause of the 2026-06-02 claude-haiku-4-5
  // baseline regression). Surface it loudly — warning by default, error under
  // strictValidation — rather than running silently degraded (anti-mission #4).
  // `provider: "test"` is exempt (deterministic provider, no real capability).
  if (model && provider !== "test" && provider !== "custom") {
    const cap = resolveCanonical(provider, model);
    if (cap.source === "fallback") {
      const msg =
        `Capability for ${provider}/${model} resolved from source="fallback" ` +
        `(no probe/cache/static-table entry) — running at a conservative ${cap.recommendedNumCtx}-token ` +
        `context window, which silently under-sizes every context budget. ` +
        `Fix: add "${model}" to STATIC_CAPABILITIES in @reactive-agents/llm-provider, ` +
        `or enable a live capability probe. Build with strict validation to make this an error.`;
      if (strict) {
        errors.push(msg);
      } else {
        warnings.push(msg);
      }
    }
  }

  return { warnings, errors, resolvedModel };
}

/**
 * Pre-flight connection check for local providers (e.g. Ollama).
 * Verifies the service is reachable before building the agent.
 */
export async function validateProviderConnection(
  provider: ProviderName,
  ollamaEndpoint?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (provider === "ollama") {
    const endpoint = ollamaEndpoint ?? process.env.OLLAMA_ENDPOINT ?? "http://localhost:11434";
    try {
      const res = await fetch(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) {
        return { ok: false, error: `Ollama returned HTTP ${res.status}. Is the service running at ${endpoint}?` };
      }
      return { ok: true };
    } catch {
      return {
        ok: false,
        error: `Cannot connect to Ollama at ${endpoint}. Is the Ollama service running?\n  Start it with: ollama serve`,
      };
    }
  }
  return { ok: true };
}

export function logBuildInfo(provider: ProviderName, resolvedModel: string): void {
  const keyName = PROVIDER_API_KEY_MAP[provider];
  const hasKey = keyName ? !!process.env[keyName] : false;
  const keyDisplay =
    hasKey && keyName
      ? `${process.env[keyName]!.slice(0, 8)}...***`
      : NO_KEY_PROVIDERS.has(provider)
        ? "(not required)"
        : "(missing)";

  console.log(`✓ Provider: ${provider} | Model: ${resolvedModel} | API key: ${keyDisplay}`);
}
