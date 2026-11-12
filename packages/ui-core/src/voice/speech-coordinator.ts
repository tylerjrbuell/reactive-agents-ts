/**
 * One spoken reading at a time, however many engines, controllers or components exist.
 * Every {@link TtsEngine} the package builds speaks through {@link exclusive}: starting an
 * utterance first cancels the one in flight (any engine, any controller), and the cancelled
 * utterance's late `onEnd` / `onError` can no longer fire. The coordinator is shared through
 * `globalThis`, so a remounted component, a second runtime or a duplicated module copy still
 * answers to the same owner.
 */
import type { TtsEngine, TtsHandle } from "./types.js";

/** An utterance the coordinator can preempt. */
export interface ActiveSpeech {
  /** Stop the sound. Called once, before the next utterance starts. */
  cancel(): void;
  /** Tell the owner it was preempted (not finished, not failed). */
  interrupted(): void;
}

/** Who is speaking right now. */
export interface SpeechCoordinator {
  /** Become the speaker, preempting the current one. Returns a release for when this one is over. */
  claim(speech: ActiveSpeech): () => void;
  /** Whether anything is being spoken. */
  isSpeaking(): boolean;
  /** Cancel whatever is speaking, if anything. */
  stopAll(): void;
}

/** A fresh coordinator (tests; the app uses {@link sharedSpeechCoordinator}). */
export function createSpeechCoordinator(): SpeechCoordinator {
  let active: ActiveSpeech | null = null;
  const preempt = (): void => {
    const prev = active;
    active = null;
    if (prev === null) return;
    prev.cancel();
    prev.interrupted();
  };
  return {
    claim(speech) {
      preempt();
      active = speech;
      return () => {
        if (active === speech) active = null;
      };
    },
    isSpeaking: () => active !== null,
    stopAll: preempt,
  };
}

const KEY = Symbol.for("reactive-agents.ui-core.speech-coordinator");

/** The one coordinator of this page (stored on `globalThis`, so duplicate module copies share it). */
export function sharedSpeechCoordinator(): SpeechCoordinator {
  const g = globalThis as { [KEY]?: SpeechCoordinator };
  return (g[KEY] ??= createSpeechCoordinator());
}

/**
 * Wrap an engine so its utterances are exclusive: `speak` cancels the active utterance first,
 * `cancel` is idempotent, and callbacks of a cancelled or preempted utterance are inert.
 */
export function exclusive(engine: TtsEngine, coordinator: SpeechCoordinator = sharedSpeechCoordinator()): TtsEngine {
  return {
    ...engine,
    speak(text, opts, h) {
      let live = true;
      // Cancelled or preempted (as opposed to finished): a stopped utterance never resumes.
      let stopped = false;
      let inner: TtsHandle | null = null;
      const release = coordinator.claim({
        cancel: () => {
          live = false;
          stopped = true;
          inner?.cancel();
        },
        interrupted: () => h.onInterrupted?.(),
      });
      inner = engine.speak(text, opts, {
        onStart: () => {
          if (live) h.onStart?.();
        },
        onEnd: () => {
          if (!live) return;
          live = false;
          release();
          h.onEnd();
        },
        onError: (error) => {
          if (!live) return;
          live = false;
          release();
          h.onError(error);
        },
        onInterrupted: () => undefined,
      });
      const handle = inner;
      return {
        pause: () => handle.pause(),
        resume: () => {
          if (!stopped) handle.resume();
        },
        cancel: () => {
          stopped = true;
          if (!live) return;
          live = false;
          release();
          handle.cancel();
        },
      };
    },
  };
}
