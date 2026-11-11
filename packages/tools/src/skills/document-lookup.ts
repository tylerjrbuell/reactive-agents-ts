// ── Document-name lookup for `find` ──────────────────────────────────────────
// Content search alone cannot answer "what is in the README?": the word
// "README" is in the document's identifier, not in its chunks. These helpers
// let `find` name the loaded documents compactly, match a query against those
// names, outline a name-matched document, and preview the part of a long
// result that holds the query's words.

import type { DocumentChunk } from "../rag/types.js";
import { scoreChunks, type RagSearchResult } from "./rag-search.js";

/** Loaded documents keyed by identifier (file path or URL). */
type DocumentStore = ReadonlyMap<string, readonly DocumentChunk[]>;

/** Lowercase alphanumeric tokens of `text` ("apps/cortex/README.md" -> apps, cortex, readme, md). */
function nameTokens(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 0);
}

/** Path segments of a document identifier (handles `/` and `\`). */
function pathSegments(identifier: string): string[] {
  return identifier.split(/[\\/]/).filter((p) => p.length > 0);
}

/** Last path segment of a document identifier. */
function basename(identifier: string): string {
  const parts = pathSegments(identifier);
  return parts[parts.length - 1] ?? identifier;
}

/** `name` without a trailing `.ext` (kept when the name is only an extension). */
function stripExtension(name: string): string {
  const stripped = name.replace(/\.[A-Za-z0-9]{1,8}$/, "");
  return stripped.length > 0 ? stripped : name;
}

/** The last `k` path segments of `identifier`, joined with `/`. */
function suffix(identifier: string, k: number): string {
  return pathSegments(identifier).slice(-k).join("/");
}

/**
 * Short display name for each identifier: its basename, or the shortest path
 * suffix no other identifier shares when basenames collide
 * (`apps/cortex/README.md` + `packages/tools/README.md` -> `cortex/README.md`,
 * `tools/README.md`). An identifier with no unique suffix keeps its full form.
 */
export function compactDocumentNames(ids: readonly string[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const id of ids) {
    const depth = Math.max(pathSegments(id).length, 1);
    let name = id;
    for (let k = 1; k <= depth; k++) {
      const candidate = suffix(id, k);
      if (ids.every((other) => other === id || suffix(other, k) !== candidate)) {
        name = candidate;
        break;
      }
    }
    names.set(id, name);
  }
  return names;
}

/** Most document names {@link loadedDocumentNames} lists before summarizing the rest. */
export const DOCUMENT_NAME_CAP = 8;

/**
 * Names of the documents in `store`, in load order, in the
 * {@link compactDocumentNames} form. At most `cap` names; a final
 * `"and N more"` entry counts the rest.
 */
export function loadedDocumentNames(store: DocumentStore, cap: number = DOCUMENT_NAME_CAP): string[] {
  const compact = compactDocumentNames([...store.keys()]);
  const names = [...compact.values()];
  if (names.length <= cap) return names;
  return [...names.slice(0, cap), `and ${names.length - cap} more`];
}

/**
 * Words that say "a document" or frame a question but carry no content to
 * search for. A query left with only these after the name tokens are removed
 * ("the readme document", "what is in the README") is a name-only query.
 */
const FILLER_WORDS: ReadonlySet<string> = new Set([
  "the", "and", "for", "from", "with", "about", "this", "that", "what", "which",
  "does", "say", "says", "show", "tell", "find", "search", "look", "read", "open",
  "loaded", "load", "document", "documents", "doc", "docs", "file", "files",
  "content", "contents", "according", "inside", "please", "its", "all",
]);

/** How a query relates to the loaded documents' names. */
export interface DocumentNameMatch {
  /** Identifiers of the documents the query names (empty when it names none). */
  readonly ids: readonly string[];
  /**
   * Query words left after dropping the matched documents' name tokens and
   * {@link FILLER_WORDS} (3+ chars, lowercase). Empty with a non-empty `ids`
   * means the query only named a document.
   */
  readonly contentTerms: readonly string[];
}

/**
 * The documents whose NAME the query refers to. A document matches when every
 * token of its basename (extension dropped) appears in the query,
 * case-insensitive: "README", "readme.md" and "cortex readme" all match
 * `apps/cortex/README.md`. Among matches, only the documents sharing the most
 * query tokens with their full identifier are kept (so "cortex readme"
 * prefers the cortex README over another README).
 */
export function matchDocumentsByName(store: DocumentStore, query: string): DocumentNameMatch {
  const tokens = nameTokens(query);
  const queryTokens = new Set(tokens);
  let best = 0;
  let matched: string[] = [];
  for (const id of store.keys()) {
    const stem = nameTokens(stripExtension(basename(id)));
    if (stem.length === 0 || !stem.every((t) => queryTokens.has(t))) continue;
    const overlap = new Set(nameTokens(stripExtension(id)).filter((t) => queryTokens.has(t))).size;
    if (overlap > best) {
      best = overlap;
      matched = [id];
    } else if (overlap === best) {
      matched.push(id);
    }
  }
  const nameWords = new Set(matched.flatMap((id) => nameTokens(id)));
  const contentTerms = [...new Set(tokens)].filter(
    (t) => t.length > 2 && !FILLER_WORDS.has(t) && !nameWords.has(t),
  );
  return { ids: matched, contentTerms };
}

/** Score added to name-matched chunks so they rank above content-only hits. */
const NAME_MATCH_BOOST = 1;

/**
 * Chunks of the documents `match` names. Each contributes its best chunks
 * scored by the query's CONTENT terms (the name words would favor every chunk
 * that repeats the document's name), or its first chunks when no content term
 * occurs in its text. Scores carry a {@link NAME_MATCH_BOOST} so these hits
 * rank first.
 */
export function searchByDocumentName(
  store: DocumentStore,
  match: DocumentNameMatch,
  topK: number,
): RagSearchResult[] {
  const hits: RagSearchResult[] = [];
  for (const id of match.ids) {
    const chunks = store.get(id) ?? [];
    const byContent = match.contentTerms.length > 0 ? scoreChunks(chunks, match.contentTerms.join(" "), topK) : [];
    const picked: RagSearchResult[] = byContent.length > 0
      ? byContent
      : chunks.slice(0, topK).map((c) => ({
          content: c.content,
          source: c.metadata.source,
          chunkIndex: c.metadata.chunkIndex,
          score: 0,
        }));
    for (const hit of picked) hits.push({ ...hit, score: hit.score + NAME_MATCH_BOOST });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, topK);
}

/** Most entries {@link documentOutline} returns. */
export const OUTLINE_CAP = 15;

/**
 * A document's outline: its markdown headings in order (outside code fences,
 * deduplicated across overlapping chunks), or the first line of each chunk
 * when it has no headings. At most `cap` entries.
 */
export function documentOutline(chunks: readonly DocumentChunk[], cap: number = OUTLINE_CAP): string[] {
  const headings: string[] = [];
  for (const chunk of chunks) {
    let inFence = false;
    for (const line of chunk.content.split("\n")) {
      if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
      else if (!inFence && /^#{1,6}\s+\S/.test(line)) headings.push(line.trim());
    }
  }
  const entries = headings.length > 0
    ? headings
    : chunks.map((c) => (c.content.split("\n").find((l) => l.trim().length > 0) ?? "").trim().slice(0, 120));
  return [...new Set(entries.filter((e) => e.length > 0))].slice(0, cap);
}

/**
 * The hint for a name-only query: names the matched documents, says their
 * outline is listed, and tells the model to search with the fact's words. The
 * example query is the first document's second heading (its first is usually
 * the title), omitted when the outline has no headings.
 */
export function nameOnlyHint(names: readonly string[], firstOutline: readonly string[]): string {
  const many = names.length > 1;
  const quoted = names.map((n) => `'${n}'`).join(", ");
  const heading = (firstOutline.length > 1 ? firstOutline[1] : firstOutline[0]) ?? "";
  const example = heading.startsWith("#") ? `, e.g. find('${heading.replace(/^#+\s*/, "")}')` : "";
  return (
    `Matched ${many ? "documents" : "document"} ${quoted} by name. ` +
    `${many ? "Their outlines are" : "Its outline is"} listed. ` +
    `Search ${many ? "their" : "its"} content with the words of the fact you need, not the document's name${example}.`
  );
}

/**
 * At most `max` characters of `content`, starting at the line whose window
 * holds the most distinct `terms` (then the most occurrences, then the
 * earliest). A window that does not start the content is prefixed with `…`.
 * Keeps a long result's preview on the part that answers the query instead of
 * its first lines.
 */
export function focusExcerpt(content: string, terms: readonly string[], max: number): string {
  if (content.length <= max) return content;
  const lowered = terms.map((t) => t.toLowerCase()).filter((t) => t.length > 0);
  if (lowered.length === 0) return content.slice(0, max);
  const lower = content.toLowerCase();
  let bestStart = 0;
  let bestDistinct = -1;
  let bestCount = -1;
  for (let start = 0; start !== -1 && start < content.length; ) {
    const next = content.indexOf("\n", start);
    if (next === start) {
      start = next + 1; // a blank line never starts a window
      continue;
    }
    const window = lower.slice(start, start + max);
    let distinct = 0;
    let count = 0;
    for (const term of lowered) {
      const n = window.split(term).length - 1;
      if (n > 0) distinct++;
      count += n;
    }
    if (distinct > bestDistinct || (distinct === bestDistinct && count > bestCount)) {
      bestStart = start;
      bestDistinct = distinct;
      bestCount = count;
    }
    start = next === -1 ? -1 : next + 1;
  }
  return (bestStart > 0 ? "…" : "") + content.slice(bestStart, bestStart + max);
}
