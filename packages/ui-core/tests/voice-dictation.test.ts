import { describe, expect, test } from "bun:test";
import {
  applyDictation,
  createDictation,
  type DictationEnd,
  type SttEngine,
  type SttHandlers,
  type VoiceClock,
} from "../src/index.js";

describe("applyDictation", () => {
  test("inserts at the caret without touching the rest of the draft", () => {
    const r = applyDictation("Hello world", null, "brave new", 5);
    expect(r.text).toBe("Hello brave new world");
    expect(r.caret).toBe("Hello brave new".length);
  });

  test("each update replaces only its own earlier insertion", () => {
    const a = applyDictation("Fix the bug", null, "in", 3);
    const b = applyDictation(a.text, a.anchor, "in the parser", 0);
    expect(b.text).toBe("Fix in the parser the bug");
    const c = applyDictation(b.text, b.anchor, "", 0);
    expect(c.text).toBe("Fix the bug");
  });

  test("appends to an empty draft and to the end with one space", () => {
    expect(applyDictation("", null, "hi there", 0).text).toBe("hi there");
    expect(applyDictation("Done.", null, "next", 5).text).toBe("Done. next");
    expect(applyDictation("Done. ", null, "next", 6).text).toBe("Done. next");
  });

  test("does not put a space before punctuation that follows", () => {
    expect(applyDictation("Hello, world", null, "there", 5).text).toBe("Hello there, world");
  });

  test("text typed over the insertion keeps it and starts a new one at the caret", () => {
    const a = applyDictation("one two", null, "mid", 3);
    const typed = a.text.replace("mid", "MID typed");
    const b = applyDictation(typed, a.anchor, "later", typed.length);
    expect(b.text.startsWith("one MID typed")).toBe(true);
    expect(b.text.endsWith("later")).toBe(true);
    expect(b.text).toContain("two");
  });

  test("a caret past the end is clamped", () => {
    expect(applyDictation("ab", null, "c", 99).text).toBe("ab c");
  });
});

/** An engine the test drives by hand. */
function fakeEngine(): { engine: SttEngine; h: () => SttHandlers; calls: { stop: number; abort: number; starts: Array<string | undefined> } } {
  let handlers: SttHandlers | null = null;
  const calls = { stop: 0, abort: 0, starts: [] as Array<string | undefined> };
  const engine: SttEngine = {
    id: "fake",
    label: "Fake",
    available: () => ({ ok: true }),
    start(opts, h) {
      handlers = h;
      calls.starts.push(opts.language);
      return {
        stop: () => {
          calls.stop += 1;
          h.onEnd();
        },
        abort: () => {
          calls.abort += 1;
          h.onEnd();
        },
      };
    },
  };
  return { engine, h: () => handlers as SttHandlers, calls };
}

/** A clock whose timers fire when the test advances it. */
function fakeClock(): VoiceClock & { advance(ms: number): void } {
  let t = 0;
  let id = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => t,
    setTimeout(fn, ms) {
      id += 1;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout(h) {
      timers.delete(h as number);
    },
    advance(ms) {
      t += ms;
      for (const [k, v] of [...timers]) {
        if (v.at <= t) {
          timers.delete(k);
          v.fn();
        }
      }
    },
  };
}

describe("createDictation", () => {
  test("collects finals and reports the running transcript", () => {
    const { engine, h } = fakeEngine();
    const seen: string[] = [];
    const d = createDictation({ engine: () => engine, onTranscript: (t) => seen.push(t) });
    d.start();
    h().onInterim?.("hel");
    h().onInterim?.("hello wor");
    h().onFinal?.("hello world");
    h().onInterim?.("second");
    expect(seen.at(-1)).toBe("hello world second");
    expect(d.get().status).toBe("listening");
  });

  test("an unavailable engine reports why and starts nothing", () => {
    const d = createDictation({
      engine: () => ({ id: "x", label: "X", available: () => ({ ok: false, reason: "No mic API" }), start: () => ({ stop() {}, abort() {} }) }),
    });
    d.start();
    expect(d.get().status).toBe("error");
    expect(d.get().error?.message).toBe("No mic API");
  });

  test("silence ends the session after the quiet period, only once something was heard", () => {
    const { engine, h, calls } = fakeEngine();
    const clock = fakeClock();
    const ends: Array<{ reason: DictationEnd; transcript: string }> = [];
    const d = createDictation({ engine: () => engine, clock, silenceMs: () => 1500, onEnd: (e) => ends.push(e) });
    d.start();
    clock.advance(5000);
    expect(calls.stop).toBe(0); // nothing heard yet: keep waiting
    h().onFinal?.("send this");
    clock.advance(1400);
    expect(calls.stop).toBe(0);
    h().onInterim?.("and"); // more speech resets the timer
    clock.advance(1400);
    expect(calls.stop).toBe(0);
    clock.advance(200);
    expect(calls.stop).toBe(1);
    expect(ends).toEqual([{ reason: "silence", transcript: "send this and" }]);
  });

  test("silenceMs 0 never stops on its own", () => {
    const { engine, h, calls } = fakeEngine();
    const clock = fakeClock();
    const d = createDictation({ engine: () => engine, clock, silenceMs: () => 0 });
    d.start();
    h().onFinal?.("x");
    clock.advance(60_000);
    expect(calls.stop).toBe(0);
  });

  test("stop delivers a phrase the engine never finalized", () => {
    const { engine, h } = fakeEngine();
    const ends: Array<{ reason: DictationEnd; transcript: string }> = [];
    const d = createDictation({ engine: () => engine, onEnd: (e) => ends.push(e) });
    d.start();
    h().onInterim?.("half said");
    d.stop();
    expect(ends).toEqual([{ reason: "stopped", transcript: "half said" }]);
    expect(d.get().status).toBe("idle");
  });

  test("abort drops the session and ignores late results", () => {
    const { engine, h, calls } = fakeEngine();
    const seen: string[] = [];
    const ends: DictationEnd[] = [];
    const d = createDictation({ engine: () => engine, onTranscript: (t) => seen.push(t), onEnd: (e) => ends.push(e.reason) });
    d.start();
    const late = h();
    d.abort();
    late.onFinal?.("too late");
    expect(calls.abort).toBe(1);
    expect(seen).toEqual([]);
    expect(ends).toEqual(["aborted"]);
    expect(d.get().status).toBe("idle");
  });

  test("an engine error keeps the error after the session ends", () => {
    const { engine, h } = fakeEngine();
    const ends: DictationEnd[] = [];
    const d = createDictation({ engine: () => engine, onEnd: (e) => ends.push(e.reason) });
    d.start();
    h().onError?.({ kind: "permission-denied", message: "blocked" });
    h().onEnd();
    expect(d.get().status).toBe("error");
    expect(d.get().error?.kind).toBe("permission-denied");
    expect(ends).toEqual(["error"]);
  });

  test("passes the language and ignores a second start while running; toggle stops", () => {
    const { engine, calls } = fakeEngine();
    const d = createDictation({ engine: () => engine, language: () => "de-DE" });
    d.start();
    d.start();
    expect(calls.starts).toEqual(["de-DE"]);
    d.toggle();
    expect(calls.stop).toBe(1);
    d.toggle();
    expect(calls.starts.length).toBe(2);
  });
});
