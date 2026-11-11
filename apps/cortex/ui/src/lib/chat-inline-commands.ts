/**
 * Inline slash commands in the chat composer. A recognized command may sit anywhere in
 * a message (`summarize this repo /codebase-health-sweep`): it is highlighted while
 * typing and, on send, activated and removed from the prompt. Pure: the composer and
 * ChatPanel only wire it.
 *
 * Grammar (a token is recognized only when every rule holds):
 * - It starts with `/` at the start of the text, after whitespace, or after `(`.
 *   So `a/b`, `https://x.dev/path` and `\/name` (escaped) never match.
 * - The name is letters, digits, `-` or `_` (`[A-Za-z0-9][A-Za-z0-9_-]*`).
 * - After the name come only closing punctuation (`. , ; : ! ? ) ] } ' "`) and then
 *   whitespace or the end. So `/usr/bin` and `/notes.txt` are paths, not tokens, while
 *   `/review.` and `(/review)` are tokens followed by text.
 * - Not inside a code span: inline backticks or a ``` fence.
 *
 * Mid-message the only commands that do something are skills, because they modify the
 * message they ride on: `/<skill-name>` and `/skill <skill-name>` use the skill for this
 * message, `/skills <skill-name>` pins it for every turn of the chat. Other `/words`
 * (unknown names, or commands such as `/clear` that act on the whole chat) are
 * reported as unrecognized and sent as typed. Skill names match case-insensitively.
 *
 * Escaping: `\/<skill-name>` sends the literal `/<skill-name>` (the backslash is dropped
 * only in front of a name that would otherwise have been recognized).
 */

/** Plain text, sent as typed (`send` differs from `text` only for an escaped token). */
export interface InlineText {
  readonly kind: "text";
  readonly text: string;
  readonly send: string;
  readonly start: number;
  readonly end: number;
}

/** A command-shaped token. Only `recognized` ones are highlighted, activated and stripped. */
export interface InlineCommand {
  readonly kind: "command";
  /** The token as typed, e.g. `/skill review`. */
  readonly text: string;
  /** Command or skill name as typed, lowercased (`review`, `skill`). */
  readonly name: string;
  readonly recognized: boolean;
  /** The skill it activates (canonical name), when recognized. */
  readonly skill?: string;
  /** `turn` = this message only; `session` = pinned for every turn (`/skills <name>`). */
  readonly scope?: "turn" | "session";
  readonly start: number;
  readonly end: number;
}

export type InlineSegment = InlineText | InlineCommand;

const NAME_START = /[A-Za-z0-9]/;
const NAME_CHAR = /[A-Za-z0-9_-]/;
const CLOSING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "'", '"']);
const isSpace = (c: string | undefined): boolean => c !== undefined && /\s/.test(c);

/** A `/` at `i` may open a token: start of text, after whitespace, or after `(`. */
function atBoundary(text: string, i: number): boolean {
  if (i === 0) return true;
  const prev = text[i - 1];
  return isSpace(prev) || prev === "(";
}

/** Read a name from `i`; `null` unless it is followed only by closing punctuation then whitespace/end. */
function readName(text: string, i: number): { name: string; end: number } | null {
  if (i >= text.length || !NAME_START.test(text[i] ?? "")) return null;
  let j = i;
  while (j < text.length && NAME_CHAR.test(text[j] ?? "")) j++;
  let k = j;
  while (k < text.length && CLOSING.has(text[k] ?? "")) k++;
  if (k < text.length && !isSpace(text[k])) return null;
  return { name: text.slice(i, j), end: j };
}

/** Index map of code spans (backticks, ``` fences): `true` = inside code. */
function codeMask(text: string): boolean[] {
  const mask = new Array<boolean>(text.length).fill(false);
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("```", i)) {
      const close = text.indexOf("```", i + 3);
      const end = close === -1 ? text.length : close + 3;
      for (let k = i; k < end; k++) mask[k] = true;
      i = end;
      continue;
    }
    if (text[i] === "`") {
      const close = text.indexOf("`", i + 1);
      if (close !== -1) {
        for (let k = i; k <= close; k++) mask[k] = true;
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return mask;
}

/** Lowercased skill name → canonical name. */
const skillIndex = (skills: readonly string[]): Map<string, string> => new Map(skills.map((s) => [s.toLowerCase(), s]));

/**
 * Split a message into text and command tokens. `skills` are the names the session's
 * agent can load; only they (bare, or after `/skill` / `/skills`) are recognized.
 */
export function parseInlineCommands(text: string, skills: readonly string[]): InlineSegment[] {
  const index = skillIndex(skills);
  const mask = codeMask(text);
  const out: InlineSegment[] = [];
  // Backslashes dropped from the sent prompt (escaped recognized names).
  const dropAt = new Set<number>();
  let textStart = 0;
  const flushText = (end: number) => {
    if (end <= textStart) return;
    let send = "";
    for (let k = textStart; k < end; k++) if (!dropAt.has(k)) send += text[k];
    out.push({ kind: "text", text: text.slice(textStart, end), send, start: textStart, end });
  };

  let i = 0;
  while (i < text.length) {
    if (text[i] !== "/" || mask[i] === true) {
      i++;
      continue;
    }
    // Escaped `\/name`: drop the backslash when the name would have been recognized.
    if (i > 0 && text[i - 1] === "\\" && atBoundary(text, i - 1)) {
      const nm = readName(text, i + 1);
      if (nm && index.has(nm.name.toLowerCase())) dropAt.add(i - 1);
      i++;
      continue;
    }
    if (!atBoundary(text, i)) {
      i++;
      continue;
    }
    const nm = readName(text, i + 1);
    if (!nm) {
      i++;
      continue;
    }
    const lower = nm.name.toLowerCase();
    let token: InlineCommand = { kind: "command", text: text.slice(i, nm.end), name: lower, recognized: false, start: i, end: nm.end };
    if (lower === "skill" || lower === "skills") {
      // `/skill <name>`: spaces or tabs (not a newline), then a skill name.
      let j = nm.end;
      while (j < text.length && (text[j] === " " || text[j] === "\t")) j++;
      const arg = j > nm.end ? readName(text, j) : null;
      const canonical = arg ? index.get(arg.name.toLowerCase()) : undefined;
      if (arg && canonical !== undefined && mask[j] !== true) {
        token = { kind: "command", text: text.slice(i, arg.end), name: lower, recognized: true, skill: canonical, scope: lower === "skills" ? "session" : "turn", start: i, end: arg.end };
      }
    }
    if (!token.recognized) {
      const canonical = index.get(lower);
      if (canonical !== undefined) token = { ...token, recognized: true, skill: canonical, scope: "turn" };
    }
    flushText(i);
    out.push(token);
    textStart = token.end;
    i = token.end;
  }
  flushText(text.length);
  return out;
}

/** Skills a message activates: `turn` = this message only, `session` = pin for the chat. Deduplicated, in order. */
export function inlineActivations(segments: readonly InlineSegment[]): { readonly turn: string[]; readonly session: string[] } {
  const turn: string[] = [];
  const session: string[] = [];
  for (const s of segments) {
    if (s.kind !== "command" || !s.recognized || s.skill === undefined) continue;
    const list = s.scope === "session" ? session : turn;
    if (!list.includes(s.skill)) list.push(s.skill);
  }
  return { turn, session };
}

/**
 * The prompt that is sent: the message without its recognized tokens. A removed token
 * takes one adjoining space with it, and a space left before closing punctuation goes;
 * other spacing (code indentation, blank lines) is untouched. Ends are trimmed.
 */
export function promptWithoutCommands(segments: readonly InlineSegment[]): string {
  let out = "";
  let dropped = false;
  for (const s of segments) {
    if (s.kind === "command" && s.recognized) {
      dropped = true;
      continue;
    }
    let piece = s.kind === "text" ? s.send : s.text;
    if (dropped) {
      if (/[ \t]$/.test(out) && /^[ \t]/.test(piece)) piece = piece.slice(1);
      else if (/[ \t]$/.test(out) && CLOSING.has(piece[0] ?? "")) out = out.replace(/[ \t]+$/, "");
      dropped = false;
    }
    out += piece;
  }
  return out.trim();
}

/** Message text with every recognized token of `skill` removed (the quick-bar chip's remove). */
export function removeSkillTokens(text: string, skills: readonly string[], skill: string): string {
  const segs = parseInlineCommands(text, skills);
  let out = "";
  let dropped = false;
  for (const s of segs) {
    if (s.kind === "command" && s.recognized && s.skill === skill) {
      dropped = true;
      continue;
    }
    let piece = s.text;
    if (dropped) {
      if (/[ \t]$/.test(out) && /^[ \t]/.test(piece)) piece = piece.slice(1);
      else if (out === "") piece = piece.replace(/^[ \t]+/, "");
      dropped = false;
    }
    out += piece;
  }
  return dropped ? out.replace(/[ \t]+$/, "") : out;
}

/** The partial `/word` the caret sits at the end of, for the inline menu. */
export interface InlineTrigger {
  /** Index of the `/`. */
  readonly start: number;
  /** The caret (end of the typed part). */
  readonly end: number;
  /** Typed name so far, lowercased (may be empty right after `/`). */
  readonly query: string;
}

/**
 * The `/partial` ending at the caret when it can open a token (boundary rules above,
 * not in code, caret not inside a word). `null` otherwise.
 */
export function inlineTrigger(text: string, caret: number): InlineTrigger | null {
  if (caret < 1 || caret > text.length) return null;
  if (caret < text.length && !isSpace(text[caret])) return null;
  let i = caret;
  while (i > 0 && NAME_CHAR.test(text[i - 1] ?? "")) i--;
  const slash = i - 1;
  if (slash < 0 || text[slash] !== "/" || !atBoundary(text, slash)) return null;
  const query = text.slice(i, caret);
  if (query !== "" && !NAME_START.test(query[0] ?? "")) return null;
  if (codeMask(text)[slash] === true) return null;
  return { start: slash, end: caret, query: query.toLowerCase() };
}

/** The partial already names a skill in full: Enter sends instead of completing it. */
export function triggerIsComplete(trigger: InlineTrigger | null, skills: readonly string[]): boolean {
  return trigger !== null && trigger.query !== "" && skills.some((s) => s.toLowerCase() === trigger.query);
}

/**
 * Insert `insert` over `[start, end)` and return the new text and caret. A space (or
 * `sep`) is added before when the text before is not whitespace, and a space after
 * when `trailingSpace` and the text after does not already start with whitespace.
 */
export function insertAtCaret(
  text: string,
  start: number,
  end: number,
  insert: string,
  opts: { readonly sep?: string; readonly trailingSpace?: boolean } = {},
): { text: string; caret: number } {
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const before = text.slice(0, s);
  const after = text.slice(e);
  const lead = before !== "" && !isSpace(before[before.length - 1]) ? (opts.sep ?? " ") : "";
  const trail = opts.trailingSpace === true && !isSpace(after[0]) ? " " : "";
  const middle = lead + insert + trail;
  return { text: before + middle + after, caret: s + middle.length };
}

/** Text runs for the composer's highlight layer: recognized tokens are `mark`ed. */
export function highlightPieces(segments: readonly InlineSegment[]): { text: string; mark: boolean }[] {
  const out: { text: string; mark: boolean }[] = [];
  for (const s of segments) {
    const mark = s.kind === "command" && s.recognized;
    const last = out[out.length - 1];
    if (last && last.mark === false && !mark) last.text += s.text;
    else out.push({ text: s.text, mark });
  }
  return out;
}
