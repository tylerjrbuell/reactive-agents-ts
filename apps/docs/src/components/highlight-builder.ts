/**
 * Tiny deterministic highlighter for the golden-run builder snippet.
 *
 * Input is the verbatim `capture.builderLines` written by capture-golden-run.ts
 * (itself derived from packages/benchmarks/scripts/golden-run-builder.ts), so the
 * displayed code is never hand-copied. Output is HTML using the existing
 * `.rk` (keyword), `.rm` (method), `.rs` (string), `.rc` (comment) span classes.
 */

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const KEYWORDS = new Set(["const", "await"]);

/** Highlight one line of TypeScript from the builder chain. */
export const highlightLine = (line: string): string => {
  const safe = escapeHtml(line);
  const commentAt = safe.indexOf("//");
  const code = commentAt === -1 ? safe : safe.slice(0, commentAt);
  const comment = commentAt === -1 ? "" : safe.slice(commentAt);
  const out = code.replace(
    /("(?:[^"\\]|\\.)*")|(\.[A-Za-z_]\w*)(?=\()|\b([A-Za-z_]\w*)\b/g,
    (m: string, str?: string, method?: string, word?: string) => {
      if (str) return `<span class="rs">${str}</span>`;
      if (method) return `.<span class="rm">${method.slice(1)}</span>`;
      if (word && KEYWORDS.has(word)) return `<span class="rk">${word}</span>`;
      return m;
    },
  );
  return out + (comment ? `<span class="rc">${comment}</span>` : "");
};

/**
 * Full displayed snippet: the captured builder chain, then the run call with the
 * captured task. Returns one HTML string per line.
 */
export const builderSnippet = (builderLines: readonly string[], task: string): string[] => {
  const lines = [...builderLines, "", `const result = await agent.run(${JSON.stringify(task)})`];
  return lines.map(highlightLine);
};
