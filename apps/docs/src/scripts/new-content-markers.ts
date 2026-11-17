/**
 * Table-of-contents icons. The route middleware computes the marked headings
 * at build time (author `<Since>` tags, release structure on What's New, and
 * parent roll-ups; see `tocMarks` in content/indicators.ts) and embeds them
 * as `#ra-toc-markers` JSON keyed by heading slug. This sets the same icon
 * attributes on the matching TOC links ("new" filled dot, "updated" ring; see
 * custom.css) with the accessible name from the label.
 */
type TocLink = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
};

export type SectionMarker = { readonly kind: "new" | "updated"; readonly label: string };

/** Parse the embedded `#ra-toc-markers` JSON into slug to marker; never throws, drops malformed entries. */
export function parseTocMarks(text: string | null | undefined): Map<string, SectionMarker> {
  const out = new Map<string, SectionMarker>();
  if (!text) return out;
  try {
    const raw: unknown = JSON.parse(text);
    if (!raw || typeof raw !== "object") return out;
    for (const [slug, v] of Object.entries(raw as Record<string, { kind?: unknown; label?: unknown }>)) {
      if ((v.kind === "new" || v.kind === "updated") && typeof v.label === "string") out.set(slug, { kind: v.kind, label: v.label });
    }
  } catch {
    // Malformed JSON: no markers.
  }
  return out;
}

/* ── Hub / overview child lists ───────────────────────────────────────
   Router tables and "what's next" lists link to child pages. The route
   middleware embeds every marked page (kind + "New in 0.19: Section, ...")
   as JSON; this decorates the row's primary link with the same icon so a hub
   shows which children, and which sections inside them, are new. */

export type MarkIndex = Readonly<Record<string, { readonly kind: "new" | "updated"; readonly label: string }>>;

/** Parse the embedded `#ra-marker-index` JSON; never throws. */
export function parseMarkIndex(text: string | null | undefined): MarkIndex {
  if (!text) return {};
  try {
    const raw: unknown = JSON.parse(text);
    return raw && typeof raw === "object" ? (raw as MarkIndex) : {};
  } catch {
    return {};
  }
}

/** Link href to a canonical docs path ("/guides/memory/"), or null for external / hash-only / non-docs links. */
export function docsPathOf(href: string | null, origin = ""): string | null {
  if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) return null;
  let path = href;
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
    if (!origin || !href.startsWith(origin)) return null;
    path = href.slice(origin.length);
  }
  path = path.split("#")[0]!.split("?")[0]!;
  if (!path.startsWith("/")) return null;
  return path.endsWith("/") ? path : `${path}/`;
}

export type HubLink = {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  after(node: unknown): void;
};

/** Selector for the primary link of a hub row: list items, first table column, link cards. */
export const HUB_LINK_SELECTOR = [
  ".sl-markdown-content li > a:first-child",
  ".sl-markdown-content li > strong:first-child > a",
  ".sl-markdown-content td:first-child a",
  ".sl-markdown-content .sl-link-card a",
].join(", ");

/**
 * Append a marker icon after each marked child link. `makeIcon` builds the
 * element (kept injectable so this stays DOM-free in tests). Returns how many
 * were decorated. Skips the current page and links already decorated.
 */
export function applyHubMarkers(
  links: Iterable<HubLink>,
  index: MarkIndex,
  currentPath: string,
  makeIcon: (kind: "new" | "updated", label: string) => unknown,
  origin = "",
): number {
  let n = 0;
  for (const link of links) {
    if (link.getAttribute("data-ra-hub-marked")) continue;
    const path = docsPathOf(link.getAttribute("href"), origin);
    const mark = path && path !== currentPath ? index[path] : undefined;
    if (!mark) continue;
    link.setAttribute("data-ra-hub-marked", "1");
    link.after(makeIcon(mark.kind, mark.label));
    n++;
  }
  return n;
}

/** Set the icon attributes on TOC links whose `#id` is a marked heading; clear stale ones. */
export function applyTocSectionMarkers(links: Iterable<TocLink>, marked: ReadonlyMap<string, SectionMarker>): void {
  for (const link of links) {
    link.removeAttribute("data-ra-new-content");
    link.removeAttribute("data-ra-marker-label");
    const href = link.getAttribute("href");
    const m = href?.startsWith("#") ? marked.get(decodeURIComponent(href.slice(1))) : undefined;
    if (m) {
      link.setAttribute("data-ra-new-content", m.kind);
      link.setAttribute("data-ra-marker-label", m.label);
    }
  }
}
