/**
 * kernel/capabilities/attend/envelope-preview.ts — preview for a JSON object
 * that wraps a list of records.
 *
 * Most search and listing tools return an envelope around their list:
 * `find` -> `{query, results:[...], totalResults, ...}`, `gh api search` ->
 * `{total_count, items:[...]}`, and most HTTP APIs look the same. The generic
 * object preview in `compressToolResult` rendered that list as `Array(n)`, so
 * the model saw a count and no content. Live repro 2026-11-10 (Cortex, ollama
 * 9B): `find` returned three matching README chunks, the preview read
 * `results: Array(3)`, and the model concluded no document was loaded.
 *
 * One rule, no per-tool case: when the object holds a list of records, show
 * the scalar envelope keys on one line, then one line per record with its
 * salient text first. Records render through the tools layer's
 * `renderValue(..., "lines", { compact: true })`, the same renderer the
 * materialize path uses, after each string field is clipped to a
 * budget-scaled length. Objects without such a list keep the old preview.
 *
 * The envelope line puts guidance keys (`hint`, `warning`, ...) first and does
 * not cut them at 80 chars, and renders small nested values (a string list, an
 * object of string lists such as find's `outline`) item by item. Live repro
 * 2026-11-10 (Cortex, ollama mimo-v2.6): `outline={README.md}` and an 80-char
 * hint hid the headings, and the model answered "no document loaded".
 */

import { asArray, renderValue } from "@reactive-agents/tools";

/**
 * Fixed char overhead of a compressed tool-result header (STORED line + Type +
 * Preview + coverage hint) used by the try-fit "show all" budget check. Shared
 * by the commit-array, generic-record and envelope renderers so the paths
 * cannot drift.
 */
export const HEADER_OVERHEAD = 220;

type JsonRecord = Record<string, unknown>;

const isRecord = (v: unknown): v is JsonRecord =>
  v !== null && typeof v === "object" && !Array.isArray(v);

/** Collapse whitespace and clip to `cap` chars, marking the cut. */
const clip = (s: string, cap: number): string => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > cap ? `${flat.slice(0, cap)}…` : flat;
};

/**
 * The key holding the object's record list: a non-empty array whose items are
 * mostly plain objects. A conventional wrapper key (`asArray`: items, data,
 * results, commits, value) wins; otherwise the longest such array.
 */
export function findRecordList(
  obj: JsonRecord,
): { key: string; records: readonly unknown[] } | undefined {
  const candidates = Object.entries(obj).filter(
    (e): e is [string, unknown[]] =>
      Array.isArray(e[1]) &&
      e[1].length > 0 &&
      e[1].filter(isRecord).length * 2 > e[1].length,
  );
  if (candidates.length === 0) return undefined;
  const named = asArray(obj);
  const pick =
    candidates.find(([, v]) => v === named) ??
    candidates.reduce((best, c) => (c[1].length > best[1].length ? c : best));
  return { key: pick[0], records: pick[1] };
}

/** Clip every string inside a record (nested objects included) to `cap`. */
function clipStrings(value: unknown, cap: number): unknown {
  if (typeof value === "string") return clip(value, cap);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clipStrings(v, cap)]));
  }
  return value;
}

/** One preview line per record: salient text first, other scalar fields after. */
function renderRecordLine(item: unknown, fieldCap: number, lineCap: number): string {
  const line = isRecord(item)
    ? renderValue([clipStrings(item, fieldCap)], "lines", { compact: true })
    : clip(String(item), fieldCap);
  return clip(line, lineCap);
}

/**
 * Keys whose string value is guidance for the model (a tool's `hint`, a
 * `warning`, an `error` message). Live repro 2026-11-10 (Cortex, ollama
 * mimo-v2.6): `find`'s `hint` was clipped at 80 chars, cutting the sentence
 * that told the model how to search. Guidance is never clipped below
 * {@link GUIDANCE_MIN_CHARS} unless the budget itself is smaller.
 */
export const GUIDANCE_KEYS: ReadonlySet<string> = new Set(["hint", "note", "warning", "error", "message"]);

/** Shortest clip a guidance string gets when the budget allows it. */
export const GUIDANCE_MIN_CHARS = 300;

/** True when `key` names a guidance string (see {@link GUIDANCE_KEYS}). */
export const isGuidanceKey = (key: string): boolean => GUIDANCE_KEYS.has(key.toLowerCase());

/**
 * Clip length for a guidance string given `space` preview chars: at least
 * {@link GUIDANCE_MIN_CHARS} (half of `space` when that is more), never more
 * than `space`, never under 40.
 */
export const guidanceCap = (space: number): number =>
  Math.max(40, Math.min(Math.max(GUIDANCE_MIN_CHARS, Math.floor(space / 2)), space));

/** Most keys a nested object may have and still render its items inline. */
const INLINE_MAX_KEYS = 8;

const isScalarList = (v: unknown): v is readonly unknown[] =>
  Array.isArray(v) && v.every((x) => x === null || typeof x !== "object");

/**
 * A small object whose values are strings or scalar lists, e.g. find's
 * `outline: {"README.md": ["# Cortex", "## Prerequisites", ...]}`.
 */
const isInlineObject = (v: unknown): v is JsonRecord =>
  isRecord(v) &&
  Object.keys(v).length > 0 &&
  Object.keys(v).length <= INLINE_MAX_KEYS &&
  Object.values(v).every((x) => typeof x === "string" || isScalarList(x));

/** Items joined by `sep` while they fit in `cap` chars; the rest as `…+N`. */
function inlineItems(items: readonly unknown[], cap: number, sep: string): string {
  const shown: string[] = [];
  let len = 0;
  for (const item of items) {
    const s = clip(String(item), 120);
    const add = (shown.length > 0 ? sep.length : 0) + s.length;
    if (shown.length > 0 && len + add > cap) break;
    shown.push(s);
    len += add;
  }
  const rest = items.length - shown.length;
  return shown.join(sep) + (rest > 0 ? ` …+${rest}` : "");
}

/** One envelope value; nested values render inline when small, `{keys}` otherwise. */
function renderEnvelopeValue(v: unknown, nestedCap: number): string {
  if (v === null) return "null";
  if (isScalarList(v)) return `[${inlineItems(v, nestedCap, ", ")}]`;
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (isInlineObject(v)) {
    const entries = Object.entries(v);
    const perKey = Math.max(40, Math.floor(nestedCap / entries.length));
    return entries
      .map(([k, x]) => `${k}: ${isScalarList(x) ? inlineItems(x, perKey, " · ") : clip(String(x), perKey)}`)
      .join(" ; ");
  }
  if (typeof v === "object") return `{${Object.keys(v).slice(0, 3).join(", ")}}`;
  return clip(String(v), 80);
}

/**
 * Scalar envelope keys on one line: `k=v | k=v`, guidance keys first. The
 * line's length scales with `available`: guidance strings get
 * {@link guidanceCap}, each nested value up to half of what is left.
 */
function renderEnvelopeLine(obj: JsonRecord, listKey: string, available: number): string {
  const entries = Object.entries(obj).filter(([k]) => k !== listKey);
  const guidance = entries.filter(([k, v]) => isGuidanceKey(k) && typeof v === "string");
  const rest = entries.filter((e) => !guidance.includes(e));
  const gCap = guidanceCap(available);
  const guidanceParts = guidance.map(([k, v]) => `${k}=${clip(String(v), gCap)}`);
  const remaining = available - guidanceParts.reduce((n, p) => n + p.length, 0);
  const nestedCap = Math.max(80, Math.floor(remaining / 2));
  return [...guidanceParts, ...rest.map(([k, v]) => `${k}=${renderEnvelopeValue(v, nestedCap)}`)].join(" | ");
}

/** Per-line caps that spread `space` chars across `count` record lines. */
function capsFor(space: number, count: number): { fieldCap: number; lineCap: number } {
  const lineCap = Math.max(160, Math.floor(space / Math.max(count, 1)));
  const fieldCap = Math.max(60, Math.min(400, Math.floor(lineCap / 2)));
  return { fieldCap, lineCap };
}

/**
 * Preview text for an object wrapping a list of records, or `undefined` when
 * the object holds no such list (the caller keeps its generic object preview).
 *
 * Budget contract: field and line lengths scale with `budget`. All records are
 * shown when they fit; otherwise the first `previewItems`, then `...M more`
 * and a recall hint. The hint names `query`/`start` recall, never
 * `arrayStart`: recall's array slicing only works on a top-level array.
 */
export function renderRecordEnvelopePreview(
  parsed: unknown,
  key: string,
  toolName: string,
  budget: number,
  previewItems: number,
): string | undefined {
  if (!isRecord(parsed)) return undefined;
  const list = findRecordList(parsed);
  if (!list) return undefined;

  const { key: listKey, records } = list;
  const available = Math.max(0, budget - HEADER_OVERHEAD);
  const envelope = renderEnvelopeLine(parsed, listKey, available);
  const space = Math.max(0, available - envelope.length);

  const renderLines = (items: readonly unknown[]): string => {
    const { fieldCap, lineCap } = capsFor(space, items.length);
    return items.map((it, i) => `  [${i}] ${renderRecordLine(it, fieldCap, lineCap)}`).join("\n");
  };

  const total = records.length;
  const allLines = renderLines(records);
  const header =
    `[STORED: ${key} | ${toolName}]\n` +
    `Type: Object(${Object.keys(parsed).length} keys) | ${listKey}: Array(${total})\n` +
    (envelope ? `  ${envelope}\n` : "");
  const recallHint =
    `\n  — full object is stored. Use recall("${key}", query: "keyword"), ` +
    `recall("${key}", start: 0, maxChars: 1200), or | transform: for focused extraction.`;

  if (envelope.length + allLines.length <= available) {
    return `${header}All ${total} ${listKey}:\n${allLines}\n  ✓ Preview covers all ${listKey}.${recallHint}`;
  }

  const shown = Math.max(1, Math.min(previewItems, total));
  const lines = renderLines(records.slice(0, shown));
  const remaining = total - shown;
  const more = remaining > 0 ? `\n  ...${remaining} more` : "";
  return `${header}Preview (first ${shown} of ${total} ${listKey}):\n${lines}${more}${recallHint}`;
}
