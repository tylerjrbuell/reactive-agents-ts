/**
 * Post-render touches on sanitized markdown HTML: GitHub-style callouts
 * (`> [!NOTE]`), a language label on code blocks, and anchor ids on headings so the
 * answer's outline can scroll to them. DOM-only; the decisions are ui-core's
 * (`calloutKindOf`, `outlineOf`). Nothing here inserts HTML: only attributes, classes
 * and text nodes, so sanitized output stays sanitized.
 */
import { calloutKindOf, type OutlineEntry } from "@reactive-agents/ui-core";

const CALLOUT_TITLE: Readonly<Record<string, string>> = { note: "Note", tip: "Tip", important: "Important", warning: "Warning", caution: "Caution" };

/** Language name of a code block, from `class="language-ts"` on its `<code>`. */
export function codeLanguageOf(className: string): string | null {
  const m = /(?:^|\s)language-([A-Za-z0-9_+#-]+)/.exec(className);
  return m ? m[1]! : null;
}

/** Apply callouts, code language labels and heading ids to rendered markdown. */
export function decorateRendered(root: HTMLElement, outline: readonly OutlineEntry[]): void {
  for (const bq of Array.from(root.querySelectorAll("blockquote"))) {
    const first = bq.firstElementChild;
    const kind = first ? calloutKindOf(first.textContent ?? "") : null;
    if (!first || kind === null || bq.classList.contains("callout")) continue;
    bq.classList.add("callout", `callout-${kind}`);
    bq.setAttribute("data-callout", CALLOUT_TITLE[kind] ?? kind);
    // Drop the `[!KIND]` marker from the first text node.
    const walker = document.createTreeWalker(first, NodeFilter.SHOW_TEXT);
    const node = walker.nextNode();
    if (node?.textContent) node.textContent = node.textContent.replace(/^\s*\[![A-Za-z]+\]\s*/, "");
  }
  for (const code of Array.from(root.querySelectorAll("pre > code"))) {
    const lang = codeLanguageOf(code.className);
    if (lang) code.parentElement?.setAttribute("data-lang", lang);
  }
  let next = 0;
  for (const h of Array.from(root.querySelectorAll("h1, h2, h3"))) {
    // Headings are matched to the outline by their text, in order (a heading inside a quote or list is skipped).
    const text = (h.textContent ?? "").trim();
    const at = outline.findIndex((e, idx) => idx >= next && e.text === text);
    if (at >= 0) {
      h.setAttribute("id", outline[at]!.id);
      next = at + 1;
    }
  }
}
