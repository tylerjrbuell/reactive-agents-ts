/**
 * The voice runtime the app shares: saved settings from the server, this browser's
 * prefs, the engines the settings pick, one read-aloud controller, and the voice-mode
 * host. `createVoiceRuntime` takes its environment (a `window`-like object, the
 * server URL, fetch, storage) so it is built and tested without a browser;
 * `stores/voice.ts` creates the one the UI uses.
 */
import { get, writable, type Readable } from "svelte/store";
import {
  createReadAloud,
  IDLE_VOICE_MODE,
  type ReadAloud,
  type ReadAloudState,
  type VoiceModeEvent,
  type VoiceFetch,
  type VoiceModeState,
} from "@reactive-agents/ui-core";
import { buildEngines, sttFor, ttsFor, type VoiceEngines } from "./engines.js";
import { loadPrefs, savePrefs, type PrefsStorage, type VoicePrefs } from "./voice-prefs.js";
import { EMPTY_VOICE_SETTINGS, voiceApi, type VoiceSettingsPatch, type VoiceSettingsView } from "./voice-api.js";
import { createVoiceModeHost, type VoiceModeHost } from "./voice-mode-host.js";
import type { VoiceTurnLike } from "./voice-text.js";
import { transcriptMarkdown } from "./voice-text.js";

/** Where the runtime gets its environment. */
export interface VoiceRuntimeEnv {
  /** `window` in the app. */
  readonly win: object;
  /** Cortex server URL. */
  readonly base: string;
  readonly fetch: VoiceFetch;
  readonly storage?: PrefsStorage | undefined;
}

/** Chat hooks voice mode needs; set by the chat panel while it is mounted. */
export interface VoiceChatHooks {
  readonly send: (text: string) => void | Promise<void>;
  readonly stopRun: () => void | Promise<void>;
}

/** The shared voice runtime. */
export interface VoiceRuntime {
  readonly engines: VoiceEngines;
  readonly settings: Readable<VoiceSettingsView>;
  readonly prefs: Readable<VoicePrefs>;
  readonly reader: ReadAloud;
  readonly readerState: Readable<ReadAloudState>;
  readonly api: ReturnType<typeof voiceApi>;
  /** Fetch the server's saved settings. */
  load(): Promise<void>;
  /** Save a settings change; the new view replaces the old one. */
  save(patch: VoiceSettingsPatch): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
  /** Change this browser's prefs. */
  setPrefs(patch: Partial<VoicePrefs>): void;
  /** Read one answer aloud; reading it again while it plays stops it. */
  toggleRead(sourceId: string, markdown: string): void;
  /** Read the whole conversation. */
  readTranscript(turns: readonly VoiceTurnLike[]): void;
  /** The voice-mode host, built on first use over the chat hooks given. */
  voiceMode(hooks: VoiceChatHooks): VoiceModeHost;
  /** Where voice mode is (idle until it starts); updates as the host does. */
  readonly modeState: Readable<VoiceModeState>;
  /** The words heard so far in the phrase voice mode is listening to. */
  readonly modeInterim: Readable<string>;
  /** Send an event to voice mode (no-op before it was built). */
  dispatchMode(event: VoiceModeEvent): void;
  /** The STT engine the settings pick (for the composer's dictation). */
  sttEngine(): ReturnType<typeof sttFor>;
}

/** Build the runtime. */
export function createVoiceRuntime(env: VoiceRuntimeEnv): VoiceRuntime {
  const engines = buildEngines(env.win, { base: env.base, fetch: env.fetch });
  const api = voiceApi(env.base, env.fetch);
  const settings = writable<VoiceSettingsView>(EMPTY_VOICE_SETTINGS);
  const prefs = writable<VoicePrefs>(loadPrefs(env.storage));

  const ttsVoice = (): string => {
    const s = get(settings);
    return s.tts.engine === "server" ? s.tts.voice : get(prefs).browserVoice;
  };
  const reader = createReadAloud({
    engine: () => ttsFor(engines, get(settings)),
    voice: ttsVoice,
    rate: () => get(prefs).rate,
    language: () => get(prefs).language,
  });
  const readerState: Readable<ReadAloudState> = { subscribe: (fn) => reader.subscribe(fn) };

  let host: VoiceModeHost | null = null;
  let hooks: VoiceChatHooks | null = null;
  const modeState = writable<VoiceModeState>(IDLE_VOICE_MODE);
  const modeInterim = writable("");

  return {
    engines,
    settings: { subscribe: settings.subscribe },
    prefs: { subscribe: prefs.subscribe },
    reader,
    readerState,
    api,
    async load() {
      const r = await api.settings();
      if (r.ok) settings.set(r.value);
    },
    async save(patch) {
      const r = await api.save(patch);
      if (!r.ok) return { ok: false, error: r.error };
      settings.set(r.value);
      return { ok: true };
    },
    setPrefs(patch) {
      const next = { ...get(prefs), ...patch };
      prefs.set(next);
      savePrefs(env.storage, next);
      // A speed or voice change applies to the sentence being read now.
      if ("rate" in patch || "browserVoice" in patch) reader.refresh();
    },
    toggleRead(sourceId, markdown) {
      const st = reader.get();
      if (st.sourceId === sourceId && st.status !== "idle" && st.status !== "error") {
        reader.stop();
        return;
      }
      reader.play(sourceId, markdown);
    },
    readTranscript(turns) {
      this.toggleRead("transcript", transcriptMarkdown(turns));
    },
    sttEngine: () => sttFor(engines, get(settings)),
    voiceMode(h) {
      hooks = h;
      if (host === null) {
        host = createVoiceModeHost({
          engine: () => sttFor(engines, get(settings)),
          language: () => get(prefs).language,
          silenceMs: () => get(prefs).silenceMs,
          reader,
          send: (text) => hooks?.send(text),
          stopRun: () => hooks?.stopRun(),
        });
        host.subscribe((s) => modeState.set(s));
        host.dictation.subscribe((d) => modeInterim.set(d.status === "listening" ? d.interim : ""));
      }
      return host;
    },
    modeState: { subscribe: modeState.subscribe },
    modeInterim: { subscribe: modeInterim.subscribe },
    dispatchMode: (event) => host?.dispatch(event),
  };
}
