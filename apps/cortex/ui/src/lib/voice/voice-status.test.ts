import { describe, expect, test } from "bun:test";
import { endpointKeyLine, sttReadiness, sttStatus, ttsReadiness, ttsStatus } from "./voice-status.js";
import { EMPTY_VOICE_SETTINGS, parseVoiceSettings, voiceApi, type VoiceSettingsView } from "./voice-api.js";
import type { BrowserVoiceCaps } from "./engines.js";
import { parseKeyStatus } from "../provider-keys.js";

const ALL: BrowserVoiceCaps = { recognition: true, synthesis: true, recording: true, playback: true, secure: true };
const NONE: BrowserVoiceCaps = { recognition: false, synthesis: false, recording: false, playback: false, secure: true };
const withServer = (patch: { stt?: Partial<VoiceSettingsView["stt"]>; tts?: Partial<VoiceSettingsView["tts"]>; keys?: VoiceSettingsView["keys"] }): VoiceSettingsView => ({
  ...EMPTY_VOICE_SETTINGS,
  keys: patch.keys ?? EMPTY_VOICE_SETTINGS.keys,
  stt: { ...EMPTY_VOICE_SETTINGS.stt, engine: "server", ...patch.stt },
  tts: { ...EMPTY_VOICE_SETTINGS.tts, engine: "server", ...patch.tts },
});
const keyOf = (stored: boolean, envSet = false) =>
  parseKeyStatus({ provider: "voice-stt", env: ["X"], envSet, stored: stored ? { masked: "••••abcd", updatedAt: 1, preferStored: false } : null, source: stored ? "stored" : envSet ? "env" : "none" });

describe("voice status", () => {
  test("browser listening: available where the browser has it, honest about the vendor service, refuses elsewhere", () => {
    const ok = sttStatus(EMPTY_VOICE_SETTINGS, ALL);
    expect(ok[0]?.tone).toBe("ok");
    expect(ok.some((l) => l.text.includes("vendor"))).toBe(true);
    expect(sttReadiness(EMPTY_VOICE_SETTINGS, ALL).ready).toBe(true);
    const no = sttReadiness(EMPTY_VOICE_SETTINGS, NONE);
    expect(no.ready).toBe(false);
    expect(no.reason).toContain("no speech recognition");
  });

  test("an insecure page cannot use the microphone", () => {
    const r = sttReadiness(EMPTY_VOICE_SETTINGS, { ...ALL, secure: false });
    expect(r.ready).toBe(false);
    expect(r.reason).toContain("https");
  });

  test("server listening needs a URL and the ability to record", () => {
    expect(sttReadiness(withServer({}), ALL).ready).toBe(false);
    expect(sttReadiness(withServer({ stt: { baseUrl: "http://localhost:8000/v1" } }), ALL).ready).toBe(true);
    expect(sttReadiness(withServer({ stt: { baseUrl: "http://localhost:8000/v1" } }), { ...ALL, recording: false }).ready).toBe(false);
  });

  test("local endpoints say audio stays; cloud ones say where it goes and nudge for a key", () => {
    const local = sttStatus(withServer({ stt: { baseUrl: "http://localhost:8000/v1" } }), ALL).map((l) => l.text).join(" ");
    expect(local).toContain("on this machine");
    const cloud = sttStatus(withServer({ stt: { baseUrl: "https://api.openai.com/v1" } }), ALL).map((l) => l.text).join(" ");
    expect(cloud).toContain("sent to api.openai.com");
    expect(cloud).toContain("No API key");
    const keyed = sttStatus(withServer({ stt: { baseUrl: "https://api.openai.com/v1" }, keys: { stt: keyOf(true), tts: null } }), ALL).map((l) => l.text).join(" ");
    expect(keyed).not.toContain("No API key");
  });

  test("speech: browser and server variants", () => {
    expect(ttsReadiness(EMPTY_VOICE_SETTINGS, ALL).ready).toBe(true);
    expect(ttsReadiness(EMPTY_VOICE_SETTINGS, NONE).ready).toBe(false);
    expect(ttsReadiness(withServer({}), ALL).ready).toBe(false);
    expect(ttsReadiness(withServer({ tts: { baseUrl: "http://localhost:8880/v1" } }), ALL).ready).toBe(true);
    expect(ttsReadiness(withServer({ tts: { baseUrl: "http://localhost:8880/v1" } }), { ...ALL, playback: false }).ready).toBe(false);
    expect(ttsStatus(withServer({ tts: { baseUrl: "https://api.openai.com/v1" } }), ALL).map((l) => l.text).join(" ")).toContain("Text is sent to");
  });

  test("key line never shows more than a mask", () => {
    expect(endpointKeyLine(keyOf(true), "E")).toBe("Saved key ••••abcd.");
    expect(endpointKeyLine(keyOf(false, true), "E")).toContain("environment");
    expect(endpointKeyLine(keyOf(false), "E")).toContain("No key saved");
    expect(endpointKeyLine(null, "E")).toContain("No key saved");
  });
});

describe("voice api client", () => {
  test("parseVoiceSettings keeps what the server sent and defaults the rest", () => {
    const p = parseVoiceSettings({
      settings: { stt: { engine: "server", baseUrl: "http://h/v1", model: "w" }, tts: { engine: "weird", voice: 3 } },
      keys: { stt: { provider: "voice-stt", env: [], envSet: false, stored: { masked: "••••1234", updatedAt: 5, preferStored: false }, source: "stored" } },
    });
    expect(p.stt).toEqual({ engine: "server", baseUrl: "http://h/v1", model: "w" });
    expect(p.tts.engine).toBe("browser");
    expect(p.tts.voice).toBe("alloy");
    expect(p.keys.stt?.stored?.masked).toBe("••••1234");
    expect(parseVoiceSettings(null)).toEqual(EMPTY_VOICE_SETTINGS);
  });

  test("calls hit the voice routes, send patches as JSON, return tagged results, and key calls use the key store", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    const doFetch = async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? "GET", body: String(init?.body ?? "") });
      if (url.endsWith("/test/tts")) return new Response(JSON.stringify({ ok: true, message: "fine", detail: "7 bytes of audio" }));
      if (url.endsWith("/voices")) return new Response(JSON.stringify({ voices: [{ id: "a", label: "A" }, { id: "" }, 3], listed: true }));
      if (url.includes("/api/settings/keys/")) return new Response(JSON.stringify({ provider: "voice-tts", source: "none" }));
      return new Response(JSON.stringify({ error: "nope" }), { status: 400 });
    };
    const api = voiceApi("http://c", doFetch);
    expect((await api.test("tts")).ok).toBe(true);
    const v = await api.voices();
    expect(v.ok && v.value.voices).toEqual([{ id: "a", label: "A" }]);
    const bad = await api.save({ tts: { voice: "x" } });
    expect(bad).toEqual({ ok: false, error: "nope" });
    expect(calls.find((c) => c.method === "PUT")?.body).toBe('{"tts":{"voice":"x"}}');
    await api.saveKey("voice-tts", "k");
    await api.removeKey("voice-tts");
    expect(calls.filter((c) => c.url === "http://c/api/settings/keys/voice-tts").map((c) => c.method)).toEqual(["PUT", "DELETE"]);
    const down = await voiceApi("http://c", async () => { throw new Error("offline"); }).settings();
    expect(down).toEqual({ ok: false, error: "offline" });
  });
});
