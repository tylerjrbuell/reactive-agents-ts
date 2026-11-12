/**
 * Markdown to speakable text, sentence chunking, and echo / location helpers for
 * read-aloud and voice mode. Pure functions: no DOM, no engine.
 *
 * Rules (what a listener should hear):
 * - fenced code blocks are announced ("Code block in typescript, 12 lines."), never read;
 * - tables are announced ("Table, 4 rows."), links read their label, images their alt text;
 * - markup characters (`#`, `*`, `_`, backticks, list markers, quote marks) are dropped;
 * - headings and list items end with a full stop so the voice pauses.
 */

/** Result of {@link speakableOf}. */
export interface Speakable {
  /** Plain text to speak; paragraphs are separated by a blank line. */
  readonly text: string;
  /** How many fenced code blocks were announced instead of read. */
  readonly codeBlocks: number;
  /** How many tables were announced instead of read. */
  readonly tables: number;
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([^\s`]*)/;
const HR = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

const endsSentence = (s: string): boolean => /[.!?…:;]["')\]]*$/.test(s);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** Strip inline markdown from one line of prose. */
function inline(line: string): string {
  return (
    line
      .replace(/<!--.*?-->/g, "")
      .replace(/<\/?[a-zA-Z][^>]*>/g, "")
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, (_m, alt: string) => (alt.trim() !== "" ? alt.trim() : "image"))
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)\]\[[^\]]*\]/g, "$1")
      .replace(/\[\^[^\]]+\]/g, "")
      .replace(/<(https?:\/\/[^>\s]+)>/g, "link")
      .replace(/\bhttps?:\/\/[^\s)]+/g, "link")
      .replace(/`{1,3}([^`]+)`{1,3}/g, "$1")
      .replace(/(\*\*|__)(.+?)\1/g, "$2")
      .replace(/(\*|_)(?=\S)(.+?)(?<=\S)\1/g, "$2")
      .replace(/~~(.+?)~~/g, "$1")
      .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, "$1")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * Turn markdown into text worth speaking. Code blocks and tables are announced, not
 * read; an empty result means there is nothing to say.
 */
export function speakableOf(markdown: string): Speakable {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let codeBlocks = 0;
  let tables = 0;
  let fence: { readonly mark: string; readonly lang: string; lines: number } | null = null;
  let equation = false;
  let tableRows = 0;

  const flushPara = (): void => {
    if (para.length > 0) out.push(para.join(" "));
    para = [];
  };
  const flushTable = (): void => {
    if (tableRows > 0) {
      tables += 1;
      flushPara();
      out.push(`Table, ${plural(tableRows, "row")}.`);
    }
    tableRows = 0;
  };

  for (const raw of lines) {
    if (fence) {
      if (new RegExp(`^\\s{0,3}${fence.mark[0] === "~" ? "~" : "`"}{${fence.mark.length},}\\s*$`).test(raw)) {
        codeBlocks += 1;
        flushPara();
        const where = fence.lang !== "" ? ` in ${fence.lang}` : "";
        out.push(`Code block${where}, ${plural(fence.lines, "line")}.`);
        fence = null;
      } else {
        fence.lines += 1;
      }
      continue;
    }
    if (equation) {
      if (raw.includes("$$")) {
        equation = false;
        flushPara();
        out.push("Equation.");
      }
      continue;
    }
    const open = FENCE.exec(raw);
    if (open) {
      flushTable();
      flushPara();
      fence = { mark: open[1] ?? "```", lang: open[2] ?? "", lines: 0 };
      continue;
    }
    if (/^\s*\$\$/.test(raw)) {
      flushTable();
      const rest = raw.replace(/^\s*\$\$/, "");
      if (!rest.includes("$$")) equation = true;
      else {
        flushPara();
        out.push("Equation.");
      }
      continue;
    }
    if (raw.includes("|") && raw.trim().startsWith("|")) {
      if (!TABLE_SEP.test(raw)) tableRows += 1;
      continue;
    }
    flushTable();
    if (raw.trim() === "") {
      flushPara();
      continue;
    }
    if (HR.test(raw)) {
      flushPara();
      continue;
    }
    const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(raw);
    if (heading) {
      flushPara();
      const t = inline(heading[1] ?? "");
      if (t !== "") out.push(endsSentence(t) ? t : `${t}.`);
      continue;
    }
    const item = /^\s*(?:[-*+]|\d{1,3}[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/.exec(raw);
    if (item) {
      flushPara();
      const t = inline(item[1] ?? "");
      if (t !== "") out.push(endsSentence(t) ? t : `${t}.`);
      continue;
    }
    const quoted = raw.replace(/^\s{0,3}(>\s?)+/, "");
    const t = inline(quoted);
    if (t !== "") para.push(t);
  }
  if (fence) {
    codeBlocks += 1;
    flushPara();
    out.push(`Code block${fence.lang !== "" ? ` in ${fence.lang}` : ""}, ${plural(fence.lines, "line")}.`);
  }
  flushTable();
  flushPara();
  return { text: out.join("\n\n"), codeBlocks, tables };
}

/** One unit the voice speaks: usually a sentence, split further when it is long. */
export interface SpeechChunk {
  /** 0-based position in the reading. */
  readonly index: number;
  readonly text: string;
  /** Offsets of `text` in the speakable text. */
  readonly start: number;
  readonly end: number;
}

/** Options for {@link chunkSpeech}. */
export interface ChunkOptions {
  /** Longest chunk in characters before it is split at a clause or space (default 220). */
  readonly maxChars?: number;
}

const ABBREVIATIONS = new Set([
  "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e", "no", "fig", "approx", "inc", "ltd", "co",
]);

/** True when the `.` at `i` ends an abbreviation or an initial rather than a sentence. */
function isAbbreviation(text: string, i: number): boolean {
  let s = i;
  while (s > 0 && /[A-Za-z.]/.test(text[s - 1] ?? "")) s -= 1;
  const word = text.slice(s, i).toLowerCase();
  if (word === "") return false;
  if (ABBREVIATIONS.has(word)) return true;
  return /^[a-z]$/.test(word) && /[A-Z]/.test(text[s] ?? "");
}

/** Split one over-long sentence at clauses, then spaces, so no piece exceeds `max`. */
function splitLong(text: string, start: number, max: number): Array<{ text: string; start: number }> {
  const out: Array<{ text: string; start: number }> = [];
  let from = 0;
  while (text.length - from > max) {
    const window = text.slice(from, from + max);
    let cut = Math.max(window.lastIndexOf("; "), window.lastIndexOf(", "), window.lastIndexOf(": "), window.lastIndexOf(" — "));
    if (cut < max * 0.4) cut = window.lastIndexOf(" ");
    if (cut <= 0) cut = max - 1;
    const piece = text.slice(from, from + cut + 1);
    out.push({ text: piece.trim(), start: start + from + (piece.length - piece.trimStart().length) });
    from += cut + 1;
    while (text[from] === " ") from += 1;
  }
  const rest = text.slice(from);
  if (rest.trim() !== "") out.push({ text: rest.trim(), start: start + from });
  return out.filter((p) => p.text !== "");
}

/**
 * Split speakable text into chunks, one per sentence, for sentence-level highlighting
 * and for engines that stall on long utterances. Newlines are always boundaries;
 * abbreviations (`Dr.`, `e.g.`), initials and decimals do not end a sentence.
 */
export function chunkSpeech(text: string, opts: ChunkOptions = {}): SpeechChunk[] {
  const max = Math.max(40, opts.maxChars ?? 220);
  const spans: Array<{ text: string; start: number }> = [];
  let sentenceStart = 0;
  const push = (end: number): void => {
    const raw = text.slice(sentenceStart, end);
    const trimmed = raw.trim();
    if (trimmed !== "") {
      const lead = raw.length - raw.trimStart().length;
      for (const piece of splitLong(trimmed, sentenceStart + lead, max)) spans.push(piece);
    }
  };
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i] ?? "";
    if (ch === "\n") {
      push(i);
      sentenceStart = i + 1;
      continue;
    }
    if (ch === "." || ch === "!" || ch === "?" || ch === "…") {
      let j = i + 1;
      while (j < text.length && /["')\]]/.test(text[j] ?? "")) j += 1;
      const next = text[j];
      const boundary = next === undefined || /\s/.test(next);
      if (!boundary) continue;
      if (ch === "." && isAbbreviation(text, i)) continue;
      push(j);
      sentenceStart = j;
      i = j - 1;
    }
  }
  push(text.length);
  return spans.map((s, index) => ({ index, text: s.text, start: s.start, end: s.start + s.text.length }));
}

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * True when `heard` is probably the voice's own output coming back through the
 * microphone (a fragment of the text being spoken), so it must not count as the
 * user barging in.
 */
export function isEcho(heard: string, spoken: string): boolean {
  const h = norm(heard);
  if (h === "") return true;
  return norm(spoken).includes(h);
}

/**
 * Where `sentence` sits in `haystack` (a rendered text's content), ignoring
 * whitespace differences. `null` when it is not there (markup the speech dropped
 * or rewrote, such as a bare URL). Offsets index `haystack`.
 */
export function locateInText(haystack: string, sentence: string): { readonly start: number; readonly end: number } | null {
  const needle = sentence.replace(/\s+/g, " ").trim();
  if (needle === "") return null;
  const map: number[] = [];
  let flat = "";
  let lastSpace = true;
  for (let i = 0; i < haystack.length; i += 1) {
    const ch = haystack[i] ?? "";
    if (/\s/.test(ch)) {
      if (!lastSpace) {
        flat += " ";
        map.push(i);
      }
      lastSpace = true;
    } else {
      flat += ch;
      map.push(i);
      lastSpace = false;
    }
  }
  const at = flat.indexOf(needle);
  if (at < 0) return null;
  const start = map[at];
  const last = map[at + needle.length - 1];
  if (start === undefined || last === undefined) return null;
  return { start, end: last + 1 };
}
