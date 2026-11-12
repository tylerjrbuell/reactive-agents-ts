/**
 * Runs the voice-mode reducer (`voiceModeReduce`, ui-core) against real parts: a
 * dedicated dictation for listening, the shared read-aloud controller for speaking,
 * and the chat's send and stop. The reducer decides; this only carries out its
 * effects, one event at a time (events raised while one is being handled wait their
 * turn, so an engine that fails synchronously cannot re-enter the loop).
 */
import {
  createDictation,
  IDLE_VOICE_MODE,
  voiceModeReduce,
  type Dictation,
  type ReadAloud,
  type SttEngine,
  type VoiceClock,
  type VoiceModeEffect,
  type VoiceModeEvent,
  type VoiceModeState,
} from "@reactive-agents/ui-core";

/** What the host needs from the app. */
export interface VoiceModeDeps {
  readonly engine: () => SttEngine;
  readonly language: () => string;
  /** Quiet period (ms) that ends an utterance. */
  readonly silenceMs: () => number;
  readonly reader: ReadAloud;
  /** Send a message to the chat. */
  readonly send: (text: string) => void | Promise<void>;
  /** Stop the running reply. */
  readonly stopRun: () => void | Promise<void>;
  readonly clock?: VoiceClock;
}

/** The running voice mode. */
export interface VoiceModeHost {
  get(): VoiceModeState;
  subscribe(fn: (s: VoiceModeState) => void): () => void;
  dispatch(event: VoiceModeEvent): void;
  /** The listening part, for the host UI's level and interim display. */
  readonly dictation: Dictation;
}

/** Source id the host reads replies under. */
export const VOICE_MODE_SOURCE = "voice-mode";

/** Build a voice-mode host. */
export function createVoiceModeHost(deps: VoiceModeDeps): VoiceModeHost {
  let state = IDLE_VOICE_MODE;
  const subs = new Set<(s: VoiceModeState) => void>();
  const queue: VoiceModeEvent[] = [];
  let draining = false;

  const dictation: Dictation = createDictation({
    engine: deps.engine,
    language: deps.language,
    silenceMs: deps.silenceMs,
    ...(deps.clock ? { clock: deps.clock } : {}),
    onTranscript: (transcript) => {
      if (transcript.trim() !== "") dispatch({ type: "interim", text: transcript });
    },
    onEnd: ({ reason, transcript }) => {
      if (reason === "aborted") return;
      if (dictation.get().status === "error") return; // reported through the subscription below
      if (transcript.trim() !== "") {
        dispatch({ type: "heard", text: transcript });
        // An utterance the loop ignored (the voice's own echo) leaves the mic wanted: reopen it.
        if (state.micOn && (state.phase === "listening" || state.phase === "speaking")) dictation.start();
      } else {
        dispatch({ type: "listen-ended" });
      }
    },
  });
  // A listening failure (permission, no microphone, unreachable server) pauses the mode with its message.
  dictation.subscribe((d) => {
    if (d.status === "error" && d.error !== null && state.phase !== "idle") dispatch({ type: "mic-error", message: d.error.message });
  });

  const run = (effect: VoiceModeEffect): void => {
    switch (effect.type) {
      case "start-listening":
        dictation.start();
        return;
      case "stop-listening":
        dictation.abort();
        return;
      case "send":
        void deps.send(effect.text);
        return;
      case "speak":
        deps.reader.play(VOICE_MODE_SOURCE, effect.text, {
          onFinish: () => dispatch({ type: "speech-ended" }),
          onError: (e) => dispatch({ type: "speech-failed", message: e.message }),
        });
        return;
      case "cancel-speech":
        deps.reader.stop();
        return;
      case "stop-run":
        void deps.stopRun();
        return;
    }
  };

  function dispatch(event: VoiceModeEvent): void {
    queue.push(event);
    if (draining) return;
    draining = true;
    try {
      for (let e = queue.shift(); e !== undefined; e = queue.shift()) {
        const step = voiceModeReduce(state, e);
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
    dispatch,
    dictation,
  };
}
