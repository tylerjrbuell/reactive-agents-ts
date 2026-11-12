import { describe, expect, test } from "bun:test";
import { createReadAloud, type SttEngine, type SttHandlers, type TtsEngine, type TtsHandlers } from "@reactive-agents/ui-core";
import { createVoiceQuestionHost } from "./voice-question-host.js";
import type { VoiceQuestion } from "./voice-question.js";

const ENV: VoiceQuestion = { id: "q1", prompt: "Which environment?", spec: { kind: "choice", options: ["Staging", "Production"] } };

function rig(opts: { autoSend?: boolean; deliver?: "ok" | "fail" } = {}) {
  let listen: SttHandlers | null = null;
  let opens = 0;
  const stt: SttEngine = {
    id: "stt",
    label: "stt",
    available: () => ({ ok: true }),
    start: (_o, h) => {
      listen = h;
      opens += 1;
      return { stop: () => h.onEnd(), abort: () => h.onEnd() };
    },
  };
  const spoken: Array<{ text: string; h: TtsHandlers; cancelled: boolean; ended: boolean }> = [];
  const tts: TtsEngine = {
    id: "tts",
    label: "tts",
    available: () => ({ ok: true }),
    voices: async () => [],
    speak: (text, _o, h) => {
      const s = { text, h, cancelled: false, ended: false };
      spoken.push(s);
      return { pause() {}, resume() {}, cancel: () => (s.cancelled = true) };
    },
  };
  const delivered: unknown[] = [];
  const host = createVoiceQuestionHost({
    engine: () => stt,
    language: () => "",
    silenceMs: () => 0,
    reader: createReadAloud({ engine: () => tts }),
    autoSend: () => opts.autoSend === true,
    deliver: async (q, value) => {
      delivered.push([q.id, value]);
      return opts.deliver === "fail" ? { ok: false, error: "no longer waiting" } : { ok: true };
    },
  });
  /** Let everything being read finish (a reading is several sentences). */
  const finishSpeech = () => {
    for (let s = spoken.find((x) => !x.ended && !x.cancelled); s !== undefined; s = spoken.find((x) => !x.ended && !x.cancelled)) {
      s.ended = true;
      s.h.onEnd();
    }
  };
  const say = (text: string) => {
    listen?.onFinal?.(text);
    listen?.onEnd();
  };
  const allSpoken = () => spoken.map((s) => s.text).join(" ");
  return { host, spoken, delivered, opens: () => opens, say, finishSpeech, allSpoken };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("voice question host", () => {
  test("reads the question, listens after it, reads the answer back, sends on 'send it'", async () => {
    const r = rig();
    r.host.ask(ENV);
    expect(r.allSpoken()).toContain("Which environment?");
    expect(r.opens()).toBe(0); // the mic stays shut while the question is read
    r.finishSpeech();
    expect(r.host.get().phase).toBe("listening");
    expect(r.opens()).toBe(1);

    r.say("the second one");
    expect(r.allSpoken()).toContain("I heard: Production");
    expect(r.delivered).toEqual([]); // never sent without a confirm
    r.finishSpeech();
    expect(r.opens()).toBe(2);

    r.say("send it");
    expect(r.host.get().phase).toBe("sending");
    await tick();
    expect(r.delivered).toEqual([["q1", "Production"]]);
    expect(r.host.get().phase).toBe("idle");
  });

  test("an explicit confirm phrase in the answer sends without a read-back", async () => {
    const r = rig();
    r.host.ask(ENV);
    r.finishSpeech();
    const before = r.spoken.length;
    r.say("staging confirm");
    await tick();
    expect(r.delivered).toEqual([["q1", "Staging"]]);
    expect(r.spoken.length).toBe(before);
  });

  test("a failed delivery goes idle with the reason", async () => {
    const r = rig({ deliver: "fail" });
    r.host.ask(ENV);
    r.finishSpeech();
    r.say("staging send it");
    await tick();
    const s = r.host.get();
    expect(s.phase).toBe("idle");
    if (s.phase === "idle") expect(s.notice).toContain("no longer waiting");
  });

  test("cancel silences the question and closes the mic", () => {
    const r = rig();
    r.host.ask(ENV);
    r.host.dispatch({ type: "cancel" });
    expect(r.spoken.every((s) => s.cancelled || s.ended)).toBe(true);
    expect(r.host.get().phase).toBe("idle");
  });

  test("free text with Send when I stop talking on goes out after the quiet period", async () => {
    const r = rig({ autoSend: true });
    r.host.ask({ id: "q2", prompt: "Name?", spec: { kind: "text" } });
    r.finishSpeech();
    r.say("Atlas");
    await tick();
    expect(r.delivered).toEqual([["q2", "Atlas"]]);
  });

  test("free text without it is read back and waits", async () => {
    const r = rig();
    r.host.ask({ id: "q2", prompt: "Name?", spec: { kind: "text" } });
    r.finishSpeech();
    r.say("Atlas");
    await tick();
    expect(r.delivered).toEqual([]);
    expect(r.allSpoken()).toContain("I heard: Atlas");
  });
});
