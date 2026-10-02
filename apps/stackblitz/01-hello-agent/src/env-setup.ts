/**
 * Shared playground setup: provider detection + run reporting.
 *
 * Each StackBlitz demo is a standalone npm project, so this file is
 * copied into every demo rather than shared via a workspace dependency.
 */

export type ProviderName =
  | "gemini"
  | "anthropic"
  | "openai"
  | "groq"
  | "xai"
  | "litellm"
  | "ollama";

/**
 * Which env var makes each provider usable. The framework supports more
 * providers than these (the full list is in the docs' LLM Providers page);
 * the demos detect the ones people actually bring to a playground.
 */
const PROVIDER_KEYS: ReadonlyArray<readonly [ProviderName, string]> = [
  ["gemini", "GOOGLE_API_KEY"],
  ["anthropic", "ANTHROPIC_API_KEY"],
  ["openai", "OPENAI_API_KEY"],
  ["groq", "GROQ_API_KEY"],
  ["xai", "XAI_API_KEY"],
  ["litellm", "LITELLM_BASE_URL"], // OpenAI-compatible proxy endpoint
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

/** Treat empty or unedited placeholder values as "no key". */
export const realKey = (value?: string): boolean =>
  !!value &&
  value.trim().length > 0 &&
  !/^your_|_here$|^<.*>$/i.test(value.trim());

/** First provider (recommended order) that has a usable key or endpoint. */
export function detectProvider(): ProviderName | undefined {
  for (const [name, varName] of PROVIDER_KEYS) {
    if (realKey(process.env[varName])) return name;
  }
  return undefined;
}

/** Explicit PROVIDER wins, then key detection, then the demo fallback. */
export function resolveProvider(fallback: ProviderName): ProviderName {
  const explicit = process.env.PROVIDER?.trim().toLowerCase();
  if (explicit && KNOWN_PROVIDERS.includes(explicit)) {
    return explicit as ProviderName;
  }
  return detectProvider() ?? fallback;
}

/** True when the selected provider can actually run. */
export function hasKeyFor(provider: ProviderName): boolean {
  if (provider === "ollama") return true; // local tunnel: no key needed
  const varName = PROVIDER_KEYS.find(([name]) => name === provider)?.[1];
  return varName !== undefined && realKey(process.env[varName]);
}

/** Friendly banner shown when no usable provider is configured. */
export function printSetupGuide(): void {
  console.log(`
================================================
  No provider configured. Add ONE of these in
  StackBlitz Secrets (Settings icon, left sidebar):

  GOOGLE_API_KEY     -> ai.google.dev         (free tier, recommended)
  ANTHROPIC_API_KEY  -> console.anthropic.com
  OPENAI_API_KEY     -> platform.openai.com
  GROQ_API_KEY       -> console.groq.com      (fast hosted Llama, free tier)
  XAI_API_KEY        -> console.x.ai
  LITELLM_BASE_URL   -> any OpenAI-compatible endpoint (40+ models)

  The demo auto-detects which provider you set. Force one with
  PROVIDER= if you have several keys in your environment.

  Local Ollama (Chrome) needs an HTTPS tunnel - WebContainer
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
 * Collects per-run outcomes and prints one summary at the end so a
 * failed run is explained instead of silently printing empty output.
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
          "\nSome runs failed. Common causes: provider rate limit, a model" +
            " without tool-calling support, or a stale MODEL override.\n" +
            "Try: unset MODEL (use the provider default), simplify the task," +
            " or set PROVIDER= to a different key."
        );
      } else {
        console.log("\nAll runs completed. Open src/agent.ts to see how it works" +
          " - every line maps to a documented framework feature.");
      }
    },
  };
}
