/**
 * Voice choices that belong to this browser, kept in localStorage (a browser's voices,
 * microphone and language are its own). The server-side half (engines, endpoints,
 * models, keys) is Settings · Voice on the server (`voice-api.ts`).
 */

/** How the mic button works. */
export type MicMode = "toggle" | "push-to-talk";

/** This browser's voice choices. */
export interface VoicePrefs {
  /** BCP-47 language for listening (and reading when the voice has none); empty = the browser's. */
  readonly language: string;
  readonly micMode: MicMode;
  /** Send the message after a quiet period instead of waiting for Send. */
  readonly autoSend: boolean;
  /** The quiet period for auto-send and voice mode, in ms. */
  readonly silenceMs: number;
  /** Reading speed, 1 = normal. */
  readonly rate: number;
  /** The browser voice used by the browser engine; empty = default. */
  readonly browserVoice: string;
  /** Voice mode reads each reply aloud. */
  readonly autoSpeak: boolean;
  /** Speaking over the voice stops it in voice mode. */
  readonly bargeIn: boolean;
}

/** Storage key. */
export const VOICE_PREFS_KEY = "cortex.voice.prefs";

/** The defaults. */
export const DEFAULT_VOICE_PREFS: VoicePrefs = {
  language: "",
  micMode: "toggle",
  autoSend: false,
  silenceMs: 1500,
  rate: 1,
  browserVoice: "",
  autoSpeak: true,
  bargeIn: true,
};

/** Reading speeds on offer. */
export const RATE_STEPS: readonly number[] = [0.75, 1, 1.25, 1.5, 1.75, 2];

/** Quiet periods on offer, in ms. */
export const SILENCE_STEPS: readonly number[] = [800, 1200, 1500, 2000, 3000];

/** Languages on offer for dictation; the box also accepts any BCP-47 code. */
export const LANGUAGES: readonly { readonly code: string; readonly label: string }[] = [
  { code: "", label: "Browser default" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "es-ES", label: "Spanish" },
  { code: "fr-FR", label: "French" },
  { code: "de-DE", label: "German" },
  { code: "it-IT", label: "Italian" },
  { code: "pt-BR", label: "Portuguese (Brazil)" },
  { code: "nl-NL", label: "Dutch" },
  { code: "ja-JP", label: "Japanese" },
  { code: "ko-KR", label: "Korean" },
  { code: "zh-CN", label: "Chinese (Mandarin)" },
  { code: "hi-IN", label: "Hindi" },
];

const BCP47 = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8}){0,3}$/;

/** True for a language tag the engines can be handed (or empty). */
export const isLanguageTag = (s: string): boolean => s === "" || BCP47.test(s);

/** Speed clamped to what engines support. */
export const clampRate = (r: number): number => (Number.isFinite(r) ? Math.min(Math.max(r, 0.5), 2) : 1);

/** Prefs from untrusted JSON; anything missing or wrong falls back to the default. */
export function parsePrefs(raw: unknown): VoicePrefs {
  const d = DEFAULT_VOICE_PREFS;
  if (typeof raw !== "object" || raw === null) return d;
  const o = raw as Record<string, unknown>;
  const lang = typeof o.language === "string" && isLanguageTag(o.language.trim()) ? o.language.trim() : d.language;
  const silence = typeof o.silenceMs === "number" && Number.isFinite(o.silenceMs) ? Math.min(Math.max(Math.round(o.silenceMs), 500), 10_000) : d.silenceMs;
  return {
    language: lang,
    micMode: o.micMode === "push-to-talk" ? "push-to-talk" : "toggle",
    autoSend: o.autoSend === true,
    silenceMs: silence,
    rate: typeof o.rate === "number" ? clampRate(o.rate) : d.rate,
    browserVoice: typeof o.browserVoice === "string" ? o.browserVoice.slice(0, 200) : d.browserVoice,
    autoSpeak: o.autoSpeak === false ? false : d.autoSpeak,
    bargeIn: o.bargeIn === false ? false : d.bargeIn,
  };
}

/** The slice of `Storage` used. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Read prefs; defaults when none or unreadable. */
export function loadPrefs(storage: PrefsStorage | undefined): VoicePrefs {
  if (storage === undefined) return DEFAULT_VOICE_PREFS;
  try {
    const raw = storage.getItem(VOICE_PREFS_KEY);
    return raw === null ? DEFAULT_VOICE_PREFS : parsePrefs(JSON.parse(raw));
  } catch {
    return DEFAULT_VOICE_PREFS;
  }
}

/** Write prefs; best effort (storage can be full or blocked). */
export function savePrefs(storage: PrefsStorage | undefined, prefs: VoicePrefs): void {
  try {
    storage?.setItem(VOICE_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* the choice lasts for this page only */
  }
}
