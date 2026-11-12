/**
 * Answering a question the agent asked (`request_user_input`) by voice, as a pure
 * reducer next to voice mode's own loop.
 *
 *   asking (question read aloud) -> listening -> heard -> [confirm] -> sending -> done
 *
 * What was heard is matched deterministically (`voice-answer.ts`). It is sent at once
 * only when the person said an explicit confirm phrase ("... send it") or, for free
 * text, turned on Send when I stop talking in Settings · Voice. Otherwise it is read
 * back and waits for "send it" / "yes" (confirm), "change it" / "no" (say it again),
 * or the buttons. Approvals are not questions: they are never routed through here and
 * always need a click.
 *
 * `voiceQuestionReduce(state, event)` returns the next state and the effects the host
 * runs (read aloud, open the mic, close it, send the answer). Nothing here touches a
 * microphone, a speaker or the network.
 */
import { confirmIntent, matchSpokenAnswer, type VoiceAnswerValue, type VoiceQuestionSpec } from "./voice-answer.js";

/** A question to answer by voice. */
export interface VoiceQuestion {
  /** Identity of the question (the interaction id); asking the same one again changes nothing. */
  readonly id: string;
  readonly prompt: string;
  readonly spec: VoiceQuestionSpec;
  /**
   * Set when this is one question of a structured ask (`voice-structured.ts`): which
   * interaction it belongs to and which of its questions. The answer is collected, not
   * sent, until every required question has one.
   */
  readonly part?: { readonly interactionId: string; readonly questionId: string };
}

/** An answer waiting for the person's confirmation. */
export interface PendingVoiceAnswer {
  readonly value: VoiceAnswerValue;
  /** How it was read back, and what the field shows. */
  readonly display: string;
  /** What the person said. */
  readonly heard: string;
}

/** Where the question flow is. */
export type VoiceQuestionState =
  | { readonly phase: "idle"; readonly notice: string | null }
  /** Reading the question (or a prompt to repeat). */
  | { readonly phase: "speaking"; readonly question: VoiceQuestion; readonly pending: PendingVoiceAnswer | null; readonly notice: string | null; readonly silences: number }
  /** The mic is open; with `pending` set it waits for confirm / change. */
  | { readonly phase: "listening"; readonly question: VoiceQuestion; readonly pending: PendingVoiceAnswer | null; readonly notice: string | null; readonly silences: number }
  | { readonly phase: "sending"; readonly question: VoiceQuestion; readonly pending: PendingVoiceAnswer };

/** The state before any question. */
export const IDLE_VOICE_QUESTION: VoiceQuestionState = { phase: "idle", notice: null };

/** Quiet listens in a row before the flow gives up and leaves the card to the person. */
export const MAX_QUESTION_SILENCES = 5;

/** Everything that can happen to the flow. */
export type VoiceQuestionEvent =
  | { readonly type: "ask"; readonly question: VoiceQuestion }
  | { readonly type: "spoken" }
  | { readonly type: "speech-failed"; readonly message: string }
  /** A finished utterance. */
  | { readonly type: "heard"; readonly text: string; readonly autoSend: boolean }
  /** The listening session ended with nothing heard. */
  | { readonly type: "silence" }
  | { readonly type: "mic-error"; readonly message: string }
  /** The Send button on the read-back. */
  | { readonly type: "confirm" }
  /** The person typed or edited the answer and pressed Send. */
  | { readonly type: "submit-text"; readonly text: string }
  /** The "Say it again" button. */
  | { readonly type: "retry" }
  | { readonly type: "sent" }
  | { readonly type: "send-failed"; readonly message: string }
  /** The question went away (answered elsewhere, run moved on) or voice mode stopped. */
  | { readonly type: "cancel" };

/** What the host must do, in order. */
export type VoiceQuestionEffect =
  | { readonly type: "speak"; readonly text: string }
  | { readonly type: "cancel-speech" }
  | { readonly type: "listen" }
  | { readonly type: "stop-listening" }
  | { readonly type: "send"; readonly question: VoiceQuestion; readonly value: VoiceAnswerValue };

/** Result of one step. */
export interface VoiceQuestionStep {
  readonly state: VoiceQuestionState;
  readonly effects: readonly VoiceQuestionEffect[];
}

const step = (state: VoiceQuestionState, ...effects: VoiceQuestionEffect[]): VoiceQuestionStep => ({ state, effects });

/** Longest answer read back word for word; a longer one is only acknowledged. */
const READBACK_MAX_CHARS = 140;

/** What is said to ask a question: the prompt, plus the options of a choice. */
export function questionSpeech(q: VoiceQuestion): string {
  const { spec } = q;
  if (spec.kind === "choice") {
    const list = spec.options.map((o, i) => `${i + 1}, ${o}`).join(". ");
    return `${q.prompt}\n\n${spec.multi === true ? "You can pick more than one." : "Your options are:"} ${list}.`;
  }
  if (spec.kind === "boolean") return `${q.prompt}\n\nSay yes or no.`;
  return q.prompt;
}

/** What is said after hearing a candidate answer. */
export function readBackSpeech(display: string): string {
  const shown = display.length > READBACK_MAX_CHARS ? "your answer" : display;
  return `I heard: ${shown}. Say send it to confirm, or say it again.`;
}

const speak = (q: VoiceQuestion, text: string, pending: PendingVoiceAnswer | null, notice: string | null, silences: number): VoiceQuestionStep =>
  step({ phase: "speaking", question: q, pending, notice, silences }, { type: "speak", text });

/** A fresh utterance (or typed text) against the question. */
function takeAnswer(
  s: Extract<VoiceQuestionState, { phase: "listening" | "speaking" }>,
  text: string,
  mayAutoSend: boolean,
  typed: boolean,
): VoiceQuestionStep {
  const m = matchSpokenAnswer(text, s.question.spec);
  if (m.type === "ambiguous") {
    return speak(s.question, `That could be ${m.candidates.join(" or ")}. Which one?`, null, `Heard "${text.trim()}": which one? ${m.candidates.join(" or ")}`, 0);
  }
  if (m.type === "none") {
    if (typed) return step({ ...s, notice: "That is not an answer to this question." });
    return speak(s.question, "I did not catch an answer. Please say it again.", null, `Heard "${text.trim()}", which is not an answer to this question.`, 0);
  }
  const pending: PendingVoiceAnswer = { value: m.value, display: m.display, heard: text.trim() };
  const send = m.confirmed || typed || (mayAutoSend && s.question.spec.kind === "text");
  if (send) return step({ phase: "sending", question: s.question, pending }, { type: "stop-listening" }, { type: "send", question: s.question, value: m.value });
  return speak(s.question, readBackSpeech(m.display), pending, null, 0);
}

/** Apply one event. */
export function voiceQuestionReduce(s: VoiceQuestionState, e: VoiceQuestionEvent): VoiceQuestionStep {
  switch (e.type) {
    case "ask":
      if (s.phase !== "idle" && s.question.id === e.question.id) return step(s);
      return step(
        { phase: "speaking", question: e.question, pending: null, notice: null, silences: 0 },
        ...(s.phase === "idle" ? [] : [{ type: "stop-listening" } as const, { type: "cancel-speech" } as const]),
        { type: "speak", text: questionSpeech(e.question) },
      );

    case "spoken":
      if (s.phase !== "speaking") return step(s);
      return step({ phase: "listening", question: s.question, pending: s.pending, notice: s.notice, silences: s.silences }, { type: "listen" });

    case "speech-failed":
      // The question is on screen; listen anyway and say why it was not read.
      if (s.phase !== "speaking") return step(s);
      return step({ phase: "listening", question: s.question, pending: s.pending, notice: e.message, silences: s.silences }, { type: "listen" });

    case "heard": {
      if (s.phase !== "listening") return step(s);
      if (s.pending !== null) {
        const intent = confirmIntent(e.text);
        if (intent === "confirm") {
          return step({ phase: "sending", question: s.question, pending: s.pending }, { type: "stop-listening" }, { type: "send", question: s.question, value: s.pending.value });
        }
        if (intent === "reject") return speak(s.question, "Okay. Say your answer again.", null, null, 0);
      }
      return takeAnswer(s, e.text, e.autoSend, false);
    }

    case "silence": {
      if (s.phase !== "listening") return step(s);
      const silences = s.silences + 1;
      if (silences >= MAX_QUESTION_SILENCES) {
        return step({ phase: "idle", notice: "Stopped listening for your answer. Answer in the thread, or press Say it again." }, { type: "stop-listening" });
      }
      return step({ ...s, silences }, { type: "listen" });
    }

    case "mic-error":
      if (s.phase === "idle" || s.phase === "sending") return step(s);
      return step({ phase: "idle", notice: e.message }, { type: "stop-listening" }, { type: "cancel-speech" });

    case "confirm":
      if ((s.phase !== "listening" && s.phase !== "speaking") || s.pending === null) return step(s);
      return step(
        { phase: "sending", question: s.question, pending: s.pending },
        { type: "stop-listening" },
        { type: "cancel-speech" },
        { type: "send", question: s.question, value: s.pending.value },
      );

    case "submit-text":
      if (s.phase !== "listening" && s.phase !== "speaking") return step(s);
      return takeAnswer(s, e.text, true, true);

    case "retry": {
      if (s.phase === "idle" || s.phase === "sending") return step(s);
      return step(
        { phase: "listening", question: s.question, pending: null, notice: null, silences: 0 },
        { type: "stop-listening" },
        { type: "cancel-speech" },
        { type: "listen" },
      );
    }

    case "sent":
      return s.phase === "sending" ? step(IDLE_VOICE_QUESTION) : step(s);

    case "send-failed":
      if (s.phase !== "sending") return step(s);
      return step({ phase: "idle", notice: `The answer was not delivered: ${e.message}` });

    case "cancel":
      if (s.phase === "idle") return step(s);
      return step(IDLE_VOICE_QUESTION, { type: "stop-listening" }, { type: "cancel-speech" });
  }
}
