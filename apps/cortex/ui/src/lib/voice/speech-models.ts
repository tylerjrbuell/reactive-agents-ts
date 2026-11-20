/**
 * The Settings · Voice model picker over `GET /api/voice/models/:direction`: what the speech server
 * has installed and what it can download (Speaches), turned into kit `Select` options. A server
 * that lists nothing leaves the free-text model field in place.
 */

/** One model the server offers. */
export interface SpeechModelInfo {
  readonly id: string;
  readonly languages: readonly string[];
  readonly voices?: number | undefined;
}

/** The server's lists. */
export interface SpeechModels {
  readonly installed: readonly SpeechModelInfo[];
  /** Downloadable, not installed yet. */
  readonly available: readonly SpeechModelInfo[];
  readonly listed: boolean;
}

/** Option value that switches the picker to a free-text id. */
export const CUSTOM_MODEL = "\u0000custom-model";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function modelOf(v: unknown): SpeechModelInfo | null {
  if (!isRecord(v) || typeof v.id !== "string" || v.id === "") return null;
  const languages = Array.isArray(v.languages) ? v.languages.filter((l): l is string => typeof l === "string") : [];
  return { id: v.id, languages, ...(typeof v.voices === "number" ? { voices: v.voices } : {}) };
}

const listOf = (v: unknown): SpeechModelInfo[] => (Array.isArray(v) ? v.map(modelOf).filter((m): m is SpeechModelInfo => m !== null) : []);

/** The lists from untrusted JSON (empty and unlisted when it is not one). */
export function parseSpeechModels(v: unknown): SpeechModels {
  if (!isRecord(v)) return { installed: [], available: [], listed: false };
  return { installed: listOf(v.installed), available: listOf(v.available), listed: v.listed === true };
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** The languages a model covers, in a few words (`Multilingual`, `English only`, `12 languages`), or empty. */
export function languagesLine(languages: readonly string[]): string {
  if (languages.includes("multilingual")) return "Multilingual";
  if (languages.length === 1) return `${languageName(languages[0] ?? "")} only`;
  return languages.length > 1 ? `${languages.length} languages` : "";
}

function describe(m: SpeechModelInfo, prefix: string): string {
  const voices = m.voices !== undefined && m.voices > 0 ? `${m.voices} ${m.voices === 1 ? "voice" : "voices"}` : "";
  return [prefix, languagesLine(m.languages), voices].filter((x) => x !== "").join(", ");
}

/** Kit `Select` options: installed, then downloadable, the current id kept when the server does not list it, and a custom-id choice. */
export function modelSelectOptions(models: SpeechModels, current: string): { value: string; label: string; group?: string; description?: string }[] {
  const listed = new Set([...models.installed, ...models.available].map((m) => m.id));
  return [
    ...(current !== "" && !listed.has(current) ? [{ value: current, label: current, group: "Saved", description: "Not listed by this server" }] : []),
    ...models.installed.map((m) => ({ value: m.id, label: m.id, group: "Installed", description: describe(m, "") })),
    ...models.available.map((m) => ({ value: m.id, label: m.id, group: "Download", description: describe(m, "Downloads when you save") })),
    { value: CUSTOM_MODEL, label: "Other model id…", group: "Other" },
  ];
}

/** True when `id` is downloadable and not installed yet. */
export const needsDownload = (models: SpeechModels, id: string): boolean => models.available.some((m) => m.id === id);
