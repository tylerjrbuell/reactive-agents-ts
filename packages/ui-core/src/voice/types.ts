/**
 * The speech engine seam. Two small interfaces cover both directions; an engine is
 * one implementation (the browser's, or a remote OpenAI-compatible endpoint behind
 * a server route). Controllers (`dictation.ts`, `read-aloud.ts`) and the voice-mode
 * reducer know only these shapes, so a new engine, or a framework speech package
 * later, drops in without touching them.
 */

/** Whether an engine can run here, and if not, why in a sentence a person can act on. */
export type EngineAvailability = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/** Why listening failed. */
export type SttErrorKind = "permission-denied" | "no-microphone" | "unsupported" | "network" | "server" | "too-long" | "other";

/** A listening failure with a message fit to show. */
export interface SttError {
  readonly kind: SttErrorKind;
  readonly message: string;
}

/** Options for one listening session. */
export interface SttStartOptions {
  /** BCP-47 language such as `en-US`; empty or absent = the engine's default. */
  readonly language?: string;
}

/** Callbacks an engine drives during one session. All optional except `onEnd`. */
export interface SttHandlers {
  /** Words heard so far in the current phrase; replaced by the next call. */
  onInterim?(text: string): void;
  /** A finished phrase. */
  onFinal?(text: string): void;
  /** Any sign of speech (an interim result, or sound above the silence threshold). */
  onActivity?(): void;
  /** The engine is turning recorded audio into text (remote engines only). */
  onProcessing?(): void;
  onError?(error: SttError): void;
  /** The session is over, whether by `stop`, `abort`, an error or the engine. Always called once. */
  onEnd(): void;
}

/** A running listening session. */
export interface SttHandle {
  /** Finish: deliver what was heard, then `onEnd`. */
  stop(): void;
  /** Drop it: no more results; `onEnd` still follows. */
  abort(): void;
}

/** Speech to text. */
export interface SttEngine {
  readonly id: string;
  readonly label: string;
  available(): EngineAvailability;
  start(opts: SttStartOptions, handlers: SttHandlers): SttHandle;
}

/** One voice a text-to-speech engine can use. */
export interface VoiceInfo {
  /** Stable name passed back in {@link TtsSpeakOptions.voice}. */
  readonly id: string;
  readonly label: string;
  /** BCP-47 language when the engine says. */
  readonly lang?: string;
  /** The engine's default voice. */
  readonly isDefault?: boolean;
}

/** Why speaking failed. */
export interface TtsError {
  readonly kind: "unsupported" | "network" | "server" | "playback" | "other";
  readonly message: string;
}

/** Options for one utterance. */
export interface TtsSpeakOptions {
  /** A {@link VoiceInfo.id}; absent = the engine's default. */
  readonly voice?: string;
  /** 1 = normal; clamped by each engine to what it supports. */
  readonly rate?: number;
  readonly language?: string;
}

/** Callbacks for one utterance. `onEnd` or `onError` is called exactly once, unless cancelled. */
export interface TtsHandlers {
  onStart?(): void;
  onEnd(): void;
  onError(error: TtsError): void;
  /** Another utterance started and cancelled this one (only one reading speaks at a time). */
  onInterrupted?(): void;
}

/** One utterance in flight. */
export interface TtsHandle {
  pause(): void;
  resume(): void;
  /** Stop for good. No further callback follows. */
  cancel(): void;
}

/** Text to speech. */
export interface TtsEngine {
  readonly id: string;
  readonly label: string;
  available(): EngineAvailability;
  voices(): Promise<readonly VoiceInfo[]>;
  speak(text: string, opts: TtsSpeakOptions, handlers: TtsHandlers): TtsHandle;
  /** Start fetching audio for text that will be spoken next (remote engines). */
  prefetch?(text: string, opts: TtsSpeakOptions): void;
}

/**
 * The part of `fetch` the remote engines use. A plain function type (not
 * `typeof fetch`) so an arrow wrapper fits, which browsers need: `window.fetch`
 * throws "Illegal invocation" when called as a method of another object.
 */
export type VoiceFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The message of a caught value when it carries one (a tag check, not `instanceof`), else `undefined`. */
export function causeMessage(cause: unknown): string | undefined {
  if (typeof cause !== "object" || cause === null || !("message" in cause)) return undefined;
  const m = cause.message;
  return typeof m === "string" ? m : undefined;
}

/** Small injectable clock so timers are testable. */
export interface VoiceClock {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

/** The real clock. */
export const systemClock: VoiceClock = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};
