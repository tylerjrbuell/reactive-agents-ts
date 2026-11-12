/**
 * Settings · Voice, saved beside the Cortex DB as `voice-settings.json` (mode 0600,
 * atomic write). Holds which engine each direction uses and the OpenAI-compatible
 * endpoint (URL, model, voice). The endpoints' API keys are NOT here: they live in
 * the encrypted provider-key store under `voice-stt` / `voice-tts`.
 *
 * Per-browser choices (language, speed, browser voice, push-to-talk, auto-send) are
 * kept by the browser, not here. Audio is never written to disk by Cortex.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { normalizeAudioBaseUrl } from "./openai-compatible.js";

/** File name beside the DB. */
export const VOICE_SETTINGS_FILE = "voice-settings.json";

/** `browser` = the browser's own engine; `server` = the OpenAI-compatible endpoint below. */
export type VoiceEngineChoice = "browser" | "server";

/** Speech-to-text settings. */
export interface SttSettings {
  readonly engine: VoiceEngineChoice;
  /** Base URL including the version segment, e.g. `http://localhost:8000/v1`; empty = not set up. */
  readonly baseUrl: string;
  readonly model: string;
}

/** Text-to-speech settings. */
export interface TtsSettings {
  readonly engine: VoiceEngineChoice;
  readonly baseUrl: string;
  readonly model: string;
  readonly voice: string;
}

/** All voice settings. */
export interface VoiceSettings {
  readonly stt: SttSettings;
  readonly tts: TtsSettings;
}

/** Defaults: browser engines, OpenAI's model names ready for an endpoint to be filled in. */
export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  stt: { engine: "browser", baseUrl: "", model: "whisper-1" },
  tts: { engine: "browser", baseUrl: "", model: "tts-1", voice: "alloy" },
};

const str = (v: unknown, fallback: string, max = 200): string => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const engineOf = (v: unknown, fallback: VoiceEngineChoice): VoiceEngineChoice => (v === "browser" || v === "server" ? v : fallback);
const urlOf = (v: unknown, fallback: string): string => (typeof v === "string" ? (normalizeAudioBaseUrl(v) ?? "") : fallback);

/** A partial update, as the PUT body carries it. */
export interface VoiceSettingsPatch {
  readonly stt?: Partial<SttSettings>;
  readonly tts?: Partial<TtsSettings>;
}

/** Why a patch was refused. */
export interface VoiceSettingsRefusal {
  readonly field: string;
  readonly message: string;
}

/**
 * Apply `patch` to `base`. A base URL that is not an http(s) URL is refused (not
 * silently dropped); an empty one clears it. Unknown or mistyped fields are ignored.
 */
export function mergeVoiceSettings(base: VoiceSettings, patch: VoiceSettingsPatch): { readonly ok: true; readonly settings: VoiceSettings } | { readonly ok: false; readonly refusal: VoiceSettingsRefusal } {
  for (const dir of ["stt", "tts"] as const) {
    const raw = patch[dir]?.baseUrl;
    if (typeof raw === "string" && raw.trim() !== "" && normalizeAudioBaseUrl(raw) === undefined) {
      return { ok: false, refusal: { field: `${dir}.baseUrl`, message: "The URL must start with http:// or https:// and carry no username or password (put the key in the API key field)." } };
    }
  }
  const s = patch.stt;
  const t = patch.tts;
  return {
    ok: true,
    settings: {
      stt: {
        engine: engineOf(s?.engine, base.stt.engine),
        baseUrl: s?.baseUrl !== undefined ? urlOf(s.baseUrl, base.stt.baseUrl) : base.stt.baseUrl,
        model: s?.model !== undefined ? str(s.model, base.stt.model) || DEFAULT_VOICE_SETTINGS.stt.model : base.stt.model,
      },
      tts: {
        engine: engineOf(t?.engine, base.tts.engine),
        baseUrl: t?.baseUrl !== undefined ? urlOf(t.baseUrl, base.tts.baseUrl) : base.tts.baseUrl,
        model: t?.model !== undefined ? str(t.model, base.tts.model) || DEFAULT_VOICE_SETTINGS.tts.model : base.tts.model,
        voice: t?.voice !== undefined ? str(t.voice, base.tts.voice) || DEFAULT_VOICE_SETTINGS.tts.voice : base.tts.voice,
      },
    },
  };
}

/** File-backed voice settings. One instance per Cortex server. */
export class VoiceSettingsStore {
  private readonly file: string;
  constructor(readonly dir: string) {
    this.file = join(dir, VOICE_SETTINGS_FILE);
  }

  /** The saved settings (defaults when none, or when the file is unreadable). */
  get(): VoiceSettings {
    if (!existsSync(this.file)) return DEFAULT_VOICE_SETTINGS;
    try {
      const v: unknown = JSON.parse(readFileSync(this.file, "utf8"));
      if (typeof v !== "object" || v === null) return DEFAULT_VOICE_SETTINGS;
      const o = v as { stt?: Partial<SttSettings>; tts?: Partial<TtsSettings> };
      const merged = mergeVoiceSettings(DEFAULT_VOICE_SETTINGS, { ...(o.stt ? { stt: o.stt } : {}), ...(o.tts ? { tts: o.tts } : {}) });
      return merged.ok ? merged.settings : DEFAULT_VOICE_SETTINGS;
    } catch {
      return DEFAULT_VOICE_SETTINGS;
    }
  }

  /** Save `settings`; atomic write. `false` on an I/O failure. */
  set(settings: VoiceSettings): boolean {
    try {
      mkdirSync(this.dir, { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(settings, null, 2), { mode: 0o600 });
      renameSync(tmp, this.file);
      return true;
    } catch {
      return false;
    }
  }
}
