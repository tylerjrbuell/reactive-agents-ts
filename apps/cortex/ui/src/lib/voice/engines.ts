/**
 * Builds the four speech engines from what the browser has and the saved voice
 * settings: the browser's own pair, and the server pair that goes through Cortex's
 * `/api/voice` routes. Feature detection reads globals by name from the object it is
 * handed (`window` in the app, a plain object in tests), so no engine needs a DOM.
 */
import {
  analyserProbe,
  createBrowserStt,
  createBrowserTts,
  createRemoteStt,
  createRemoteTts,
  type AudioContextLike,
  type AudioLike,
  type MediaStreamLike,
  type RecognitionCtor,
  type RecorderCtor,
  type SttEngine,
  type SynthLike,
  type TtsEngine,
  type UtteranceLike,
  type VoiceFetch,
} from "@reactive-agents/ui-core";
import type { VoiceSettingsView } from "./voice-api.js";

/** A global read by name, untyped until a guard says what it is. */
const prop = (o: object, name: string): unknown => Reflect.get(o, name);

/** A guard for "this global is a constructor of shape C" (the browser's own check is its existence). */
const ctorGuard =
  <C>() =>
  (v: unknown): v is C =>
    typeof v === "function";

const hasMethods =
  <T>(...names: string[]) =>
  (v: unknown): v is T =>
    (typeof v === "object" || typeof v === "function") && v !== null && names.every((n) => typeof prop(v, n) === "function");

interface MediaDevicesLike {
  getUserMedia(constraints: { audio: true }): Promise<MediaStreamLike>;
}
interface UrlApiLike {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
}

const isRecognitionCtor = ctorGuard<RecognitionCtor>();
const isUtteranceCtor = ctorGuard<new (text: string) => UtteranceLike>();
const isRecorderCtor = ctorGuard<RecorderCtor>();
const isAudioContextCtor = ctorGuard<new () => AudioContextLike>();
const isAudioCtor = ctorGuard<new (src: string) => AudioLike>();
const isSynth = hasMethods<SynthLike>("speak", "getVoices", "cancel");
const isMediaDevices = hasMethods<MediaDevicesLike>("getUserMedia");
const isUrlApi = hasMethods<UrlApiLike>("createObjectURL", "revokeObjectURL");

/** What this browser can do, by feature. */
export interface BrowserVoiceCaps {
  /** `SpeechRecognition` (or the webkit name) exists. */
  readonly recognition: boolean;
  readonly synthesis: boolean;
  /** Recording through `MediaRecorder` and a microphone is possible (needs a secure page). */
  readonly recording: boolean;
  readonly playback: boolean;
  /** The page is https or localhost, which browsers require for the microphone. */
  readonly secure: boolean;
}

/** The four engines and what the browser supports. */
export interface VoiceEngines {
  readonly caps: BrowserVoiceCaps;
  readonly browserStt: SttEngine;
  readonly browserTts: TtsEngine;
  readonly serverStt: SttEngine;
  readonly serverTts: TtsEngine;
}

/** Where the server routes live and how to call them. */
export interface EngineOptions {
  /** Cortex server URL (`CORTEX_SERVER_URL`). */
  readonly base: string;
  readonly fetch: VoiceFetch;
}

/** Detect the browser's speech features on `w` and build the engines. */
export function buildEngines(w: object, opts: EngineOptions): VoiceEngines {
  const recognition = [prop(w, "SpeechRecognition"), prop(w, "webkitSpeechRecognition")].find(isRecognitionCtor);
  const synth = prop(w, "speechSynthesis");
  const Utterance = prop(w, "SpeechSynthesisUtterance");
  const nav = prop(w, "navigator");
  const media = typeof nav === "object" && nav !== null ? prop(nav, "mediaDevices") : undefined;
  const Recorder = [prop(w, "MediaRecorder")].find(isRecorderCtor);
  const AudioCtx = [prop(w, "AudioContext"), prop(w, "webkitAudioContext")].find(isAudioContextCtor);
  const Audio = [prop(w, "Audio")].find(isAudioCtor);
  const url = prop(w, "URL");
  const secure = prop(w, "isSecureContext") !== false;

  const browserTts = createBrowserTts(isSynth(synth) ? synth : undefined, isUtteranceCtor(Utterance) ? (text) => new Utterance(text) : undefined);
  const browserStt = createBrowserStt(recognition);

  const devices = isMediaDevices(media) ? media : undefined;
  const probe = AudioCtx ? analyserProbe(() => new AudioCtx()) : undefined;
  const serverStt = createRemoteStt({
    url: `${opts.base}/api/voice/transcribe`,
    fetch: opts.fetch,
    getUserMedia: secure && devices ? () => devices.getUserMedia({ audio: true }) : undefined,
    Recorder,
    ...(probe ? { probe } : {}),
  });

  const urls = isUrlApi(url) ? url : undefined;
  const serverTts = createRemoteTts({
    speakUrl: `${opts.base}/api/voice/speak`,
    voicesUrl: `${opts.base}/api/voice/voices`,
    fetch: opts.fetch,
    createAudio: Audio && urls ? (src) => new Audio(src) : undefined,
    createObjectURL: (b) => urls?.createObjectURL(b) ?? "",
    revokeObjectURL: (u) => urls?.revokeObjectURL(u),
  });

  return {
    caps: {
      recognition: recognition !== undefined,
      synthesis: isSynth(synth) && isUtteranceCtor(Utterance),
      recording: secure && devices !== undefined && Recorder !== undefined,
      playback: Audio !== undefined && urls !== undefined,
      secure,
    },
    browserStt,
    browserTts,
    serverStt,
    serverTts,
  };
}

/** The engine the settings pick for listening. */
export const sttFor = (e: VoiceEngines, s: VoiceSettingsView): SttEngine => (s.stt.engine === "server" ? e.serverStt : e.browserStt);

/** The engine the settings pick for speaking. */
export const ttsFor = (e: VoiceEngines, s: VoiceSettingsView): TtsEngine => (s.tts.engine === "server" ? e.serverTts : e.browserTts);
