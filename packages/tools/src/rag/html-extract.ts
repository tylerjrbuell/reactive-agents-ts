/**
 * HTML main-content extraction for the RAG html loader.
 *
 * Pure, dependency-free, regex-based. Not a conformant HTML parser: it targets
 * the shape of documentation/article pages (Starlight, Docusaurus, blogs).
 */

/** Elements removed wholesale (content included). */
const DROP_ELEMENTS = [
  "head",
  "script",
  "style",
  "noscript",
  "svg",
  "template",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  "form",
  "button",
  "select",
  "dialog",
  "starlight-menu-button",
  "starlight-search",
  "starlight-theme-select",
];

const BLOCK_TAGS =
  "p|div|br|h[1-6]|li|ul|ol|tr|td|th|blockquote|pre|hr|section|article|main|table|dt|dd";

const ENTITIES: Readonly<Record<string, string>> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/** Return the outermost `<main>` or `<article>` inner HTML, or undefined. */
function findMainRegion(html: string): string | undefined {
  for (const tag of ["main", "article"]) {
    const open = new RegExp(`<${tag}(?:\\s[^>]*)?>`, "i").exec(html);
    if (!open) continue;
    const start = open.index + open[0].length;
    const end = html.toLowerCase().lastIndexOf(`</${tag}>`);
    if (end > start) return html.slice(start, end);
  }
  return undefined;
}

/**
 * Convert an HTML document to readable main-content text.
 *
 * Prefers the `<main>` (else `<article>`) region; drops script/style/noscript/svg,
 * nav/header/footer/aside, forms/buttons/selects, screen-reader-only spans and
 * "skip to" links. Block elements become newlines; common entities are decoded.
 * Text appearing in headings, lists and code blocks is preserved.
 *
 * @param html - Raw HTML source.
 * @returns Plain text with collapsed blank lines (may be empty).
 */
export function extractHtmlText(html: string): string {
  // Comments first so commented-out markup cannot confuse later passes.
  let region = html.replace(/<!--[\s\S]*?-->/g, "");
  region = findMainRegion(region) ?? region;

  for (const tag of DROP_ELEMENTS) {
    region = region.replace(
      new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}\\s*>`, "gi"),
      "",
    );
  }

  return region
    // screen-reader-only spans (e.g. Starlight heading-anchor labels)
    .replace(/<span\s[^>]*class="[^"]*\bsr-only\b[^"]*"[^>]*>[\s\S]*?<\/span>/gi, "")
    // in-page "skip to ..." links
    .replace(/<a\s[^>]*href="#[^"]*"[^>]*>\s*skip to[\s\S]*?<\/a>/gi, "")
    .replace(new RegExp(`</?(?:${BLOCK_TAGS})(?:\\s[^>]*)?/?>`, "gi"), "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(?:lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
