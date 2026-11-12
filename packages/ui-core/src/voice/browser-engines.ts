/**
 * The browser's own speech engines: `SpeechRecognition` for listening and
 * `speechSynthesis` for speaking. No install, no key; quality and languages are the
 * browser's. Chrome and Edge send recognition audio to the vendor's service, which
 * {@link createBrowserStt} says in its label. Every browser global is injected, so
 * the engines run (and are tested) without a DOM.
 */
import { causeMessage, type SttEngine, SttError, SttHandle, SttHandlers, SttStartOptions, TtsEngine, TtsHandle, TtsHandlers, TtsSpeakOptions, VoiceInfo } from "./types.js";
import { exclusive } from "./speech-coordinator.js";

/** The slice of a `SpeechRecognition` result list the engine reads. */
export interface RecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { readonly transcript: string };
}

/** The slice of a `SpeechRecognition` instance the engine drives. */
export interface RecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { readonly resultIndex: number; readonly results: ArrayLike<RecognitionResultLike> }) => void) | null;
  onerror: ((e: { readonly error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** A `SpeechRecognition` constructor (or `webkitSpeechRecognition`). */
export type RecognitionCtor = new () => RecognitionLike;

/** Map a `SpeechRecognition` error code to a message a person can act on. */
export function recognitionError(code: string): SttError | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null; // not failures: silence, or our own stop
    case "not-allowed":
    case "service-not-allowed":
      return { kind: "permission-denied", message: "Microphone access is blocked. Allow it in the browser's site settings, then try again." };
    case "audio-capture":
      return { kind: "no-microphone", message: "No microphone was found. Connect one and try again." };
    case "network":
      return { kind: "network", message: "The browser's speech service could not be reached. Chrome sends audio to Google for recognition; check the connection, or use a server engine in Settings · Voice." };
    case "language-not-supported":
      return { kind: "unsupported", message: "The browser does not support that language for dictation." };
    default:
      return { kind: "other", message: `Speech recognition stopped (${code}).` };
  }
}

/** Browser speech recognition. `ctor` is `undefined` where the browser has none. */
export function createBrowserStt(ctor: RecognitionCtor | undefined): SttEngine {
  return {
    id: "browser",
    label: "Browser (SpeechRecognition)",
    available: () =>
      ctor !== undefined
        ? { ok: true }
        : { ok: false, reason: "This browser has no speech recognition. Use Chrome or Edge, or set a server engine in Settings · Voice." },
    start(opts: SttStartOptions, h: SttHandlers): SttHandle {
      if (ctor === undefined) {
        h.onError?.({ kind: "unsupported", message: "This browser has no speech recognition." });
        h.onEnd();
        return { stop: () => undefined, abort: () => undefined };
      }
      const rec = new ctor();
      rec.continuous = true;
      rec.interimResults = true;
      if (opts.language !== undefined && opts.language !== "") rec.lang = opts.language;
      let ended = false;
      const end = (): void => {
        if (ended) return;
        ended = true;
        h.onEnd();
      };
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i += 1) {
          const r = e.results[i];
          if (r === undefined) continue;
          const text = r[0].transcript;
          if (r.isFinal) {
            if (text.trim() !== "") h.onFinal?.(text.trim());
          } else {
            interim += text;
          }
        }
        h.onInterim?.(interim.trim());
        h.onActivity?.();
      };
      rec.onerror = (e) => {
        const err = recognitionError(e.error);
        if (err !== null) h.onError?.(err);
      };
      rec.onend = end;
      try {
        rec.start();
      } catch (cause) {
        h.onError?.({ kind: "other", message: causeMessage(cause) ?? "Could not start listening." });
        end();
      }
      return {
        stop: () => {
          try {
            rec.stop();
          } catch {
            end();
          }
        },
        abort: () => {
          rec.onresult = null;
          try {
            rec.abort();
          } catch {
            /* already stopped */
          }
          end();
        },
      };
    },
  };
}

/** The slice of a `SpeechSynthesisVoice` the engine reads. */
export interface SynthVoiceLike {
  readonly name: string;
  readonly lang: string;
  readonly default?: boolean;
  readonly localService?: boolean;
}

/** The slice of a `SpeechSynthesisUtterance` the engine sets. */
export interface UtteranceLike {
  voice: SynthVoiceLike | null;
  rate: number;
  lang: string;
  onstart: (() => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { readonly error?: string }) => void) | null;
}

/** The slice of `speechSynthesis` the engine drives. */
export interface SynthLike {
  getVoices(): readonly SynthVoiceLike[];
  speak(u: UtteranceLike): void;
  cancel(): void;
  pause(): void;
  resume(): void;
  addEventListener?(type: "voiceschanged", fn: () => void): void;
  removeEventListener?(type: "voiceschanged", fn: () => void): void;
}

/** Browser text to speech. `synth` is `undefined` where the browser has none. */
export function createBrowserTts(
  synth: SynthLike | undefined,
  makeUtterance: ((text: string) => UtteranceLike) | undefined,
  opts: { readonly voicesTimeoutMs?: number } = {},
): TtsEngine {
  return exclusive(createBrowserTtsUnguarded(synth, makeUtterance, opts));
}

function createBrowserTtsUnguarded(
  synth: SynthLike | undefined,
  makeUtterance: ((text: string) => UtteranceLike) | undefined,
  opts: { readonly voicesTimeoutMs?: number },
): TtsEngine {
  const toInfo = (v: SynthVoiceLike): VoiceInfo => ({
    id: v.name,
    label: `${v.name} (${v.lang})`,
    lang: v.lang,
    ...(v.default === true ? { isDefault: true } : {}),
  });
  return {
    id: "browser",
    label: "Browser (speechSynthesis)",
    available: () =>
      synth !== undefined && makeUtterance !== undefined
        ? { ok: true }
        : { ok: false, reason: "This browser cannot speak text aloud." },
    voices(): Promise<readonly VoiceInfo[]> {
      if (synth === undefined) return Promise.resolve([]);
      const now = synth.getVoices();
      if (now.length > 0) return Promise.resolve(now.map(toInfo));
      // Voices load after the first request in Chrome: wait for the event, but not forever.
      return new Promise((resolve) => {
        let done = false;
        const finish = (): void => {
          if (done) return;
          done = true;
          synth.removeEventListener?.("voiceschanged", finish);
          resolve(synth.getVoices().map(toInfo));
        };
        synth.addEventListener?.("voiceschanged", finish);
        globalThis.setTimeout(finish, opts.voicesTimeoutMs ?? 1500);
      });
    },
    speak(text: string, o: TtsSpeakOptions, h: TtsHandlers): TtsHandle {
      if (synth === undefined || makeUtterance === undefined) {
        h.onError({ kind: "unsupported", message: "This browser cannot speak text aloud." });
        return { pause: () => undefined, resume: () => undefined, cancel: () => undefined };
      }
      const u = makeUtterance(text);
      u.rate = Math.min(Math.max(o.rate ?? 1, 0.5), 2);
      if (o.language !== undefined && o.language !== "") u.lang = o.language;
      if (o.voice !== undefined && o.voice !== "") {
        const v = synth.getVoices().find((x) => x.name === o.voice);
        if (v !== undefined) {
          u.voice = v;
          u.lang = v.lang;
        }
      }
      let cancelled = false;
      u.onstart = () => {
        if (!cancelled) h.onStart?.();
      };
      u.onend = () => {
        if (!cancelled) h.onEnd();
      };
      u.onerror = (e) => {
        // `interrupted` and `canceled` are our own cancel(), not a failure.
        if (cancelled || e.error === "interrupted" || e.error === "canceled") return;
        h.onError({ kind: "playback", message: `The browser could not speak this${e.error ? ` (${e.error})` : ""}.` });
      };
      synth.speak(u);
      return {
        pause: () => synth.pause(),
        resume: () => synth.resume(),
        cancel: () => {
          cancelled = true;
          synth.cancel();
        },
      };
    },
  };
}
