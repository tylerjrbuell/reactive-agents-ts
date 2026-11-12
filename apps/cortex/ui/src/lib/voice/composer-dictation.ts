/**
 * Dictation into the chat composer: binds an ui-core `Dictation` to a draft the host
 * owns, so interim words appear at the caret as they are heard and nothing typed is
 * overwritten (`applyDictation`). Auto-send hands the finished text to the host when
 * the quiet period ends the session.
 */
import { applyDictation, createDictation, type Dictation, type DictationAnchor, type DictationEnd, type SttEngine, type VoiceClock } from "@reactive-agents/ui-core";

/** How the controller reads and writes the composer. */
export interface ComposerField {
  /** The draft and where the caret is now. */
  read(): { readonly text: string; readonly caret: number };
  /** Replace the draft and put the caret at `caret`. */
  write(text: string, caret: number): void;
}

/** Options for {@link createComposerDictation}. */
export interface ComposerDictationOptions {
  readonly engine: () => SttEngine;
  readonly field: ComposerField;
  readonly language?: () => string;
  /** Quiet period (ms) after which listening ends; 0 = only when stopped. */
  readonly silenceMs?: () => number;
  /** When true, the session ending by silence calls `onAutoSend`. */
  readonly autoSend?: () => boolean;
  /** The silence ended the session with this transcript in the draft. */
  readonly onAutoSend?: () => void;
  readonly onEnd?: (end: { readonly reason: DictationEnd; readonly transcript: string }) => void;
  readonly clock?: VoiceClock;
}

/** Create a dictation bound to the composer. */
export function createComposerDictation(opts: ComposerDictationOptions): Dictation {
  let anchor: DictationAnchor | null = null;
  const dictation = createDictation({
    engine: opts.engine,
    ...(opts.language ? { language: opts.language } : {}),
    ...(opts.silenceMs ? { silenceMs: opts.silenceMs } : {}),
    ...(opts.clock ? { clock: opts.clock } : {}),
    onTranscript: (transcript) => {
      const cur = opts.field.read();
      const w = applyDictation(cur.text, anchor, transcript, cur.caret);
      anchor = w.anchor;
      opts.field.write(w.text, w.caret);
    },
    onEnd: (end) => {
      // The session's words are now ordinary text in the draft.
      anchor = null;
      opts.onEnd?.(end);
      if (end.reason === "silence" && end.transcript !== "" && opts.autoSend?.() === true) opts.onAutoSend?.();
    },
  });
  return dictation;
}
