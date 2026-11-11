/**
 * Quote-aware command-line splitting shared by shell-execute's allow-list
 * (skills/shell-execution.ts) and the read-only git/gh check
 * (skills/shell-git-readonly.ts). Leaf module: imports nothing.
 */

/**
 * Split a (potentially chained) command pipeline into segments on `&&`,
 * `||`, `;`, `|` and `|&` — but only outside quoted strings so jq filters like
 * `'.[] | .field'` are preserved.
 */
export function splitCommandSegments(trimmed: string): string[] {
  const segments: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    const next = i + 1 < trimmed.length ? trimmed[i + 1] : "";

    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      current += ch;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      current += ch;
      continue;
    }

    const outsideQuotes = !inSingleQuote && !inDoubleQuote;
    if (outsideQuotes) {
      // `|&` pipes stdout and stderr: a pipe, so the next word starts a segment.
      if (ch === "|" && next === "&") {
        segments.push(current.trim());
        current = "";
        i += 1;
        continue;
      }
      if (ch === ";" || ch === "|") {
        segments.push(current.trim());
        current = "";
        continue;
      }
      if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
        segments.push(current.trim());
        current = "";
        i += 1; // consume second operator char
        continue;
      }
    }

    current += ch;
  }
  segments.push(current.trim());
  return segments;
}

/**
 * Split one segment into the words `sh` would pass as argv: whitespace
 * outside quotes separates words, quotes are removed, and a backslash escapes
 * the next character (inside double quotes only `"`, `\`, `$` and backtick,
 * as in sh). So `git 'con'fig` yields
 * `["git", "config"]`, the word git receives. Expansions are not handled;
 * shell-execute refuses them before this runs.
 */
export function shellWords(segment: string): string[] {
  const words: string[] = [];
  let current = "";
  let inWord = false;
  let quote: "'" | '"' | null = null;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]!;
    if (quote === "'") {
      if (ch === "'") quote = null;
      else current += ch;
      continue;
    }
    if (quote === '"') {
      // Inside double quotes a backslash escapes only " \ $ and backtick.
      if (ch === "\\" && i + 1 < segment.length && '"\\$`'.includes(segment[i + 1]!)) current += segment[++i]!;
      else if (ch === '"') quote = null;
      else current += ch;
      continue;
    }
    if (ch === "\\" && i + 1 < segment.length) {
      current += segment[++i]!;
      inWord = true;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      inWord = true;
      continue;
    }
    if (/\s/.test(ch)) {
      if (inWord) words.push(current);
      current = "";
      inWord = false;
      continue;
    }
    current += ch;
    inWord = true;
  }
  if (inWord) words.push(current);
  return words;
}

/**
 * True when the unquoted `&` at index `i` belongs to a redirect rather than
 * backgrounding a command: right after `<` or `>` (fd dup such as `2>&1`,
 * `>&2`, `<&0`), right after `|` (`|&` pipes stderr too), or right before `>`
 * (`&>file`, `&>>file`). Every other lone `&` runs the command in the
 * background.
 *
 * @example
 * isRedirectAmpersand("make 2>&1", 7); // true
 * isRedirectAmpersand("sleep 1 & ls", 8); // false
 */
export function isRedirectAmpersand(command: string, i: number): boolean {
  const prev = i > 0 ? command[i - 1] : "";
  return prev === "<" || prev === ">" || prev === "|" || command[i + 1] === ">";
}

/**
 * Words of `command` that may name a file, for the sandbox path check. Splits
 * on whitespace and on the redirect and control characters `< > & | ;`, so a
 * glued redirect target (`2>/etc/x`, `&>../x`, `cmd>/x`) is its own word.
 * Splitting more than sh does only adds words to check.
 */
export function pathCandidateTokens(command: string): string[] {
  return command.split(/[\s<>&|;]+/).filter((token) => token !== "");
}

/** Characters that end an unquoted shell word. */
const WORD_END = /[\s<>&|;()]/;

/**
 * `command` with every redirect whose target word is exactly `/dev/null`
 * blanked out: `2>/dev/null`, `>/dev/null`, `1>/dev/null`, `&>/dev/null`,
 * `>>/dev/null`, `2>>/dev/null`, `>&/dev/null`, `</dev/null`, with or
 * without a space before the target and with the target quoted or not. Each
 * blanked character becomes a space, so nothing else shifts or joins.
 *
 * The target is read as sh reads a word: it ends at unquoted whitespace or at
 * `< > & | ; ( )`, and its quotes are removed before the comparison. So
 * `2>/dev/null>/etc/x` blanks only `2>/dev/null` and leaves `>/etc/x` for the
 * checks, and `>/dev/null2`, `>/dev/null/x` and `>/dev/./sda` stay as written.
 * Here-documents (`<<`) are left alone.
 *
 * shell-execute runs its default block-list and its sandbox path check on
 * this text, so discarding output is allowed while every other `/dev/` path
 * is still refused. The command that runs is the original one.
 *
 * @example
 * withoutNullRedirects("make 2>/dev/null"); // "make            "
 * withoutNullRedirects("cat x >/dev/sda"); // unchanged
 */
export function withoutNullRedirects(command: string): string {
  const chars = command.split("");
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === "\\") i++;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch !== "<" && ch !== ">") continue;
    if (ch === "<" && command[i + 1] === "<") {
      i++; // here-document operator: its word is a delimiter, not a file
      continue;
    }
    // Operator start: a leading `&` (`&>`), or fd digits that begin a word (`2>`).
    let start = i;
    if (ch === ">" && command[i - 1] === "&") start = i - 1;
    else {
      let d = i;
      while (d > 0 && /\d/.test(command[d - 1]!)) d--;
      if (d < i && (d === 0 || WORD_END.test(command[d - 1]!))) start = d;
    }
    // Operator end: `>>`, `>|`, `>&`, `<>`, `<&` take one more character.
    let end = i + 1;
    if ((ch === ">" && /[>|&]/.test(command[end] ?? "")) || (ch === "<" && /[>&]/.test(command[end] ?? ""))) end++;
    // Target word: optional blanks, then characters up to an unquoted word end.
    let w = end;
    while (w < command.length && (command[w] === " " || command[w] === "\t")) w++;
    let wordEnd = w;
    let q: "'" | '"' | null = null;
    while (wordEnd < command.length) {
      const c = command[wordEnd]!;
      if (q !== null) {
        if (c === q) q = null;
        else if (q === '"' && c === "\\") wordEnd++;
      } else if (c === "\\") wordEnd++;
      else if (c === "'" || c === '"') q = c;
      else if (WORD_END.test(c)) break;
      wordEnd++;
    }
    const target = shellWords(command.slice(w, Math.min(wordEnd, command.length)));
    if (target.length === 1 && target[0] === "/dev/null") {
      for (let k = start; k < wordEnd && k < chars.length; k++) chars[k] = " ";
      i = wordEnd - 1;
    } else {
      i = end - 1;
    }
  }
  return chars.join("");
}

/**
 * True when `command` has an output redirect (`>`, `>>`, `>|`, `&>`, `2>`,
 * `>&file`) outside quotes. An escaped `\>` is a literal character, not a
 * redirect. A file-descriptor dup (`2>&1`, `>&2`, `2>&-`) writes no file, so
 * it does not count.
 */
export function hasOutputRedirect(command: string): boolean {
  let quote: "'" | '"' | null = null;
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]!;
    if (quote !== null) {
      if (ch === quote) quote = null;
      else if (quote === '"' && ch === "\\") i++;
      continue;
    }
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "'" || ch === '"') quote = ch;
    else if (ch === ">") {
      const dup = /^&(?:\d+|-)(?=$|[\s|;&<>)])/.exec(command.slice(i + 1));
      if (dup === null) return true;
      i += dup[0].length;
    }
  }
  return false;
}
