/**
 * Dictation: a controller over an {@link SttEngine} plus the pure rule for putting
 * the transcript into a draft.
 *
 * - {@link createDictation} runs one listening session at a time, collects finished
 *   phrases, reports the interim phrase, and can stop itself after a quiet period
 *   ({@link DictationOptions.silenceMs}) so the host can auto-send.
 * - {@link applyDictation} writes the running transcript into a draft at the caret
 *   and replaces only its own earlier insertion, so typed text is never overwritten.
 */
import type { SttEngine, SttError, SttHandle, VoiceClock } from "./types.js";
import { systemClock } from "./types.js";

/** Where the running transcript sits in the draft. */
export interface DictationAnchor {
  readonly start: number;
  /** Exactly what was last written at `start`. */
  readonly inserted: string;
}

/** Result of {@link applyDictation}. */
export interface DictationWrite {
  readonly text: string;
  /** Caret to restore, just after the inserted words. */
  readonly caret: number;
  readonly anchor: DictationAnchor;
}

/**
 * Write `transcript` (finished phrases plus the interim one) into `draft` at the
 * anchor. First call: the anchor is `null` and `caret` says where it starts. A
 * space is added only where a word would otherwise touch its neighbour. If the
 * draft no longer holds what was inserted (the person typed in it), the earlier
 * insertion is kept as typed text and a new one starts at `caret`.
 */
export function applyDictation(draft: string, anchor: DictationAnchor | null, transcript: string, caret: number): DictationWrite {
  let a = anchor;
  if (a !== null && draft.slice(a.start, a.start + a.inserted.length) !== a.inserted) a = null;
  const start = a === null ? Math.min(Math.max(caret, 0), draft.length) : a.start;
  const removed = a === null ? 0 : a.inserted.length;
  const before = draft.slice(0, start);
  const after = draft.slice(start + removed);
  const body = transcript.trim();
  if (body === "") return { text: before + after, caret: start, anchor: { start, inserted: "" } };
  const lead = before !== "" && !/\s$/.test(before) ? " " : "";
  const trail = after !== "" && !/^[\s.,;:!?)\]]/.test(after) ? " " : "";
  const inserted = lead + body + trail;
  return { text: before + inserted + after, caret: start + inserted.length, anchor: { start, inserted } };
}

/** How listening is started and ended. */
export type DictationMode = "toggle" | "push-to-talk";

/** What the controller reports. */
export interface DictationState {
  readonly status: "idle" | "listening" | "processing" | "error";
  /** The phrase being heard now (not yet final). */
  readonly interim: string;
  /** Finished phrases of this session, joined. */
  readonly finals: string;
  readonly error: SttError | null;
}

/** Why a session ended. */
export type DictationEnd = "stopped" | "silence" | "engine" | "error" | "aborted";

/** Options for {@link createDictation}. */
export interface DictationOptions {
  /** The engine to use for the next session (read at each `start`). */
  readonly engine: () => SttEngine;
  readonly language?: () => string;
  /** Quiet period after speech that ends the session on its own; 0 or absent = never. */
  readonly silenceMs?: () => number;
  readonly clock?: VoiceClock;
  /** Interim or final text changed: `transcript` is finals plus interim. */
  readonly onTranscript?: (transcript: string, state: DictationState) => void;
  /** A session ended. `transcript` is everything finalized in it. */
  readonly onEnd?: (end: { readonly reason: DictationEnd; readonly transcript: string }) => void;
}

/** A dictation controller. */
export interface Dictation {
  get(): DictationState;
  subscribe(fn: (s: DictationState) => void): () => void;
  /** Begin listening (no-op while a session runs). */
  start(): void;
  /** Finish and deliver what was heard. */
  stop(): void;
  /** Drop the session without delivering anything more. */
  abort(): void;
  toggle(): void;
}

const IDLE: DictationState = { status: "idle", interim: "", finals: "", error: null };

/** Build a dictation controller over `opts.engine()`. */
export function createDictation(opts: DictationOptions): Dictation {
  const clock = opts.clock ?? systemClock;
  let state: DictationState = IDLE;
  const subs = new Set<(s: DictationState) => void>();
  let handle: SttHandle | null = null;
  let session = 0;
  let timer: unknown = null;
  let heard = false;
  let finals: string[] = [];
  let ending: DictationEnd | null = null;

  const set = (next: DictationState): void => {
    state = next;
    for (const fn of subs) fn(state);
  };
  const clearTimer = (): void => {
    if (timer !== null) clock.clearTimeout(timer);
    timer = null;
  };
  const transcript = (): string => [...finals, state.interim].filter((s) => s.trim() !== "").join(" ").trim();
  const emit = (): void => opts.onTranscript?.(transcript(), state);
  const armSilence = (): void => {
    clearTimer();
    const ms = opts.silenceMs?.() ?? 0;
    if (ms <= 0 || !heard) return;
    timer = clock.setTimeout(() => {
      timer = null;
      ending = "silence";
      handle?.stop();
    }, ms);
  };

  const start = (): void => {
    if (handle !== null) return;
    const engine = opts.engine();
    const avail = engine.available();
    if (!avail.ok) {
      set({ ...IDLE, status: "error", error: { kind: "unsupported", message: avail.reason } });
      return;
    }
    session += 1;
    const mine = session;
    heard = false;
    finals = [];
    ending = null;
    set({ ...IDLE, status: "listening" });
    const lang = opts.language?.() ?? "";
    handle = engine.start(lang !== "" ? { language: lang } : {}, {
      onInterim: (text) => {
        if (mine !== session) return;
        heard = heard || text.trim() !== "";
        set({ ...state, status: "listening", interim: text });
        emit();
        armSilence();
      },
      onFinal: (text) => {
        if (mine !== session) return;
        if (text.trim() !== "") {
          finals.push(text.trim());
          heard = true;
        }
        set({ ...state, interim: "", finals: finals.join(" ") });
        emit();
        armSilence();
      },
      onActivity: () => {
        if (mine !== session) return;
        heard = true;
        armSilence();
      },
      onProcessing: () => {
        if (mine !== session) return;
        clearTimer();
        set({ ...state, status: "processing" });
      },
      onError: (error) => {
        if (mine !== session) return;
        ending = "error";
        set({ ...state, status: "error", error });
      },
      onEnd: () => {
        if (mine !== session) return;
        clearTimer();
        handle = null;
        const reason: DictationEnd = ending ?? "engine";
        // An interim phrase the engine never finalized is kept: the person said it.
        if (state.interim.trim() !== "") finals.push(state.interim.trim());
        const text = finals.join(" ").trim();
        const failed = state.status === "error";
        set(failed ? { ...IDLE, status: "error", error: state.error } : { ...IDLE, finals: text });
        opts.onEnd?.({ reason, transcript: text });
      },
    });
  };

  const stop = (): void => {
    if (handle === null) return;
    ending = ending ?? "stopped";
    clearTimer();
    handle.stop();
  };
  const abort = (): void => {
    if (handle === null) return;
    clearTimer();
    const h = handle;
    session += 1; // late results from this session are ignored
    handle = null;
    h.abort();
    set(IDLE);
    opts.onEnd?.({ reason: "aborted", transcript: "" });
  };

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      fn(state);
      return () => subs.delete(fn);
    },
    start,
    stop,
    abort,
    toggle: () => (handle === null ? start() : stop()),
  };
}
