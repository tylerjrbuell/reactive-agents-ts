/**
 * Audio diagnostic: plays a short tone through the same remote-engine path a reading uses and
 * says whether the browser played it, something outside Cortex paused it, or the browser blocked it.
 * Pure over injected audio functions, so it is testable without a browser.
 */
import { createRemoteTts, type AudioLike, type TtsError } from "@reactive-agents/ui-core";

/** What the diagnostic found. */
export type AudioDiagnosis = "played" | "external-pause" | "blocked" | "failed";

/** A mono 16-bit PCM WAV of a sine tone (`ms` long at 440 Hz, quiet). */
export function toneWav(ms = 300, sampleRate = 16_000): Uint8Array<ArrayBuffer> {
  const samples = Math.round((sampleRate * ms) / 1000);
  const bytes = new Uint8Array(new ArrayBuffer(44 + samples * 2));
  const view = new DataView(bytes.buffer);
  const text = (at: number, s: string): void => {
    for (let i = 0; i < s.length; i += 1) view.setUint8(at + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let i = 0; i < samples; i += 1) view.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 3000), true);
  return bytes;
}

/** An `HTMLAudioElement` as the engine's {@link AudioLike} (the DOM handlers take an event argument). */
export function htmlAudio(src: string): AudioLike {
  const a = new Audio(src);
  const wrap = (fn: (() => void) | null): (() => void) | null => (fn === null ? null : () => fn());
  return {
    get onended() {
      return null;
    },
    set onended(fn) {
      a.onended = wrap(fn);
    },
    get onerror() {
      return null;
    },
    set onerror(fn) {
      a.onerror = wrap(fn);
    },
    get onplaying() {
      return null;
    },
    set onplaying(fn) {
      a.onplaying = wrap(fn);
    },
    play: () => a.play(),
    pause: () => a.pause(),
  };
}

/** The finding for a speaking error. */
export function diagnosisOf(error: TtsError): AudioDiagnosis {
  if (error.code === "external-pause") return "external-pause";
  if (error.code === "autoplay-blocked") return "blocked";
  return "failed";
}

/** The line shown in the status area. */
export function diagnosisLine(d: AudioDiagnosis): { readonly tone: "ok" | "bad"; readonly text: string } {
  switch (d) {
    case "played":
      return { tone: "ok", text: "Audio played: the browser can play sound from Cortex." };
    case "external-pause":
      return { tone: "bad", text: "Paused by something outside Cortex (often a browser extension or a media-key controller). Try an Incognito window, or use Browser speech." };
    case "blocked":
      return { tone: "bad", text: "Blocked by the browser: it only plays sound after you interact with the page. Click again, or allow sound for this site." };
    case "failed":
      return { tone: "bad", text: "The tone could not be played." };
  }
}

/** Browser pieces the diagnostic needs. */
export interface DiagnosticDeps {
  readonly createAudio: ((src: string) => AudioLike) | undefined;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly retryDelayMs?: number;
}

/** Play the tone through the remote engine and report what happened. */
export function runAudioDiagnostic(deps: DiagnosticDeps): Promise<AudioDiagnosis> {
  return new Promise((resolve) => {
    const engine = createRemoteTts({
      id: "diagnostic",
      speakUrl: "diagnostic:speak",
      voicesUrl: "diagnostic:voices",
      fetch: async () => new Response(new Blob([toneWav()], { type: "audio/wav" })),
      createAudio: deps.createAudio,
      createObjectURL: deps.createObjectURL,
      revokeObjectURL: deps.revokeObjectURL,
      ...(deps.retryDelayMs !== undefined ? { retryDelayMs: deps.retryDelayMs } : {}),
    });
    engine.speak("tone", {}, { onEnd: () => resolve("played"), onError: (e) => resolve(diagnosisOf(e)) });
  });
}

/** Whether a repeated message may toast again: at most once per `windowMs`. */
export function toastDue(lastAt: number | null, now: number, windowMs = 60_000): boolean {
  return lastAt === null || now - lastAt >= windowMs;
}
