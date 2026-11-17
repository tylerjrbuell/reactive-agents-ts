#!/usr/bin/env bun
/**
 * ia-inventory — rerunnable information-architecture inventory of the docs.
 *
 * Walks apps/docs/src/content/docs, reads the sidebar out of astro.config.mjs
 * (explicit links and `autogenerate` groups), builds the internal link graph
 * and emits a deterministic report (no timestamps) to
 * wiki/Reference/Docs-IA-Inventory.md. `--json` prints the same data as JSON
 * on stdout instead. The pure functions are exported for tests and for the
 * report-only warnings in check-docs-sync.ts.
 *
 * Usage:
 *   bun apps/docs/scripts/ia-inventory.ts          # write the markdown report
 *   bun apps/docs/scripts/ia-inventory.ts --json   # JSON to stdout, no write
 *
 * Definitions (see the report header too):
 *   - orphan      : not in the sidebar AND no inbound internal link from another page.
 *   - depth       : fewest clicks from the home page. The home page is a splash page
 *                   with no sidebar, so a sidebar-only page costs 2 clicks (one to any
 *                   doc page, one in the sidebar) plus one per collapsed ancestor group.
 *                   Content links cost 1 click each.
 *   - linkDepth   : same, but content links only (sidebar ignored).
 *   - near-duplicate: two pages whose 5-word shingle sets overlap by
 *                   >= SHINGLE_CONTAINMENT (containment of the smaller set, with at least
 *                   MIN_SHARED_SHINGLES shared shingles) or that
 *                   share >= 3 H2 headings making up >= H2_OVERLAP of the smaller set.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

export const REPO_ROOT = resolve(import.meta.dir, "../../..");
export const DOCS_ROOT = join(REPO_ROOT, "apps/docs/src/content/docs");
export const CONFIG_PATH = join(REPO_ROOT, "apps/docs/astro.config.mjs");
export const REPORT_PATH = join(REPO_ROOT, "wiki/Reference/Docs-IA-Inventory.md");

export const LONG_PAGE_WORDS = 3500;

/**
 * Slug prefixes exempt from the `ia-missing-topic` gate. `features/cortex` is owned by cortex-warden
 * and is being overhauled for the next release; remove the entry once its pages carry `topic`.
 */
export const TOPIC_EXEMPT_PREFIXES: readonly string[] = ["features/cortex"];

/** True when `slug` is `features/cortex` or below (listed exemption for the topic gate). */
export function isTopicExempt(slug: string): boolean {
  return TOPIC_EXEMPT_PREFIXES.some((p) => slug === p || slug.startsWith(`${p}/`));
}

/** Slugs of pages the topic gate fails on: no `topic` frontmatter, not the 404 page, not exempt. */
export function pagesMissingTopic(pages: ReadonlyArray<{ slug: string; hasTopic: boolean }>): string[] {
  return pages.filter((p) => !p.hasTopic && p.slug !== "404" && !isTopicExempt(p.slug)).map((p) => p.slug);
}
export const SHINGLE_SIZE = 5;
export const SHINGLE_CONTAINMENT = 0.1;
export const MIN_SHARED_SHINGLES = 40;
export const H2_MIN_SHARED = 3;
export const H2_OVERLAP = 0.5;

/** Routes that exist but are not content-collection pages. */
const NON_CONTENT_ROUTES = new Set(["playground"]);

export interface SidebarEntry {
  /** Page slug ("" is home). */
  slug: string;
  /** Group path, e.g. "Build" or "How It Works > Cortex Studio". */
  group: string;
  /** 1-based position within its group. */
  position: number;
  /** Number of collapsed groups above this entry (0 = visible when sidebar shows). */
  collapsedAncestors: number;
  via: "link" | "autogenerate";
}

export interface FrontmatterInfo {
  title: string;
  description: string;
  order: number | null;
  topic: string | null;
  related: string[] | null;
  audience: string | null;
  raw: string;
}

export interface PageSource {
  slug: string;
  file: string;
  frontmatter: FrontmatterInfo;
  body: string;
}

export interface LinkRef {
  /** Resolved slug when it points at a page; null otherwise. */
  target: string | null;
  raw: string;
  kind: "ok" | "broken" | "redirected" | "non-content";
  note?: string;
}

export interface PageRecord {
  slug: string;
  path: string;
  title: string;
  description: string;
  type: string;
  words: number;
  sidebar: { group: string; position: number; via: string }[];
  inbound: string[];
  outbound: string[];
  orphan: boolean;
  noSidebar: boolean;
  multiGroup: boolean;
  duplicateTitleWith: string[];
  nearDuplicateWith: string[];
  overLength: boolean;
  depth: number | null;
  linkDepth: number | null;
  linkIssues: { raw: string; kind: string; note?: string }[];
  hasTopic: boolean;
  hasRelated: boolean;
}

export interface Inventory {
  pages: PageRecord[];
  summary: {
    pageCount: number;
    orphans: number;
    zeroInbound: number;
    noSidebar: number;
    multiGroup: number;
    duplicateTitleGroups: number;
    nearDuplicatePairs: number;
    overLength: number;
    medianDepth: number;
    maxDepth: number;
    unreachable: number;
    linkIssues: number;
    missingTopic: number;
    missingRelated: number;
  };
  nearDuplicatePairs: { a: string; b: string; containment: number; sharedH2: number }[];
  titleGroups: { title: string; slugs: string[] }[];
}

// ---------------------------------------------------------------- walking

export function walkContent(root: string): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else if (/\.mdx?$/.test(name)) out.push(full);
    }
  };
  visit(root);
  return out;
}

export function slugOf(file: string, root: string): string {
  let s = relative(root, file).replace(/\\/g, "/").replace(/\.mdx?$/, "");
  if (s === "index") return "";
  if (s.endsWith("/index")) s = s.slice(0, -"/index".length);
  return s;
}

// ------------------------------------------------------------ frontmatter

export function splitFrontmatter(src: string): { fm: string; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(src);
  if (!m) return { fm: "", body: src };
  return { fm: m[1] ?? "", body: src.slice(m[0].length) };
}

export function parseFrontmatter(fm: string): FrontmatterInfo {
  let data: Record<string, unknown> = {};
  try {
    const parsed: unknown = Bun.YAML.parse(fm);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    const t = /^title:\s*(.+)$/m.exec(fm);
    if (t?.[1]) data.title = t[1].replace(/^["']|["']$/g, "");
  }
  const sidebar = data.sidebar as { order?: unknown } | undefined;
  const related = data.related;
  return {
    title: typeof data.title === "string" ? data.title : "",
    description: typeof data.description === "string" ? data.description.trim() : "",
    order: typeof sidebar?.order === "number" ? sidebar.order : null,
    topic: typeof data.topic === "string" ? data.topic : null,
    related: Array.isArray(related) ? related.map(String) : null,
    audience: typeof data.audience === "string" ? data.audience : null,
    raw: fm,
  };
}

export function loadPages(root: string): PageSource[] {
  return walkContent(root).map((file) => {
    const { fm, body } = splitFrontmatter(readFileSync(file, "utf8"));
    return { slug: slugOf(file, root), file: relative(REPO_ROOT, file), frontmatter: parseFrontmatter(fm), body };
  });
}

// ---------------------------------------------------------------- sidebar

/** Return the text of the `sidebar: [...]` array literal, bracket-matched and string-aware. */
export function extractSidebarText(configText: string): string {
  const start = configText.search(/\bsidebar\s*:\s*\[/);
  if (start < 0) throw new Error("no `sidebar: [` found in astro config");
  const open = configText.indexOf("[", start);
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < configText.length; i++) {
    const c = configText[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) return configText.slice(open, i + 1);
  }
  throw new Error("unbalanced sidebar array in astro config");
}

type RawSidebarItem =
  | string
  | {
      label?: string;
      link?: string;
      slug?: string;
      collapsed?: boolean;
      items?: RawSidebarItem[];
      autogenerate?: { directory: string; collapsed?: boolean };
    };

const normSlug = (s: string): string => s.replace(/^\/+|\/+$/g, "");

/**
 * Flatten the sidebar to one entry per (page, group). Autogenerate groups list the
 * directory's pages ordered by `sidebar.order` then slug (an approximation of
 * Starlight's ordering; the position inside autogenerate groups is indicative).
 */
export function parseSidebar(configText: string, pages: PageSource[]): SidebarEntry[] {
  const raw = new Function(`return ${extractSidebarText(configText)}`)() as RawSidebarItem[];
  const entries: SidebarEntry[] = [];

  const walk = (items: RawSidebarItem[], path: string[], collapsedAbove: number): void => {
    let position = 0;
    for (const item of items) {
      if (typeof item === "string") {
        entries.push({ slug: normSlug(item), group: path.join(" > "), position: ++position, collapsedAncestors: collapsedAbove, via: "link" });
        continue;
      }
      const link = item.link ?? item.slug;
      if (link && !/^https?:/.test(link)) {
        entries.push({ slug: normSlug(link), group: path.join(" > "), position: ++position, collapsedAncestors: collapsedAbove, via: "link" });
      } else if (item.autogenerate) {
        const dir = normSlug(item.autogenerate.directory);
        const collapsed = collapsedAbove; // the autogenerate group itself is the parent `item` (handled by caller)
        const members = pages
          .filter((p) => p.slug.startsWith(`${dir}/`))
          .sort((a, b) => (a.frontmatter.order ?? Infinity) - (b.frontmatter.order ?? Infinity) || a.slug.localeCompare(b.slug));
        members.forEach((p, i) =>
          entries.push({ slug: p.slug, group: path.join(" > "), position: i + 1, collapsedAncestors: collapsed, via: "autogenerate" }),
        );
      } else if (item.items) {
        walk(item.items, [...path, item.label ?? "?"], collapsedAbove + (item.collapsed ? 1 : 0));
      }
    }
  };

  // Top-level groups: an `autogenerate` item sits at group level, so treat it as a group of its own.
  const top = raw.map((g) => g);
  for (const g of top) {
    if (typeof g === "string") continue;
    const label = g.label ?? "?";
    const collapsed = g.collapsed ? 1 : 0;
    if (g.autogenerate) {
      const dir = normSlug(g.autogenerate.directory);
      pages
        .filter((p) => p.slug.startsWith(`${dir}/`))
        .sort((a, b) => (a.frontmatter.order ?? Infinity) - (b.frontmatter.order ?? Infinity) || a.slug.localeCompare(b.slug))
        .forEach((p, i) => entries.push({ slug: p.slug, group: label, position: i + 1, collapsedAncestors: collapsed, via: "autogenerate" }));
    } else if (g.items) {
      walk(g.items, [label], collapsed);
    } else if (g.link) {
      entries.push({ slug: normSlug(g.link), group: "(top level)", position: entries.length + 1, collapsedAncestors: 0, via: "link" });
    }
  }
  return entries;
}

// ------------------------------------------------------------------ links

function stripCode(body: string): string {
  return body
    .replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "")
    .replace(/`[^`\n]*`/g, "");
}

const ASSET_EXT = /\.(png|jpe?g|gif|svg|webp|avif|ico|mp4|webm|json|txt|xml|pdf|zip|css|js|map)$/i;

/** Raw link targets found in markdown/JSX/frontmatter, in document order. */
export function extractRawLinks(body: string, frontmatterRaw = ""): string[] {
  const text = stripCode(body);
  const found: string[] = [];
  for (const m of text.matchAll(/!?\[[^\]\n]*\]\(\s*<?([^)\s>]+)/g)) {
    if (!m[0].startsWith("!")) found.push(m[1] ?? "");
  }
  for (const m of text.matchAll(/\b(?:href|link)\s*=\s*\{?["']([^"']+)["']/g)) found.push(m[1] ?? "");
  for (const m of frontmatterRaw.matchAll(/^\s*(?:-\s*)?link:\s*['"]?([^'"\n]+?)['"]?\s*$/gm)) found.push(m[1] ?? "");
  return found;
}

/** Resolve one raw link from `fromSlug` against the known slug set. */
export function resolveLink(raw: string, fromSlug: string, known: Set<string>): LinkRef | null {
  if (!raw || raw.startsWith("#")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//")) return null;
  const clean = raw.split("#")[0]!.split("?")[0]!;
  if (!clean) return null;
  const isFrontmatterHome = fromSlug === "";
  let path: string;
  if (clean.startsWith("/")) path = clean;
  else {
    const base = isFrontmatterHome ? "/" : `/${fromSlug}/`;
    path = new URL(clean, `http://x${base}`).pathname;
  }
  const lastSeg = path.split("/").filter(Boolean).pop() ?? "";
  const mdLink = /\.mdx?$/.test(lastSeg);
  if (ASSET_EXT.test(lastSeg) && !mdLink) return { target: null, raw, kind: "non-content" };
  const slug = normSlug(path.replace(/\.mdx?$/, ""));
  if (NON_CONTENT_ROUTES.has(slug)) return { target: null, raw, kind: "non-content" };
  if (!known.has(slug)) {
    const lower = slug.toLowerCase();
    const hit = [...known].find((k) => k.toLowerCase() === lower);
    return { target: null, raw, kind: "broken", note: hit ? `case mismatch, page is /${hit}/` : "no such page" };
  }
  if (mdLink) return { target: slug, raw, kind: "redirected", note: "links to a source file extension" };
  if (slug !== "" && !path.endsWith("/")) return { target: slug, raw, kind: "redirected", note: "missing trailing slash" };
  return { target: slug, raw, kind: "ok" };
}

// ------------------------------------------------------------- text stats

export function wordCount(body: string): number {
  const text = body.replace(/^import .*$/gm, "").replace(/<[^>\n]+>/g, " ");
  return (text.match(/[A-Za-z0-9_$][\w$'.-]*/g) ?? []).length;
}

function proseWords(body: string): string[] {
  return stripCode(body)
    .replace(/^import .*$/gm, "")
    .replace(/<[^>\n]+>/g, " ")
    .toLowerCase()
    .match(/[a-z0-9]+/g) ?? [];
}

export function shingles(words: string[], size = SHINGLE_SIZE): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + size <= words.length; i++) out.add(words.slice(i, i + size).join(" "));
  return out;
}

export function h2Set(body: string): Set<string> {
  const text = body.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[^\n]*$/gm, "");
  const out = new Set<string>();
  for (const m of text.matchAll(/^##\s+(.+?)\s*$/gm)) {
    const norm = (m[1] ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (norm) out.add(norm);
  }
  return out;
}

function overlap(a: Set<string>, b: Set<string>): number {
  let n = 0;
  const [s, l] = a.size <= b.size ? [a, b] : [b, a];
  for (const x of s) if (l.has(x)) n++;
  return n;
}

const normTitle = (t: string): string => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// --------------------------------------------------------------- inventory

export function buildInventory(pages: PageSource[], configText: string): Inventory {
  const known = new Set(pages.map((p) => p.slug));
  const sidebar = parseSidebar(configText, pages);
  const sidebarBySlug = new Map<string, SidebarEntry[]>();
  for (const e of sidebar) sidebarBySlug.set(e.slug, [...(sidebarBySlug.get(e.slug) ?? []), e]);

  const outbound = new Map<string, Set<string>>();
  const issues = new Map<string, { raw: string; kind: string; note?: string }[]>();
  const inbound = new Map<string, Set<string>>();
  for (const p of pages) {
    const outs = new Set<string>();
    const bad: { raw: string; kind: string; note?: string }[] = [];
    for (const raw of extractRawLinks(p.body, p.frontmatter.raw)) {
      const r = resolveLink(raw, p.slug, known);
      if (!r) continue;
      if (r.target !== null && r.target !== p.slug) outs.add(r.target);
      if (r.kind === "broken" || r.kind === "redirected") bad.push({ raw: r.raw, kind: r.kind, note: r.note });
    }
    outbound.set(p.slug, outs);
    issues.set(p.slug, bad);
    for (const t of outs) inbound.set(t, (inbound.get(t) ?? new Set()).add(p.slug));
  }

  // Click depth. Seeds: home = 0. Sidebar-only reach costs 2 + collapsed ancestors
  // (home is splash: 1 click to any doc page, then 1 in the sidebar).
  const dist = (useSidebar: boolean): Map<string, number> => {
    const d = new Map<string, number>([["", 0]]);
    if (useSidebar && known.has("")) {
      for (const [slug, es] of sidebarBySlug) {
        if (slug === "" || !known.has(slug)) continue;
        d.set(slug, Math.min(...es.map((e) => 2 + e.collapsedAncestors)));
      }
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (const [from, outs] of outbound) {
        const df = d.get(from);
        if (df === undefined) continue;
        for (const to of outs) {
          if ((d.get(to) ?? Infinity) > df + 1) {
            d.set(to, df + 1);
            changed = true;
          }
        }
      }
    }
    return d;
  };
  const withSidebar = dist(true);
  const linkOnly = dist(false);

  const bySlug = new Map(pages.map((p) => [p.slug, p]));
  const words = new Map(pages.map((p) => [p.slug, wordCount(p.body)]));
  const sh = new Map(pages.map((p) => [p.slug, shingles(proseWords(p.body))]));
  const h2 = new Map(pages.map((p) => [p.slug, h2Set(p.body)]));

  const titleMap = new Map<string, string[]>();
  for (const p of pages) {
    const k = normTitle(p.frontmatter.title);
    if (k) titleMap.set(k, [...(titleMap.get(k) ?? []), p.slug]);
  }
  const titleGroups = [...titleMap.entries()]
    .filter(([, s]) => s.length > 1)
    .map(([k, s]) => ({ title: bySlug.get(s[0]!)!.frontmatter.title || k, slugs: s.sort() }))
    .sort((a, b) => a.title.localeCompare(b.title));

  const slugs = pages.map((p) => p.slug).sort();
  const nearPairs: Inventory["nearDuplicatePairs"] = [];
  for (let i = 0; i < slugs.length; i++) {
    for (let j = i + 1; j < slugs.length; j++) {
      const a = slugs[i]!;
      const b = slugs[j]!;
      const sa = sh.get(a)!;
      const sb = sh.get(b)!;
      const containment = Math.min(sa.size, sb.size) > 0 ? overlap(sa, sb) / Math.min(sa.size, sb.size) : 0;
      const ha = h2.get(a)!;
      const hb = h2.get(b)!;
      const sharedH2 = overlap(ha, hb);
      const h2Frac = Math.min(ha.size, hb.size) > 0 ? sharedH2 / Math.min(ha.size, hb.size) : 0;
      if ((containment >= SHINGLE_CONTAINMENT && overlap(sa, sb) >= MIN_SHARED_SHINGLES) || (sharedH2 >= H2_MIN_SHARED && h2Frac >= H2_OVERLAP)) {
        nearPairs.push({ a, b, containment: Math.round(containment * 100) / 100, sharedH2 });
      }
    }
  }
  const nearBy = new Map<string, string[]>();
  for (const { a, b } of nearPairs) {
    nearBy.set(a, [...(nearBy.get(a) ?? []), b]);
    nearBy.set(b, [...(nearBy.get(b) ?? []), a]);
  }
  const titleBy = new Map<string, string[]>();
  for (const g of titleGroups) for (const s of g.slugs) titleBy.set(s, g.slugs.filter((x) => x !== s));

  const records: PageRecord[] = pages
    .map((p): PageRecord => {
      const es = sidebarBySlug.get(p.slug) ?? [];
      const inb = [...(inbound.get(p.slug) ?? [])].sort();
      const groups = new Set(es.map((e) => e.group));
      const noSidebar = es.length === 0;
      return {
        slug: p.slug,
        path: p.file,
        title: p.frontmatter.title,
        description: p.frontmatter.description,
        type: p.slug.includes("/") ? p.slug.split("/")[0]! : p.slug === "" ? "home" : "root",
        words: words.get(p.slug)!,
        sidebar: es.map((e) => ({ group: e.group, position: e.position, via: e.via })),
        inbound: inb,
        outbound: [...(outbound.get(p.slug) ?? [])].sort(),
        orphan: p.slug !== "" && p.slug !== "404" && noSidebar && inb.length === 0,
        noSidebar,
        multiGroup: groups.size > 1,
        duplicateTitleWith: titleBy.get(p.slug) ?? [],
        nearDuplicateWith: (nearBy.get(p.slug) ?? []).sort(),
        overLength: words.get(p.slug)! > LONG_PAGE_WORDS,
        depth: withSidebar.get(p.slug) ?? null,
        linkDepth: linkOnly.get(p.slug) ?? null,
        linkIssues: issues.get(p.slug) ?? [],
        hasTopic: p.frontmatter.topic !== null,
        hasRelated: p.frontmatter.related !== null && p.frontmatter.related.length > 0,
      };
    })
    .sort((a, b) => a.slug.localeCompare(b.slug));

  const depths = records.filter((r) => r.slug !== "" && r.depth !== null).map((r) => r.depth as number).sort((a, b) => a - b);
  const median = depths.length ? (depths[Math.floor((depths.length - 1) / 2)]! + depths[Math.ceil((depths.length - 1) / 2)]!) / 2 : 0;
  return {
    pages: records,
    summary: {
      pageCount: records.length,
      orphans: records.filter((r) => r.orphan).length,
      zeroInbound: records.filter((r) => r.slug !== "" && r.slug !== "404" && r.inbound.length === 0).length,
      noSidebar: records.filter((r) => r.noSidebar && r.slug !== "" && r.slug !== "404").length,
      multiGroup: records.filter((r) => r.multiGroup).length,
      duplicateTitleGroups: titleGroups.length,
      nearDuplicatePairs: nearPairs.length,
      overLength: records.filter((r) => r.overLength).length,
      medianDepth: median,
      maxDepth: depths.length ? depths[depths.length - 1]! : 0,
      unreachable: records.filter((r) => r.depth === null).length,
      linkIssues: records.reduce((n, r) => n + r.linkIssues.length, 0),
      missingTopic: records.filter((r) => !r.hasTopic).length,
      missingRelated: records.filter((r) => !r.hasRelated).length,
    },
    nearDuplicatePairs: nearPairs,
    titleGroups,
  };
}

// ------------------------------------------------------------------ report

const cell = (s: string): string => s.replace(/\|/g, "\\|").replace(/\n/g, " ");
const url = (slug: string): string => (slug === "" ? "/" : `/${slug}/`);

export function renderReport(inv: Inventory): string {
  const s = inv.summary;
  const L: string[] = [];
  L.push("---", "type: reference", "status: generated", "created: 2026-11-17", "tags: [docs, information-architecture, inventory]", "---", "");
  L.push("# Docs IA Inventory", "");
  L.push("Generated by `bun apps/docs/scripts/ia-inventory.ts`. Do not edit by hand; rerun the script. Output is deterministic (no timestamps).", "");
  L.push("Companion: [[Docs-IA-Proposal]]. Plan: [[2026-11-17-docs-adoption-readiness]] Phase 3b.", "");
  L.push("## Definitions", "");
  L.push("- **orphan**: not in the sidebar AND no inbound internal link from another page.");
  L.push("- **no-sidebar**: not in the sidebar (may still have inbound links).");
  L.push("- **depth**: fewest clicks from home. Home is a splash page with no sidebar, so sidebar-only pages cost 2 clicks (+1 per collapsed ancestor group); content links cost 1 each. `linkDepth` ignores the sidebar.");
  L.push(`- **long**: more than ${LONG_PAGE_WORDS} words (body incl. code, excluding imports and tags).`);
  L.push(`- **near-duplicate**: 5-word shingle containment >= ${SHINGLE_CONTAINMENT} of the smaller page (min ${MIN_SHARED_SHINGLES} shared shingles), or >= ${H2_MIN_SHARED} shared H2 headings making up >= ${H2_OVERLAP} of the smaller page's H2s.`);
  L.push("- **sidebar position inside `autogenerate` groups** is approximated (order, then slug).", "");
  L.push("## Summary", "");
  L.push("| Metric | Value |", "|---|---|");
  const rows: [string, string | number][] = [
    ["Pages", s.pageCount],
    ["Orphans (404 page excluded: framework-owned)", s.orphans],
    ["Pages with zero inbound content links (sidebar-only)", s.zeroInbound],
    ["Pages not in the sidebar (excl. home)", s.noSidebar],
    ["Pages in more than one sidebar group", s.multiGroup],
    ["Duplicate-title groups", s.duplicateTitleGroups],
    ["Near-duplicate page pairs", s.nearDuplicatePairs],
    [`Pages over ${LONG_PAGE_WORDS} words`, s.overLength],
    ["Median click depth (excl. home)", s.medianDepth],
    ["Max click depth", s.maxDepth],
    ["Unreachable from home", s.unreachable],
    ["Broken or redirected internal links", s.linkIssues],
    ["Pages missing `topic` frontmatter", s.missingTopic],
    ["Pages missing `related` frontmatter", s.missingRelated],
  ];
  for (const [k, v] of rows) L.push(`| ${k} | ${v} |`);
  L.push("");

  const sect = (title: string, items: string[]): void => {
    L.push(`## ${title}`, "");
    if (items.length === 0) L.push("None.", "");
    else L.push(...items, "");
  };
  sect("Orphans", inv.pages.filter((p) => p.orphan).map((p) => `- ${url(p.slug)} (${p.title})`));
  sect("Zero inbound content links (reachable only through the sidebar)", inv.pages.filter((p) => p.slug !== "" && p.slug !== "404" && p.inbound.length === 0).map((p) => `- ${url(p.slug)}`));
  sect("Not in the sidebar (has inbound links)", inv.pages.filter((p) => p.noSidebar && !p.orphan && p.slug !== "" && p.slug !== "404").map((p) => `- ${url(p.slug)}: ${p.inbound.length} inbound`));
  sect("Pages in more than one sidebar group", inv.pages.filter((p) => p.multiGroup).map((p) => `- ${url(p.slug)}: ${p.sidebar.map((e) => e.group).join(" ; ")}`));
  sect("Duplicate titles", inv.titleGroups.map((g) => `- "${g.title}": ${g.slugs.map(url).join(", ")}`));
  sect("Near-duplicate pairs", inv.nearDuplicatePairs.map((n) => `- ${url(n.a)} / ${url(n.b)}: containment ${n.containment}, shared H2 ${n.sharedH2}`));
  sect(`Pages over ${LONG_PAGE_WORDS} words`, inv.pages.filter((p) => p.overLength).sort((a, b) => b.words - a.words).map((p) => `- ${url(p.slug)}: ${p.words} words`));
  sect("Broken or redirected links", inv.pages.flatMap((p) => p.linkIssues.map((i) => `- ${url(p.slug)}: \`${i.raw}\` (${i.kind}${i.note ? `: ${i.note}` : ""})`)));
  sect("Deepest pages", inv.pages.filter((p) => p.depth === null || p.depth >= 3).sort((a, b) => (b.depth ?? 99) - (a.depth ?? 99) || a.slug.localeCompare(b.slug)).map((p) => `- ${url(p.slug)}: depth ${p.depth ?? "unreachable"}, linkDepth ${p.linkDepth ?? "unreachable"}`));

  L.push("## All pages", "");
  L.push("| Path | Title | Type | Words | Sidebar (group #pos) | In | Out | Depth | LinkDepth | Flags |", "|---|---|---|---|---|---|---|---|---|---|");
  for (const p of inv.pages) {
    const flags = [
      p.orphan ? "ORPHAN" : p.noSidebar && p.slug !== "" && p.slug !== "404" ? "no-sidebar" : "",
      p.multiGroup ? "multi-group" : "",
      p.overLength ? "long" : "",
      p.duplicateTitleWith.length ? "dup-title" : "",
      p.nearDuplicateWith.length ? `near-dup(${p.nearDuplicateWith.length})` : "",
      p.linkIssues.length ? `links(${p.linkIssues.length})` : "",
    ].filter(Boolean).join(" ");
    const sb = p.sidebar.length ? p.sidebar.map((e) => `${e.group} #${e.position}`).join(" ; ") : "NONE";
    L.push(`| ${url(p.slug)} | ${cell(p.title)} | ${p.type} | ${p.words} | ${cell(sb)} | ${p.inbound.length} | ${p.outbound.length} | ${p.depth ?? "-"} | ${p.linkDepth ?? "-"} | ${flags} |`);
  }
  L.push("", "## Link graph (inbound sources and outbound targets)", "");
  for (const p of inv.pages) {
    L.push(`### ${url(p.slug)}`, "", `- description: ${cell(p.description) || "(none)"}`);
    L.push(`- inbound (${p.inbound.length}): ${p.inbound.map(url).join(", ") || "none"}`);
    L.push(`- outbound (${p.outbound.length}): ${p.outbound.map(url).join(", ") || "none"}`, "");
  }
  return `${L.join("\n")}\n`;
}

export function runInventory(): Inventory {
  return buildInventory(loadPages(DOCS_ROOT), readFileSync(CONFIG_PATH, "utf8"));
}

if (import.meta.main) {
  const inv = runInventory();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(inv, null, 2)}\n`);
  } else {
    writeFileSync(REPORT_PATH, renderReport(inv));
    console.log(`ia-inventory: ${inv.summary.pageCount} pages -> ${relative(REPO_ROOT, REPORT_PATH)}`);
    console.log(JSON.stringify(inv.summary));
  }
  if (!existsSync(DOCS_ROOT)) process.exit(1);
}
