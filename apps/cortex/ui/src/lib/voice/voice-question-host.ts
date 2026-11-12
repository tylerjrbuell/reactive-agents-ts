/**
 * Runs the question reducer (`voiceQuestionReduce`) against real parts: the shared
 * read-aloud controller (one speaker, one reading at a time, so the question never
 * overlaps voice mode's own reply reading), a dedicated dictation for the answer, and
 * the app's way of delivering an answer. Events are handled one at a time, so an engine
 * that fails synchronously cannot re-enter the loop.
 */
import { createDictation, type Dictation, type ReadAloud, type SttEngine, type VoiceClock } from "@reactive-agents/ui-core";
import type { VoiceAnswerValue } from "./voice-answer.js";
import {
  IDLE_VOICE_QUESTION,
  voiceQuestionReduce,
  type VoiceQuestion,
  type VoiceQuestionEffect,
  type VoiceQuestionEvent,
  type VoiceQuestionState,
} from "./voice-question.js";
import { VOICE_MODE_SOURCE } from "./voice-mode-host.js";

/** What the host needs from the app. */
export interface VoiceQuestionDeps {
  readonly engine: () => SttEngine;
  readonly language: () => string;
  /** Quiet period (ms) that ends an utterance. */
  readonly silenceMs: () => number;
  readonly reader: ReadAloud;
  /** Deliver an answer; `ok: false` carries why it was not delivered. */
  readonly deliver: (question: VoiceQuestion, value: VoiceAnswerValue) => Promise<{ readonly ok: true } | { readonly ok: false; readonly error: string }>;
  /** Settings · Voice · Send when I stop talking: a spoken free-text answer is sent without asking. */
  readonly autoSend: () => boolean;
  readonly clock?: VoiceClock;
}

/** The question flow in use. */
export interface VoiceQuestionHost {
  get(): VoiceQuestionState;
  subscribe(fn: (s: VoiceQuestionState) => void): () => void;
  /** Ask a question (read it aloud, then listen); asking the one already open changes nothing. */
  ask(question: VoiceQuestion): void;
  dispatch(event: VoiceQuestionEvent): void;
  /** The listening part, for an interim display. */
  readonly dictation: Dictation;
}

/** Build the host. */
export function createVoiceQuestionHost(deps: VoiceQuestionDeps): VoiceQuestionHost {
  let state: VoiceQuestionState = IDLE_VOICE_QUESTION;
  const subs = new Set<(s: VoiceQuestionState) => void>();
  const queue: VoiceQuestionEvent[] = [];
  let draining = false;

  const dictation: Dictation = createDictation({
    engine: deps.engine,
    language: deps.language,
    silenceMs: deps.silenceMs,
    ...(deps.clock ? { clock: deps.clock } : {}),
    onEnd: ({ reason, transcript }) => {
      if (reason === "aborted" || state.phase !== "listening") return;
      if (dictation.get().status === "error") return; // reported through the subscription below
      if (transcript.trim() !== "") dispatch({ type: "heard", text: transcript, autoSend: deps.autoSend() });
      else dispatch({ type: "silence" });
    },
  });
  dictation.subscribe((d) => {
    if (d.status === "error" && d.error !== null && state.phase !== "idle") dispatch({ type: "mic-error", message: d.error.message });
  });

  const run = (effect: VoiceQuestionEffect): void => {
    switch (effect.type) {
      case "listen":
        dictation.start();
        return;
      case "stop-listening":
        dictation.abort();
        return;
      case "speak": {
        const started = deps.reader.play(VOICE_MODE_SOURCE, effect.text, {
          onFinish: () => dispatch({ type: "spoken" }),
          onError: (e) => dispatch({ type: "speech-failed", message: e.message }),
        });
        if (!started) dispatch({ type: "speech-failed", message: "The question could not be read aloud." });
        return;
      }
      case "cancel-speech":
        deps.reader.stop();
        return;
      case "send":
        void deps.deliver(effect.question, effect.value).then((r) => dispatch(r.ok ? { type: "sent" } : { type: "send-failed", message: r.error }));
        return;
    }
  };

  function dispatch(event: VoiceQuestionEvent): void {
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      for (let e = queue.shift(); e !== undefined; e = queue.shift()) {
        const step = voiceQuestionReduce(state, e);
        const changed = step.state !== state;
        state = step.state;
        for (const effect of step.effects) run(effect);
        if (changed) for (const fn of subs) fn(state);
      }
    } finally {
      draining = false;
    }
  }

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
    ask: (question) => dispatch({ type: "ask", question }),
    dispatch,
    dictation,
  };
}
