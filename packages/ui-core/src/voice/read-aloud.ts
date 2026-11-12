/**
 * Read aloud: a controller that speaks markdown sentence by sentence through a
 * {@link TtsEngine}, with play, pause, resume, stop, skip, speed and voice. One
 * reading at a time: starting another replaces the first. Chunking keeps long
 * answers from stalling an engine and gives the UI a current sentence to highlight.
 */
import { chunkSpeech, speakableOf, type SpeechChunk } from "./speakable.js";
import type { TtsEngine, TtsError, TtsHandle } from "./types.js";

/** What the controller reports. */
export interface ReadAloudState {
  /** `loading` = asked to speak, no sound yet (a remote engine is fetching audio). */
  readonly status: "idle" | "loading" | "playing" | "paused" | "error";
  /** Who is being read (a turn id, `"transcript"`, `"voice-mode"`); `null` when idle. */
  readonly sourceId: string | null;
  readonly chunks: readonly SpeechChunk[];
  /** The chunk being spoken. */
  readonly index: number;
  readonly error: TtsError | null;
}

/** Options for {@link createReadAloud}. */
export interface ReadAloudOptions {
  /** The engine for the next reading (read at each play). */
  readonly engine: () => TtsEngine;
  readonly voice?: () => string;
  readonly rate?: () => number;
  readonly language?: () => string;
  /** Longest sentence chunk (default 220 characters). */
  readonly maxChars?: number;
  /** How many chunks ahead a remote engine fetches (default 2). */
  readonly prefetchAhead?: number;
}

/** Per-reading callbacks. */
export interface PlayOptions {
  /** Start at this chunk. */
  readonly from?: number;
  /** The whole text was spoken. */
  readonly onFinish?: () => void;
  /** The reading failed. */
  readonly onError?: (error: TtsError) => void;
}

/** A read-aloud controller. */
export interface ReadAloud {
  get(): ReadAloudState;
  subscribe(fn: (s: ReadAloudState) => void): () => void;
  /** Read `markdown`. `false` when it holds nothing to say. */
  play(sourceId: string, markdown: string, opts?: PlayOptions): boolean;
  pause(): void;
  resume(): void;
  /** Stop; nothing more is spoken and no callback fires. */
  stop(): void;
  /** Jump to a chunk (negative or past the end is clamped). */
  seek(index: number): void;
  /** Apply a changed speed or voice to the sentence being spoken, from its start. */
  refresh(): void;
}

const IDLE: ReadAloudState = { status: "idle", sourceId: null, chunks: [], index: 0, error: null };

/** Build a read-aloud controller. */
export function createReadAloud(opts: ReadAloudOptions): ReadAloud {
  let state: ReadAloudState = IDLE;
  const subs = new Set<(s: ReadAloudState) => void>();
  let handle: TtsHandle | null = null;
  let token = 0;
  let current: PlayOptions = {};
  let engine: TtsEngine | null = null;

  const set = (next: ReadAloudState): void => {
    state = next;
    for (const fn of subs) fn(state);
  };
  const speakOpts = () => {
    const voice = opts.voice?.() ?? "";
    const language = opts.language?.() ?? "";
    return {
      ...(voice !== "" ? { voice } : {}),
      ...(language !== "" ? { language } : {}),
      rate: opts.rate?.() ?? 1,
    };
  };
  const drop = (): void => {
    token += 1;
    const h = handle;
    handle = null;
    h?.cancel();
  };

  const speakAt = (index: number): void => {
    const eng = engine;
    const chunk = state.chunks[index];
    if (eng === null || chunk === undefined) return;
    token += 1;
    const mine = token;
    set({ ...state, status: "loading", index, error: null });
    const so = speakOpts();
    const ahead = opts.prefetchAhead ?? 2;
    for (let k = 1; k <= ahead; k += 1) {
      const next = state.chunks[index + k];
      if (next !== undefined) eng.prefetch?.(next.text, so);
    }
    handle = eng.speak(chunk.text, so, {
      onStart: () => {
        if (mine === token && state.status === "loading") set({ ...state, status: "playing" });
      },
      onEnd: () => {
        if (mine !== token) return;
        handle = null;
        if (index + 1 < state.chunks.length) {
          speakAt(index + 1);
          return;
        }
        const done = current.onFinish;
        set(IDLE);
        done?.();
      },
      // Another reading (any controller) took the speaker: this one is over, silently.
      onInterrupted: () => {
        if (mine !== token) return;
        token += 1;
        handle = null;
        set(IDLE);
      },
      onError: (error) => {
        if (mine !== token) return;
        handle = null;
        const failed = current.onError;
        set({ ...state, status: "error", error });
        failed?.(error);
      },
    });
  };

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
    play(sourceId, markdown, playOpts = {}) {
      drop();
      const chunks = chunkSpeech(speakableOf(markdown).text, opts.maxChars !== undefined ? { maxChars: opts.maxChars } : {});
      if (chunks.length === 0) {
        set({ ...IDLE, status: "error", error: { kind: "other", message: "There is nothing to read aloud." } });
        return false;
      }
      const eng = opts.engine();
      const avail = eng.available();
      if (!avail.ok) {
        set({ ...IDLE, sourceId, status: "error", error: { kind: "unsupported", message: avail.reason } });
        playOpts.onError?.({ kind: "unsupported", message: avail.reason });
        return false;
      }
      engine = eng;
      current = playOpts;
      set({ status: "loading", sourceId, chunks, index: 0, error: null });
      speakAt(Math.min(Math.max(playOpts.from ?? 0, 0), chunks.length - 1));
      return true;
    },
    pause() {
      if (state.status !== "playing" && state.status !== "loading") return;
      handle?.pause();
      set({ ...state, status: "paused" });
    },
    resume() {
      if (state.status !== "paused") return;
      handle?.resume();
      set({ ...state, status: "playing" });
    },
    stop() {
      if (state.status === "idle") return;
      drop();
      set(IDLE);
    },
    seek(index) {
      if (state.chunks.length === 0 || state.status === "idle") return;
      drop();
      speakAt(Math.min(Math.max(index, 0), state.chunks.length - 1));
    },
    refresh() {
      if (state.status !== "playing" && state.status !== "loading") return;
      drop();
      speakAt(state.index);
    },
  };
}
