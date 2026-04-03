/**
 * Split markdown so `$$...$$` display math can be rendered with KaTeX while the rest
 * goes through marked + DOMPurify. Fenced ``` code blocks are not scanned for `$$`.
 */
export type MarkdownMathSegment =
  | { readonly kind: "markdown"; readonly text: string }
  | { readonly kind: "math"; readonly text: string };

export function splitMarkdownAndDisplayMath(src: string): MarkdownMathSegment[] {
  const out: MarkdownMathSegment[] = [];
  let i = 0;
  let buf = "";
  let inFence = false;

  while (i < src.length) {
    if (!inFence && src.startsWith("```", i)) {
      const lineEnd = src.indexOf("\n", i + 3);
      if (lineEnd === -1) {
        buf += src.slice(i);
        break;
      }
      buf += src.slice(i, lineEnd + 1);
      i = lineEnd + 1;
      inFence = true;
      continue;
    }
    if (inFence) {
      const close = src.indexOf("```", i);
      if (close === -1) {
        buf += src.slice(i);
        break;
      }
      buf += src.slice(i, close + 3);
      i = close + 3;
      inFence = false;
      continue;
    }
    if (src.startsWith("$$", i)) {
      const end = src.indexOf("$$", i + 2);
      if (end === -1) {
        buf += "$$";
        i += 2;
        continue;
      }
      if (buf.length > 0) {
        out.push({ kind: "markdown", text: buf });
        buf = "";
      }
      i += 2;
      const tex = src.slice(i, end).trim();
      if (tex.length > 0) out.push({ kind: "math", text: tex });
      i = end + 2;
      continue;
    }
    buf += src[i]!;
    i++;
  }
  if (buf.length > 0) out.push({ kind: "markdown", text: buf });
  return out;
}

const PURIFY_TAGS = [
  "p", "br", "strong", "b", "em", "i", "u", "s",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li",
  "blockquote",
  "code", "pre",
  "a", "hr",
  "table", "thead", "tbody", "tr", "th", "td",
  "del", "ins", "span",
] as const;

const PURIFY_ATTR = ["href", "title", "colspan", "rowspan", "class"] as const;

/**
 * Renders markdown + `$$` display math to a safe HTML string (KaTeX blocks are not re-sanitized;
 * LaTeX is passed only through KaTeX, which does not execute scripts).
 */
export async function renderMarkdownWithMath(markdown: string): Promise<string> {
  const [{ parse }, { default: DOMPurify }, katexMod] = await Promise.all([
    import("marked"),
    import("dompurify"),
    import("katex"),
  ]);
  const katex = katexMod.default;

  const segments = splitMarkdownAndDisplayMath(markdown);
  const parts: string[] = [];

  for (const seg of segments) {
    if (seg.kind === "markdown") {
      if (seg.text.length === 0) continue;
      const raw = parse(seg.text);
      const str = typeof raw === "string" ? raw : String(raw);
      parts.push(
        DOMPurify.sanitize(str, {
          ALLOWED_TAGS: [...PURIFY_TAGS],
          ALLOWED_ATTR: [...PURIFY_ATTR],
        }),
      );
    } else {
      try {
        const rendered = katex.renderToString(seg.text, {
          displayMode: true,
          throwOnError: false,
          strict: "ignore",
          trust: false,
        });
        parts.push(
          `<div class="katex-display-shell overflow-x-auto py-2 -mx-1 px-1" role="img" aria-label="Equation">${rendered}</div>`,
        );
      } catch {
        parts.push(
          `<pre class="font-mono text-[10px] text-error/70 whitespace-pre-wrap break-words border border-error/20 rounded p-2 my-2">${escapeHtml(seg.text)}</pre>`,
        );
      }
    }
  }

  return parts.join("");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
