/**
 * The one place reasoning is told apart from the answer in text a model streamed as visible output.
 *
 * Providers send reasoning on its own channel (`thinking_delta`, surfaced as `ThinkingEmitted`;
 * narration as `ThoughtEmitted`). Some models still print a reasoning preface into the visible text,
 * opened by a bare `thought` marker (observed: gemini-2.5-flash, `thought The user wants a markdown
 * report...`). That text is reasoning, not the answer, and must never open the answer body.
 *
 * The rule, so no component carries its own regex:
 *  - Text that does not open with the marker is the answer, untouched.
 *  - Marker plus text the known reasoning channels already reported (whitespace-insensitive, also
 *    while that text is still arriving): that text is the reasoning, the rest is the answer.
 *  - Marker with no channel to confirm it, on its own line (`thought\n...`) or before a capitalised
 *    word (`thought The user...`): the marker is dropped. A lower-case continuation
 *    (`thought is...`) is ordinary prose unless a channel confirms it.
 *  - Such an unconfirmed marker whose first line reads as reasoning (a lead-in like `The user`, `I'll`,
 *    `Let me`, `Okay`, or a bold heading) also moves that leading block to reasoning. The block ends
 *    where the answer visibly starts: the first blank line, or the first markdown structure (heading,
 *    list, table, fence, quote), taking a line that ends in `:` along with the structure it introduces.
 *    The answer is never emptied: with no boundary the prose stays the answer, except while the turn
 *    is still streaming (`live`), when the block so far is reasoning. A first line that does not read
 *    as reasoning is never touched beyond dropping the marker.
 *
 * Pure; call it on every event of a streaming turn.
 */

/** Reasoning and answer, told apart. */
export interface ReasoningSplit {
  /** Reasoning that was printed into the visible text (empty when none was confirmed). */
  readonly reasoning: string;
  /** The text to show as the answer. */
  readonly answer: string;
  /** True when a `thought` marker was found and removed from the answer. */
  readonly leaked: boolean;
}

const MARKER = /^\s*thought(\r?\n|[ \t]+)/;

/** First lines that read as a model thinking aloud (or a bold thought-summary heading). */
const LEAD = /^(?:\*\*[^*\n]+\*\*|(?:the user|user|i|i'll|i'm|i've|i'd|let me|let's|okay|ok|alright|hmm|first|my plan|my goal|we|we'll|this (?:is|request|task)|the (?:task|request|goal|question|prompt)|so)\b)/i;

/** A line that opens markdown structure: heading, list item, fence, table row, rule, quote. */
const STRUCTURAL = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|```|\||-{3,}\s*$|>\s)/;

/** Index of the first answer line in a reasoning-led block, or -1 when the answer has not visibly started. */
const answerStart = (lines: readonly string[]): number => {
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === "") continue;
    const afterBlank = lines[i - 1]!.trim() === "";
    if (!afterBlank && !STRUCTURAL.test(line)) continue;
    const at = !afterBlank && lines[i - 1]!.trim().endsWith(":") ? i - 1 : i;
    return at === 0 ? -1 : at;
  }
  return -1;
};

const compact = (s: string): string => s.replace(/\s+/g, "");

/** Index in `text` just after its first `count` non-space characters. */
const indexAfterCompact = (text: string, count: number): number => {
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (!/\s/.test(text[i]!)) seen += 1;
    if (seen === count) return i + 1;
  }
  return text.length;
};

/**
 * Split `text` (a turn's visible output, final or in flight) into reasoning and answer.
 * `channels` are the reasoning texts the run reported on its own channels (provider thinking,
 * narration), in any order.
 */
export function splitReasoning(
  text: string,
  channels: readonly (string | undefined)[] = [],
  opts: {
    /** The turn still streams: a reasoning block with no visible end yet is all reasoning. */
    readonly live?: boolean;
  } = {},
): ReasoningSplit {
  const m = MARKER.exec(text);
  if (!m) return { reasoning: "", answer: text, leaked: false };
  const rest = text.slice(m[0].length);
  const cr = compact(rest);
  for (const channel of channels) {
    const ck = compact(channel ?? "");
    if (ck.length === 0 || cr.length === 0) continue;
    if (cr.startsWith(ck)) {
      const cut = indexAfterCompact(rest, ck.length);
      return { reasoning: rest.slice(0, cut).trim(), answer: rest.slice(cut).trimStart(), leaked: true };
    }
    // Still arriving: everything so far is the start of that reasoning.
    if (ck.startsWith(cr)) return { reasoning: rest.trim(), answer: "", leaked: true };
  }
  if (m[1]!.includes("\n") || /^[A-Z]/.test(rest)) {
    const body = rest.trimStart();
    if (LEAD.test(body)) {
      const lines = body.split(/\r?\n/);
      const at = answerStart(lines);
      if (at > 0) {
        return { reasoning: lines.slice(0, at).join("\n").trim(), answer: lines.slice(at).join("\n").trimStart(), leaked: true };
      }
      if (opts.live === true) return { reasoning: body.trim(), answer: "", leaked: true };
    }
    return { reasoning: "", answer: rest, leaked: true };
  }
  return { reasoning: "", answer: text, leaked: false };
}
