import { describe, expect, test } from "bun:test";
import { clampRate, DEFAULT_VOICE_PREFS, isLanguageTag, loadPrefs, parsePrefs, savePrefs, VOICE_PREFS_KEY, type PrefsStorage } from "./voice-prefs.js";
import { leavesThisMachine, presetFor, STT_PRESETS, TTS_PRESETS } from "./voice-presets.js";

const memory = (): PrefsStorage & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe("voice prefs", () => {
  test("defaults: toggle mic, no auto-send, browser language, reads replies, barge-in on", () => {
    expect(DEFAULT_VOICE_PREFS).toMatchObject({ micMode: "toggle", autoSend: false, language: "", rate: 1, autoSpeak: true, bargeIn: true });
  });

  test("parsePrefs keeps valid values and falls back per field on junk", () => {
    const p = parsePrefs({ language: "fr-FR", micMode: "push-to-talk", autoSend: true, silenceMs: 99999, rate: 9, browserVoice: "Alex", autoSpeak: false, bargeIn: false });
    expect(p).toEqual({ language: "fr-FR", micMode: "push-to-talk", autoSend: true, silenceMs: 10_000, rate: 2, browserVoice: "Alex", autoSpeak: false, bargeIn: false });
    expect(parsePrefs({ language: "not a tag!", micMode: 3, silenceMs: "x", rate: "fast" })).toEqual(DEFAULT_VOICE_PREFS);
    expect(parsePrefs(null)).toEqual(DEFAULT_VOICE_PREFS);
    expect(parsePrefs({ silenceMs: 10 }).silenceMs).toBe(500);
  });

  test("language tags and rate clamping", () => {
    expect(isLanguageTag("en-US")).toBe(true);
    expect(isLanguageTag("")).toBe(true);
    expect(isLanguageTag("english please")).toBe(false);
    expect(clampRate(0.1)).toBe(0.5);
    expect(clampRate(NaN)).toBe(1);
  });

  test("save then load round-trips; unreadable or missing storage gives defaults", () => {
    const s = memory();
    savePrefs(s, { ...DEFAULT_VOICE_PREFS, micMode: "push-to-talk", rate: 1.5 });
    expect(loadPrefs(s)).toMatchObject({ micMode: "push-to-talk", rate: 1.5 });
    s.data.set(VOICE_PREFS_KEY, "{broken");
    expect(loadPrefs(s)).toEqual(DEFAULT_VOICE_PREFS);
    expect(loadPrefs(undefined)).toEqual(DEFAULT_VOICE_PREFS);
    expect(() => savePrefs({ getItem: () => null, setItem: () => { throw new Error("full"); } }, DEFAULT_VOICE_PREFS)).not.toThrow();
  });
});

describe("voice presets", () => {
  test("every preset is a usable http(s) endpoint with a model, and speech presets name a voice", () => {
    for (const p of [...STT_PRESETS, ...TTS_PRESETS]) {
      expect(() => new URL(p.baseUrl)).not.toThrow();
      expect(p.model).not.toBe("");
    }
    for (const p of TTS_PRESETS) expect(p.voice).not.toBe("");
  });

  test("presetFor matches by URL ignoring trailing slashes; custom is undefined", () => {
    expect(presetFor(TTS_PRESETS, "http://localhost:8880/v1/")?.id).toBe("kokoro");
    expect(presetFor(STT_PRESETS, "http://elsewhere:9/v1")).toBeUndefined();
  });

  test("leavesThisMachine: loopback stays, anything else leaves", () => {
    expect(leavesThisMachine("http://localhost:8000/v1")).toBe(false);
    expect(leavesThisMachine("http://127.0.0.1:8080/v1")).toBe(false);
    expect(leavesThisMachine("https://api.openai.com/v1")).toBe(true);
    expect(leavesThisMachine("http://192.168.1.20:8000/v1")).toBe(true);
    expect(leavesThisMachine("garbage")).toBe(false);
  });
});
