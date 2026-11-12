/**
 * Voice mode: the hands-free loop as a pure reducer.
 *
 *   listening --heard--> thinking --reply--> speaking --speech-ended--> listening
 *
 * `voiceModeReduce(state, event)` returns the next state and the effects the host must run
 * (open the mic, send a message, speak, cancel speech, stop the run). Nothing here
 * touches a microphone, a speaker or the network, so the loop's rules are testable
 * and a framework binding only has to run the effects.
 *
 * Rules:
 * - the mic is closed while the agent is thinking (nothing to hear, and its own
 *   tools may make noise) and open while it speaks when barge-in is on;
 * - barge-in: speech that is not the voice's own echo stops the reading at once
 *   (heard words that are a fragment of what is being spoken are ignored);
 * - Stop is always honoured, from any state, and also stops a running reply;
 * - an approval or question the agent waits on is `waitingOn`: the loop keeps
 *   waiting (it never answers for the person) and the host shows the card;
 * - a quiet minute of repeated empty listening ends the mode instead of looping.
 */
import { isEcho, speakableOf } from "./speakable.js";

/** Where the loop is. `error` keeps the mode on but paused until Retry or Stop. */
export type VoiceModePhase = "idle" | "listening" | "thinking" | "speaking" | "error";

/** What a thinking agent is blocked on, if anything. */
export type VoiceWaitingOn = "approval" | "question" | null;

/** Reducer state. */
export interface VoiceModeState {
  readonly phase: VoiceModePhase;
  /** The microphone is (meant to be) open. */
  readonly micOn: boolean;
  readonly waitingOn: VoiceWaitingOn;
  /** The reply being spoken (for echo checks). */
  readonly speaking: string;
  /** A message fit to show: why `error`, or a non-fatal note while listening. */
  readonly notice: string | null;
  /** Listening sessions in a row that ended with nothing heard. */
  readonly emptyListens: number;
  /** Read each reply aloud (default on). */
  readonly autoSpeak: boolean;
  /** Speech while the voice is speaking stops it (default on). */
  readonly bargeIn: boolean;
}

/** Everything that can happen to the loop. */
export type VoiceModeEvent =
  | { readonly type: "start" }
  | { readonly type: "stop" }
  /** A finished utterance (after silence). */
  | { readonly type: "heard"; readonly text: string }
  /** Words heard so far while the voice speaks; the host sends it only then. */
  | { readonly type: "interim"; readonly text: string }
  /** The listening session ended with nothing heard (the engine timed out). */
  | { readonly type: "listen-ended" }
  /** The agent's reply finished (markdown). */
  | { readonly type: "reply"; readonly text: string }
  | { readonly type: "reply-failed"; readonly message: string }
  | { readonly type: "speech-ended" }
  | { readonly type: "speech-failed"; readonly message: string }
  /** The Interrupt control was pressed. */
  | { readonly type: "interrupt" }
  | { readonly type: "waiting"; readonly on: VoiceWaitingOn }
  | { readonly type: "mic-error"; readonly message: string }
  | { readonly type: "retry" }
  | { readonly type: "settings"; readonly autoSpeak?: boolean; readonly bargeIn?: boolean };

/** What the host must do. Order matters: run them in the order given. */
export type VoiceModeEffect =
  | { readonly type: "start-listening" }
  | { readonly type: "stop-listening" }
  | { readonly type: "send"; readonly text: string }
  | { readonly type: "speak"; readonly text: string }
  | { readonly type: "cancel-speech" }
  | { readonly type: "stop-run" };

/** Result of one step. */
export interface VoiceModeStep {
  readonly state: VoiceModeState;
  readonly effects: readonly VoiceModeEffect[];
}

/** Consecutive empty listening sessions before the mode gives up (about a quiet minute). */
export const MAX_EMPTY_LISTENS = 8;

/** Fewest characters of non-echo speech that count as a barge-in. */
export const BARGE_IN_MIN_CHARS = 2;

/** The state voice mode starts from. */
export const IDLE_VOICE_MODE: VoiceModeState = {
  phase: "idle",
  micOn: false,
  waitingOn: null,
  speaking: "",
  notice: null,
  emptyListens: 0,
  autoSpeak: true,
  bargeIn: true,
};

const step = (state: VoiceModeState, ...effects: VoiceModeEffect[]): VoiceModeStep => ({ state, effects });
const LISTEN: VoiceModeEffect = { type: "start-listening" };

/** Move to listening, opening the mic only if it is not already open. */
function toListening(s: VoiceModeState, notice: string | null = null): VoiceModeStep {
  return step({ ...s, phase: "listening", micOn: true, waitingOn: null, speaking: "", notice }, ...(s.micOn ? [] : [LISTEN]));
}

/** Apply one event. */
export function voiceModeReduce(s: VoiceModeState, e: VoiceModeEvent): VoiceModeStep {
  switch (e.type) {
    case "settings":
      return step({ ...s, ...(e.autoSpeak !== undefined ? { autoSpeak: e.autoSpeak } : {}), ...(e.bargeIn !== undefined ? { bargeIn: e.bargeIn } : {}) });

    case "start":
      if (s.phase !== "idle" && s.phase !== "error") return step(s);
      return toListening({ ...s, micOn: false, emptyListens: 0 });

    case "stop": {
      if (s.phase === "idle") return step(s);
      const effects: VoiceModeEffect[] = [];
      if (s.micOn) effects.push({ type: "stop-listening" });
      if (s.phase === "speaking") effects.push({ type: "cancel-speech" });
      if (s.phase === "thinking") effects.push({ type: "stop-run" });
      return step({ ...IDLE_VOICE_MODE, autoSpeak: s.autoSpeak, bargeIn: s.bargeIn }, ...effects);
    }

    case "retry":
      if (s.phase !== "error") return step(s);
      return toListening({ ...s, micOn: false, emptyListens: 0 });

    case "heard": {
      const text = e.text.trim();
      if (text === "") return step(s);
      if (s.phase === "listening") {
        return step(
          { ...s, phase: "thinking", micOn: false, emptyListens: 0, notice: null },
          { type: "stop-listening" },
          { type: "send", text },
        );
      }
      if (s.phase === "speaking" && s.bargeIn && !isEcho(text, s.speaking)) {
        return step(
          { ...s, phase: "thinking", micOn: false, speaking: "", emptyListens: 0, notice: null },
          { type: "cancel-speech" },
          { type: "stop-listening" },
          { type: "send", text },
        );
      }
      return step(s);
    }

    case "interim": {
      const text = e.text.trim();
      const real = s.phase === "speaking" && s.bargeIn && text.length >= BARGE_IN_MIN_CHARS && !isEcho(text, s.speaking);
      const quiet = s.phase === "listening" ? { ...s, emptyListens: 0 } : s;
      if (!real) return step(quiet);
      return step({ ...s, phase: "listening", speaking: "", emptyListens: 0, notice: null }, { type: "cancel-speech" });
    }

    case "listen-ended": {
      if (!s.micOn || (s.phase !== "listening" && s.phase !== "speaking")) return step({ ...s, micOn: false });
      const emptyListens = s.emptyListens + 1;
      if (emptyListens >= MAX_EMPTY_LISTENS) {
        const effects: VoiceModeEffect[] = s.phase === "speaking" ? [{ type: "cancel-speech" }] : [];
        return step({ ...IDLE_VOICE_MODE, autoSpeak: s.autoSpeak, bargeIn: s.bargeIn, notice: "Voice mode ended after a quiet minute." }, ...effects);
      }
      return step({ ...s, emptyListens }, LISTEN);
    }

    case "reply": {
      if (s.phase !== "thinking") return step(s);
      const speakable = speakableOf(e.text).text.trim() !== "";
      if (!s.autoSpeak || !speakable) return toListening({ ...s, micOn: false });
      return step(
        { ...s, phase: "speaking", waitingOn: null, speaking: speakableOf(e.text).text, micOn: s.bargeIn, notice: null },
        { type: "speak", text: e.text },
        ...(s.bargeIn ? [LISTEN] : []),
      );
    }

    case "reply-failed":
      if (s.phase !== "thinking") return step(s);
      return step({ ...s, phase: "error", micOn: false, waitingOn: null, notice: e.message });

    case "speech-ended":
      if (s.phase !== "speaking") return step(s);
      return toListening(s);

    case "speech-failed":
      if (s.phase !== "speaking") return step(s);
      return toListening(s, e.message);

    case "interrupt":
      if (s.phase === "speaking") {
        return step({ ...s, phase: "listening", speaking: "", notice: null, micOn: true, emptyListens: 0 }, { type: "cancel-speech" }, ...(s.micOn ? [] : [LISTEN]));
      }
      if (s.phase === "thinking") {
        return step({ ...s, phase: "listening", micOn: true, waitingOn: null, notice: null }, { type: "stop-run" }, LISTEN);
      }
      return step(s);

    case "waiting":
      if (s.phase !== "thinking") return step(s);
      return step({ ...s, waitingOn: e.on });

    case "mic-error": {
      if (s.phase === "idle") return step(s);
      const effects: VoiceModeEffect[] = s.phase === "speaking" ? [{ type: "cancel-speech" }] : [];
      return step({ ...s, phase: "error", micOn: false, waitingOn: null, speaking: "", notice: e.message }, ...effects);
    }
  }
}
