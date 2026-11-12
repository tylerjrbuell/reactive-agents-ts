/**
 * Outline of a markdown answer: its headings, for a sticky table of contents.
 * Fenced code is skipped; ids are unique slugs (`-2`, `-3` for repeats) that a
 * renderer can put on the heading elements it makes from the same text.
 */

/** One heading in an answer. */
export interface OutlineEntry {
  /** 1 to 6. */
  readonly depth: number;
  readonly text: string;
  /** Unique anchor id for this heading. */
  readonly id: string;
}

/** Slug of a heading text: lowercase words joined by `-`. */
export const slugOf = (text: string): string =>
  text.toLowerCase().replace(/[`*_~[\]()]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "") || "section";

/** Strip inline markdown from a heading to its plain text. */
const plainHeading = (raw: string): string =>
  raw.replace(/\s+#+\s*$/, "").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_~]/g, "").trim();

/**
 * Headings (levels 1 to `maxDepth`) of a markdown text, in order. A text with
 * fewer than `minEntries` headings has no useful outline and returns `[]`.
 */
export function outlineOf(markdown: string, opts: { readonly maxDepth?: number; readonly minEntries?: number } = {}): readonly OutlineEntry[] {
  const maxDepth = opts.maxDepth ?? 3;
  const minEntries = opts.minEntries ?? 3;
  const seen = new Map<string, number>();
  const out: OutlineEntry[] = [];
  let fence: string | null = null;
  for (const line of markdown.split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (f) {
      const marker = f[1]!;
      if (fence === null) fence = marker[0]!;
      else if (marker[0] === fence) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const depth = m[1]!.length;
    if (depth > maxDepth) continue;
    const text = plainHeading(m[2]!);
    if (text === "") continue;
    const base = slugOf(text);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    out.push({ depth, text, id: n === 1 ? base : `${base}-${n}` });
  }
  return out.length >= minEntries ? out : [];
}

/** Callout kinds recognised in a blockquote that starts `[!KIND]`. */
export type CalloutKind = "note" | "tip" | "important" | "warning" | "caution";

const CALLOUTS: readonly CalloutKind[] = ["note", "tip", "important", "warning", "caution"];

/** The callout a blockquote's first line declares (`[!NOTE]`, any case), else null. */
export function calloutKindOf(firstLine: string): CalloutKind | null {
  const m = /^\s*\[!([A-Za-z]+)\]/.exec(firstLine);
  const kind = m?.[1]?.toLowerCase();
  return CALLOUTS.find((k) => k === kind) ?? null;
}
