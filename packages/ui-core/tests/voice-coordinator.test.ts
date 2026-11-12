import { describe, expect, test } from "bun:test";
import {
  createBrowserTts,
  createReadAloud,
  createRemoteTts,
  createSpeechCoordinator,
  exclusive,
  sharedSpeechCoordinator,
  type AudioLike,
  type SynthLike,
  type TtsEngine,
  type TtsHandlers,
  type UtteranceLike,
} from "../src/index.js";

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/** A fake engine whose utterances the test ends by hand. */
function fakeEngine() {
  const live: Array<{ text: string; h: TtsHandlers; cancels: number }> = [];
  const engine: TtsEngine = {
    id: "fake",
    label: "Fake",
    available: () => ({ ok: true }),
    voices: async () => [],
    speak(text, _o, h) {
      const u = { text, h, cancels: 0 };
      live.push(u);
      return { pause: () => undefined, resume: () => undefined, cancel: () => void (u.cancels += 1) };
    },
  };
  return { engine, live };
}

describe("a multi-sentence reading is strictly sequential", () => {
  const TEXT = "Cortex voice test. This is how replies will sound. And a third sentence.";

  test("remote engine: one play at a time, chunk N+1 starts only after chunk N ended", async () => {
    const log: string[] = [];
    let playing = 0;
    let overlap = false;
    const audios: Array<{ onended: (() => void) | null; id: number }> = [];
    class Audio implements AudioLike {
      onended: AudioLike["onended"] = null;
      onerror: AudioLike["onerror"] = null;
      onplaying: AudioLike["onplaying"] = null;
      id = audios.length;
      constructor() {
        audios.push(this);
      }
      async play() {
        playing += 1;
        if (playing > 1) overlap = true;
        log.push(`play${this.id}`);
        this.onplaying?.();
      }
      pause() {
        if (playing > 0) playing -= 1;
      }
    }
    const remote = createRemoteTts({
      speakUrl: "/s",
      voicesUrl: "/v",
      fetch: async () => new Response(new Blob(["a"])),
      createAudio: () => new Audio(),
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
    });
    const reader = createReadAloud({ engine: () => remote });
    reader.play("voice-test", TEXT);
    await tick();
    await tick();
    expect(log).toEqual(["play0"]);
    for (let i = 0; i < 3; i += 1) {
      playing -= 1; // the sentence finishes playing, then its element reports the end
      audios[i]!.onended?.();
      await tick();
      await tick();
    }
    expect(log).toEqual(["play0", "play1", "play2"]);
    expect(overlap).toBe(false);
    expect(reader.get().status).toBe("idle");
  });

  test("browser engine: speechSynthesis never holds two utterances; the next speaks on the previous end", () => {
    const queue: UtteranceLike[] = [];
    let live = 0;
    let overlap = false;
    const synth: SynthLike = {
      speak: (u) => {
        live += 1;
        if (live > 1) overlap = true;
        queue.push(u);
        u.onstart?.();
      },
      cancel: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      getVoices: () => [],
    };
    const browser = createBrowserTts(synth, () => ({ voice: null, rate: 1, lang: "", onstart: null, onend: null, onerror: null }));
    const reader = createReadAloud({ engine: () => browser });
    reader.play("voice-test", TEXT);
    expect(queue.length).toBe(1);
    for (let i = 0; i < 3; i += 1) {
      live -= 1;
      queue[i]!.onend?.();
    }
    expect(queue.length).toBe(3);
    expect(overlap).toBe(false);
    expect(reader.get().status).toBe("idle");
  });
});

describe("duplicate and stale engine events never advance the queue twice", () => {
  const TEXT = "One sentence here. Two sentences here. Three sentences here.";

  test("reader: onEnd twice for one chunk starts one next chunk; a stale handle's callbacks are ignored", () => {
    const calls: Array<{ text: string; h: TtsHandlers; cancels: number }> = [];
    const raw: TtsEngine = {
      id: "raw",
      label: "Raw (no coordinator)",
      available: () => ({ ok: true }),
      voices: async () => [],
      speak(text, _o, h) {
        const c = { text, h, cancels: 0 };
        calls.push(c);
        return { pause: () => undefined, resume: () => undefined, cancel: () => void (c.cancels += 1) };
      },
    };
    const reader = createReadAloud({ engine: () => raw });
    reader.play("t", TEXT);
    calls[0]!.h.onEnd();
    calls[0]!.h.onEnd();
    expect(calls.length).toBe(2);
    reader.stop();
    calls[1]!.h.onEnd();
    calls[0]!.h.onEnd();
    expect(calls.length).toBe(2);
    expect(reader.get().status).toBe("idle");
  });

  test("browser engine: end then error (or end twice) settles once", () => {
    const queue: UtteranceLike[] = [];
    const synth: SynthLike = { speak: (u) => void queue.push(u), cancel: () => undefined, pause: () => undefined, resume: () => undefined, getVoices: () => [] };
    const browser = createBrowserTts(synth, () => ({ voice: null, rate: 1, lang: "", onstart: null, onend: null, onerror: null }));
    const events: string[] = [];
    browser.speak("x", {}, { onEnd: () => events.push("end"), onError: () => events.push("error") });
    queue[0]!.onend?.();
    queue[0]!.onend?.();
    queue[0]!.onerror?.({ error: "synthesis-failed" });
    expect(events).toEqual(["end"]);
  });
});

describe("no play() rejection is ever unhandled", () => {
  /** An element like a browser's: play() stays pending until playing starts; pause() rejects a pending play() with AbortError. */
  function pendingAudio() {
    const audios: PendingAudio[] = [];
    class PendingAudio implements AudioLike {
      onended: AudioLike["onended"] = null;
      onerror: AudioLike["onerror"] = null;
      onplaying: AudioLike["onplaying"] = null;
      private reject: ((e: unknown) => void) | null = null;
      constructor() {
        audios.push(this);
      }
      play(): Promise<void> {
        return new Promise<void>((_resolve, reject) => {
          this.reject = reject;
        });
      }
      pause(): void {
        const r = this.reject;
        this.reject = null;
        r?.(Object.assign(new Error("The play() request was interrupted by a call to pause()."), { name: "AbortError" }));
      }
    }
    const remote = createRemoteTts({
      speakUrl: "/s",
      voicesUrl: "/v",
      fetch: async () => new Response(new Blob(["a"])),
      createAudio: () => new PendingAudio(),
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
      retryDelayMs: 0,
    });
    return { remote, audios };
  }

  async function withRejectionWatch(run: () => Promise<void>): Promise<unknown[]> {
    const seen: unknown[] = [];
    const on = (reason: unknown): void => void seen.push(reason);
    process.on("unhandledRejection", on);
    try {
      await run();
      await new Promise<void>((r) => setTimeout(r, 20));
    } finally {
      process.off("unhandledRejection", on);
    }
    return seen;
  }

  test("cancel during a pending play, rapid A->B->C, pause then resume, and stop", async () => {
    const seen = await withRejectionWatch(async () => {
      const { remote, audios } = pendingAudio();
      const h = { onEnd: () => undefined, onError: () => undefined };
      const reader = createReadAloud({ engine: () => remote });
      // cancel while play() is pending
      const one = remote.speak("one", {}, h);
      await tick();
      await tick();
      one.cancel();
      // rapid A -> B -> C
      remote.speak("A", {}, h);
      remote.speak("B", {}, h);
      remote.speak("C", {}, h);
      await tick();
      await tick();
      // pause then resume the one that is left, then stop through a reader
      const d = remote.speak("D", {}, h);
      await tick();
      await tick();
      d.pause();
      d.resume();
      reader.play("t", "First sentence here. Second sentence here.");
      await tick();
      await tick();
      reader.stop();
      reader.play("t2", "Another one. And another.");
      await tick();
      await tick();
      reader.stop();
      expect(audios.length).toBeGreaterThan(0);
    });
    expect(seen).toEqual([]);
  });

  test("a throwing callback inside the utterance is reported as a playback error, not an unhandled rejection", async () => {
    const seen = await withRejectionWatch(async () => {
      const { remote, audios } = pendingAudio();
      const errors: string[] = [];
      // A handler that throws while the interrupted play() is being settled (inside the async body).
      remote.speak("x", {}, {
        onEnd: () => undefined,
        onError: (e) => {
          errors.push(e.kind);
          throw new Error("handler blew up");
        },
      });
      await tick();
      await tick();
      audios[0]!.pause(); // an outside pause rejects the pending play(); the retry is paused again -> onError throws
      await tick();
      await new Promise<void>((r) => setTimeout(r, 5));
      audios[0]!.pause();
      await new Promise<void>((r) => setTimeout(r, 15));
      expect(errors).toEqual(["playback"]);
    });
    expect(seen).toEqual([]);
  });
});

describe("speech coordinator", () => {
  test("starting B while A plays cancels A exactly once and A's callbacks go inert", () => {
    const { engine, live } = fakeEngine();
    const ex = exclusive(engine, createSpeechCoordinator());
    const events: string[] = [];
    ex.speak("A", {}, { onStart: () => events.push("A:start"), onEnd: () => events.push("A:end"), onError: () => events.push("A:error"), onInterrupted: () => events.push("A:interrupted") });
    ex.speak("B", {}, { onEnd: () => events.push("B:end"), onError: () => events.push("B:error") });
    expect(live[0]!.cancels).toBe(1);
    live[0]!.h.onStart?.();
    live[0]!.h.onEnd();
    live[0]!.h.onError({ kind: "other", message: "late" });
    live[1]!.h.onEnd();
    expect(events).toEqual(["A:interrupted", "B:end"]);
    expect(live[0]!.cancels).toBe(1);
  });

  test("cancel is idempotent and frees the speaker", () => {
    const { engine, live } = fakeEngine();
    const coord = createSpeechCoordinator();
    const ex = exclusive(engine, coord);
    const h = ex.speak("A", {}, { onEnd: () => undefined, onError: () => undefined });
    expect(coord.isSpeaking()).toBe(true);
    h.cancel();
    h.cancel();
    expect(live[0]!.cancels).toBe(1);
    expect(coord.isSpeaking()).toBe(false);
    ex.speak("B", {}, { onEnd: () => undefined, onError: () => undefined });
    expect(live[0]!.cancels).toBe(1);
  });

  test("the end of one utterance chains the next without preempting itself", () => {
    const { engine, live } = fakeEngine();
    const ex = exclusive(engine, createSpeechCoordinator());
    const events: string[] = [];
    ex.speak("A", {}, { onEnd: () => ex.speak("B", {}, { onEnd: () => events.push("B"), onError: () => undefined }), onError: () => undefined });
    live[0]!.h.onEnd();
    live[1]!.h.onEnd();
    expect(events).toEqual(["B"]);
    expect(live[0]!.cancels + live[1]!.cancels).toBe(0);
  });

  test("two controllers share one owner: the first goes idle when the second plays, toggle off works", () => {
    const { engine, live } = fakeEngine();
    const shared = exclusive(engine, createSpeechCoordinator());
    const a = createReadAloud({ engine: () => shared });
    const b = createReadAloud({ engine: () => shared });
    a.play("reply-1", "First reply.");
    expect(a.get().status).toBe("loading");
    b.play("reply-2", "Second reply.");
    expect(a.get().status).toBe("idle");
    expect(a.get().sourceId).toBeNull();
    expect(b.get().sourceId).toBe("reply-2");
    expect(live[0]!.cancels).toBe(1);
    live[0]!.h.onEnd();
    expect(b.get().sourceId).toBe("reply-2");
    b.stop();
    expect(b.get().status).toBe("idle");
    expect(live[1]!.cancels).toBe(1);
  });

  test("a browser engine and a remote engine preempt each other (speechSynthesis and audio both cancelled)", async () => {
    const log: string[] = [];
    const spoken: UtteranceLike[] = [];
    const synth: SynthLike = {
      speak: (u) => void spoken.push(u),
      cancel: () => void log.push("synth.cancel"),
      pause: () => undefined,
      resume: () => undefined,
      getVoices: () => [],
    };
    const browser = createBrowserTts(synth, (): UtteranceLike => ({ rate: 1, lang: "", voice: null, onstart: null, onend: null, onerror: null }));
    class Audio implements AudioLike {
      onended: AudioLike["onended"] = null;
      onerror: AudioLike["onerror"] = null;
      onplaying: AudioLike["onplaying"] = null;
      async play() {
        log.push("audio.play");
      }
      pause() {
        log.push("audio.pause");
      }
    }
    const remote = createRemoteTts({
      speakUrl: "/s",
      voicesUrl: "/v",
      fetch: async () => new Response(new Blob(["a"])),
      createAudio: () => new Audio(),
      createObjectURL: () => "blob:x",
      revokeObjectURL: () => undefined,
    });
    // Both engines were built against the shared coordinator.
    const events: string[] = [];
    remote.speak("r", {}, { onEnd: () => events.push("r:end"), onError: () => events.push("r:err"), onInterrupted: () => events.push("r:int") });
    await tick();
    await tick();
    browser.speak("b", {}, { onEnd: () => events.push("b:end"), onError: () => events.push("b:err"), onInterrupted: () => events.push("b:int") });
    expect(log).toEqual(["audio.play", "audio.pause"]);
    expect(events).toEqual(["r:int"]);
    remote.speak("r2", {}, { onEnd: () => events.push("r2:end"), onError: () => undefined });
    expect(log.slice(2)).toEqual(["synth.cancel"]);
    expect(events).toEqual(["r:int", "b:int"]);
    sharedSpeechCoordinator().stopAll();
  });
});
