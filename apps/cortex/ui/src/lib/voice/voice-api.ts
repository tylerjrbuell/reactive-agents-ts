/**
 * Client for `/api/voice` (Settings · Voice and the two engines' server routes).
 * The server never returns an endpoint key; the key calls reuse the provider-key
 * routes under the ids `voice-stt` / `voice-tts`. Results are tagged, never thrown.
 */
import { causeMessage, type VoiceFetch } from "@reactive-agents/ui-core";
import { parseKeyStatus, type ProviderKeyStatus } from "../provider-keys.js";

/** `browser` = the browser's engine; `server` = the OpenAI-compatible endpoint. */
export type EngineChoice = "browser" | "server";

/** Speech-to-text settings. */
export interface SttSettings {
  readonly engine: EngineChoice;
  readonly baseUrl: string;
  readonly model: string;
}

/** Text-to-speech settings. */
export interface TtsSettings {
  readonly engine: EngineChoice;
  readonly baseUrl: string;
  readonly model: string;
  readonly voice: string;
}

/** `GET /api/voice/settings`. */
export interface VoiceSettingsView {
  readonly stt: SttSettings;
  readonly tts: TtsSettings;
  readonly keys: { readonly stt: ProviderKeyStatus | null; readonly tts: ProviderKeyStatus | null };
  readonly caps: { readonly maxAudioBytes: number; readonly maxSpeechChars: number };
}

/** The settings before the server has answered: browser engines, nothing configured. */
export const EMPTY_VOICE_SETTINGS: VoiceSettingsView = {
  stt: { engine: "browser", baseUrl: "", model: "whisper-1" },
  tts: { engine: "browser", baseUrl: "", model: "tts-1", voice: "alloy" },
  keys: { stt: null, tts: null },
  caps: { maxAudioBytes: 25 * 1024 * 1024, maxSpeechChars: 4096 },
};

/** Key-store ids of the two endpoint keys. */
export const STT_KEY_ID = "voice-stt";
export const TTS_KEY_ID = "voice-tts";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, fallback: string): string => (typeof v === "string" ? v : fallback);
const engine = (v: unknown): EngineChoice => (v === "server" ? "server" : "browser");

/** The settings view from untrusted JSON. */
export function parseVoiceSettings(v: unknown): VoiceSettingsView {
  const d = EMPTY_VOICE_SETTINGS;
  if (!isRecord(v) || !isRecord(v.settings)) return d;
  const s = v.settings;
  const stt = isRecord(s.stt) ? s.stt : {};
  const tts = isRecord(s.tts) ? s.tts : {};
  const k = isRecord(v.keys) ? v.keys : {};
  const caps = isRecord(v.caps) ? v.caps : {};
  return {
    stt: { engine: engine(stt.engine), baseUrl: str(stt.baseUrl, ""), model: str(stt.model, d.stt.model) },
    tts: { engine: engine(tts.engine), baseUrl: str(tts.baseUrl, ""), model: str(tts.model, d.tts.model), voice: str(tts.voice, d.tts.voice) },
    keys: { stt: parseKeyStatus(k.stt), tts: parseKeyStatus(k.tts) },
    caps: {
      maxAudioBytes: typeof caps.maxAudioBytes === "number" ? caps.maxAudioBytes : d.caps.maxAudioBytes,
      maxSpeechChars: typeof caps.maxSpeechChars === "number" ? caps.maxSpeechChars : d.caps.maxSpeechChars,
    },
  };
}

/** A partial settings update. */
export interface VoiceSettingsPatch {
  readonly stt?: Partial<SttSettings>;
  readonly tts?: Partial<TtsSettings>;
}

/** Result of `POST /api/voice/test/:direction`. */
export interface VoiceTestResult {
  readonly ok: boolean;
  readonly message: string;
  readonly detail?: string;
}

/** A voice the speech server offers. */
export interface ServerVoiceOption {
  readonly id: string;
  readonly label: string;
  /** The language, used to group the picker. */
  readonly group?: string | undefined;
}

/** Tagged result of a call. */
export type VoiceCall<A> = { readonly ok: true; readonly value: A } | { readonly ok: false; readonly error: string };

async function call<A>(doFetch: VoiceFetch, url: string, init: RequestInit, parse: (v: unknown) => A): Promise<VoiceCall<A>> {
  try {
    const res = await doFetch(url, init);
    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: isRecord(body) && typeof body.error === "string" ? body.error : `Server returned ${res.status}` };
    return { ok: true, value: parse(body) };
  } catch (e) {
    return { ok: false, error: causeMessage(e) ?? String(e) };
  }
}

const jsonInit = (method: string, body?: unknown): RequestInit => ({
  method,
  ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
});

/** The voice calls against `base` (the Cortex server URL). */
export function voiceApi(base: string, doFetch: VoiceFetch = (input, init) => fetch(input, init)) {
  const v = (p: string) => `${base}/api/voice${p}`;
  const key = (id: string) => `${base}/api/settings/keys/${encodeURIComponent(id)}`;
  return {
    settings: () => call(doFetch, v("/settings"), { method: "GET" }, parseVoiceSettings),
    save: (patch: VoiceSettingsPatch) => call(doFetch, v("/settings"), jsonInit("PUT", patch), parseVoiceSettings),
    test: (direction: "stt" | "tts") =>
      call(doFetch, v(`/test/${direction}`), jsonInit("POST"), (b): VoiceTestResult =>
        isRecord(b) ? { ok: b.ok === true, message: str(b.message, "No answer"), ...(typeof b.detail === "string" ? { detail: b.detail } : {}) } : { ok: false, message: "Unexpected reply" },
      ),
    voices: () =>
      call(doFetch, v("/voices"), { method: "GET" }, (b): { voices: ServerVoiceOption[]; listed: boolean } => {
        const list = isRecord(b) && Array.isArray(b.voices) ? b.voices : [];
        return {
          voices: list.filter(isRecord).map((x) => ({ id: str(x.id, ""), label: str(x.label, str(x.id, "")), group: str(x.group, "") || undefined })).filter((x) => x.id !== ""),
          listed: isRecord(b) && b.listed === true,
        };
      }),
    saveKey: (id: string, apiKey: string) => call(doFetch, key(id), jsonInit("PUT", { apiKey }), parseKeyStatus),
    removeKey: (id: string) => call(doFetch, key(id), jsonInit("DELETE"), parseKeyStatus),
  };
}
