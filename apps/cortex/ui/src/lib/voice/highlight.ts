/**
 * Sentence highlighting for read-aloud, through the CSS Custom Highlight API: the
 * sentence being spoken is found in the rendered answer's text (`locateInText`,
 * ui-core) and painted as `::highlight(cortex-reading)` (styled in `app.css`), with
 * no change to the DOM. Browsers without the API show only the reader bar's sentence
 * strip. A sentence the speech rewrote (a bare URL read as "link") is not found and
 * simply gets no highlight.
 */
import { locateInText } from "@reactive-agents/ui-core";

/** Name of the highlight the stylesheet paints. */
export const READING_HIGHLIGHT = "cortex-reading";

interface HighlightRegistryLike {
  set(name: string, highlight: unknown): unknown;
  delete(name: string): unknown;
}

const registry = (): HighlightRegistryLike | undefined => {
  const css: unknown = Reflect.get(globalThis, "CSS");
  const reg = typeof css === "object" && css !== null ? Reflect.get(css, "highlights") : undefined;
  return typeof reg === "object" && reg !== null && typeof Reflect.get(reg, "set") === "function" ? (reg as HighlightRegistryLike) : undefined;
};

/** Remove the reading highlight. */
export function clearReadingHighlight(): void {
  registry()?.delete(READING_HIGHLIGHT);
}

/**
 * Highlight `sentence` inside `root` and scroll it into view. Returns whether it was
 * found. Safe to call when the API or the element is missing.
 */
export function highlightSentence(root: Element | null, sentence: string): boolean {
  const reg = registry();
  const HighlightCtor: unknown = Reflect.get(globalThis, "Highlight");
  if (reg === undefined || typeof HighlightCtor !== "function" || root === null) return false;
  const nodes: Array<{ node: Text; start: number }> = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n !== null; n = walker.nextNode()) {
    if (n.nodeType === Node.TEXT_NODE) {
      const t = n as Text;
      nodes.push({ node: t, start: text.length });
      text += t.data;
    }
  }
  const at = locateInText(text, sentence) ?? locateInText(text, sentence.replace(/[.:;]+$/, ""));
  if (at === null) {
    reg.delete(READING_HIGHLIGHT);
    return false;
  }
  const locate = (offset: number, end: boolean): { node: Text; offset: number } | null => {
    for (const { node, start } of nodes) {
      const len = node.data.length;
      if (offset < start + len || (end && offset === start + len)) return { node, offset: Math.max(0, offset - start) };
    }
    return null;
  };
  const a = locate(at.start, false);
  const b = locate(at.end, true);
  if (a === null || b === null) return false;
  const range = document.createRange();
  range.setStart(a.node, a.offset);
  range.setEnd(b.node, b.offset);
  reg.set(READING_HIGHLIGHT, Reflect.construct(HighlightCtor, [range]));
  // `auto`, not `smooth`: a sentence per second would otherwise keep the page in motion (and ignore reduced motion).
  a.node.parentElement?.scrollIntoView({ block: "nearest", behavior: "auto" });
  return true;
}
