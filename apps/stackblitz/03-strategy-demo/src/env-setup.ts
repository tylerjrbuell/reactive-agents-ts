/**
 * Shared playground setup: provider detection + run reporting.
 *
 * Each StackBlitz demo is a standalone npm project, so this file is
 * copied into every demo rather than shared via a workspace dependency.
 */

/** Providers the demos support, mirroring the framework's provider list. */
export type ProviderName =
  | "gemini"
  | "anthropic"
  | "openai"
  | "groq"
  | "xai"
  | "litellm"
  | "ollama";

/**
 * Which env var signals a provider is usable. Gemini/Anthropic/OpenAI/Groq/
 * xAI use API keys; LiteLLM points at a proxy URL (its key is optional);
 * Ollama is local and keyless.
 */
const PROVIDER_ENV: ReadonlyArray<readonly [ProviderName, string]> = [
  ["gemini", "GOOGLE_API_KEY"],
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["groq", "GROQ_API_KEY"],
  ["xai", "XAI_API_KEY"],
  ["litellm", "LITELLM_BASE_URL"],
];

const KNOWN_PROVIDERS: readonly string[] = [
  "gemini",
  "anthropic",
  "openai",
  "groq",
  "xai",
  "litellm",
  "ollama",
];

/** Treat empty or unedited placeholder values as "not set". */
export const realKey = (value?: string): boolean =>
  !!value &&
  value.trim().length > 0 &&
  !/^your_|_here$|^<.*>$/i.test(value.trim());

/** First provider (recommended order) that has a usable config present. */
export function detectProvider(): ProviderName | undefined {
  for (const [name, varName] of PROVIDER_ENV) {
    if (realKey(process.env[varName])) return name;
  }
  return undefined;
}

/** Explicit PROVIDER wins, then env detection, then the demo fallback. */
export function resolveProvider(fallback: ProviderName): ProviderName {
  const explicit = process.env.PROVIDER?.trim().toLowerCase();
  if (explicit && KNOWN_PROVIDERS.includes(explicit)) {
    return explicit as ProviderName;
  }
  return detectProvider() ?? fallback;
}

/** True when the selected provider can actually run. */
export function hasKeyFor(provider: ProviderName): boolean {
  if (provider === "ollama") return true; // local tunnel needs no key
  const varName = PROVIDER_ENV.find(([name]) => name === provider)?.[1];
  return varName !== undefined && realKey(process.env[varName]);
}

/** Friendly banner shown when no usable provider is configured. */
export function printSetupGuide(): void {
  console.log(`
================================================
  No provider configured. Add ONE of these in
  StackBlitz Secrets (Settings icon, left sidebar):

  GOOGLE_API_KEY      -> ai.google.dev        (free tier, recommended)
  ANTHROPIC_API_KEY   -> console.anthropic.com
  OPENAI_API_KEY      -> platform.openai.com
  GROQ_API_KEY        -> console.groq.com     (fast hosted Llama/Qwen)
  XAI_API_KEY         -> console.x.ai
  LITELLM_BASE_URL    -> any OpenAI-compatible endpoint
                        (a LiteLLM proxy, llama.cpp server, etc.)

  The demos detect which provider you configured.
  Force one with PROVIDER= if several keys are set.

  Local Ollama (Chrome) needs an HTTPS tunnel: WebContainer
  localhost is NOT your machine. On your host run:
    OLLAMA_ORIGINS=* ollama serve
    cloudflared tunnel --url http://localhost:11434
  then set:
    PROVIDER=ollama
    OLLAMA_ENDPOINT=https://YOUR-TUNNEL.trycloudflare.com
================================================
`);
}

export interface RunRow {
  readonly label: string;
  readonly ok: boolean;
  readonly detail?: string;
}

/**
 * Collects per-run outcomes and prints one summary so a failed run is
 * explained instead of silently printing empty output.
 */
export function createFinisher(): {
  add: (row: RunRow) => void;
  report: () => void;
} {
  const rows: RunRow[] = [];
  return {
    add: (row) => {
      rows.push(row);
    },
    report: () => {
      console.log("\n===============================================");
      console.log("                  RUN SUMMARY                  ");
      console.log("===============================================");
      for (const row of rows) {
        const mark = row.ok ? "[ok]   " : "[fail] ";
        console.log(`${mark}${row.label}${row.detail ? ` - ${row.detail}` : ""}`);
      }
      const failures = rows.filter((row) => !row.ok).length;
      if (failures > 0) {
        console.log(
          `\n${failures} run(s) failed. Common causes: provider rate limit, a` +
            ` model without tool-calling support, or a stale MODEL override.\n` +
            `Try: unset MODEL (use the provider default), simplify the task,` +
            ` or point PROVIDER at a different key.`
        );
      }
    },
  };
}
