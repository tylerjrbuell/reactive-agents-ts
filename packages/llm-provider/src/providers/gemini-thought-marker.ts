/**
 * Gemini thought-marker normalization.
 *
 * gemini-2.5-flash intermittently emits a bare `thought` line as the very
 * first characters of an ordinary VISIBLE text part (no `thought: true` flag
 * on the part), e.g. `"thought\nThe user wants to ..."`. Recorded and
 * reproduced through the framework stream path with RA_GEMINI_DEBUG=1: the
 * chunk is `kind=text`, so the SDK-level thought routing cannot catch it. It
 * is model-emitted text (thought-summary leakage), not a part-shape bug.
 *
 * Narrow rule: strip exactly one leading `thought` line (lowercase, followed
 * by LF or CRLF) from the start of the visible content. Anything else — an
 * answer that merely starts with the word ("thoughtful ...", "Thought: ...",
 * "thought process ...") — is untouched.
 */

const MARKER = /^thought\r?\n/;
const LF_FORM = "thought\n";
const CRLF_FORM = "thought\r\n";

/** Strip one leading bare `thought` marker line. Pure; for complete() paths. */
export const stripLeadingThoughtMarker = (text: string): string =>
  text.replace(MARKER, "");

/** Incremental stripper for stream(): chunk boundaries may split the marker. */
export interface ThoughtMarkerStripper {
  /** Feed a visible text delta; returns the text safe to emit now ("" = held). */
  readonly push: (text: string) => string;
  /** End of stream: returns any held text (never a complete marker). */
  readonly flush: () => string;
}

/** Create a per-stream stripper. Holds back only while the head could still become the marker. */
export const makeThoughtMarkerStripper = (): ThoughtMarkerStripper => {
  let decided = false;
  let buffer = "";
  return {
    push: (text) => {
      if (decided) return text;
      buffer += text;
      if (LF_FORM.startsWith(buffer) || CRLF_FORM.startsWith(buffer)) {
        // Still a strict prefix of the marker (or exactly "thought\r"): wait.
        if (buffer !== LF_FORM && buffer !== CRLF_FORM) return "";
      }
      decided = true;
      const out = buffer.replace(MARKER, "");
      buffer = "";
      return out;
    },
    flush: () => {
      if (decided) return "";
      decided = true;
      const out = buffer.replace(MARKER, "");
      buffer = "";
      return out;
    },
  };
};
