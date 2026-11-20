/**
 * The speech models a server offers, for the Settings · Voice model pickers.
 *
 * Speaches lists what it has installed at `GET <base>/models?task=<task>` and what it can download
 * at `GET <base>/registry?task=<task>` (tasks `automatic-speech-recognition`, `text-to-speech`;
 * checked against Speaches' OpenAPI document). Other OpenAI-compatible servers answer only the
 * first, or neither: then the lists are short or empty and the picker keeps its free-text field.
 * Never fails; error bodies are never echoed; redirects are not followed.
 */
import { audioUrl, type AudioEndpoint } from "./openai-compatible.js";

/** Which list. */
export type SpeechTask = "automatic-speech-recognition" | "text-to-speech";

/** One model the server offers. */
export interface SpeechModel {
  readonly id: string;
  /** Language codes the model covers (`multilingual`, `en`, ...); empty when the server does not say. */
  readonly languages: readonly string[];
  /** Number of voices (speech models that list them). */
  readonly voices?: number;
}

/** Body of `GET /api/voice/models/:direction`. */
export interface SpeechModelList {
  readonly installed: readonly SpeechModel[];
  /** Downloadable and not installed yet. */
  readonly available: readonly SpeechModel[];
  /** The server answered a model list at all. */
  readonly listed: boolean;
}

const MAX_BODY_CHARS = 8_000_000;
const MAX_MODELS = 3000;

function modelFrom(v: unknown): SpeechModel | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as { id?: unknown; language?: unknown; voices?: unknown };
  if (typeof o.id !== "string" || o.id === "" || o.id.length > 200) return null;
  const languages = Array.isArray(o.language) ? o.language.filter((l): l is string => typeof l === "string" && l.length <= 20).slice(0, 200) : [];
  return { id: o.id, languages, ...(Array.isArray(o.voices) ? { voices: o.voices.length } : {}) };
}

async function fetchModels(ep: AudioEndpoint, path: string): Promise<readonly SpeechModel[] | null> {
  try {
    const res = await (ep.fetch ?? fetch)(audioUrl(ep.baseUrl, path), {
      headers: ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {},
      signal: ep.signal ? AbortSignal.any([ep.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
      redirect: "manual",
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return null;
    }
    const text = await res.text();
    if (text.length > MAX_BODY_CHARS) return null;
    const j: unknown = JSON.parse(text);
    const data = typeof j === "object" && j !== null ? (j as { data?: unknown }).data : undefined;
    if (!Array.isArray(data)) return null;
    return data
      .slice(0, MAX_MODELS)
      .map(modelFrom)
      .filter((m): m is SpeechModel => m !== null);
  } catch {
    return null;
  }
}

/** The installed and downloadable models for `task` on the endpoint. */
export async function listSpeechModels(ep: AudioEndpoint, task: SpeechTask): Promise<SpeechModelList> {
  const [installed, registry] = await Promise.all([fetchModels(ep, `models?task=${task}`), fetchModels(ep, `registry?task=${task}`)]);
  const have = new Set((installed ?? []).map((m) => m.id));
  return {
    installed: installed ?? [],
    available: (registry ?? []).filter((m) => !have.has(m.id)),
    listed: installed !== null || registry !== null,
  };
}
