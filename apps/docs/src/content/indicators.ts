/**
 * Release-based page indicators. Pure and deterministic: everything derives
 * from authored frontmatter (`since`, `updated`, `stability`), authored
 * `<Since>` heading tags and one release number, never from git recency.
 * See wiki/Reference/Docs-Indicators.md.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const STABILITY_TIERS = ["stable", "unstable", "experimental", "deprecated"] as const;
export type StabilityTier = (typeof STABILITY_TIERS)[number];

/** Single label/variant map used by page titles, sidebar indicators and `<StabilityBadge>`. */
export const STABILITY_BADGE: Readonly<Record<StabilityTier, { label: string; variant: "default" | "caution" | "tip" | "danger" }>> = {
  stable: { label: "Stable", variant: "default" },
  unstable: { label: "Unstable", variant: "caution" },
  experimental: { label: "Experimental", variant: "tip" },
  deprecated: { label: "Deprecated", variant: "danger" },
};

/** New/Updated markers show for this many minors: the current one and the one before. */
export const WINDOW_MINORS = 2;

export type MinorVersion = { readonly major: number; readonly minor: number };

/** Parse `0.18`, `v0.18` or `0.18.3` to major.minor. Returns null when malformed. */
export function parseMinor(value: string): MinorVersion | null {
  const m = value.trim().match(/^v?(\d+)\.(\d+)(?:\.\d+)?$/);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : null;
}

function ordinal(v: MinorVersion): number {
  return v.major * 1000 + v.minor;
}

export function formatMinor(v: MinorVersion): string {
  return `${v.major}.${v.minor}`;
}

/**
 * Derive the release the docs describe. Chain, first hit wins:
 *   1. `RA_DOCS_VERSION` env (CI or a local override).
 *   2. The highest strict `vX.Y.Z` tag reachable from HEAD (`git tag --merged HEAD`).
 *      The docs deploy checks out with `fetch-depth: 0` and `fetch-tags`, so tagging
 *      a release moves the chip, the sidebar badge and the indicator window
 *      with no content edit.
 *   3. The repo-root `VERSION` file (stamped by `scripts/release.ts`; workspace
 *      package.json files stay at a 0.10.6 baseline, so they are never read).
 */
export type VersionSource = "env" | "git-tag" | "version-file";

export interface VersionInputs {
  readonly env?: string | undefined;
  readonly tags?: readonly string[];
  readonly file?: string | undefined;
}

const SEMVER_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** Highest strict `vX.Y.Z` tag (pre-releases and non-version tags ignored), without the `v`; null when none. */
export function latestReleaseTag(tags: readonly string[]): string | null {
  let best: { version: string; key: readonly number[] } | null = null;
  for (const raw of tags) {
    const m = raw.trim().match(SEMVER_TAG);
    if (!m) continue;
    const key = [Number(m[1]), Number(m[2]), Number(m[3])];
    const delta = best ? key[0]! - best.key[0]! || key[1]! - best.key[1]! || key[2]! - best.key[2]! : 1;
    if (delta > 0) best = { version: `${m[1]}.${m[2]}.${m[3]}`, key };
  }
  return best ? best.version : null;
}

/** Pure resolver over already-gathered inputs. */
export function resolveVersion(inputs: VersionInputs): { version: string; source: VersionSource } {
  const env = inputs.env?.trim();
  if (env) {
    if (!parseMinor(env)) throw new Error(`RA_DOCS_VERSION is not a version: "${env}"`);
    return { version: env.replace(/^v/, ""), source: "env" };
  }
  const tag = inputs.tags ? latestReleaseTag(inputs.tags) : null;
  if (tag) return { version: tag, source: "git-tag" };
  const file = inputs.file?.trim();
  if (file && parseMinor(file)) return { version: file, source: "version-file" };
  throw new Error(`no docs version: set RA_DOCS_VERSION, fetch v* tags, or keep a valid VERSION file (got "${file ?? ""}")`);
}

/** Reachable `v*` tags in a repo, or [] when git or the repo is unavailable. */
export function listReachableTags(repoRoot: string): string[] {
  try {
    const out = execFileSync("git", ["-C", repoRoot, "tag", "--list", "v*", "--merged", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out.split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

export function deriveCurrentVersion(
  repoRoot: string = defaultRepoRoot(),
  env: Record<string, string | undefined> = process.env,
): { version: string; source: VersionSource } {
  const versionFile = join(repoRoot, "VERSION");
  return resolveVersion({
    env: env.RA_DOCS_VERSION,
    tags: listReachableTags(repoRoot),
    file: existsSync(versionFile) ? readFileSync(versionFile, "utf8") : undefined,
  });
}

export function readCurrentVersion(repoRoot: string = defaultRepoRoot()): string {
  return deriveCurrentVersion(repoRoot).version;
}

export function readCurrentRelease(repoRoot: string = defaultRepoRoot()): MinorVersion {
  return parseMinor(readCurrentVersion(repoRoot))!;
}

/**
 * The one build-time release constant. The header chip, the What's New
 * sidebar badge, the indicator window and the stale-marker checks all read
 * it. Never hand-edited: see `deriveCurrentVersion`.
 */
const DERIVED = deriveCurrentVersion();
export const CURRENT_VERSION: string = DERIVED.version;
export const CURRENT_VERSION_SOURCE: VersionSource = DERIVED.source;
export const CURRENT_RELEASE: MinorVersion = parseMinor(CURRENT_VERSION)!;

/**
 * Nearest ancestor holding a VERSION file. Starts from the working directory
 * first because rendered pages run from a bundled chunk under dist/, where
 * `import.meta.url` no longer points into src/.
 */
function defaultRepoRoot(): string {
  const starts = [process.cwd(), dirname(fileURLToPath(import.meta.url))];
  for (const start of starts) {
    for (let dir = start; ; dir = dirname(dir)) {
      if (existsSync(join(dir, "VERSION"))) return dir;
      if (dirname(dir) === dir) break;
    }
  }
  throw new Error("VERSION file not found above the docs working directory");
}

/** The next minor: unreleased work on `dev` may be authored against it before it ships. */
export function upcomingRelease(current: MinorVersion): MinorVersion {
  return { major: current.major, minor: current.minor + 1 };
}

/**
 * True when the What's New page's top `## vX.Y.Z` heading may stand at the
 * `current` release: it is the current minor (any patch), or the next minor
 * being prepared on `dev` before its tag (VERSION is stamped at tag time).
 * A heading behind `current`, or more than one minor ahead, is drift.
 */
export function isPublishableTopRelease(version: string, current: MinorVersion): boolean {
  const v = parseMinor(version);
  if (!v) return false;
  return ordinal(v) === ordinal(current) || ordinal(v) === ordinal(upcomingRelease(current));
}

/** True when `version` falls inside the marker window ending at the upcoming minor. */
export function isInWindow(version: string, current: MinorVersion, span: number = WINDOW_MINORS): boolean {
  const v = parseMinor(version);
  if (!v) return false;
  return ordinal(v) >= ordinal(current) - (span - 1) && ordinal(v) <= ordinal(upcomingRelease(current));
}

export type MarkerKind = "new" | "updated";
export type Marker = { readonly kind: MarkerKind; readonly version: string };

export interface PageIndicators {
  readonly stability?: StabilityTier;
  readonly marker?: Marker;
}

export interface IndicatorFrontmatter {
  readonly since?: string;
  readonly updated?: string;
  readonly stability?: StabilityTier;
}

/** New wins over Updated; both expire with the window. Stability is independent of age. */
export function indicatorsFor(data: IndicatorFrontmatter, current: MinorVersion): PageIndicators {
  const marker: Marker | undefined =
    data.since && isInWindow(data.since, current)
      ? { kind: "new", version: formatMinor(parseMinor(data.since)!) }
      : data.updated && isInWindow(data.updated, current)
        ? { kind: "updated", version: formatMinor(parseMinor(data.updated)!) }
        : undefined;
  return { ...(data.stability ? { stability: data.stability } : {}), ...(marker ? { marker } : {}) };
}

export function markerLabel(marker: Marker): string {
  return `${marker.kind === "new" ? "New" : "Updated"} in ${marker.version}`;
}

/* ── Section markers: `<Since>` tags in headings ─────────────────────── */

export interface SectionMarker {
  readonly text: string;
  readonly kind: MarkerKind;
  readonly version: string;
}

const SINCE_TAG = /<Since\b([^>]*?)\/?>/;

/** A heading in a page body (h2 to h4), in document order, with its `<Since>` tag if any. */
export interface BodyHeading {
  readonly depth: number;
  readonly text: string;
  readonly tag?: { readonly kind: MarkerKind; readonly version: string };
}

/**
 * Headings of an md/mdx body. Fenced code is skipped. A `<Since>` tag of
 * `type="deprecated"` is a stability fact, not a recency marker, so it yields
 * no tag. Pure: window filtering is the caller's job.
 */
export function extractHeadings(source: string): BodyHeading[] {
  const out: BodyHeading[] = [];
  let fenced = false;
  for (const line of source.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    const h = line.match(/^(#{2,4})\s+(.*)$/);
    if (!h) continue;
    const raw = h[2]!;
    const text = raw
      .replace(SINCE_TAG, "")
      .replace(/<[^>]+>/g, "")
      .replace(/`/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, "$1")
      .trim();
    if (!text) continue;
    const tag = raw.match(SINCE_TAG);
    const version = tag?.[1]!.match(/version=["']([^"']+)["']/)?.[1];
    const type = tag?.[1]!.match(/type=["']([^"']+)["']/)?.[1] ?? "new";
    const minor = version ? parseMinor(version) : null;
    out.push({
      depth: h[1]!.length,
      text,
      ...(minor && (type === "new" || type === "updated") ? { tag: { kind: type, version: formatMinor(minor) } } : {}),
    });
  }
  return out;
}

/** Headings that carry a `<Since>` tag, in document order. */
export function extractSectionMarkers(source: string): SectionMarker[] {
  return extractHeadings(source).flatMap((h) => (h.tag ? [{ text: h.text, kind: h.tag.kind, version: h.tag.version }] : []));
}

/* ── Release-structure markers (guides/whats-new) ──────────────────────
   The What's New page is organised by release, so its recency is structural,
   not hand-tagged: everything under the Unreleased section is new in the
   upcoming minor, everything under the current release's heading is new in
   the current minor, older releases and the archive pages carry nothing. */

export const WHATS_NEW_ID = "guides/whats-new";

/** Per-heading derived tag, aligned with `headings`. Pure; `current` comes from the release constant. */
export function releaseStructureTags(
  headings: readonly BodyHeading[],
  current: MinorVersion,
): Array<{ kind: MarkerKind; version: string } | undefined> {
  let section: { kind: MarkerKind; version: string } | undefined;
  return headings.map((h) => {
    if (h.depth === 2) {
      const rel = h.text.match(/^v(\d+\.\d+)\.\d+\b/)?.[1];
      if (/^unreleased\b/i.test(h.text)) section = { kind: "new", version: formatMinor(upcomingRelease(current)) };
      else if (rel && formatMinor(parseMinor(rel)!) === formatMinor(current)) section = { kind: "new", version: formatMinor(current) };
      // The release being prepared (heading written before its tag) is new in that minor.
      else if (rel && formatMinor(parseMinor(rel)!) === formatMinor(upcomingRelease(current)))
        section = { kind: "new", version: formatMinor(upcomingRelease(current)) };
      else section = undefined;
    }
    return section;
  });
}

/* ── Table of contents ───────────────────────────────────────────────── */

export interface TocNode {
  readonly depth: number;
  readonly slug: string;
  readonly text: string;
  readonly children: readonly TocNode[];
}

export interface TocMark {
  readonly kind: MarkerKind;
  /** Accessible name and tooltip: "New in 0.18", or "Updated in 0.19: Ollama Cloud, Images" when rolled up. */
  readonly label: string;
  /** True when the entry itself is unmarked and only a child is. */
  readonly rolledUp: boolean;
}

/** A marked section for the "What changed" line under the title. */
export interface ChangedSection {
  readonly slug: string;
  readonly text: string;
  readonly kind: MarkerKind;
  readonly version: string;
}

/** Lead text of the "What changed" line: "New in 0.19", or "New or updated in 0.19" when kinds mix. */
export function changedLead(sections: readonly ChangedSection[]): { kind: MarkerKind; text: string } | undefined {
  if (sections.length === 0) return undefined;
  const kinds = new Set(sections.map((s) => s.kind));
  const version = newestVersion(sections.map((s) => s.version));
  if (kinds.size === 1) {
    const kind = sections[0]!.kind;
    return { kind, text: markerLabel({ kind, version }) };
  }
  return { kind: "new", text: `New or updated in ${version}` };
}

const PAGE_TITLE_SLUG = "_top";

function normalizeText(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

/**
 * Markers for TOC entries. Each TOC entry is matched, in order, to the body
 * heading with the same text (the TOC is authoritative for slugs and depth,
 * so no slugger runs here). A heading is marked by its in-window `<Since>` tag
 * or, on the What's New page, by release structure. A parent whose own
 * heading is unmarked rolls up its marked children without hiding them.
 */
export function tocMarks(
  toc: readonly TocNode[],
  headings: readonly BodyHeading[],
  current: MinorVersion,
  pageId: string,
): { marks: Record<string, TocMark>; sections: ChangedSection[] } {
  const structure = pageId === WHATS_NEW_ID ? releaseStructureTags(headings, current) : [];
  const tags = headings.map((h, i) => (h.tag && isInWindow(h.tag.version, current) ? h.tag : structure[i]));

  const own = new Map<string, { kind: MarkerKind; version: string }>();
  let cursor = 0;
  const flat: TocNode[] = [];
  const flatten = (nodes: readonly TocNode[]): void => {
    for (const n of nodes) {
      if (n.slug !== PAGE_TITLE_SLUG) flat.push(n);
      flatten(n.children);
    }
  };
  flatten(toc);
  for (const node of flat) {
    const want = normalizeText(node.text);
    for (let i = cursor; i < headings.length; i++) {
      if (normalizeText(headings[i]!.text) === want) {
        const t = tags[i];
        if (t) own.set(node.slug, t);
        cursor = i + 1;
        break;
      }
    }
  }

  const marks: Record<string, TocMark> = {};
  const sections: ChangedSection[] = [];
  /** Returns the marked descendants (top-most) of `node`, including itself when marked. */
  const visit = (node: TocNode, ancestorMarked: boolean): Array<{ text: string; kind: MarkerKind; version: string }> => {
    const mine = own.get(node.slug);
    const found = node.children.flatMap((c) => visit(c, ancestorMarked || !!mine));
    if (mine) {
      marks[node.slug] = { kind: mine.kind, label: markerLabel(mine), rolledUp: false };
      // Rendered heading text can carry stray whitespace (a component after the words).
      const text = node.text.trim();
      if (!ancestorMarked) sections.push({ slug: node.slug, text, kind: mine.kind, version: mine.version });
      return [{ text, ...mine }];
    }
    if (found.length === 0) return [];
    const kind: MarkerKind = found.some((f) => f.kind === "new") ? "new" : "updated";
    const version = newestVersion(found.map((f) => f.version));
    marks[node.slug] = {
      kind,
      label: `${markerLabel({ kind, version })}: ${joinNames(found.map((f) => f.text))}`,
      rolledUp: true,
    };
    return found;
  };
  for (const n of toc) if (n.slug !== PAGE_TITLE_SLUG) visit(n, false);
  return { marks, sections };
}

export function inWindow(sections: readonly SectionMarker[], current: MinorVersion): SectionMarker[] {
  return sections.filter((s) => isInWindow(s.version, current));
}

/** Cap a name list for tooltips: first `max` names, then "and N more". */
export function joinNames(names: readonly string[], max = 4): string {
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/** Everything the UI shows about one page's recency: page-level marker plus in-window sections. */
export interface PageMark {
  readonly kind: MarkerKind;
  readonly version: string;
  /** Tooltip / accessible name, e.g. "Updated in 0.19: Ollama Cloud, Images Audio and Files". */
  readonly label: string;
  readonly sections: readonly SectionMarker[];
}

/**
 * A page is marked when its frontmatter marker is in the window or any
 * heading `<Since>` is. Page-level kind wins; section-only pages take "new"
 * only when every section is new, otherwise "updated".
 */
export function pageMarkFor(
  data: IndicatorFrontmatter,
  sections: readonly SectionMarker[],
  current: MinorVersion,
): PageMark | undefined {
  const live = inWindow(sections, current);
  const page = indicatorsFor(data, current).marker;
  if (!page && live.length === 0) return undefined;
  const kind: MarkerKind = page ? page.kind : live.every((s) => s.kind === "new") ? "new" : "updated";
  const version = page ? page.version : newestVersion(live.map((s) => s.version));
  const base = `${kind === "new" ? "New" : "Updated"} in ${version}`;
  const label = live.length > 0 ? `${base}: ${joinNames(live.map((s) => s.text))}` : base;
  return { kind, version, label, sections: live };
}

function newestVersion(versions: readonly string[]): string {
  return [...versions].sort((a, b) => ordinal(parseMinor(b)!) - ordinal(parseMinor(a)!))[0]!;
}

/** What a collapsed or expanded sidebar group says about its descendants. */
export interface Rollup {
  readonly kind: MarkerKind;
  readonly text: string;
}

/** Roll marked descendant pages up into one group indicator; undefined when none is marked. */
export function rollupFor(marked: readonly { label: string; mark: PageMark }[]): Rollup | undefined {
  if (marked.length === 0) return undefined;
  const kind: MarkerKind = marked.some((m) => m.mark.kind === "new") ? "new" : "updated";
  const version = newestVersion(marked.map((m) => m.mark.version));
  const names = joinNames(marked.map((m) => m.label), 5);
  const count = marked.length;
  return { kind, text: `${count} new or updated in ${version}: ${names}` };
}

/* ── Sidebar attributes (compact indicators only) ────────────────────── */

/** A tooltip/accessible label for a stability tier. */
export function stabilityLabel(tier: StabilityTier): string {
  return STABILITY_BADGE[tier].label;
}

/**
 * Sidebar indicators are attributes on the link; CSS draws compact glyphs
 * (custom.css), so the label column is never squeezed by a text pill:
 *  - New/Updated: leading dot/ring (`data-ra-new-content`).
 *  - Non-stable tier: trailing glyph (`data-ra-stability`). `stable` stays off the sidebar.
 * `title` is the combined tooltip; the CSS alt text carries the accessible names.
 */
export function sidebarAttrs(ind: PageIndicators, mark?: PageMark): Record<string, string> | undefined {
  const attrs: Record<string, string> = {};
  const tips: string[] = [];
  const m = mark ?? (ind.marker ? { kind: ind.marker.kind, label: markerLabel(ind.marker) } : undefined);
  if (m) {
    attrs["data-ra-new-content"] = m.kind;
    attrs["data-ra-marker-label"] = m.label;
    tips.push(m.label);
  }
  if (ind.stability && ind.stability !== "stable") {
    const label = stabilityLabel(ind.stability);
    attrs["data-ra-stability"] = ind.stability;
    attrs["data-ra-stability-label"] = label;
    tips.push(label);
  }
  if (tips.length === 0) return undefined;
  attrs.title = tips.join(" · ");
  return attrs;
}

const STABILITY_WORD = /\b(experimental|unstable|beta|alpha|preview|deprecated)\b/i;

/**
 * Nav-redundancy guard: when a page carries a non-stable indicator, its label or
 * title must not repeat the tier ("Plan Review (experimental)").
 */
export function redundantStabilityLabel(
  where: string,
  text: string | undefined,
  tier: StabilityTier | undefined,
): string | null {
  if (!text || !tier || tier === "stable") return null;
  const hit = text.match(STABILITY_WORD)?.[1];
  return hit ? `${where}: "${text}" repeats "${hit}", which the ${tier} indicator already shows` : null;
}

/** Problems with authored `since`/`updated`; the loader throws on any, so the build fails. */
export function validateVersions(id: string, data: IndicatorFrontmatter, current: MinorVersion): string[] {
  const errs: string[] = [];
  const upcoming = upcomingRelease(current);
  for (const key of ["since", "updated"] as const) {
    const raw = data[key];
    if (raw === undefined) continue;
    const v = parseMinor(raw);
    if (!v) errs.push(`${id}: ${key} "${raw}" is not a version like "0.18"`);
    else if (ordinal(v) > ordinal(upcoming)) errs.push(`${id}: ${key} ${raw} is beyond the upcoming release ${formatMinor(upcoming)}`);
  }
  const s = data.since && parseMinor(data.since);
  const u = data.updated && parseMinor(data.updated);
  if (s && u && ordinal(u) < ordinal(s)) errs.push(`${id}: updated ${data.updated} is older than since ${data.since}`);
  return errs;
}

/** Convert a Starlight docs collection ID to its canonical page URL. */
export function pagePathFromDocId(id: string): string {
  const normalized = id.replace(/^\/+|\/+$/g, "");
  const slug = normalized === "index" ? "" : normalized.replace(/\/index$/, "");
  return slug === "" ? "/" : `/${slug}/`;
}
