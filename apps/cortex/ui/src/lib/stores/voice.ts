/**
 * The app's one voice runtime (settings, prefs, engines, read-aloud, voice mode),
 * created on first use in the browser. Components import `voice()`; server rendering
 * never calls it. Logic lives in `lib/voice/*` (tested); this file only supplies the
 * browser's globals.
 */
import { CORTEX_SERVER_URL } from "$lib/constants.js";
import { createVoiceRuntime, type VoiceRuntime } from "$lib/voice/voice-runtime.js";

let runtime: VoiceRuntime | null = null;

/** The shared voice runtime (browser only). */
export function voice(): VoiceRuntime {
  if (runtime === null) {
    runtime = createVoiceRuntime({
      win: window,
      base: CORTEX_SERVER_URL,
      fetch: (input, init) => window.fetch(input, init),
      storage: window.localStorage,
    });
  }
  return runtime;
}
