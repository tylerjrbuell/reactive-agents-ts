/**
 * /api/voice — Settings · Voice and the server side of the two speech engines.
 *
 * - GET  /settings            { settings, keys: { stt, tts }, caps }  (keys masked, never the key)
 * - PUT  /settings            { stt?: {engine?, baseUrl?, model?}, tts?: {engine?, baseUrl?, model?, voice?} }
 * - POST /transcribe          audio bytes (content-type = the recording's) -> { text }   (?language=)
 * - POST /speak               { text, voice?, speed? } -> audio bytes (mp3)
 * - GET  /voices              { voices: [{ id, label }], listed }  (the speech server's list, else OpenAI's names)
 * - POST /test/:direction     stt | tts -> { ok, ... } using the saved settings (a short silent clip / a short phrase)
 *
 * The browser never sees an endpoint key: keys are saved through `/api/settings/keys/voice-stt|voice-tts`
 * (the encrypted provider-key store) and read here, on the server. Audio is relayed and never stored.
 * Requests carry the browser's abort: closing the request cancels the call to the audio server.
 * The adapter is `services/voice/openai-compatible.ts`.
 */
import { Elysia, t } from "elysia";
import { checkOutboundUrl, type HostResolver } from "../outbound-url.js";
import {
  listVoices,
  MAX_AUDIO_BYTES,
  MAX_SPEECH_CHARS,
  silentWav,
  speak,
  transcribe,
  type AudioEndpoint,
} from "../services/voice/openai-compatible.js";
import { readCappedBytes } from "../services/voice/capped-body.js";
import { mergeVoiceSettings, type VoiceSettings, type VoiceSettingsStore } from "../services/voice/voice-settings.js";
import { VOICE_STT_KEY_ID, VOICE_TTS_KEY_ID, type ProviderKeyStatus, type ProviderKeyStore } from "../services/provider-key-store.js";

/** Body of `GET /api/voice/settings`. */
export interface VoiceSettingsView {
  readonly settings: VoiceSettings;
  /** Key state for each endpoint (masked; never a key). */
  readonly keys: { readonly stt: ProviderKeyStatus | null; readonly tts: ProviderKeyStatus | null };
  readonly caps: { readonly maxAudioBytes: number; readonly maxSpeechChars: number };
}

/** Result of `POST /api/voice/test/:direction`. */
export interface VoiceTestResult {
  readonly ok: boolean;
  readonly message: string;
  /** Speech: bytes of audio the server returned. Transcription: the text it heard (usually empty for silence). */
  readonly detail?: string;
}

/** Everything the router reads; `fetch` is injectable for tests. */
export interface VoiceRouterDeps {
  readonly settings: VoiceSettingsStore;
  readonly keys: ProviderKeyStore;
  readonly fetch?: typeof fetch;
  /** DNS resolver for the base-URL check (default: the system resolver); tests inject one. */
  readonly resolveHost?: HostResolver;
}

/** The key used for an endpoint: the saved one, else the environment variable. */
export function voiceKey(keys: ProviderKeyStore, id: typeof VOICE_STT_KEY_ID | typeof VOICE_TTS_KEY_ID, env: Readonly<Record<string, string | undefined>> = process.env): string | undefined {
  const saved = keys.storedKey(id);
  if (saved) return saved;
  const name = id === VOICE_STT_KEY_ID ? "CORTEX_VOICE_STT_API_KEY" : "CORTEX_VOICE_TTS_API_KEY";
  const fromEnv = env[name]?.trim();
  return fromEnv ? fromEnv : undefined;
}

const NOT_SET_UP = {
  stt: "Server transcription is not set up. Add the endpoint URL in Settings · Voice.",
  tts: "Server speech is not set up. Add the endpoint URL in Settings · Voice.",
} as const;

/** Build the router. */
export function voiceRouter(deps: VoiceRouterDeps) {
  const endpoint = (dir: "stt" | "tts", signal?: AbortSignal): AudioEndpoint | null => {
    const s = deps.settings.get()[dir];
    if (s.baseUrl === "") return null;
    const apiKey = voiceKey(deps.keys, dir === "stt" ? VOICE_STT_KEY_ID : VOICE_TTS_KEY_ID);
    return { baseUrl: s.baseUrl, apiKey, model: s.model, fetch: deps.fetch, signal };
  };
  const keyView = (id: typeof VOICE_STT_KEY_ID | typeof VOICE_TTS_KEY_ID): ProviderKeyStatus | null => {
    const r = deps.keys.status(id);
    return r.ok ? r.value : null;
  };
  const view = (): VoiceSettingsView => ({
    settings: deps.settings.get(),
    keys: { stt: keyView(VOICE_STT_KEY_ID), tts: keyView(VOICE_TTS_KEY_ID) },
    caps: { maxAudioBytes: MAX_AUDIO_BYTES, maxSpeechChars: MAX_SPEECH_CHARS },
  });

  return new Elysia({ prefix: "/api/voice" })
    .get("/settings", () => view())
    .put(
      "/settings",
      async ({ body, set }) => {
        const merged = mergeVoiceSettings(deps.settings.get(), body);
        if (!merged.ok) {
          set.status = 400;
          return { error: merged.refusal.message, field: merged.refusal.field };
        }
        // A name that resolves to a link-local / metadata address is refused too (outbound-url.ts).
        for (const dir of ["stt", "tts"] as const) {
          const raw = body[dir]?.baseUrl;
          if (raw === undefined || raw.trim() === "") continue;
          const checked = await checkOutboundUrl(raw, deps.resolveHost);
          if (!checked.ok) {
            set.status = 400;
            return { error: `The ${dir === "stt" ? "transcription" : "speech"} URL is not allowed: ${checked.reason}.`, field: `${dir}.baseUrl` };
          }
        }
        if (!deps.settings.set(merged.settings)) {
          set.status = 500;
          return { error: "Could not save the voice settings." };
        }
        return view();
      },
      {
        body: t.Object({
          stt: t.Optional(
            t.Object({
              engine: t.Optional(t.Union([t.Literal("browser"), t.Literal("server")])),
              baseUrl: t.Optional(t.String({ maxLength: 2048 })),
              model: t.Optional(t.String({ maxLength: 200 })),
            }),
          ),
          tts: t.Optional(
            t.Object({
              engine: t.Optional(t.Union([t.Literal("browser"), t.Literal("server")])),
              baseUrl: t.Optional(t.String({ maxLength: 2048 })),
              model: t.Optional(t.String({ maxLength: 200 })),
              voice: t.Optional(t.String({ maxLength: 200 })),
            }),
          ),
        }),
      },
    )
    .post(
      "/transcribe",
      async ({ request, query, set }) => {
        const ep = endpoint("stt", request.signal);
        if (ep === null) {
          set.status = 400;
          return { error: NOT_SET_UP.stt };
        }
        // Streamed and counted: a chunked body has no content-length to trust.
        const audio = await readCappedBytes(request, MAX_AUDIO_BYTES);
        if (audio === null) {
          set.status = 413;
          return { error: "The recording is too large to transcribe (25 MB limit)." };
        }
        const r = await transcribe(ep, {
          audio,
          mediaType: request.headers.get("content-type") ?? "audio/webm",
          model: deps.settings.get().stt.model,
          language: query.language,
        });
        if (!r.ok) {
          set.status = r.status;
          return { error: r.message };
        }
        return { text: r.text };
      },
      // Raw audio body: Elysia must not try to parse it.
      { parse: "none", query: t.Object({ language: t.Optional(t.String({ maxLength: 20 })) }) },
    )
    .post(
      "/speak",
      async ({ body, request, set }) => {
        const ep = endpoint("tts", request.signal);
        if (ep === null) {
          set.status = 400;
          return { error: NOT_SET_UP.tts };
        }
        const s = deps.settings.get().tts;
        const r = await speak(ep, { text: body.text, model: s.model, voice: body.voice && body.voice !== "" ? body.voice : s.voice, speed: body.speed });
        if (!r.ok) {
          set.status = r.status;
          return { error: r.message };
        }
        return new Response(r.body, { headers: { "content-type": r.contentType, "cache-control": "no-store" } });
      },
      {
        body: t.Object({
          text: t.String({ maxLength: MAX_SPEECH_CHARS * 2 }),
          voice: t.Optional(t.String({ maxLength: 200 })),
          speed: t.Optional(t.Number({ minimum: 0.25, maximum: 4 })),
        }),
      },
    )
    .get("/voices", async ({ request, set }) => {
      const ep = endpoint("tts", request.signal);
      if (ep === null) {
        set.status = 400;
        return { error: NOT_SET_UP.tts };
      }
      return listVoices(ep);
    })
    .post(
      "/test/:direction",
      async ({ params, set }): Promise<VoiceTestResult | { readonly error: string }> => {
        if (params.direction !== "stt" && params.direction !== "tts") {
          set.status = 400;
          return { error: "direction must be stt or tts" };
        }
        const ep = endpoint(params.direction);
        if (ep === null) return { ok: false, message: NOT_SET_UP[params.direction] };
        const s = deps.settings.get();
        if (params.direction === "stt") {
          const r = await transcribe(ep, { audio: silentWav(1), mediaType: "audio/wav", model: s.stt.model });
          return r.ok
            ? { ok: true, message: `Reached the transcription server and model ${s.stt.model}.`, detail: r.text }
            : { ok: false, message: r.message };
        }
        const r = await speak(ep, { text: "Cortex voice test.", model: s.tts.model, voice: s.tts.voice });
        if (!r.ok) return { ok: false, message: r.message };
        const bytes = (await new Response(r.body).arrayBuffer()).byteLength;
        return bytes > 0
          ? { ok: true, message: `Reached the speech server: voice ${s.tts.voice}, model ${s.tts.model}.`, detail: `${bytes} bytes of audio` }
          : { ok: false, message: "The speech server answered with no audio." };
      },
    );
}
