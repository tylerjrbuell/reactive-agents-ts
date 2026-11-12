import { describe, expect, test } from "bun:test";
import {
  analyserProbe,
  createBrowserStt,
  createBrowserTts,
  createRemoteStt,
  createRemoteTts,
  recognitionError,
  rmsOf,
  type AudioContextLike,
  type AudioLike,
  type MediaStreamLike,
  type RecognitionLike,
  type RecognitionResultLike,
  type VoiceFetch,
  type RecorderLike,
  type SttError,
  type SynthLike,
  type SynthVoiceLike,
  type UtteranceLike,
} from "../src/index.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe("browser STT", () => {
  function setup() {
    const instances: FakeRec[] = [];
    class FakeRec implements RecognitionLike {
      lang = "";
      continuous = false;
      interimResults = false;
      onresult: RecognitionLike["onresult"] = null;
      onerror: RecognitionLike["onerror"] = null;
      onend: RecognitionLike["onend"] = null;
      started = false;
      stopped = false;
      aborted = false;
      constructor() {
        instances.push(this);
      }
      start() {
        this.started = true;
      }
      stop() {
        this.stopped = true;
        this.onend?.();
      }
      abort() {
        this.aborted = true;
        this.onend?.();
      }
    }
    return { engine: createBrowserStt(FakeRec), rec: () => instances[0]! };
  }
  const result = (text: string, isFinal: boolean): RecognitionResultLike => ({ isFinal, 0: { transcript: text } });

  test("is unavailable without a SpeechRecognition and says what to do", () => {
    const a = createBrowserStt(undefined).available();
    expect(a.ok).toBe(false);
    expect(a.ok === false && a.reason).toContain("Settings");
  });

  test("streams interim and final text, with continuous interim results and the language", () => {
    const { engine, rec } = setup();
    const interim: string[] = [];
    const finals: string[] = [];
    let activity = 0;
    engine.start({ language: "fr-FR" }, {
      onInterim: (t) => interim.push(t),
      onFinal: (t) => finals.push(t),
      onActivity: () => (activity += 1),
      onEnd: () => undefined,
    });
    expect(rec().continuous).toBe(true);
    expect(rec().interimResults).toBe(true);
    expect(rec().lang).toBe("fr-FR");
    rec().onresult?.({ resultIndex: 0, results: [result("bonjour le", false)] });
    rec().onresult?.({ resultIndex: 0, results: [result(" bonjour le monde ", true)] });
    expect(interim).toEqual(["bonjour le", ""]);
    expect(finals).toEqual(["bonjour le monde"]);
    expect(activity).toBe(2);
  });

  test("stop finishes through onEnd once; abort stops delivering", () => {
    const { engine, rec } = setup();
    let ends = 0;
    const got: string[] = [];
    const h = engine.start({}, { onFinal: (t) => got.push(t), onEnd: () => (ends += 1) });
    h.stop();
    expect(rec().stopped).toBe(true);
    expect(ends).toBe(1);
    h.abort();
    expect(ends).toBe(1);
  });

  test("error codes map to actionable messages; no-speech and aborted are not errors", () => {
    expect(recognitionError("not-allowed")?.kind).toBe("permission-denied");
    expect(recognitionError("audio-capture")?.kind).toBe("no-microphone");
    expect(recognitionError("network")?.message).toContain("Google");
    expect(recognitionError("no-speech")).toBeNull();
    expect(recognitionError("aborted")).toBeNull();
    expect(recognitionError("weird")?.kind).toBe("other");
    const { engine, rec } = setup();
    const errs: SttError[] = [];
    engine.start({}, { onError: (e) => errs.push(e), onEnd: () => undefined });
    rec().onerror?.({ error: "no-speech" });
    rec().onerror?.({ error: "not-allowed" });
    expect(errs.map((e) => e.kind)).toEqual(["permission-denied"]);
  });
});

describe("browser TTS", () => {
  function setup(voices: SynthVoiceLike[]) {
    const spoken: FakeUtterance[] = [];
    const calls: string[] = [];
    class FakeUtterance implements UtteranceLike {
      voice: SynthVoiceLike | null = null;
      rate = 1;
      lang = "";
      onstart: UtteranceLike["onstart"] = null;
      onend: UtteranceLike["onend"] = null;
      onerror: UtteranceLike["onerror"] = null;
      constructor(readonly text: string) {}
    }
    const synth: SynthLike = {
      getVoices: () => voices,
      speak: (u) => spoken.push(u as FakeUtterance),
      cancel: () => calls.push("cancel"),
      pause: () => calls.push("pause"),
      resume: () => calls.push("resume"),
    };
    return { engine: createBrowserTts(synth, (t) => new FakeUtterance(t), { voicesTimeoutMs: 5 }), spoken, calls };
  }

  test("unavailable without speechSynthesis", () => {
    expect(createBrowserTts(undefined, undefined).available().ok).toBe(false);
  });

  test("lists voices and marks the default", async () => {
    const { engine } = setup([{ name: "Alex", lang: "en-US", default: true }, { name: "Amélie", lang: "fr-CA" }]);
    const v = await engine.voices();
    expect(v.map((x) => x.id)).toEqual(["Alex", "Amélie"]);
    expect(v[0]?.isDefault).toBe(true);
  });

  test("voices that load late are awaited, then given up on", async () => {
    const { engine } = setup([]);
    expect(await engine.voices()).toEqual([]);
  });

  test("speaks with the chosen voice and a clamped rate, and reports start and end", () => {
    const alex: SynthVoiceLike = { name: "Alex", lang: "en-US" };
    const { engine, spoken } = setup([alex]);
    const events: string[] = [];
    engine.speak("Hello.", { voice: "Alex", rate: 9 }, { onStart: () => events.push("start"), onEnd: () => events.push("end"), onError: () => events.push("error") });
    const u = spoken[0]!;
    expect(u.voice).toBe(alex);
    expect(u.rate).toBe(2);
    u.onstart?.();
    u.onend?.();
    expect(events).toEqual(["start", "end"]);
  });

  test("cancel is silent: the interrupted error and a late end are swallowed", () => {
    const { engine, spoken, calls } = setup([]);
    const events: string[] = [];
    const h = engine.speak("Hello.", {}, { onEnd: () => events.push("end"), onError: () => events.push("error") });
    h.cancel();
    spoken[0]!.onerror?.({ error: "interrupted" });
    spoken[0]!.onend?.();
    expect(events).toEqual([]);
    expect(calls).toEqual(["cancel"]);
    const live = engine.speak("Again.", {}, { onEnd: () => events.push("end"), onError: () => events.push("error") });
    spoken[1]!.onerror?.({ error: "synthesis-failed" });
    live.pause();
    live.resume();
    expect(events).toEqual(["error"]);
    expect(calls).toEqual(["cancel", "pause", "resume"]);
  });
});

describe("remote STT", () => {
  function setup(opts: { probe?: (s: MediaStreamLike, onSound: () => void) => () => void; bytes?: number; res?: () => Response } = {}) {
    const stops: string[] = [];
    const stream: MediaStreamLike = { getTracks: () => [{ stop: () => stops.push("track") }] };
    const recorders: FakeRecorder[] = [];
    class FakeRecorder implements RecorderLike {
      mimeType = "audio/webm";
      ondataavailable: RecorderLike["ondataavailable"] = null;
      onstop: RecorderLike["onstop"] = null;
      onerror: RecorderLike["onerror"] = null;
      started = false;
      constructor(readonly s: MediaStreamLike) {
        recorders.push(this);
      }
      start() {
        this.started = true;
        const n = opts.bytes ?? 100;
        if (n > 0) this.ondataavailable?.({ data: new Blob([new Uint8Array(n)]) });
      }
      stop() {
        queueMicrotask(() => this.onstop?.());
      }
    }
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn: VoiceFetch = async (url, init = {}) => {
      requests.push({ url, init });
      return opts.res ? opts.res() : new Response(JSON.stringify({ text: " hello there " }), { status: 200 });
    };
    const engine = createRemoteStt({
      url: "/api/voice/transcribe",
      fetch: fetchFn,
      getUserMedia: async () => stream,
      Recorder: FakeRecorder,
      ...(opts.probe ? { probe: opts.probe } : {}),
    });
    return { engine, recorders, requests, stops };
  }

  test("records, uploads on stop with the recorded media type, and delivers the text", async () => {
    const { engine, requests, stops } = setup();
    const events: string[] = [];
    const h = engine.start({ language: "en-GB" }, {
      onProcessing: () => events.push("processing"),
      onFinal: (t) => events.push(`final:${t}`),
      onEnd: () => events.push("end"),
    });
    await tick();
    h.stop();
    await tick();
    await tick();
    expect(events).toEqual(["processing", "final:hello there", "end"]);
    expect(requests[0]?.url).toBe("/api/voice/transcribe?language=en-GB");
    expect((requests[0]?.init.headers as Record<string, string>)["content-type"]).toBe("audio/webm");
    expect(stops).toContain("track");
  });

  test("sound from the probe is reported as activity and the probe is disposed", async () => {
    let disposed = false;
    let sound: () => void = () => undefined;
    const { engine } = setup({
      probe: (_s, onSound) => {
        sound = onSound;
        return () => (disposed = true);
      },
    });
    let activity = 0;
    const h = engine.start({}, { onActivity: () => (activity += 1), onEnd: () => undefined });
    await tick();
    sound();
    sound();
    expect(activity).toBe(2);
    h.stop();
    await tick();
    expect(disposed).toBe(true);
  });

  test("a server error is reported with its message and the session still ends", async () => {
    const { engine } = setup({ res: () => new Response(JSON.stringify({ error: "model not found" }), { status: 502 }) });
    const events: string[] = [];
    const h = engine.start({}, { onError: (e) => events.push(`${e.kind}:${e.message}`), onEnd: () => events.push("end") });
    await tick();
    h.stop();
    await tick();
    await tick();
    expect(events).toEqual(["server:model not found", "end"]);
  });

  test("no audio recorded means no upload and no text", async () => {
    const { engine, requests } = setup({ bytes: 0 });
    const events: string[] = [];
    const h = engine.start({}, { onFinal: () => events.push("final"), onEnd: () => events.push("end") });
    await tick();
    h.stop();
    await tick();
    expect(requests.length).toBe(0);
    expect(events).toEqual(["end"]);
  });

  test("abort drops the audio without uploading", async () => {
    const { engine, requests, stops } = setup();
    const events: string[] = [];
    const h = engine.start({}, { onFinal: () => events.push("final"), onEnd: () => events.push("end") });
    await tick();
    h.abort();
    await tick();
    expect(requests.length).toBe(0);
    expect(events).toEqual(["end"]);
    expect(stops).toContain("track");
  });

  test("a blocked microphone is a permission error", async () => {
    const engine = createRemoteStt({
      url: "/t",
      fetch: async () => new Response("{}"),
      getUserMedia: async () => {
        throw Object.assign(new Error("denied"), { name: "NotAllowedError" });
      },
      Recorder: class {} as never,
    });
    const events: string[] = [];
    engine.start({}, { onError: (e) => events.push(e.kind), onEnd: () => events.push("end") });
    await tick();
    expect(events).toEqual(["permission-denied", "end"]);
  });

  test("a browser with no MediaRecorder is unavailable", () => {
    const engine = createRemoteStt({ url: "/t", fetch: fetch, getUserMedia: undefined, Recorder: undefined });
    expect(engine.available().ok).toBe(false);
  });
});

describe("remote TTS", () => {
  function setup(
    res: () => Response = () => new Response(new Blob(["audio"], { type: "audio/mpeg" }), { status: 200 }),
    playError?: () => unknown,
  ) {
    const audios: FakeAudio[] = [];
    const requests: Array<{ url: string; body: unknown }> = [];
    const revoked: string[] = [];
    class FakeAudio implements AudioLike {
      onended: AudioLike["onended"] = null;
      onerror: AudioLike["onerror"] = null;
      onplaying: AudioLike["onplaying"] = null;
      playing = false;
      constructor(readonly src: string) {
        audios.push(this);
      }
      async play() {
        if (playError !== undefined) throw playError();
        this.playing = true;
        this.onplaying?.();
      }
      pauses = 0;
      pause() {
        this.pauses += 1;
        this.playing = false;
      }
    }
    const fetchFn: VoiceFetch = async (url, init) => {
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.endsWith("/voices")) return new Response(JSON.stringify({ voices: [{ id: "nova", label: "Nova" }] }), { status: 200 });
      return res();
    };
    const engine = createRemoteTts({
      speakUrl: "/api/voice/speak",
      voicesUrl: "/api/voice/voices",
      fetch: fetchFn,
      createAudio: (src) => new FakeAudio(src),
      createObjectURL: () => "blob:test",
      revokeObjectURL: (u) => revoked.push(u),
    });
    return { engine, audios, requests, revoked };
  }

  test("posts the text, voice and speed, plays the audio, and ends when it ends", async () => {
    const { engine, audios, requests, revoked } = setup();
    const events: string[] = [];
    engine.speak("Hello there.", { voice: "nova", rate: 1.25 }, { onStart: () => events.push("start"), onEnd: () => events.push("end"), onError: (e) => events.push(e.message) });
    await tick();
    await tick();
    expect(requests[0]).toEqual({ url: "/api/voice/speak", body: { text: "Hello there.", voice: "nova", speed: 1.25 } });
    audios[0]!.onended?.();
    expect(events).toEqual(["start", "end"]);
    expect(revoked).toEqual(["blob:test"]);
  });

  test("prefetch fetches once and speak reuses it", async () => {
    const { engine, requests } = setup();
    engine.prefetch?.("Next one.", { rate: 1 });
    engine.speak("Next one.", { rate: 1 }, { onEnd: () => undefined, onError: () => undefined });
    await tick();
    await tick();
    expect(requests.filter((r) => r.url === "/api/voice/speak").length).toBe(1);
  });

  test("a server error is surfaced with the server's message", async () => {
    const { engine } = setup(() => new Response(JSON.stringify({ error: "Speech server returned 500" }), { status: 502 }));
    const errs: string[] = [];
    engine.speak("x", {}, { onEnd: () => undefined, onError: (e) => errs.push(`${e.kind}:${e.message}`) });
    await tick();
    await tick();
    expect(errs).toEqual(["server:Speech server returned 500"]);
  });

  test("cancel before the audio arrives plays nothing", async () => {
    const { engine, audios } = setup();
    const events: string[] = [];
    const h = engine.speak("x", {}, { onStart: () => events.push("start"), onEnd: () => events.push("end"), onError: () => events.push("error") });
    h.cancel();
    await tick();
    await tick();
    expect(audios.length).toBe(0);
    expect(events).toEqual([]);
  });

  test("an AbortError from a play() that is still sounding pauses the element and ends once, even if it later fires 'ended'", async () => {
    const { engine, audios } = setup(undefined, () => domError("AbortError", "interrupted"));
    const events: string[] = [];
    engine.speak("x", {}, { onEnd: () => events.push("end"), onError: (e) => events.push(`error:${e.message}`) });
    await tick();
    await tick();
    const a = audios[0]!;
    a.playing = true; // the element kept sounding despite the rejection
    expect(events).toEqual(["end"]);
    // The utterance is settled: it paused the element and dropped its handlers.
    expect(a.onended).toBeNull();
    a.onended?.();
    a.onerror?.();
    expect(events).toEqual(["end"]);
    expect(a.pauses).toBeGreaterThan(0);
  });

  test("ended then a stray error fire a single callback, and the element is silenced", async () => {
    const { engine, audios } = setup();
    const events: string[] = [];
    engine.speak("x", {}, { onEnd: () => events.push("end"), onError: () => events.push("error") });
    await tick();
    await tick();
    const a = audios[0]!;
    const ended = a.onended;
    const failed = a.onerror;
    ended?.();
    ended?.();
    failed?.();
    expect(events).toEqual(["end"]);
    expect(a.pauses).toBeGreaterThan(0);
  });

  const domError = (name: string, message: string): Error => Object.assign(new Error(message), { name });

  test("an interrupted play() (AbortError) is a normal stop: no error, the utterance ends", async () => {
    const { engine } = setup(undefined, () => domError("AbortError", "The play() request was interrupted because the media was removed from the document."));
    const events: string[] = [];
    engine.speak("x", {}, { onEnd: () => events.push("end"), onError: (e) => events.push(`error:${e.message}`) });
    await tick();
    await tick();
    expect(events).toEqual(["end"]);
  });

  test("an AbortError caused by a user pause stays silent and does not end the utterance", async () => {
    let handle: { pause(): void } | undefined;
    const { engine } = setup(undefined, () => {
      handle?.pause();
      return domError("AbortError", "interrupted by a call to pause()");
    });
    const events: string[] = [];
    handle = engine.speak("x", {}, { onEnd: () => events.push("end"), onError: (e) => events.push(`error:${e.message}`) });
    await tick();
    await tick();
    expect(events).toEqual([]);
  });

  test("an AbortError after cancel stays silent", async () => {
    let handle: { cancel(): void } | undefined;
    const { engine } = setup(undefined, () => {
      handle?.cancel();
      return domError("AbortError", "interrupted");
    });
    const events: string[] = [];
    handle = engine.speak("x", {}, { onEnd: () => events.push("end"), onError: (e) => events.push(`error:${e.message}`) });
    await tick();
    await tick();
    expect(events).toEqual([]);
  });

  test("a blocked autoplay is a specific playback error", async () => {
    const { engine } = setup(undefined, () => domError("NotAllowedError", "blocked"));
    const errs: string[] = [];
    engine.speak("x", {}, { onEnd: () => undefined, onError: (e) => errs.push(`${e.kind}:${e.message}`) });
    await tick();
    await tick();
    expect(errs).toEqual(["playback:The browser blocked audio until you interact with the page. Press play again."]);
  });

  test("another play() failure is a playback error, not 'could not reach Cortex'", async () => {
    const { engine } = setup(undefined, () => domError("NotSupportedError", "no supported source"));
    const errs: string[] = [];
    engine.speak("x", {}, { onEnd: () => undefined, onError: (e) => errs.push(`${e.kind}:${e.message}`) });
    await tick();
    await tick();
    expect(errs).toEqual(["playback:The audio could not be played."]);
  });

  test("a network failure still says Cortex could not be reached", async () => {
    const { engine } = setup(() => {
      throw new TypeError("Failed to fetch");
    });
    const errs: string[] = [];
    engine.speak("x", {}, { onEnd: () => undefined, onError: (e) => errs.push(`${e.kind}:${e.message}`) });
    await tick();
    await tick();
    expect(errs[0]).toStartWith("network:Could not reach Cortex for speech");
  });

  test("pause and resume drive the audio element; lists voices", async () => {
    const { engine, audios } = setup();
    const h = engine.speak("x", {}, { onEnd: () => undefined, onError: () => undefined });
    await tick();
    await tick();
    h.pause();
    expect(audios[0]!.playing).toBe(false);
    h.resume();
    await tick();
    expect(audios[0]!.playing).toBe(true);
    expect((await engine.voices()).map((v) => v.id)).toEqual(["nova"]);
  });
});

describe("level helpers", () => {
  test("rmsOf is 0 for silence and grows with amplitude", () => {
    expect(rmsOf(new Uint8Array(64).fill(128))).toBe(0);
    expect(rmsOf(new Uint8Array(64).fill(255))).toBeGreaterThan(0.9);
    expect(rmsOf([])).toBe(0);
  });

  test("analyserProbe reports sound only above the threshold and cleans up", () => {
    let level = 128;
    let closed = false;
    const ctx: AudioContextLike = {
      createMediaStreamSource: () => ({ connect: () => undefined }),
      createAnalyser: () => ({ fftSize: 0, getByteTimeDomainData: (a) => a.fill(level) }),
      close: async () => {
        closed = true;
      },
    };
    let poll: () => void = () => undefined;
    let cleared = false;
    const probe = analyserProbe(() => ctx, 0.02, (fn) => ((poll = fn), 1), () => (cleared = true));
    let sounds = 0;
    const dispose = probe({ getTracks: () => [] }, () => (sounds += 1));
    poll();
    expect(sounds).toBe(0);
    level = 200;
    poll();
    expect(sounds).toBe(1);
    dispose();
    expect(cleared).toBe(true);
    expect(closed).toBe(true);
  });
});
