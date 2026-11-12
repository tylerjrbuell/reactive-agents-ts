/**
 * Endpoint presets for Settings · Voice. Each fills the URL, model and (for speech)
 * voice of a server that speaks the OpenAI audio API. Defaults only: the person can
 * edit every field, and a server's own docs win if its model names differ.
 */

/** A speech-to-text preset. */
export interface SttPreset {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
  /** One line of setup help. */
  readonly hint: string;
}

/** A text-to-speech preset. */
export interface TtsPreset {
  readonly id: string;
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly voice: string;
  readonly hint: string;
}

/** Transcription servers. */
export const STT_PRESETS: readonly SttPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "whisper-1", hint: "Cloud. Needs an API key; audio is sent to OpenAI." },
  {
    id: "faster-whisper",
    label: "faster-whisper-server (local)",
    baseUrl: "http://localhost:8000/v1",
    model: "Systran/faster-whisper-small",
    hint: "Run the faster-whisper-server container; audio stays on this machine.",
  },
  {
    id: "whisper-cpp",
    label: "whisper.cpp server (local)",
    baseUrl: "http://localhost:8080/v1",
    model: "whisper-1",
    hint: "Start whisper-server with --inference-path /v1/audio/transcriptions; the model is the one it loaded.",
  },
];

/** Speech servers. */
export const TTS_PRESETS: readonly TtsPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "tts-1", voice: "alloy", hint: "Cloud. Needs an API key; text is sent to OpenAI." },
  { id: "kokoro", label: "Kokoro-FastAPI (local)", baseUrl: "http://localhost:8880/v1", model: "kokoro", voice: "af_bella", hint: "Run the Kokoro-FastAPI container; text stays on this machine." },
  { id: "openedai-speech", label: "openedai-speech / Piper (local)", baseUrl: "http://localhost:8000/v1", model: "tts-1", voice: "alloy", hint: "openedai-speech maps OpenAI voice names to Piper voices." },
];

/** The preset whose URL matches `baseUrl`, or undefined (a custom endpoint). */
export function presetFor<P extends { readonly baseUrl: string }>(presets: readonly P[], baseUrl: string): P | undefined {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  return presets.find((p) => p.baseUrl === clean);
}

/** True when the endpoint is cloud rather than this machine (so audio or text leaves it). */
export function leavesThisMachine(baseUrl: string): boolean {
  try {
    const h = new URL(baseUrl).hostname;
    return !(h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]" || h.endsWith(".localhost"));
  } catch {
    return false;
  }
}
