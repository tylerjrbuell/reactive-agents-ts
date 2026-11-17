/**
 * Sidebar indicators from authored frontmatter (stability, since/updated) and
 * `<Since>` heading tags for every page, plus roll-ups and the What's New
 * group's version badge. Replaces hand-written badges in astro.config.mjs.
 *
 * Sidebar links carry compact attributes that CSS draws as glyphs (see
 * `sidebarAttrs`), never a wide text pill. Groups carry a roll-up badge when a
 * descendant is new/updated; its text is visually hidden (custom.css) and is
 * the accessible name. The same marks are embedded as JSON so hub pages can
 * decorate their child lists (new-content-markers). Also fails the build when
 * a sidebar label repeats the stability tier its indicator already shows.
 */
import { getCollection } from "astro:content";
import { defineRouteMiddleware } from "@astrojs/starlight/route-data";
import {
  CURRENT_RELEASE,
  extractHeadings,
  extractSectionMarkers,
  formatMinor,
  indicatorsFor,
  pageMarkFor,
  pagePathFromDocId,
  redundantStabilityLabel,
  rollupFor,
  sidebarAttrs,
  tocMarks,
  type TocNode,
  type IndicatorFrontmatter,
  type PageIndicators,
  type PageMark,
} from "./content/indicators";

const WHATS_NEW_PATH = "/guides/whats-new/";

interface Entry {
  readonly ind: PageIndicators;
  readonly mark: PageMark | undefined;
}

let table: Promise<Map<string, Entry>> | null = null;

function loadTable(): Promise<Map<string, Entry>> {
  table ??= getCollection("docs").then(
    (pages) =>
      new Map(
        pages.map((p) => {
          const data = p.data as IndicatorFrontmatter;
          return [
            pagePathFromDocId(p.id),
            {
              ind: indicatorsFor(data, CURRENT_RELEASE),
              mark: pageMarkFor(data, extractSectionMarkers(p.body ?? ""), CURRENT_RELEASE),
            },
          ] as const;
        }),
      ),
  );
  return table;
}

type Marked = { label: string; mark: PageMark };

/** Decorate entries in place; returns every marked page beneath them. */
function walkSidebar(entries: ReadonlyArray<{ type: string }>, byPath: Map<string, Entry>): Marked[] {
  const marked: Marked[] = [];
  for (const raw of entries) {
    const entry = raw as {
      type: "link" | "group";
      href: string;
      label: string;
      attrs: Record<string, unknown>;
      badge?: { text: string; variant: string; class?: string };
      entries: Array<{ type: string }>;
    };
    if (entry.type === "group") {
      const below = walkSidebar(entry.entries, byPath);
      marked.push(...below);
      // The group that holds the What's New page carries the current minor.
      if ((entry.entries as Array<{ type: string; href?: string }>).some((e) => e.type === "link" && e.href === WHATS_NEW_PATH)) {
        entry.badge = { text: `v${formatMinor(CURRENT_RELEASE)}`, variant: "success" };
      } else {
        const roll = rollupFor(below);
        if (roll) entry.badge = { text: roll.text, variant: "default", class: `ra-rollup ra-rollup-${roll.kind}` };
      }
      continue;
    }
    const found = byPath.get(entry.href);
    if (!found) continue;
    const bad = redundantStabilityLabel(`sidebar "${entry.href}"`, entry.label, found.ind.stability);
    if (bad) throw new Error(bad);
    const attrs = sidebarAttrs(found.ind, found.mark);
    if (attrs) entry.attrs = { ...entry.attrs, ...attrs };
    if (found.mark) marked.push({ label: entry.label, mark: found.mark });
  }
  return marked;
}

export const onRequest = defineRouteMiddleware(async (context) => {
  const route = context.locals.starlightRoute;
  const byPath = await loadTable();
  walkSidebar(route.sidebar, byPath);

  // Marks for hub pages to decorate their child lists (new-content-markers.ts).
  const index: Record<string, { kind: string; label: string }> = {};
  for (const [path, { mark }] of byPath) if (mark) index[path] = { kind: mark.kind, label: mark.label };
  route.head.push({
    tag: "script",
    attrs: { type: "application/json", id: "ra-marker-index" },
    content: JSON.stringify(index),
  });

  // "On this page" markers: one entry per marked heading (author tags, or
  // release structure on What's New), with parents rolling up their children.
  const { marks } = tocMarks(
    (route.toc?.items ?? []) as TocNode[],
    extractHeadings(route.entry.body ?? ""),
    CURRENT_RELEASE,
    route.entry.id.replace(/\.(mdx?|md)$/, "").replace(/\/index$/, ""),
  );
  if (Object.keys(marks).length > 0) {
    route.head.push({
      tag: "script",
      attrs: { type: "application/json", id: "ra-toc-markers" },
      content: JSON.stringify(marks),
    });
  }
});
