import { describe, expect, test } from "bun:test";
import { matchSpokenAnswer } from "./voice-answer.js";
import { IDLE_VOICE_QUESTION, voiceQuestionReduce, type VoiceQuestionEffect, type VoiceQuestionEvent, type VoiceQuestionState } from "./voice-question.js";
import { answerValueOf, createStructuredVoiceAnswers, deliverPartAnswer, nextVoiceStep, voiceSpecOfQuestion } from "./voice-structured.js";
import { liveQuestionOpen, voiceQuestionOf, type VoiceTurnLike } from "./voice-text.js";
import type { StructuredQuestion } from "../structured-questions.js";

const QUESTIONS: StructuredQuestion[] = [
  { id: "env", prompt: "Which environment?", type: "single-choice", options: [{ label: "Staging box", value: "stg" }, { label: "Production", value: "prod" }] },
  { id: "checks", prompt: "Which checks?", type: "multi-choice", options: [{ label: "Lint", value: "lint" }, { label: "Tests", value: "test" }] },
  { id: "go", prompt: "Proceed?", type: "boolean" },
  { id: "n", prompt: "How many replicas?", type: "number", min: 1, max: 5 },
  { id: "why", prompt: "Reason?", type: "text", required: false },
];
const ASK = { interactionId: "i1", questions: QUESTIONS, schema: {} };

describe("voiceSpecOfQuestion / answerValueOf", () => {
  test("choices speak their labels and report their values", () => {
    expect(voiceSpecOfQuestion(QUESTIONS[0] as StructuredQuestion)).toEqual({ kind: "choice", options: ["Staging box", "Production"] });
    expect(voiceSpecOfQuestion(QUESTIONS[1] as StructuredQuestion)).toEqual({ kind: "choice", options: ["Lint", "Tests"], multi: true });
    expect(voiceSpecOfQuestion(QUESTIONS[3] as StructuredQuestion)).toEqual({ kind: "number", min: 1, max: 5 });
    expect(voiceSpecOfQuestion(QUESTIONS[2] as StructuredQuestion)).toEqual({ kind: "boolean" });
    expect(answerValueOf(QUESTIONS[0] as StructuredQuestion, "Staging box")).toBe("stg");
    expect(answerValueOf(QUESTIONS[1] as StructuredQuestion, ["Lint", "Tests"])).toEqual(["lint", "test"]);
    expect(answerValueOf(QUESTIONS[3] as StructuredQuestion, 3)).toBe(3);
  });

  test("the matcher hears a label and the answer maps back to its value", () => {
    const m = matchSpokenAnswer("staging box", voiceSpecOfQuestion(QUESTIONS[0] as StructuredQuestion));
    expect(m.type).toBe("answer");
    if (m.type === "answer") expect(answerValueOf(QUESTIONS[0] as StructuredQuestion, m.value)).toBe("stg");
  });
});

describe("nextVoiceStep", () => {
  test("asks required questions in order, one step each; optional ones are not asked", () => {
    const first = nextVoiceStep(ASK, {});
    expect(first?.id).toBe("i1#env");
    expect(first?.part).toEqual({ interactionId: "i1", questionId: "env" });
    expect(first?.prompt).toBe("Question 1 of 4. Which environment?");
    expect(nextVoiceStep(ASK, { env: "stg" })?.part?.questionId).toBe("checks");
    expect(nextVoiceStep(ASK, { env: "stg", checks: ["lint"], go: true })?.part?.questionId).toBe("n");
    expect(nextVoiceStep(ASK, { env: "stg", checks: ["lint"], go: true, n: 2 })).toBeNull();
  });

  test("a legacy ask has no steps", () => {
    expect(nextVoiceStep({ interactionId: "i2", schema: { options: ["a"] } }, {})).toBeNull();
  });
});

describe("deliverPartAnswer", () => {
  const send = (sent: unknown[], result: { ok: true } | { ok: false; error: string } = { ok: true }) => async (a: unknown) => {
    sent.push(a);
    return result;
  };

  test("collects each answer, sends once with the id-keyed map after the last required one", async () => {
    const collected = createStructuredVoiceAnswers();
    const sent: unknown[] = [];
    const answers: [string, Parameters<typeof deliverPartAnswer>[0]["value"]][] = [["env", "Production"], ["checks", ["Lint", "Tests"]], ["go", true], ["n", 3]];
    const outs = [];
    for (const [qid, value] of answers) {
      const question = nextVoiceStep(ASK, collected.get("i1"));
      expect(question?.part?.questionId).toBe(qid);
      outs.push(await deliverPartAnswer({ question: question!, value, interaction: ASK, collected, send: send(sent) }));
    }
    expect(outs.map((o) => (o.ok ? o.done : "err"))).toEqual([false, false, false, true]);
    expect(sent).toEqual([{ env: "prod", checks: ["lint", "test"], go: true, n: 3 }]);
  });

  test("a failed send clears the collected answers so the person starts again", async () => {
    const collected = createStructuredVoiceAnswers();
    for (const [qid, value] of [["env", "Production"], ["checks", ["Lint"]], ["go", false]] as const) {
      const q = nextVoiceStep(ASK, collected.get("i1"));
      expect(q?.part?.questionId).toBe(qid);
      await deliverPartAnswer({ question: q!, value, interaction: ASK, collected, send: send([]) });
    }
    const last = nextVoiceStep(ASK, collected.get("i1"));
    const out = await deliverPartAnswer({ question: last!, value: 9, interaction: ASK, collected, send: send([], { ok: false, error: "n: At most 5." }) });
    expect(out).toEqual({ ok: false, error: "n: At most 5." });
    expect(collected.get("i1")).toEqual({});
    expect(nextVoiceStep(ASK, collected.get("i1"))?.part?.questionId).toBe("env");
  });

  test("a question that is not part of the ask is refused", async () => {
    const out = await deliverPartAnswer({
      question: { id: "i1#zzz", prompt: "?", spec: { kind: "text" }, part: { interactionId: "i1", questionId: "zzz" } },
      value: "x",
      interaction: ASK,
      collected: createStructuredVoiceAnswers(),
      send: send([]),
    });
    expect(out.ok).toBe(false);
  });
});

describe("the voice flow, one step per question", () => {
  const run = (from: VoiceQuestionState, ...events: VoiceQuestionEvent[]) => {
    let state = from;
    const effects: VoiceQuestionEffect[] = [];
    for (const e of events) {
      const s = voiceQuestionReduce(state, e);
      state = s.state;
      effects.push(...s.effects);
    }
    return { state, effects };
  };

  test("each step is read back and confirmed before it counts; the next step replaces the sending one", () => {
    const first = nextVoiceStep(ASK, {})!;
    const a = run(IDLE_VOICE_QUESTION, { type: "ask", question: first }, { type: "spoken" }, { type: "heard", text: "production send it", autoSend: false });
    const send = a.effects.find((e) => e.type === "send");
    expect(send).toMatchObject({ type: "send", value: "Production" });
    expect(a.state.phase).toBe("sending");
    // The next step arrives while the first answer is still being delivered.
    const second = nextVoiceStep(ASK, { env: "prod" })!;
    const b = run(a.state, { type: "ask", question: second }, { type: "sent" });
    expect(b.state.phase).toBe("speaking");
    if (b.state.phase === "speaking") expect(b.state.question.id).toBe("i1#checks");
  });
});

describe("voiceQuestionOf with a structured live ask", () => {
  const turn = (extra: Partial<VoiceTurnLike>): VoiceTurnLike => ({ role: "assistant", content: "", streaming: true, ...extra });
  const live = { runId: "r1", interactionId: "i1", kind: "form", prompt: "Deploy details", schema: {}, questions: QUESTIONS };

  test("yields the next unanswered step; null when all are in but the ask is still open", () => {
    const none = () => ({});
    expect(voiceQuestionOf([turn({ liveInteraction: live })], none)?.id).toBe("i1#env");
    const done = () => ({ env: "prod", checks: ["lint"], go: true, n: 2 });
    expect(voiceQuestionOf([turn({ liveInteraction: live })], done)).toBeNull();
    expect(liveQuestionOpen([turn({ liveInteraction: live })])).toBe(true);
    expect(liveQuestionOpen([turn({ liveInteraction: live, streaming: false })])).toBe(false);
  });

  test("a legacy ask is still the single interaction-level question", () => {
    const legacy = { runId: "r1", interactionId: "i7", kind: "choice", prompt: "Which?", schema: { options: ["a", "b"] } };
    const q = voiceQuestionOf([turn({ liveInteraction: legacy })]);
    expect(q).toEqual({ id: "i7", prompt: "Which?", spec: { kind: "choice", options: ["a", "b"] } });
  });
});
