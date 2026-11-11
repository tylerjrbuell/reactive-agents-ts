/**
 * Quote-aware command-line splitting shared by shell-execute's allow-list
 * (skills/shell-execution.ts) and the read-only git/gh check
 * (skills/shell-git-readonly.ts). Leaf module: imports nothing.
 */

/**
 * Split a (potentially chained) command pipeline into segments on `&&`,
 * `||`, `;`, and `|` — but only outside quoted strings so jq filters like
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
 * True when `command` has an output redirect (`>`, `>>`, `>|`, `&>`, `2>`)
 * outside quotes. An escaped `\>` is a literal character, not a redirect.
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
    else if (ch === ">") return true;
  }
  return false;
}
