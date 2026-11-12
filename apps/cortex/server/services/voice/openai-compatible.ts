/**
 * Speech through any OpenAI-compatible audio server: `POST <base>/audio/transcriptions`
 * (speech to text) and `POST <base>/audio/speech` (text to speech). One adapter covers
 * OpenAI itself and the local servers that copy its shape (faster-whisper-server,
 * whisper.cpp server, Kokoro-FastAPI, openedai-speech, Piper wrappers).
 *
 * This module is the seam for a future framework speech package: it knows nothing
 * about Cortex (no store, no routes, no Elysia). Callers pass the endpoint, the key
 * and `fetch`; every function returns a tagged result and never throws. Error text
 * has the key redacted before it leaves this module.
 */

import { isBlockedAddress, noRedirect } from "../../outbound-url.js";

/** A configured audio endpoint. `baseUrl` includes the version segment, such as `http://localhost:8000/v1`. */
export interface AudioEndpoint {
  readonly baseUrl: string;
  readonly apiKey?: string | undefined;
  /** The configured model; `listVoices` uses it for servers that list voices per model. */
  readonly model?: string | undefined;
  readonly fetch?: typeof fetch | undefined;
  readonly signal?: AbortSignal | undefined;
}

/** Why a call failed, mapped to the HTTP status Cortex should answer with. */
export interface AudioFailure {
  readonly ok: false;
  /** 400 bad request, 401 key rejected, 404 route missing, 413 too large, 502 server error, 504 timeout. */
  readonly status: 400 | 401 | 404 | 413 | 502 | 504;
  readonly message: string;
}

/** Largest recording a transcription takes (OpenAI's limit; local servers are looser). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
/** Longest text one speech request takes (OpenAI's limit). */
export const MAX_SPEECH_CHARS = 4096;
/** Time allowed for the audio server to answer. */
export const AUDIO_TIMEOUT_MS = 120_000;

/** OpenAI's built-in voices, offered when a server lists none. */
export const OPENAI_VOICES: readonly string[] = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer"];

const replaceAll = (text: string, secret: string | undefined): string =>
  secret && secret.length >= 4 ? text.split(secret).join("••••") : text;

/** The URL of `path` under `baseUrl` (no doubled slash). */
export function audioUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

/**
 * Link-local and cloud-metadata hosts (the shared rule lives in `outbound-url.ts`).
 * Loopback and private LAN stay allowed: a local speech server is the point.
 */
export const isBlockedAudioHost = isBlockedAddress;

/** `http` or `https` URL without embedded credentials, trailing slashes removed; `undefined` otherwise (or for a link-local / metadata host). */
export function normalizeAudioBaseUrl(raw: string): string | undefined {
  const s = raw.trim();
  if (s === "") return undefined;
  try {
    const u = new URL(s);
    if ((u.protocol !== "http:" && u.protocol !== "https:") || u.username !== "" || u.password !== "") return undefined;
    if (isBlockedAudioHost(u.hostname)) return undefined;
    return s.replace(/\/+$/, "");
  } catch {
    return undefined;
  }
}

function headers(ep: AudioEndpoint, extra: Record<string, string> = {}): Record<string, string> {
  return { ...(ep.apiKey ? { authorization: `Bearer ${ep.apiKey}` } : {}), ...extra };
}

/**
 * The one sentence a server gives for a rejected voice (Speaches: `{"detail":"Voice 'nova' is not
 * supported. Supported voices: [...]"}`), or `undefined`. Only a string `detail` starting with
 * "Voice " qualifies; anything after "Supported voices" is dropped and the sentence is capped, so an
 * arbitrary upstream body is never echoed.
 */
export async function rejectedVoiceSentence(res: Response): Promise<string | undefined> {
  try {
    const j: unknown = JSON.parse((await res.text()).slice(0, 4_000));
    const detail = typeof j === "object" && j !== null ? (j as { detail?: unknown }).detail : undefined;
    if (typeof detail !== "string" || !detail.startsWith("Voice ")) return undefined;
    const cut = detail.split(/Supported voices/i)[0] ?? detail;
    // eslint-disable-next-line no-control-regex
    const clean = cut.replace(/[\u0000-\u001f]/g, " ").trim();
    return clean === "" ? undefined : clean.slice(0, 160);
  } catch {
    return undefined;
  }
}

/**
 * The failure for a non-2xx answer. The upstream body is never echoed: the status says what
 * went wrong, and a response body is attacker-shaped text when the base URL is not a server
 * the operator trusts.
 */
async function failureOf(res: Response, _ep: AudioEndpoint, what: string): Promise<AudioFailure> {
  if (res.status === 422 || res.status === 400) {
    const reason = await rejectedVoiceSentence(res);
    return { ok: false, status: 400, message: reason ?? `The ${what} server rejected the request (HTTP ${res.status}).` };
  }
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 401 || res.status === 403) return { ok: false, status: 401, message: `The ${what} server rejected the API key.` };
  if (res.status === 404) return { ok: false, status: 404, message: `The ${what} server has no such route or model (HTTP 404). Check the base URL ends with /v1 and the model name.` };
  if (res.status === 413) return { ok: false, status: 413, message: `The ${what} server refused the size of the request.` };
  if (res.status >= 300 && res.status < 400) return { ok: false, status: 502, message: `The ${what} server answered with a redirect (HTTP ${res.status}); redirects are not followed, so use its final URL.` };
  return { ok: false, status: 502, message: `The ${what} server answered HTTP ${res.status}.` };
}

function networkFailure(cause: unknown, ep: AudioEndpoint, what: string): AudioFailure {
  const name = typeof cause === "object" && cause !== null && "name" in cause ? String((cause as { name: unknown }).name) : "";
  if (name === "TimeoutError") return { ok: false, status: 504, message: `The ${what} server did not answer in time.` };
  const msg = typeof cause === "object" && cause !== null && "message" in cause && typeof cause.message === "string" ? cause.message : String(cause);
  let host = ep.baseUrl;
  try {
    host = new URL(ep.baseUrl).host;
  } catch {
    /* keep the raw value */
  }
  return { ok: false, status: 502, message: `Could not reach the ${what} server at ${host}: ${replaceAll(msg, ep.apiKey)}` };
}

const withTimeout = (ep: AudioEndpoint): AbortSignal =>
  ep.signal ? AbortSignal.any([ep.signal, AbortSignal.timeout(AUDIO_TIMEOUT_MS)]) : AbortSignal.timeout(AUDIO_TIMEOUT_MS);

const EXT: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/flac": "flac",
  "audio/aac": "aac",
};

/** File name for an upload, from its media type (servers pick the decoder by extension). */
export function audioFileName(mediaType: string): string {
  const base = mediaType.split(";")[0]?.trim().toLowerCase() ?? "";
  return `audio.${EXT[base] ?? "webm"}`;
}

/** What to transcribe. */
export interface TranscribeRequest {
  readonly audio: Uint8Array;
  readonly mediaType: string;
  readonly model: string;
  readonly language?: string | undefined;
}

/** Transcribe a recording. */
export async function transcribe(ep: AudioEndpoint, req: TranscribeRequest): Promise<{ readonly ok: true; readonly text: string } | AudioFailure> {
  if (req.audio.byteLength === 0) return { ok: false, status: 400, message: "The recording is empty." };
  if (req.audio.byteLength > MAX_AUDIO_BYTES) return { ok: false, status: 413, message: "The recording is too large to transcribe (25 MB limit)." };
  const form = new FormData();
  const type = req.mediaType.split(";")[0]?.trim() || "audio/webm";
  form.set("file", new Blob([req.audio],{ type }), audioFileName(req.mediaType));
  form.set("model", req.model);
  form.set("response_format", "json");
  if (req.language !== undefined && req.language !== "") form.set("language", req.language.split("-")[0] ?? req.language);
  try {
    const res = await noRedirect(ep.fetch ?? fetch)(audioUrl(ep.baseUrl, "audio/transcriptions"), {
      method: "POST",
      headers: headers(ep),
      body: form,
      signal: withTimeout(ep),
    });
    if (!res.ok) return failureOf(res, ep, "transcription");
    const raw = await res.text();
    try {
      const j: unknown = JSON.parse(raw);
      const text = typeof j === "object" && j !== null && typeof (j as { text?: unknown }).text === "string" ? (j as { text: string }).text : "";
      return { ok: true, text: text.trim() };
    } catch {
      return { ok: true, text: raw.trim() }; // some servers answer plain text
    }
  } catch (cause) {
    return networkFailure(cause, ep, "transcription");
  }
}

/** What to say. */
export interface SpeakRequest {
  readonly text: string;
  readonly model: string;
  readonly voice: string;
  readonly speed?: number | undefined;
  /** `mp3` by default: every browser plays it. */
  readonly format?: "mp3" | "wav" | "opus" | "aac" | "flac" | undefined;
}

/** Audio bytes from a speech request, still streaming. */
export interface SpokenAudio {
  readonly ok: true;
  readonly body: ReadableStream<Uint8Array>;
  readonly contentType: string;
}

const FORMAT_TYPES: Readonly<Record<string, string>> = { mp3: "audio/mpeg", wav: "audio/wav", opus: "audio/ogg", aac: "audio/aac", flac: "audio/flac" };

/** Synthesize `text`. The body is the server's audio, streamed through. */
export async function speak(ep: AudioEndpoint, req: SpeakRequest): Promise<SpokenAudio | AudioFailure> {
  if (req.text.trim() === "") return { ok: false, status: 400, message: "There is no text to speak." };
  if (req.text.length > MAX_SPEECH_CHARS) return { ok: false, status: 413, message: `Too much text for one speech request (limit ${MAX_SPEECH_CHARS} characters).` };
  const format = req.format ?? "mp3";
  const speed = Math.min(Math.max(req.speed ?? 1, 0.25), 4);
  try {
    const res = await noRedirect(ep.fetch ?? fetch)(audioUrl(ep.baseUrl, "audio/speech"), {
      method: "POST",
      headers: headers(ep, { "content-type": "application/json" }),
      body: JSON.stringify({ model: req.model, input: req.text, voice: req.voice, response_format: format, speed }),
      signal: withTimeout(ep),
    });
    if (!res.ok) return failureOf(res, ep, "speech");
    if (res.body === null) return { ok: false, status: 502, message: "The speech server sent no audio." };
    const upstream = res.headers.get("content-type") ?? "";
    return { ok: true, body: res.body, contentType: upstream.startsWith("audio/") ? upstream : (FORMAT_TYPES[format] ?? "audio/mpeg") };
  } catch (cause) {
    return networkFailure(cause, ep, "speech");
  }
}

/** One voice a server offers. */
export interface ServerVoice {
  readonly id: string;
  readonly label: string;
}

const voiceFrom = (v: unknown): ServerVoice | null => {
  if (typeof v === "string" && v !== "") return { id: v, label: v };
  if (typeof v === "object" && v !== null) {
    const o = v as { id?: unknown; name?: unknown; voice_id?: unknown; language?: unknown; gender?: unknown };
    const id = [o.id, o.voice_id, o.name].find((x): x is string => typeof x === "string" && x !== "");
    if (id === undefined) return null;
    const name = typeof o.name === "string" && o.name !== "" ? o.name : id;
    const meta = [o.language, o.gender].filter((x): x is string => typeof x === "string" && x !== "");
    return { id, label: meta.length > 0 ? `${name} (${meta.join(", ")})` : name };
  }
  return null;
};

async function fetchVoiceList(ep: AudioEndpoint, path: string): Promise<readonly ServerVoice[]> {
  try {
    const res = await noRedirect(ep.fetch ?? fetch)(audioUrl(ep.baseUrl, path), { headers: headers(ep), signal: AbortSignal.timeout(5_000) });
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return [];
    }
    const j: unknown = await res.json();
    const list = typeof j === "object" && j !== null ? (j as { voices?: unknown }).voices : j;
    return Array.isArray(list) ? list.map(voiceFrom).filter((v): v is ServerVoice => v !== null) : [];
  } catch {
    return [];
  }
}

/**
 * The voices the speech server lists: `<base>/audio/voices` (Kokoro-FastAPI, openedai-speech),
 * else the model object at `<base>/models/<model>` (Speaches lists voices per model), else
 * OpenAI's built-in names with `listed: false`. Never fails: an unreachable server yields
 * the built-in names. Error bodies are never echoed.
 */
export async function listVoices(ep: AudioEndpoint): Promise<{ readonly voices: readonly ServerVoice[]; readonly listed: boolean }> {
  const direct = await fetchVoiceList(ep, "audio/voices");
  if (direct.length > 0) return { voices: direct, listed: true };
  if (ep.model !== undefined && ep.model.trim() !== "") {
    const modelPath = `models/${ep.model.trim().split("/").map(encodeURIComponent).join("/")}`;
    const perModel = await fetchVoiceList(ep, modelPath);
    if (perModel.length > 0) return { voices: perModel, listed: true };
  }
  return { voices: OPENAI_VOICES.map((id) => ({ id, label: id })), listed: false };
}

/** One second of 16 kHz mono silence as a WAV file, used to test a transcription endpoint. */
export function silentWav(seconds = 1, sampleRate = 16_000): Uint8Array {
  const samples = Math.floor(sampleRate * seconds);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, "data");
  v.setUint32(40, samples * 2, true);
  return new Uint8Array(buf);
}
