import { describe, expect, test } from "bun:test";
import { buildEngines, sttFor, ttsFor } from "./engines.js";
import { EMPTY_VOICE_SETTINGS } from "./voice-api.js";

const noFetch = async () => new Response("{}");
const opts = { base: "http://c", fetch: noFetch };

class Ctor {}
const fakeSynth = { speak() {}, getVoices: () => [], cancel() {}, pause() {}, resume() {} };

describe("buildEngines feature detection", () => {
  test("a browser with nothing reports nothing and every engine says why it cannot run", () => {
    const e = buildEngines({}, opts);
    expect(e.caps).toEqual({ recognition: false, synthesis: false, recording: false, playback: false, secure: true });
    expect(e.browserStt.available().ok).toBe(false);
    expect(e.browserTts.available().ok).toBe(false);
    expect(e.serverStt.available().ok).toBe(false);
    expect(e.serverTts.available().ok).toBe(false);
  });

  test("a full browser: webkit-prefixed recognition counts, recording needs a secure page", () => {
    const win = {
      webkitSpeechRecognition: Ctor,
      speechSynthesis: fakeSynth,
      SpeechSynthesisUtterance: Ctor,
      navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [] }) } },
      MediaRecorder: Ctor,
      Audio: Ctor,
      URL: Object.assign(function URL() {}, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }),
    };
    const e = buildEngines(win, opts);
    expect(e.caps).toEqual({ recognition: true, synthesis: true, recording: true, playback: true, secure: true });
    expect(e.browserStt.available().ok).toBe(true);
    expect(e.serverTts.available().ok).toBe(true);
    const insecure = buildEngines({ ...win, isSecureContext: false }, opts);
    expect(insecure.caps.recording).toBe(false);
    expect(insecure.caps.secure).toBe(false);
    expect(insecure.serverStt.available().ok).toBe(false);
  });

  test("the settings pick the engine per direction", () => {
    const e = buildEngines({}, opts);
    expect(sttFor(e, EMPTY_VOICE_SETTINGS)).toBe(e.browserStt);
    expect(ttsFor(e, EMPTY_VOICE_SETTINGS)).toBe(e.browserTts);
    const server = { ...EMPTY_VOICE_SETTINGS, stt: { ...EMPTY_VOICE_SETTINGS.stt, engine: "server" as const }, tts: { ...EMPTY_VOICE_SETTINGS.tts, engine: "server" as const } };
    expect(sttFor(e, server)).toBe(e.serverStt);
    expect(ttsFor(e, server)).toBe(e.serverTts);
  });

  test("the server engines call Cortex's routes through the injected fetch (never a bare window.fetch method call)", async () => {
    const urls: string[] = [];
    const seenThis: unknown[] = [];
    const e = buildEngines({ Audio: Ctor, URL: Object.assign(function URL() {}, { createObjectURL: () => "blob:x", revokeObjectURL: () => undefined }) }, {
      base: "http://c",
      fetch: async function (this: unknown, url: string) {
        seenThis.push(this);
        urls.push(url);
        return new Response(JSON.stringify({ voices: [] }));
      },
    });
    await e.serverTts.voices();
    expect(urls).toEqual(["http://c/api/voice/voices"]);
    expect(seenThis.length).toBe(1);
  });
});
