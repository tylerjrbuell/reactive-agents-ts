// Run: bun run repo test apps/cortex/server/tests/voice-api.test.ts
//
// Settings · Voice server side against a stub OpenAI-compatible audio server (no network, no
// paid calls): transcription and speech relay, the endpoint key stays on the server, errors are
// redacted, caps hold, the browser's abort reaches the audio server, and no audio is stored.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Elysia } from "elysia";
import { voiceKey, voiceRouter } from "../api/voice.js";
import { providerKeysRouter } from "../api/provider-keys.js";
import { ProviderKeyStore, VOICE_STT_KEY_ID, VOICE_TTS_KEY_ID } from "../services/provider-key-store.js";
import { DEFAULT_VOICE_SETTINGS, mergeVoiceSettings, VoiceSettingsStore } from "../services/voice/voice-settings.js";
import { audioFileName, audioUrl, listVoices, normalizeAudioBaseUrl, silentWav, speak, transcribe } from "../services/voice/openai-compatible.js";

const STT_KEY = "sk-stt-secret-0123456789ABCD";
const TTS_KEY = "sk-tts-secret-9876543210WXYZ";
const AUDIO = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

interface Seen {
  path: string;
  auth: string | null;
  form?: { model: string | null; language: string | null; format: string | null; fileName: string | null; fileType: string | null; fileBytes: number };
  json?: Record<string, unknown>;
}
let seen: Seen[] = [];
let mode: "ok" | "unauthorized" | "hang" | "voices" | "novoices" = "ok";
let upstreamAborted = false;

let stub: ReturnType<typeof Bun.serve>;
beforeAll(() => {
  stub = Bun.serve({
    port: 0,
    async fetch(req) {
      const url = new URL(req.url);
      const auth = req.headers.get("authorization");
      if (mode === "unauthorized") {
        // A careless server that echoes the credential back in its error.
        return new Response(JSON.stringify({ error: { message: `Invalid key ${auth}` } }), { status: 401 });
      }
      if (url.pathname === "/v1/audio/transcriptions") {
        if (mode === "hang") {
          req.signal.addEventListener("abort", () => (upstreamAborted = true));
          await new Promise((r) => setTimeout(r, 4000));
          return new Response("{}");
        }
        const form = await req.formData();
        const file = form.get("file");
        seen.push({
          path: url.pathname,
          auth,
          form: {
            model: form.get("model") as string | null,
            language: form.get("language") as string | null,
            format: form.get("response_format") as string | null,
            fileName: file instanceof File ? file.name : null,
            fileType: file instanceof File ? file.type : null,
            fileBytes: file instanceof File ? file.size : 0,
          },
        });
        return Response.json({ text: "  hello from the stub  " });
      }
      if (url.pathname === "/v1/audio/speech") {
        seen.push({ path: url.pathname, auth, json: (await req.json()) as Record<string, unknown> });
        return new Response(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 1, 2, 3]), { headers: { "content-type": "audio/mpeg" } });
      }
      if (url.pathname === "/v1/audio/voices") {
        return mode === "voices" ? Response.json({ voices: ["af_bella", "am_adam"] }) : new Response("nope", { status: 404 });
      }
      return new Response("not found", { status: 404 });
    },
  });
});
afterAll(() => stub.stop(true));

let dir: string;
let keys: ProviderKeyStore;
let settings: VoiceSettingsStore;
let app: { handle(request: Request): Response | Promise<Response> };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-voice-"));
  keys = new ProviderKeyStore({ dir, env: {} });
  settings = new VoiceSettingsStore(dir);
  app = new Elysia().use(voiceRouter({ settings, keys })).use(providerKeysRouter(keys));
  seen = [];
  mode = "ok";
  upstreamAborted = false;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const base = () => `http://127.0.0.1:${stub.port}/v1`;
const call = async (path: string, init?: RequestInit): Promise<Response> => app.handle(new Request(`http://cortex.test${path}`, init));
const put = (body: unknown) => call("/api/voice/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const configure = async () => {
  await put({ stt: { engine: "server", baseUrl: base(), model: "whisper-small" }, tts: { engine: "server", baseUrl: base(), model: "kokoro", voice: "af_bella" } });
  keys.set(VOICE_STT_KEY_ID, STT_KEY);
  keys.set(VOICE_TTS_KEY_ID, TTS_KEY);
};

describe("settings", () => {
  it("defaults to browser engines with nothing configured", async () => {
    const body = (await (await call("/api/voice/settings")).json()) as { settings: typeof DEFAULT_VOICE_SETTINGS };
    expect(body.settings.stt.engine).toBe("browser");
    expect(body.settings.tts.engine).toBe("browser");
    expect(body.settings.stt.baseUrl).toBe("");
  });

  it("saves, merges and persists across a new store instance", async () => {
    await put({ tts: { engine: "server", baseUrl: `${base()}/`, voice: " nova " } });
    await put({ stt: { model: "whisper-large" } });
    const next = new VoiceSettingsStore(dir).get();
    expect(next.tts).toEqual({ engine: "server", baseUrl: base(), model: "tts-1", voice: "nova" });
    expect(next.stt.model).toBe("whisper-large");
    expect(next.stt.engine).toBe("browser");
  });

  it("refuses a URL that is not http(s) or carries credentials, and keeps the old value", async () => {
    await put({ stt: { baseUrl: base() } });
    for (const bad of ["ftp://x/v1", "not a url", "http://user:pw@host/v1"]) {
      const res = await put({ stt: { baseUrl: bad } });
      expect(res.status).toBe(400);
      expect(((await res.json()) as { field: string }).field).toBe("stt.baseUrl");
    }
    expect(settings.get().stt.baseUrl).toBe(base());
    expect((await put({ stt: { baseUrl: "" } })).status).toBe(200);
    expect(settings.get().stt.baseUrl).toBe("");
  });

  it("an unreadable settings file falls back to the defaults", () => {
    rmSync(join(dir, "voice-settings.json"), { force: true });
    expect(settings.get()).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(mergeVoiceSettings(DEFAULT_VOICE_SETTINGS, { stt: { engine: "server" } }).ok).toBe(true);
  });
});

describe("keys never reach the browser", () => {
  it("the settings view carries a mask and the state, never the key", async () => {
    await configure();
    const text = await (await call("/api/voice/settings")).text();
    expect(text).not.toContain(STT_KEY);
    expect(text).not.toContain(TTS_KEY);
    expect(text).not.toContain("secret-0123");
    expect(text).toContain("••••ABCD");
    const keysText = await (await call("/api/settings/keys")).text();
    expect(keysText).not.toContain(STT_KEY);
    expect(keysText).not.toContain(TTS_KEY);
  });

  it("the key is sent upstream as a bearer token, and appears in no response", async () => {
    await configure();
    const t = await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO });
    const s = await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hi." }) });
    expect(seen.map((x) => x.auth)).toEqual([`Bearer ${STT_KEY}`, `Bearer ${TTS_KEY}`]);
    const everything = (await t.text()) + [...s.headers.entries()].join() + (await s.text());
    expect(everything).not.toContain("secret");
  });

  it("an error from a server that echoes the key is redacted", async () => {
    await configure();
    mode = "unauthorized";
    const res = await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO });
    expect(res.status).toBe(401);
    const text = await res.text();
    expect(text).not.toContain(STT_KEY);
    expect(text).toContain("rejected the API key");
    const test = await call("/api/voice/test/tts", { method: "POST" });
    expect(await test.text()).not.toContain(TTS_KEY);
  });

  it("the provider-key Test for a voice key points to Settings · Voice instead of calling an LLM provider", async () => {
    keys.set(VOICE_TTS_KEY_ID, TTS_KEY);
    const res = (await (await call(`/api/settings/keys/${VOICE_TTS_KEY_ID}/test`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()) as { ok: boolean; error: string };
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Settings · Voice");
  });

  it("the key is read from the environment when none is saved", () => {
    expect(voiceKey(keys, VOICE_STT_KEY_ID, { CORTEX_VOICE_STT_API_KEY: " env-key " })).toBe("env-key");
    keys.set(VOICE_STT_KEY_ID, "saved-key-value");
    expect(voiceKey(keys, VOICE_STT_KEY_ID, { CORTEX_VOICE_STT_API_KEY: "env-key" })).toBe("saved-key-value");
  });
});

describe("transcription", () => {
  it("relays the recording as a multipart upload and returns the trimmed text", async () => {
    await configure();
    const res = await call("/api/voice/transcribe?language=de-DE", { method: "POST", headers: { "content-type": "audio/webm;codecs=opus" }, body: AUDIO });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: "hello from the stub" });
    // The part's own content type is the runtime's to label (Bun sniffs by extension); servers decode by content.
    expect(seen[0]?.form).toMatchObject({ model: "whisper-small", language: "de", format: "json", fileName: "audio.webm", fileBytes: AUDIO.length });
  });

  it("is refused with a clear message when no endpoint is set up", async () => {
    const res = await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain("Settings · Voice");
  });

  it("refuses an empty or oversized recording before calling the server", async () => {
    await configure();
    const empty = await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: new Uint8Array(0) });
    expect(empty.status).toBe(400);
    const big = await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm", "content-length": String(30 * 1024 * 1024) }, body: AUDIO });
    expect(big.status).toBe(413);
    expect(seen.length).toBe(0);
  });

  it("an unreachable server is a 502 naming the host, not a crash", async () => {
    await put({ stt: { baseUrl: "http://127.0.0.1:1/v1" } });
    const res = await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO });
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: string }).error).toContain("127.0.0.1:1");
  });

  it("the browser's abort reaches the audio server", async () => {
    await configure();
    mode = "hang";
    const ctl = new AbortController();
    const pending = call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO, signal: ctl.signal });
    await new Promise((r) => setTimeout(r, 200));
    ctl.abort();
    await pending.catch(() => undefined);
    await new Promise((r) => setTimeout(r, 200));
    expect(upstreamAborted).toBe(true);
  });
});

describe("speech", () => {
  it("synthesizes with the saved model and voice and returns playable audio", async () => {
    await configure();
    const res = await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Read this.", speed: 1.5 }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer()).length).toBe(7);
    expect(seen[0]?.json).toEqual({ model: "kokoro", input: "Read this.", voice: "af_bella", response_format: "mp3", speed: 1.5 });
  });

  it("a voice in the request wins over the saved one", async () => {
    await configure();
    await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x", voice: "am_adam" }) });
    expect(seen[0]?.json?.voice).toBe("am_adam");
  });

  it("refuses text beyond the cap, empty text, and an unset endpoint", async () => {
    const unset = await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "x" }) });
    expect(unset.status).toBe(400);
    await configure();
    const long = await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "a".repeat(5000) }) });
    expect(long.status).toBe(413);
    const blank = await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "  " }) });
    expect(blank.status).toBe(400);
    expect(seen.length).toBe(0);
  });

  it("lists the server's voices, else OpenAI's names", async () => {
    await configure();
    mode = "voices";
    const listed = (await (await call("/api/voice/voices")).json()) as { voices: Array<{ id: string }>; listed: boolean };
    expect(listed.listed).toBe(true);
    expect(listed.voices.map((v) => v.id)).toEqual(["af_bella", "am_adam"]);
    mode = "novoices";
    const fallback = (await (await call("/api/voice/voices")).json()) as { voices: Array<{ id: string }>; listed: boolean };
    expect(fallback.listed).toBe(false);
    expect(fallback.voices.map((v) => v.id)).toContain("alloy");
  });
});

describe("Test buttons", () => {
  it("report the saved models and what came back", async () => {
    await configure();
    const stt = (await (await call("/api/voice/test/stt", { method: "POST" })).json()) as { ok: boolean; message: string };
    expect(stt.ok).toBe(true);
    expect(stt.message).toContain("whisper-small");
    const tts = (await (await call("/api/voice/test/tts", { method: "POST" })).json()) as { ok: boolean; detail: string };
    expect(tts.ok).toBe(true);
    expect(tts.detail).toBe("7 bytes of audio");
  });

  it("say plainly when nothing is set up", async () => {
    const r = (await (await call("/api/voice/test/stt", { method: "POST" })).json()) as { ok: boolean; message: string };
    expect(r.ok).toBe(false);
    expect(r.message).toContain("not set up");
    expect((await call("/api/voice/test/other", { method: "POST" })).status).toBe(400);
  });
});

describe("storage", () => {
  it("writes no audio: only settings and key files exist in the data directory", async () => {
    await configure();
    await call("/api/voice/transcribe", { method: "POST", headers: { "content-type": "audio/webm" }, body: AUDIO });
    await call("/api/voice/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "Hello." }) });
    expect(readdirSync(dir).sort()).toEqual(["provider-keys.json", "secret.key", "voice-settings.json"]);
    expect(readFileSync(join(dir, "voice-settings.json"), "utf8")).not.toContain(STT_KEY);
  });
});

describe("adapter helpers", () => {
  it("joins URLs, normalizes base URLs and names uploads by media type", () => {
    expect(audioUrl("http://h/v1/", "/audio/speech")).toBe("http://h/v1/audio/speech");
    expect(normalizeAudioBaseUrl(" http://localhost:8000/v1/// ")).toBe("http://localhost:8000/v1");
    expect(normalizeAudioBaseUrl("javascript:alert(1)")).toBeUndefined();
    expect(audioFileName("audio/ogg; codecs=opus")).toBe("audio.ogg");
    expect(audioFileName("audio/x-wav")).toBe("audio.wav");
    expect(audioFileName("weird/type")).toBe("audio.webm");
  });

  it("silentWav is a valid 16 kHz mono WAV of the right length", () => {
    const wav = silentWav(1);
    expect(new TextDecoder().decode(wav.subarray(0, 4))).toBe("RIFF");
    expect(wav.length).toBe(44 + 32_000);
  });

  it("works against the stub directly, with an injected fetch", async () => {
    let called = "";
    const fetchStub = (async (url: string) => {
      called = url;
      return new Response("plain text answer", { status: 200 });
    }) as unknown as typeof fetch;
    const r = await transcribe({ baseUrl: "http://x/v1", fetch: fetchStub }, { audio: AUDIO, mediaType: "audio/wav", model: "m" });
    expect(r).toEqual({ ok: true, text: "plain text answer" });
    expect(called).toBe("http://x/v1/audio/transcriptions");
    expect((await speak({ baseUrl: "http://x/v1", fetch: fetchStub }, { text: "", model: "m", voice: "v" })).ok).toBe(false);
    expect((await listVoices({ baseUrl: "http://x/v1", fetch: fetchStub })).listed).toBe(false);
  });
});
