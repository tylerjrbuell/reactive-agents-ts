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
