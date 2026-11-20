/**
 * Which local Speaches endpoint the speech supervisor serves, read from the voice settings. Pure.
 *
 * Only server-engine endpoints on a loopback `http://host:port/v1` with a Hugging Face model id
 * qualify (so `tts-1` on an openedai-speech server, or any cloud URL, is never supervised), and
 * listening and reading must share one port. Whatever loopback form was typed (`localhost`,
 * `127.0.0.1`, `::1`, `[::1]`), the server is called as `127.0.0.1`: the Cortex container is
 * published on IPv4 loopback only, and `[::1]` (or a `localhost` that resolves to `::1` first)
 * would be refused there.
 */
import type { VoiceSettings } from "./voice-settings.js";

/** What the supervisor will keep running, read from the voice settings. */
export type SpeechTarget =
  | {
      readonly ok: true;
      readonly port: number;
      /** `http://127.0.0.1:<port>`. */
      readonly origin: string;
      /** `<origin>/v1`. */
      readonly apiBase: string;
      readonly models: readonly string[];
      readonly directions: readonly ("stt" | "tts")[];
    }
  | { readonly ok: false; readonly reason: string };

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
/** A Hugging Face model id as Speaches names them: `org/name`. */
export const SPEECH_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The sentence shown when no local Speaches endpoint is saved. */
export const NO_LOCAL_ENDPOINT = "Set the listening or reading engine to a local Speaches endpoint first (a localhost URL with a port, ending in /v1).";

/** The local Speaches endpoint(s) in `settings`, or why there is none. */
export function resolveSpeechTarget(settings: VoiceSettings): SpeechTarget {
  const found: { dir: "stt" | "tts"; port: number; model: string }[] = [];
  for (const dir of ["stt", "tts"] as const) {
    const s = settings[dir];
    if (s.engine !== "server" || s.baseUrl === "") continue;
    let u: URL;
    try {
      u = new URL(s.baseUrl);
    } catch {
      continue;
    }
    if (u.protocol !== "http:" || !LOOPBACK.has(u.hostname) || u.username !== "" || u.password !== "") continue;
    if (u.pathname.replace(/\/+$/, "") !== "/v1" || u.search !== "" || u.hash !== "") continue;
    const port = Number(u.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) continue;
    if (!SPEECH_MODEL_ID.test(s.model)) continue;
    found.push({ dir, port, model: s.model });
  }
  const first = found[0];
  if (first === undefined) return { ok: false, reason: NO_LOCAL_ENDPOINT };
  if (found.some((f) => f.port !== first.port)) {
    return { ok: false, reason: "Listening and reading point at different local ports; Cortex keeps one speech server running, so use the same port for both." };
  }
  const origin = `http://127.0.0.1:${first.port}`;
  return {
    ok: true,
    port: first.port,
    origin,
    apiBase: `${origin}/v1`,
    models: [...new Set(found.map((f) => f.model))],
    directions: found.map((f) => f.dir),
  };
}

/** The base URL Cortex calls for `direction`: the IPv4 loopback form when it is the supervised server, else `undefined` (use the saved URL). */
export function supervisedBaseUrl(settings: VoiceSettings, direction: "stt" | "tts"): string | undefined {
  const t = resolveSpeechTarget(settings);
  return t.ok && t.directions.includes(direction) ? t.apiBase : undefined;
}
