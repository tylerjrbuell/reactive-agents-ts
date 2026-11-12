import { describe, expect, test } from "bun:test";
import {
  IDLE_VOICE_QUESTION,
  MAX_QUESTION_SILENCES,
  questionSpeech,
  readBackSpeech,
  voiceQuestionReduce,
  type VoiceQuestion,
  type VoiceQuestionEffect,
  type VoiceQuestionEvent,
  type VoiceQuestionState,
} from "./voice-question.js";

const ENV: VoiceQuestion = { id: "q1", prompt: "Which environment?", spec: { kind: "choice", options: ["Staging", "Production"] } };
const FREE: VoiceQuestion = { id: "q2", prompt: "What should I call it?", spec: { kind: "text" } };

/** Run events in order; returns the final state and every effect. */
function run(events: readonly VoiceQuestionEvent[], from: VoiceQuestionState = IDLE_VOICE_QUESTION) {
  let state = from;
  const effects: VoiceQuestionEffect[] = [];
  for (const e of events) {
    const step = voiceQuestionReduce(state, e);
    state = step.state;
    effects.push(...step.effects);
  }
  return { state, effects };
}
const types = (effects: readonly VoiceQuestionEffect[]) => effects.map((e) => e.type);
const heard = (text: string, autoSend = false): VoiceQuestionEvent => ({ type: "heard", text, autoSend });

describe("voiceQuestionReduce", () => {
  test("ask reads the question with its options, then listens", () => {
    const a = run([{ type: "ask", question: ENV }]);
    expect(a.state.phase).toBe("speaking");
    expect(a.effects).toEqual([{ type: "speak", text: questionSpeech(ENV) }]);
    expect(questionSpeech(ENV)).toContain("1, Staging. 2, Production");
    const b = run([{ type: "spoken" }], a.state);
    expect(b.state.phase).toBe("listening");
    expect(types(b.effects)).toEqual(["listen"]);
  });

  test("asking the question already open changes nothing; a new one replaces it", () => {
    const a = run([{ type: "ask", question: ENV }]);
    const same = voiceQuestionReduce(a.state, { type: "ask", question: ENV });
    expect(same.state).toBe(a.state);
    expect(same.effects).toEqual([]);
    const other = voiceQuestionReduce(a.state, { type: "ask", question: FREE });
    expect(other.state.phase).toBe("speaking");
    expect(types(other.effects)).toEqual(["stop-listening", "cancel-speech", "speak"]);
  });

  test("a spoken choice is read back and waits; nothing is sent yet", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("the second one")]);
    expect(r.state.phase).toBe("speaking");
    expect(types(r.effects)).not.toContain("send");
    expect(r.effects.at(-1)).toEqual({ type: "speak", text: readBackSpeech("Production") });
    if (r.state.phase === "speaking") expect(r.state.pending?.value).toBe("Production");
  });

  test("'send it' after the read-back sends the pending answer", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("production"), { type: "spoken" }, heard("send it")]);
    expect(r.state.phase).toBe("sending");
    expect(r.effects.at(-1)).toEqual({ type: "send", question: ENV, value: "Production" });
  });

  test("'no' after the read-back drops it and asks again", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("production"), { type: "spoken" }, heard("no")]);
    expect(r.state.phase).toBe("speaking");
    if (r.state.phase === "speaking") expect(r.state.pending).toBeNull();
    expect(types(r.effects)).not.toContain("send");
  });

  test("a different answer at the read-back replaces the pending one", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("production"), { type: "spoken" }, heard("staging")]);
    if (r.state.phase === "speaking") expect(r.state.pending?.value).toBe("Staging");
    expect(types(r.effects)).not.toContain("send");
  });

  test("an explicit confirm phrase sends at once", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("option b, send it")]);
    expect(r.state.phase).toBe("sending");
    expect(r.effects.at(-1)).toEqual({ type: "send", question: ENV, value: "Production" });
  });

  test("free text waits for confirmation unless Send when I stop talking is on", () => {
    const wait = run([{ type: "ask", question: FREE }, { type: "spoken" }, heard("Atlas")]);
    expect(wait.state.phase).toBe("speaking");
    expect(types(wait.effects)).not.toContain("send");
    const auto = run([{ type: "ask", question: FREE }, { type: "spoken" }, heard("Atlas", true)]);
    expect(auto.state.phase).toBe("sending");
    expect(auto.effects.at(-1)).toEqual({ type: "send", question: FREE, value: "Atlas" });
  });

  test("auto-send never applies to a choice or a yes/no", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("staging", true)]);
    expect(r.state.phase).toBe("speaking");
    expect(types(r.effects)).not.toContain("send");
  });

  test("an ambiguous or unrecognised answer asks to repeat and keeps nothing", () => {
    const amb: VoiceQuestion = { id: "q3", prompt: "Which?", spec: { kind: "choice", options: ["Production", "Prod EU"] } };
    const a = run([{ type: "ask", question: amb }, { type: "spoken" }, heard("prod")]);
    expect(a.state.phase).toBe("speaking");
    expect(a.effects.at(-1)).toEqual({ type: "speak", text: "That could be Production or Prod EU. Which one?" });
    const n = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("banana")]);
    expect(n.effects.at(-1)).toMatchObject({ type: "speak" });
    expect(types(n.effects)).not.toContain("send");
  });

  test("the Send button sends the pending answer; without one it does nothing", () => {
    const base = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("staging"), { type: "spoken" }]);
    const sent = voiceQuestionReduce(base.state, { type: "confirm" });
    expect(sent.state.phase).toBe("sending");
    expect(sent.effects.at(-1)).toEqual({ type: "send", question: ENV, value: "Staging" });
    const none = run([{ type: "ask", question: ENV }, { type: "spoken" }, { type: "confirm" }]);
    expect(none.state.phase).toBe("listening");
    expect(types(none.effects)).not.toContain("send");
  });

  test("typed text sent with the button goes through the matcher and sends", () => {
    const ok = run([{ type: "ask", question: ENV }, { type: "spoken" }, { type: "submit-text", text: "production" }]);
    expect(ok.effects.at(-1)).toEqual({ type: "send", question: ENV, value: "Production" });
    const bad = run([{ type: "ask", question: ENV }, { type: "spoken" }, { type: "submit-text", text: "banana" }]);
    expect(bad.state.phase).toBe("listening");
    if (bad.state.phase === "listening") expect(bad.state.notice).toContain("not an answer");
  });

  test("Say it again clears the pending answer and listens", () => {
    const r = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("staging"), { type: "retry" }]);
    expect(r.state.phase).toBe("listening");
    if (r.state.phase === "listening") expect(r.state.pending).toBeNull();
    expect(types(r.effects).slice(-3)).toEqual(["stop-listening", "cancel-speech", "listen"]);
  });

  test("a quiet listen listens again, and enough of them give up", () => {
    let s = run([{ type: "ask", question: ENV }, { type: "spoken" }]).state;
    for (let i = 0; i < MAX_QUESTION_SILENCES - 1; i += 1) {
      const step = voiceQuestionReduce(s, { type: "silence" });
      expect(types(step.effects)).toEqual(["listen"]);
      s = step.state;
    }
    const last = voiceQuestionReduce(s, { type: "silence" });
    expect(last.state.phase).toBe("idle");
    if (last.state.phase === "idle") expect(last.state.notice).toContain("Answer in the thread");
  });

  test("sent returns to idle; a failed send says why and leaves the card to the person", () => {
    const sending = run([{ type: "ask", question: ENV }, { type: "spoken" }, heard("staging, confirm")]).state;
    expect(voiceQuestionReduce(sending, { type: "sent" }).state).toEqual(IDLE_VOICE_QUESTION);
    const failed = voiceQuestionReduce(sending, { type: "send-failed", message: "no longer waiting" }).state;
    expect(failed.phase).toBe("idle");
    if (failed.phase === "idle") expect(failed.notice).toContain("no longer waiting");
  });

  test("cancel and a mic error stop everything; a speech failure still listens", () => {
    const open = run([{ type: "ask", question: ENV }, { type: "spoken" }]).state;
    const c = voiceQuestionReduce(open, { type: "cancel" });
    expect(c.state).toEqual(IDLE_VOICE_QUESTION);
    expect(types(c.effects)).toEqual(["stop-listening", "cancel-speech"]);
    const m = voiceQuestionReduce(open, { type: "mic-error", message: "no mic" });
    expect(m.state).toEqual({ phase: "idle", notice: "no mic" });
    const f = run([{ type: "ask", question: ENV }, { type: "speech-failed", message: "no voice" }]);
    expect(f.state.phase).toBe("listening");
    expect(types(f.effects).at(-1)).toBe("listen");
  });

  test("events for a flow that is not running do nothing", () => {
    for (const e of [{ type: "spoken" }, heard("yes"), { type: "silence" }, { type: "confirm" }, { type: "retry" }, { type: "sent" }, { type: "cancel" }] as const) {
      const step = voiceQuestionReduce(IDLE_VOICE_QUESTION, e);
      expect(step.state).toBe(IDLE_VOICE_QUESTION);
      expect(step.effects).toEqual([]);
    }
  });

  test("a long answer is acknowledged, not read word for word", () => {
    expect(readBackSpeech("x".repeat(300))).toContain("your answer");
    expect(readBackSpeech("Staging")).toContain("Staging");
  });
});
