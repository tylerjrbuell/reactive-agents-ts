/**
 * Settings · Voice · local speech server: port and hardware (CPU / GPU image), applied to the saved
 * voice settings. Pure; `speech-supervisor.ts` saves the result and re-creates its container.
 *
 * A port change moves the endpoints the supervisor serves (the listening and reading URLs that
 * `resolveSpeechTarget` accepts) to `http://127.0.0.1:<port>/v1`, so the URLs Cortex calls and the
 * port the container publishes on never disagree. Other endpoints (cloud, LAN, browser engine) are
 * left as they are.
 */
import { resolveSpeechTarget } from "./speech-target.js";
import { isLocalSpeechDevice, isLocalSpeechPort, type LocalSpeechDevice, type VoiceSettings } from "./voice-settings.js";

/** What `POST /api/voice/local/config` may change. Absent = keep. */
export interface LocalSpeechConfigPatch {
  readonly port?: number;
  readonly device?: LocalSpeechDevice;
}

/** The settings after a patch, or why it was refused. */
export type LocalSpeechConfigResult =
  | { readonly ok: true; readonly settings: VoiceSettings; readonly changed: boolean }
  | { readonly ok: false; readonly error: string };

/** Apply `patch` to `base`. */
export function applyLocalSpeechConfig(base: VoiceSettings, patch: LocalSpeechConfigPatch): LocalSpeechConfigResult {
  if (patch.port !== undefined && !isLocalSpeechPort(patch.port)) {
    return { ok: false, error: "The port must be a whole number from 1024 to 65535." };
  }
  if (patch.device !== undefined && !isLocalSpeechDevice(patch.device)) {
    return { ok: false, error: "Hardware must be auto, cpu or cuda." };
  }
  const port = patch.port ?? base.localSpeech.port;
  const device = patch.device ?? base.localSpeech.device;
  const target = resolveSpeechTarget(base);
  let { stt, tts } = base;
  if (target.ok && target.port !== port) {
    const url = `http://127.0.0.1:${port}/v1`;
    if (target.directions.includes("stt")) stt = { ...stt, baseUrl: url };
    if (target.directions.includes("tts")) tts = { ...tts, baseUrl: url };
  }
  const changed = stt !== base.stt || tts !== base.tts || port !== base.localSpeech.port || device !== base.localSpeech.device;
  return { ok: true, changed, settings: { stt, tts, localSpeech: { ...base.localSpeech, port, device } } };
}
