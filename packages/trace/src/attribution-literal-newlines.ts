// packages/trace/src/attribution-literal-newlines.ts
//
// Literal `\n` in prose deliverables (tool-result budget spike,
// wiki/Research/Harness-Reports/2026-11-07-tool-result-budget-spike.md, F3).
// All 5 gpt-4o-mini lh-1 failures, plus one llama3.2:3b run, wrote `report.md`
// and `sources.md` as one line with literal backslash-n: the model sent `\\n`
// in the tool-call arguments and the write boundary saved it as is. The grader's
// URL regex does not stop at a backslash, so adjacent URLs fused into one.
//
//   harness:unrepaired-content  the last successful write of a failing prose file
//                               (.md/.markdown/.txt/.rst/.csv) holds no real newline
//                               and at least two literal `\n`; a content-preserving
//                               repair (unescape `\n`, `\r\n`, `\t`) restores its lines
//                               and the boundary wrote it unrepaired
//
// Owner: the harness, by the same rule as `harness:refused-repairable`
// (attribution-refusal.ts, c756cbd6e): when a deterministic, content-preserving
// repair at the write boundary would have saved the file, the loss is the
// harness's. The repair is the one the tools package applies
// (packages/tools/src/healing/literal-newlines.ts); the conditions are copied
// here because trace depends on core only. Always `probable`: the trace cannot
// rerun the grader on the repaired text, and the file may fail for other reasons
// too (the evidence line says how many URL tokens the repair separates).

import { ev1, baseName, argPath, contentArg, type Rule } from "./attribution-facts.js";

/** Prose extensions whose content is read as lines (tools TEXT_FILE_EXTENSIONS). */
const TEXT_FILE = /\.(md|markdown|txt|rst|csv)$/i;
/** Fewest literal `\n` sequences that count as the escaping defect (tools MIN_LITERAL_NEWLINES). */
const MIN_LITERAL_NEWLINES = 2;
/** An escaped backslash (kept as written), or one of the sequences the repair unescapes. */
const ESCAPE_SEQUENCE = /\\\\|\\r\\n|\\n|\\t/g;
/**
 * A URL as a whitespace-delimited matcher reads one (the lh-1 grader's
 * `https?://[^\s)\]"'<>]+`): it does not stop at a backslash, so URLs joined by a
 * literal `\n` read as one.
 */
const SPACE_DELIMITED_URL = /https?:\/\/[^\s)\]"'<>]+/g;
const urlCount = (text: string): number => new Set(text.match(SPACE_DELIMITED_URL) ?? []).size;

/**
 * The text a literal-newline repair turns `text` into, or undefined when the
 * defect is absent: a real newline is present, or fewer than two literal `\n`.
 * Rewrites only `\r\n`, `\n` and `\t`; `\\` and every other backslash stay.
 */
export function unescapedLiteralNewlines(text: string): string | undefined {
  if (text.includes("\n")) return undefined;
  let n = 0;
  for (const m of text.matchAll(ESCAPE_SEQUENCE)) if (m[0] !== "\\\\" && m[0] !== "\\t") n++;
  if (n < MIN_LITERAL_NEWLINES) return undefined;
  return text.replace(ESCAPE_SEQUENCE, (s) => (s === "\\\\" ? s : s === "\\t" ? "\t" : "\n"));
}

/** The last successful write of a failing prose file holds literal `\n` and no real newline. */
export const ruleUnrepairedContent: Rule = ({ divergences }) => {
  for (const d of divergences) {
    const w = d?.write;
    const path = w === undefined ? undefined : argPath(w.args);
    if (w === undefined || path === undefined || !TEXT_FILE.test(path)) continue;
    const content = contentArg(w.args);
    const repaired = content === undefined ? undefined : unescapedLiteralNewlines(content);
    if (content === undefined || repaired === undefined) continue;
    const literal = content.split("\\n").length - 1;
    const before = urlCount(content), after = urlCount(repaired);
    return {
      reason: "harness:unrepaired-content",
      target: d!.target,
      divergence: d!,
      evidence: [ev1(w,
        `${w.toolName} wrote ${baseName(path)} as one line: ${literal} literal \\n, no real newline; ` +
        `unescaping restores ${repaired.split("\n").length} lines` +
        (before !== after ? `; a whitespace-delimited URL match reads ${before} URL(s) as written, ${after} after` : ""))],
      needs: ["a regrade of the repaired content (the trace cannot rerun the grader)"],
    };
  }
  return undefined;
};
