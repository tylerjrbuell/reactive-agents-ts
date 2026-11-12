/**
 * What is actually available, in plain words, for Settings · Voice and the controls
 * that depend on it. Pure over the saved settings and the browser's feature flags
 * (`engines.ts` `BrowserVoiceCaps`), so the page never claims more than is true.
 */
import type { BrowserVoiceCaps } from "./engines.js";
import type { VoiceSettingsView } from "./voice-api.js";
import { leavesThisMachine } from "./voice-presets.js";

/** One line of status. */
export interface VoiceStatusLine {
  readonly tone: "ok" | "warn" | "bad";
  readonly text: string;
}

/** Whether a direction can be used now, and if not, why. */
export interface VoiceReadiness {
  readonly ready: boolean;
  /** Why not, as one sentence; empty when ready. */
  readonly reason: string;
}

/** A key is saved, or the server has one in its environment. */
const hasKey = (k: VoiceSettingsView["keys"]["stt"]): boolean => k !== null && (k.stored !== null || k.envSet);

const hostOf =(url: string): string => {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/** Lines describing speech to text. */
export function sttStatus(s: VoiceSettingsView, caps: BrowserVoiceCaps): VoiceStatusLine[] {
  if (s.stt.engine === "browser") {
    const lines: VoiceStatusLine[] = [];
    if (!caps.recognition) {
      lines.push({ tone: "bad", text: "This browser has no speech recognition. Use Chrome or Edge, or switch to a server engine." });
    } else {
      lines.push({ tone: "ok", text: "Browser speech recognition is available." });
      lines.push({ tone: "warn", text: "Chrome and Edge send the audio to their vendor's recognition service; no key is needed." });
    }
    if (!caps.secure) lines.push({ tone: "bad", text: "The microphone needs a secure page: open Cortex over https or on localhost." });
    return lines;
  }
  const lines: VoiceStatusLine[] = [];
  if (s.stt.baseUrl === "") {
    lines.push({ tone: "bad", text: "No endpoint URL yet. Pick a preset or enter one." });
  } else {
    const cloud = leavesThisMachine(s.stt.baseUrl);
    lines.push(
      cloud
        ? { tone: "warn", text: `Audio is sent to ${hostOf(s.stt.baseUrl)}.` }
        : { tone: "ok", text: `Audio goes to ${hostOf(s.stt.baseUrl)} on this machine.` },
    );
    if (cloud && !hasKey(s.keys.stt)) lines.push({ tone: "warn", text: "No API key saved for this endpoint." });
  }
  if (!caps.recording) lines.push({ tone: "bad", text: caps.secure ? "This browser cannot record audio." : "Recording needs a secure page: open Cortex over https or on localhost." });
  else lines.push({ tone: "ok", text: "Recording is available." });
  return lines;
}

/** Lines describing text to speech. */
export function ttsStatus(s: VoiceSettingsView, caps: BrowserVoiceCaps): VoiceStatusLine[] {
  if (s.tts.engine === "browser") {
    return caps.synthesis
      ? [{ tone: "ok", text: "Browser speech is available. The voices are the ones installed on this device." }]
      : [{ tone: "bad", text: "This browser cannot speak text aloud. Switch to a server engine." }];
  }
  const lines: VoiceStatusLine[] = [];
  if (s.tts.baseUrl === "") {
    lines.push({ tone: "bad", text: "No endpoint URL yet. Pick a preset or enter one." });
  } else {
    const cloud = leavesThisMachine(s.tts.baseUrl);
    lines.push(
      cloud
        ? { tone: "warn", text: `Text is sent to ${hostOf(s.tts.baseUrl)} to be spoken.` }
        : { tone: "ok", text: `Text goes to ${hostOf(s.tts.baseUrl)} on this machine.` },
    );
    if (cloud && !hasKey(s.keys.tts)) lines.push({ tone: "warn", text: "No API key saved for this endpoint." });
  }
  lines.push(caps.playback ? { tone: "ok", text: "Audio playback is available." } : { tone: "bad", text: "This browser cannot play audio." });
  return lines;
}

/** Can the mic button work with these settings? */
export function sttReadiness(s: VoiceSettingsView, caps: BrowserVoiceCaps): VoiceReadiness {
  const bad = sttStatus(s, caps).find((l) => l.tone === "bad");
  return bad ? { ready: false, reason: bad.text } : { ready: true, reason: "" };
}

/** Can read-aloud work with these settings? */
export function ttsReadiness(s: VoiceSettingsView, caps: BrowserVoiceCaps): VoiceReadiness {
  const bad = ttsStatus(s, caps).find((l) => l.tone === "bad");
  return bad ? { ready: false, reason: bad.text } : { ready: true, reason: "" };
}

/** What the key row for an endpoint says. */
export function endpointKeyLine(status: VoiceSettingsView["keys"]["stt"], envName: string): string {
  if (status?.unreadable) return "A saved key could not be decrypted. Save it again.";
  if (status?.stored) return `Saved key ${status.stored.masked}.`;
  if (status?.envSet) return `Using ${envName} from the server's environment.`;
  return `No key saved. A server that needs none works as is, or set ${envName} where Cortex runs.`;
}

/**
 * The voice to use given what the server lists. With no known list the current voice stands.
 * A voice the list lacks is replaced by `preferred` (a preset's voice) when listed, else the
 * first listed voice, so a stale name such as OpenAI's `nova` never goes to a Kokoro model.
 */
export function reconcileVoice(current: string, listed: readonly string[], preferred?: string): string {
  if (listed.length === 0 || listed.includes(current)) return current;
  return preferred !== undefined && listed.includes(preferred) ? preferred : (listed[0] ?? current);
}

/** Select value that means "type an id yourself". */
export const CUSTOM_VOICE = "__custom__";

/**
 * The Voice picker's options: every listed voice (friendly label, grouped by language), the
 * current voice when the list lacks it (so it still shows), and a final "Custom voice id..." entry.
 */
export function voiceSelectOptions(
  voices: readonly { readonly id: string; readonly label: string; readonly group?: string | undefined }[],
  current: string,
): { value: string; label: string; description?: string; group?: string }[] {
  const out: { value: string; label: string; description?: string; group?: string }[] = voices.map((v) => ({
    value: v.id,
    label: v.label,
    description: v.id,
    ...(v.group !== undefined ? { group: v.group } : {}),
  }));
  const c = current.trim();
  if (c !== "" && !voices.some((v) => v.id === c)) out.unshift({ value: c, label: c, description: "current voice" });
  out.push({ value: CUSTOM_VOICE, label: "Custom voice id...", description: "type an id the server accepts" });
  return out;
}

/** Inline warning for the Voice field: set only when a list is known and lacks the voice. */
export function voiceWarning(voice: string, listed: readonly string[]): string | null {
  const v = voice.trim();
  return listed.length > 0 && v !== "" && !listed.includes(v) ? `${v} is not offered by this model.` : null;
}
