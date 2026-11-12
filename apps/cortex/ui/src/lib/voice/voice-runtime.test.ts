import { describe, expect, test } from "bun:test";
import { get } from "svelte/store";
import { createVoiceRuntime } from "./voice-runtime.js";
import { VOICE_PREFS_KEY } from "./voice-prefs.js";
import { VOICE_TEST_TEXT } from "./voice-text.js";

/** A browser that can speak (synthesis records what it was asked to say). */
function browser() {
  const spoken: Array<{ text: string; rate: number; voiceName: string | null; cancelled: boolean }> = [];
  class Utterance {
    voice: { name: string; lang: string } | null = null;
    rate = 1;
    lang = "";
    onstart: (() => void) | null = null;
    onend: (() => void) | null = null;
    onerror: (() => void) | null = null;
    constructor(readonly text: string) {}
  }
  const utterances: Utterance[] = [];
  const synth = {
    getVoices: () => [{ name: "Alex", lang: "en-US" }],
    speak: (u: Utterance) => {
      utterances.push(u);
      spoken.push({ text: u.text, rate: u.rate, voiceName: u.voice?.name ?? null, cancelled: false });
    },
    cancel: () => void (spoken.at(-1)!.cancelled = true),
    pause() {},
    resume() {},
  };
  return { win: { speechSynthesis: synth, SpeechSynthesisUtterance: Utterance }, spoken, utterances };
}

const store = () => {
  const data = new Map<string, string>();
  return { data, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
};

function runtime(fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>) {
  const b = browser();
  const s = store();
  const rt = createVoiceRuntime({
    win: b.win,
    base: "http://c",
    fetch: fetchImpl ?? (async () => new Response(JSON.stringify({ settings: { stt: { engine: "browser" }, tts: { engine: "browser" } } }))),
    storage: s,
  });
  return { rt, b, s };
}

describe("voice runtime", () => {
  test("starts on browser engines, loads the server's settings", async () => {
    const { rt } = runtime(async () => new Response(JSON.stringify({ settings: { tts: { engine: "server", baseUrl: "http://k/v1", model: "kokoro", voice: "af_bella" } } })));
    expect(get(rt.settings).tts.engine).toBe("browser");
    await rt.load();
    expect(get(rt.settings).tts).toMatchObject({ engine: "server", voice: "af_bella" });
  });

  test("a failed load keeps the defaults; a failed save reports and keeps the old settings", async () => {
    const { rt } = runtime(async () => new Response(JSON.stringify({ error: "down" }), { status: 500 }));
    await rt.load();
    expect(get(rt.settings).stt.engine).toBe("browser");
    expect(await rt.save({ stt: { engine: "server" } })).toEqual({ ok: false, error: "down" });
    expect(get(rt.settings).stt.engine).toBe("browser");
  });

  test("toggleRead reads, and the same source again stops it", () => {
    const { rt, b } = runtime();
    rt.toggleRead("turn-1", "First sentence. Second sentence.");
    expect(b.spoken[0]?.text).toBe("First sentence.");
    expect(get(rt.readerState).sourceId).toBe("turn-1");
    rt.toggleRead("turn-1", "First sentence. Second sentence.");
    expect(get(rt.readerState).status).toBe("idle");
    expect(b.spoken[0]?.cancelled).toBe(true);
  });

  test("reading another source replaces the first", () => {
    const { rt, b } = runtime();
    rt.toggleRead("a", "Alpha text.");
    rt.toggleRead("b", "Beta text.");
    expect(b.spoken.map((x) => x.text)).toEqual(["Alpha text.", "Beta text."]);
    expect(get(rt.readerState).sourceId).toBe("b");
  });

  test("a Settings Test click speaks once; a second click stops it; a reply read while it plays replaces it", () => {
    const { rt, b } = runtime();
    rt.toggleRead("voice-test", VOICE_TEST_TEXT);
    expect(b.spoken.length).toBe(1);
    rt.toggleRead("voice-test", VOICE_TEST_TEXT);
    expect(b.spoken.length).toBe(1);
    expect(get(rt.readerState).status).toBe("idle");
    expect(b.spoken[0]?.cancelled).toBe(true);
    rt.toggleRead("voice-test", VOICE_TEST_TEXT);
    rt.toggleRead("turn-9", "A reply.");
    expect(b.spoken.map((x) => x.text).slice(-1)).toEqual(["A reply."]);
    expect(get(rt.readerState).sourceId).toBe("turn-9");
  });

  test("a second runtime (remount, HMR) cannot speak over the first", () => {
    const one = runtime();
    const two = runtime();
    one.rt.toggleRead("a", "Alpha text.");
    two.rt.toggleRead("b", "Beta text.");
    expect(one.b.spoken[0]?.cancelled).toBe(true);
    expect(get(one.rt.readerState).status).toBe("idle");
    expect(get(two.rt.readerState).sourceId).toBe("b");
  });

  test("speed and voice prefs persist and apply to the sentence being read", () => {
    const { rt, b, s } = runtime();
    rt.toggleRead("t", "Speak this slowly.");
    rt.setPrefs({ rate: 1.5 });
    expect(b.spoken.at(-1)?.rate).toBe(1.5);
    rt.setPrefs({ browserVoice: "Alex" });
    expect(b.spoken.at(-1)?.voiceName).toBe("Alex");
    expect(JSON.parse(s.data.get(VOICE_PREFS_KEY) ?? "{}")).toMatchObject({ rate: 1.5, browserVoice: "Alex" });
  });

  test("readTranscript speaks who said what", () => {
    const { rt, b } = runtime();
    rt.readTranscript([{ role: "user", content: "Hello" }, { role: "assistant", content: "Hi back" }]);
    expect(b.spoken[0]?.text).toBe("You said.");
    expect(get(rt.readerState).sourceId).toBe("transcript");
    expect(get(rt.readerState).chunks.map((c) => c.text)).toEqual(["You said.", "Hello", "The agent replied.", "Hi back"]);
  });

  test("an empty transcript reports an error instead of speaking", () => {
    const { rt, b } = runtime();
    rt.readTranscript([]);
    expect(b.spoken.length).toBe(0);
    expect(get(rt.readerState).status).toBe("error");
  });

  test("voice mode is built once over the latest chat hooks and starts idle", () => {
    const { rt } = runtime();
    expect(get(rt.modeState).phase).toBe("idle");
    const sent: string[] = [];
    const a = rt.voiceMode({ send: (t) => void sent.push(`a:${t}`), stopRun: () => undefined });
    const b = rt.voiceMode({ send: (t) => void sent.push(`b:${t}`), stopRun: () => undefined });
    expect(a).toBe(b);
    rt.dispatchMode({ type: "settings", autoSpeak: false });
    expect(get(rt.modeState).autoSpeak).toBe(false);
  });
});
