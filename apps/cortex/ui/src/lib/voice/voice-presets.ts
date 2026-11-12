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
    label: "Speaches (local)",
    baseUrl: "http://localhost:8000/v1",
    model: "Systran/faster-whisper-small",
    hint: "Run the speaches container (formerly faster-whisper-server); audio stays on this machine. Download the model first: POST /v1/models/Systran/faster-whisper-small",
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
  {
    id: "speaches",
    label: "Speaches (local, Kokoro)",
    baseUrl: "http://localhost:8000/v1",
    model: "speaches-ai/Kokoro-82M-v1.0-ONNX",
    voice: "af_heart",
    hint: "Run the speaches container, then download the model: POST /v1/models/speaches-ai/Kokoro-82M-v1.0-ONNX",
  },
  { id: "kokoro", label: "Kokoro-FastAPI (local)", baseUrl: "http://localhost:8880/v1", model: "kokoro", voice: "af_bella", hint: "Run the Kokoro-FastAPI container; text stays on this machine." },
  { id: "openedai-speech", label: "openedai-speech / Piper (local)", baseUrl: "http://localhost:8000/v1", model: "tts-1", voice: "alloy", hint: "openedai-speech maps OpenAI voice names to Piper voices." },
];

/**
 * The preset whose URL matches `baseUrl`, or undefined (a custom endpoint). Presets can share
 * a server URL (Speaches and openedai-speech both listen on :8000), so when `model` is given a
 * preset with that model wins over one that only shares the URL.
 */
export function presetFor<P extends { readonly baseUrl: string; readonly model?: string }>(
  presets: readonly P[],
  baseUrl: string,
  model?: string,
): P | undefined {
  const clean = baseUrl.trim().replace(/\/+$/, "");
  const sameUrl = presets.filter((p) => p.baseUrl === clean);
  return (model !== undefined ? sameUrl.find((p) => p.model === model.trim()) : undefined) ?? sameUrl[0];
}

/** What to do when a local server answers "not installed locally": the hint and a copyable command. */
export interface ModelInstallHelp {
  readonly hint: string;
  /** A curl command that downloads the model (Speaches `POST /v1/models/{id}`). */
  readonly curl: string;
}

/**
 * Help for a Test failure that says the model is not installed on the server (Speaches answers
 * 404 "Model ... is not installed locally"). `undefined` for any other failure.
 */
export function modelInstallHelp(failure: string, baseUrl: string, model: string, presetHint?: string): ModelInstallHelp | undefined {
  if (!/not installed locally/i.test(failure) || model.trim() === "") return undefined;
  const root = baseUrl.trim().replace(/\/+$/, "");
  return {
    hint: presetHint ?? `Download the model on the server: POST ${root}/models/${model.trim()}`,
    curl: `curl -X POST ${root}/models/${model.trim()}`,
  };
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
