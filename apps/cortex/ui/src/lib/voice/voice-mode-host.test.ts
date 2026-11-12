import { describe, expect, test } from "bun:test";
import { createReadAloud, type SttEngine, type SttHandlers, type TtsEngine, type TtsHandlers } from "@reactive-agents/ui-core";
import { createVoiceModeHost } from "./voice-mode-host.js";

/** Listening and speaking engines the test drives by hand. */
function rig(opts: { sttAvailable?: boolean; ttsAvailable?: boolean } = {}) {
  const log: string[] = [];
  let listen: SttHandlers | null = null;
  const sessions: Array<{ stopped: number; aborted: number }> = [];
  const stt: SttEngine = {
    id: "stt",
    label: "stt",
    available: () => (opts.sttAvailable === false ? { ok: false, reason: "no mic" } : { ok: true }),
    start: (_o, h) => {
      const s = { stopped: 0, aborted: 0 };
      sessions.push(s);
      listen = h;
      log.push("mic-open");
      return {
        stop: () => {
          s.stopped += 1;
          h.onEnd();
        },
        abort: () => {
          s.aborted += 1;
          h.onEnd();
        },
      };
    },
  };
  const spoken: Array<{ text: string; h: TtsHandlers; cancelled: boolean }> = [];
  const tts: TtsEngine = {
    id: "tts",
    label: "tts",
    available: () => (opts.ttsAvailable === false ? { ok: false, reason: "no voice" } : { ok: true }),
    voices: async () => [],
    speak: (text, _o, h) => {
      const s = { text, h, cancelled: false };
      spoken.push(s);
      log.push(`speak:${text}`);
      return { pause() {}, resume() {}, cancel: () => (s.cancelled = true) };
    },
  };
  const sent: string[] = [];
  let stopRuns = 0;
  const reader = createReadAloud({ engine: () => tts });
  const host = createVoiceModeHost({
    engine: () => stt,
    language: () => "",
    silenceMs: () => 0,
    reader,
    send: (t) => void sent.push(t),
    stopRun: () => void (stopRuns += 1),
  });
  return { host, reader, log, sent, spoken, sessions, listen: () => listen as SttHandlers, stopRuns: () => stopRuns };
}

describe("voice mode host", () => {
  test("the whole loop: listen, hear, send, reply, speak, listen again", () => {
    const r = rig();
    r.host.dispatch({ type: "start" });
    expect(r.host.get().phase).toBe("listening");
    r.listen().onFinal?.("what is the status");
    r.listen().onEnd(); // the engine ends the utterance
    expect(r.sent).toEqual(["what is the status"]);
    expect(r.host.get().phase).toBe("thinking");

    r.host.dispatch({ type: "reply", text: "All **green**. Nothing to do." });
    expect(r.host.get().phase).toBe("speaking");
    expect(r.spoken[0]?.text).toBe("All green.");
    expect(r.log.filter((l) => l === "mic-open").length).toBe(2); // opened for barge-in while speaking

    r.spoken[0]!.h.onEnd();
    r.spoken[1]!.h.onEnd();
    expect(r.host.get().phase).toBe("listening");
  });

  test("barge-in: speech over the voice cancels the reading and is sent", () => {
    const r = rig();
    r.host.dispatch({ type: "start" });
    r.listen().onFinal?.("go");
    r.listen().onEnd();
    r.host.dispatch({ type: "reply", text: "The deploy finished without errors. More detail follows." });
    expect(r.host.get().phase).toBe("speaking");

    r.listen().onInterim?.("hold on a second");
    expect(r.spoken[0]!.cancelled).toBe(true);
    expect(r.host.get().phase).toBe("listening");
    expect(r.reader.get().status).toBe("idle");
    r.listen().onFinal?.("hold on a second");
    r.listen().onEnd();
    expect(r.sent).toEqual(["go", "hold on a second"]);
    expect(r.host.get().phase).toBe("thinking");
  });

  test("the voice's own echo does not interrupt itself, and the mic is reopened", () => {
    const r = rig();
    r.host.dispatch({ type: "start" });
    r.listen().onFinal?.("go");
    r.listen().onEnd();
    r.host.dispatch({ type: "reply", text: "The deploy finished without errors." });
    const opens = r.log.filter((l) => l === "mic-open").length;
    r.listen().onInterim?.("deploy finished without");
    r.listen().onFinal?.("deploy finished without");
    r.listen().onEnd();
    expect(r.host.get().phase).toBe("speaking");
    expect(r.spoken[0]!.cancelled).toBe(false);
    expect(r.log.filter((l) => l === "mic-open").length).toBe(opens + 1);
  });

  test("Stop is honoured from speaking: voice cancelled, mic closed, idle", () => {
    const r = rig();
    r.host.dispatch({ type: "start" });
    r.listen().onFinal?.("go");
    r.listen().onEnd();
    r.host.dispatch({ type: "reply", text: "Long answer here." });
    r.host.dispatch({ type: "stop" });
    expect(r.host.get().phase).toBe("idle");
    expect(r.spoken[0]!.cancelled).toBe(true);
    expect(r.sessions.at(-1)?.aborted).toBe(1);
  });

  test("Stop while thinking stops the running reply", () => {
    const r = rig();
    r.host.dispatch({ type: "start" });
    r.listen().onFinal?.("go");
    r.listen().onEnd();
    r.host.dispatch({ type: "stop" });
    expect(r.stopRuns()).toBe(1);
    expect(r.host.get().phase).toBe("idle");
  });

  test("an unavailable microphone pauses the mode with the reason", () => {
    const r = rig({ sttAvailable: false });
    r.host.dispatch({ type: "start" });
    expect(r.host.get().phase).toBe("error");
    expect(r.host.get().notice).toBe("no mic");
  });

  test("an unavailable voice does not kill the loop: it keeps listening and says why", () => {
    const r = rig({ ttsAvailable: false });
    r.host.dispatch({ type: "start" });
    r.listen().onFinal?.("go");
    r.listen().onEnd();
    r.host.dispatch({ type: "reply", text: "A reply to read." });
    expect(r.host.get().phase).toBe("listening");
    expect(r.host.get().notice).toBe("no voice");
  });

  test("an engine that ends with nothing heard is reopened", () => {
    const r = rig();
    r.host.dispatch({ type: "start" });
    r.listen().onEnd();
    expect(r.host.get().phase).toBe("listening");
    expect(r.sessions.length).toBe(2);
  });

  test("subscribers see each state once", () => {
    const r = rig();
    const phases: string[] = [];
    r.host.subscribe((s) => phases.push(s.phase));
    r.host.dispatch({ type: "start" });
    r.host.dispatch({ type: "stop" });
    expect(phases).toEqual(["idle", "listening", "idle"]);
  });
});
