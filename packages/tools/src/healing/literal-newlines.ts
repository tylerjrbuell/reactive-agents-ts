/**
 * literal-newlines.ts — repair for prose file content written as one line
 * with literal backslash-n sequences instead of line breaks.
 *
 * Witness (tool-result budget spike 2026-11-07,
 * `wiki/Research/Harness-Reports/2026-11-07-tool-result-budget-spike.md`):
 * 5 of 5 gpt-4o-mini lh-1 failures, plus one llama3.2:3b run, wrote
 * `report.md` / `sources.md` with literal `\n` because the model sent `\\n`
 * inside the tool-call arguments. The saved file was one line and fused the
 * URLs the grader looks for.
 *
 * The repair fires only when the evidence is unambiguous: the text has zero
 * real newlines and at least two literal `\n` sequences. It rewrites only
 * `\r\n`, `\n` and `\t`; an escaped backslash (`\\`) and every other
 * backslash stay as written. Callers restrict it to prose paths
 * ({@link isTextFilePath}); code and JSON files are never rewritten, since a
 * literal `\n` there is usually meant.
 *
 * Pure.
 */
import { hasFileExtension } from "./path-resolver.js"

/** Prose file extensions whose content is read as lines of text. */
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([".md", ".markdown", ".txt", ".rst", ".csv"])

/** True when `filePath` ends in a {@link TEXT_FILE_EXTENSIONS} extension (case-insensitive). */
export function isTextFilePath(filePath: string): boolean {
  return hasFileExtension(filePath, TEXT_FILE_EXTENSIONS)
}

/** Fewest literal `\n` sequences that count as evidence of the escaping defect. */
const MIN_LITERAL_NEWLINES = 2

/** An escaped backslash (kept as written), or one of the sequences unescaped. */
const ESCAPE_SEQUENCE = /\\\\|\\r\\n|\\n|\\t/g

/**
 * Unescape literal `\r\n`, `\n` and `\t` in `text` when it has no real
 * newline and at least two literal `\n`. Returns `undefined` when the rule
 * does not apply. `count` is the number of sequences rewritten.
 */
export function unescapeLiteralNewlines(text: string): { readonly text: string; readonly count: number } | undefined {
  if (text.includes("\n")) return undefined
  let literalNewlines = 0
  for (const match of text.matchAll(ESCAPE_SEQUENCE)) {
    if (match[0] !== "\\\\" && match[0] !== "\\t") literalNewlines++
  }
  if (literalNewlines < MIN_LITERAL_NEWLINES) return undefined
  let count = 0
  const out = text.replace(ESCAPE_SEQUENCE, (seq) => {
    if (seq === "\\\\") return seq
    count++
    return seq === "\\t" ? "\t" : "\n"
  })
  return { text: out, count }
}
