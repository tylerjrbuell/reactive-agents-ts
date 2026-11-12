import { describe, expect, test } from "bun:test";
import { createReadAloud, type TtsEngine, type TtsHandlers, type TtsSpeakOptions } from "../src/index.js";

interface Spoken {
  text: string;
  opts: TtsSpeakOptions;
  h: TtsHandlers;
  cancelled: boolean;
  paused: boolean;
}

function fakeTts(available = true): { engine: TtsEngine; spoken: Spoken[]; prefetched: string[] } {
  const spoken: Spoken[] = [];
  const prefetched: string[] = [];
  const engine: TtsEngine = {
    id: "fake",
    label: "Fake",
    available: () => (available ? { ok: true } : { ok: false, reason: "No voice here" }),
    voices: async () => [],
    prefetch: (t) => void prefetched.push(t),
    speak(text, opts, h) {
      const s: Spoken = { text, opts, h, cancelled: false, paused: false };
      spoken.push(s);
      return {
        pause: () => (s.paused = true),
        resume: () => (s.paused = false),
        cancel: () => (s.cancelled = true),
      };
    },
  };
  return { engine, spoken, prefetched };
}

describe("createReadAloud", () => {
  test("speaks sentence by sentence and finishes once", () => {
    const { engine, spoken } = fakeTts();
    let finished = 0;
    const r = createReadAloud({ engine: () => engine });
    expect(r.play("t1", "One. Two. Three.", { onFinish: () => (finished += 1) })).toBe(true);
    expect(r.get().status).toBe("loading");
    spoken[0]!.h.onStart?.();
    expect(r.get().status).toBe("playing");
    spoken[0]!.h.onEnd();
    expect(spoken.map((s) => s.text)).toEqual(["One.", "Two."]);
    expect(r.get().index).toBe(1);
    spoken[1]!.h.onEnd();
    spoken[2]!.h.onEnd();
    expect(finished).toBe(1);
    expect(r.get().status).toBe("idle");
  });

  test("code blocks are announced, not spoken", () => {
    const { engine, spoken } = fakeTts();
    const r = createReadAloud({ engine: () => engine });
    r.play("t", "Use this.\n\n```js\nsecret();\n```");
    spoken[0]!.h.onEnd();
    expect(spoken[1]!.text).toBe("Code block in js, 1 line.");
  });

  test("pause and resume reach the engine and the state", () => {
    const { engine, spoken } = fakeTts();
    const r = createReadAloud({ engine: () => engine });
    r.play("t", "One. Two.");
    spoken[0]!.h.onStart?.();
    r.pause();
    expect(r.get().status).toBe("paused");
    expect(spoken[0]!.paused).toBe(true);
    r.resume();
    expect(r.get().status).toBe("playing");
    expect(spoken[0]!.paused).toBe(false);
  });

  test("stop cancels the sentence and a late end callback does nothing", () => {
    const { engine, spoken } = fakeTts();
    let finished = 0;
    const r = createReadAloud({ engine: () => engine });
    r.play("t", "One. Two.", { onFinish: () => (finished += 1) });
    r.stop();
    expect(spoken[0]!.cancelled).toBe(true);
    spoken[0]!.h.onEnd();
    expect(spoken.length).toBe(1);
    expect(finished).toBe(0);
    expect(r.get().status).toBe("idle");
  });

  test("starting a new reading replaces the old one", () => {
    const { engine, spoken } = fakeTts();
    const r = createReadAloud({ engine: () => engine });
    r.play("a", "First text.");
    r.play("b", "Second text.");
    expect(spoken[0]!.cancelled).toBe(true);
    expect(r.get().sourceId).toBe("b");
    spoken[0]!.h.onEnd(); // stale
    expect(spoken.length).toBe(2);
  });

  test("seek jumps to a sentence; refresh re-speaks the current one with the new rate", () => {
    const { engine, spoken } = fakeTts();
    let rate = 1;
    const r = createReadAloud({ engine: () => engine, rate: () => rate });
    r.play("t", "A one. B two. C three.");
    r.seek(2);
    expect(spoken.at(-1)!.text).toBe("C three.");
    rate = 1.5;
    r.refresh();
    expect(spoken.at(-1)!.text).toBe("C three.");
    expect(spoken.at(-1)!.opts.rate).toBe(1.5);
    r.seek(99);
    expect(r.get().index).toBe(2);
  });

  test("passes voice and prefetches the sentences ahead", () => {
    const { engine, spoken, prefetched } = fakeTts();
    const r = createReadAloud({ engine: () => engine, voice: () => "af_bella", prefetchAhead: 2 });
    r.play("t", "One. Two. Three. Four.");
    expect(spoken[0]!.opts.voice).toBe("af_bella");
    expect(prefetched).toEqual(["Two.", "Three."]);
  });

  test("nothing speakable is an error, not silence", () => {
    const { engine, spoken } = fakeTts();
    const r = createReadAloud({ engine: () => engine });
    expect(r.play("t", "---")).toBe(false);
    expect(r.get().status).toBe("error");
    expect(spoken.length).toBe(0);
  });

  test("an unavailable engine reports its reason through state and onError", () => {
    const { engine } = fakeTts(false);
    let msg = "";
    const r = createReadAloud({ engine: () => engine });
    expect(r.play("t", "Hello there.", { onError: (e) => (msg = e.message) })).toBe(false);
    expect(msg).toBe("No voice here");
    expect(r.get().error?.kind).toBe("unsupported");
  });

  test("an engine error stops the reading and reports it", () => {
    const { engine, spoken } = fakeTts();
    let msg = "";
    const r = createReadAloud({ engine: () => engine });
    r.play("t", "One. Two.", { onError: (e) => (msg = e.message) });
    spoken[0]!.h.onError({ kind: "server", message: "HTTP 500" });
    expect(msg).toBe("HTTP 500");
    expect(r.get().status).toBe("error");
    expect(spoken.length).toBe(1);
  });
});
