/**
 * Saving and sharing a final answer: a file name from its own title, a standalone HTML
 * page from the already-sanitized rendered body, and the labels the toolbar uses. Pure.
 */
import { outlineOf, slugOf } from "@reactive-agents/ui-core";

/** The answer's title: its first heading, else its first non-empty line (cut), else "Answer". */
export function answerTitleOf(markdown: string): string {
  const heading = outlineOf(markdown, { minEntries: 0, maxDepth: 6 })[0];
  if (heading) return heading.text;
  const line = markdown.split("\n").map((l) => l.replace(/^[#>*\-\s]+/, "").trim()).find((l) => l !== "");
  if (!line) return "Answer";
  return line.length > 70 ? `${line.slice(0, 67)}...` : line;
}

/** `title-slug.md` / `.html`: a file name a person would choose. */
export function exportFileName(markdown: string, ext: "md" | "html"): string {
  const slug = slugOf(answerTitleOf(markdown)).slice(0, 60).replace(/-+$/, "");
  return `${slug === "" ? "answer" : slug}.${ext}`;
}

const escapeHtml = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A self-contained HTML page around a rendered answer body. `bodyHtml` must already be
 * sanitized (it is the output of the markdown pipeline); the page adds no script.
 */
export function htmlDocument(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${escapeHtml(title)}</title>
<style>
body { max-width: 46rem; margin: 2.5rem auto; padding: 0 1rem; font: 16px/1.6 system-ui, sans-serif; color: #1a1a1f; }
h1, h2, h3 { line-height: 1.25; }
pre { padding: 12px; overflow-x: auto; background: #f4f4f7; border-radius: 6px; }
code { font-family: ui-monospace, monospace; font-size: 0.9em; }
table { border-collapse: collapse; } th, td { padding: 6px 14px 6px 0; border-bottom: 1px solid #ddd; text-align: left; }
blockquote { margin-left: 0; padding-left: 12px; border-left: 3px solid #bbb; color: #444; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}
