/**
 * Lab · Judgment rules: the form value, the body sent to the server (`judgment` on
 * `POST /api/runs` and chat), and the words that say which backend is active.
 *
 * `.withJudgment()` has no AgentConfig form in the framework, so Cortex applies it as an
 * overlay (server `services/cortex-judgment.ts`). Off is "not sent": the framework only
 * wires a judgment service when asked.
 */

/** The backends the framework knows (`JudgmentBackendName`). */
export type JudgmentBackendChoice = "jev" | "ollama" | "llm";

/** The Judgment section's value on the agent config. */
export interface JudgmentFormConfig {
  readonly enabled: boolean;
  /** Absent = the framework default by presence: `jev` with a TypeSafe key, else `llm`. */
  readonly backend?: JudgmentBackendChoice;
  readonly model?: string;
  /** Per-request timeout in ms. */
  readonly timeoutMs?: number;
  /** Backend base URL (jev: TypeSafe API root; ollama: server root). */
  readonly baseUrl?: string;
  /** Ollama `keep_alive`: seconds, or a `"5m"` style string. */
  readonly keepAlive?: string;
}

/** The default: judgment off. */
export const defaultJudgment = (): JudgmentFormConfig => ({ enabled: false });

/** The form value from a stored config's `judgment` (server-normalised, keep_alive may be a number). */
export function judgmentFrom(raw: unknown): JudgmentFormConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return defaultJudgment();
  const r = raw as Record<string, unknown>;
  if (r.enabled !== true) return defaultJudgment();
  const backend = r.backend === "jev" || r.backend === "ollama" || r.backend === "llm" ? r.backend : undefined;
  return {
    enabled: true,
    ...(backend ? { backend } : {}),
    ...(typeof r.model === "string" ? { model: r.model } : {}),
    ...(typeof r.timeoutMs === "number" ? { timeoutMs: r.timeoutMs } : {}),
    ...(typeof r.baseUrl === "string" ? { baseUrl: r.baseUrl } : {}),
    ...(typeof r.keepAlive === "string" || typeof r.keepAlive === "number" ? { keepAlive: String(r.keepAlive) } : {}),
  };
}

/** Options of the backend picker. `auto` = leave it to the framework's presence rule. */
export const JUDGMENT_BACKEND_OPTIONS: readonly { readonly value: JudgmentBackendChoice | "auto"; readonly label: string }[] = [
  { value: "auto", label: "Automatic (TypeSafe with a key, else the agent's own model)" },
  { value: "jev", label: "TypeSafe Jev (calibrated)" },
  { value: "ollama", label: "Ollama System One model" },
  { value: "llm", label: "The agent's own model (uncalibrated)" },
];

const text = (v: string | undefined): string | undefined => (v !== undefined && v.trim() !== "" ? v.trim() : undefined);

/** The `judgment` body field for a form value, or undefined when judgment is off. */
export function judgmentBodyOf(j: JudgmentFormConfig | undefined): Record<string, unknown> | undefined {
  if (!j || j.enabled !== true) return undefined;
  const timeoutMs = typeof j.timeoutMs === "number" && Number.isFinite(j.timeoutMs) && j.timeoutMs > 0 ? j.timeoutMs : undefined;
  return {
    enabled: true,
    ...(j.backend ? { backend: j.backend } : {}),
    ...(text(j.model) ? { model: text(j.model) } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(text(j.baseUrl) ? { baseUrl: text(j.baseUrl) } : {}),
    ...(j.backend === "ollama" && text(j.keepAlive) ? { keepAlive: text(j.keepAlive) } : {}),
  };
}

/** Where the TypeSafe key an agent would use comes from (Settings · Providers status). */
export type TypesafeKeySource = "stored" | "env" | "none";

/** Which backend runs, in plain words, given the choice and the key. */
export function activeBackendOf(j: JudgmentFormConfig, key: TypesafeKeySource): { readonly backend: JudgmentBackendChoice; readonly why: string } {
  if (j.backend) return { backend: j.backend, why: "chosen here" };
  return key === "none"
    ? { backend: "llm", why: "no TypeSafe key, so the agent's own model answers (uncalibrated)" }
    : { backend: "jev", why: key === "stored" ? "a TypeSafe key is saved in Settings" : "TYPESAFE_API_KEY is set in the server's environment" };
}

/** One-line status beside the section title. */
export function judgmentHeadOf(j: JudgmentFormConfig | undefined): string {
  if (!j || !j.enabled) return "off";
  return j.backend ? `on · ${j.backend}` : "on · automatic";
}

/** The Ollama System One model hints: the framework default and the vision models its docs name. */
export const OLLAMA_JUDGMENT_MODELS: readonly string[] = ["nimble", "clef", "clef-flash"];

/** Note shown with the Ollama backend. Honest about what the framework can and cannot tell. */
export function ollamaJudgmentNote(ollamaEndpointIsCloud: boolean): string {
  return ollamaEndpointIsCloud
    ? "System One needs local GGUF weights with a scoring-capable runner and is not available on Ollama Cloud. Point this at a local Ollama server (Base URL below)."
    : "System One needs local GGUF weights with a scoring-capable runner (default model nimble; clef and clef-flash take images). The framework has no list of which installed models support it, so type the model id.";
}
