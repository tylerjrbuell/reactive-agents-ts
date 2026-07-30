/**
 * Pure deterministic renderer for stored tool results (overhaul).
 *
 * Lives in the tools layer so both the `write-result-to-file` builtin and the
 * reasoning-side ContextManager can share it (reasoning → tools, never the
 * reverse). Renders ALL items from a stored result — no truncation, no LLM —
 * which is the brick that fixes the array-overflow / marker-copy failure.
 */

export type ResultFormat = "bullets" | "json" | "table" | "lines";

const SALIENT_FIELDS = ["message", "title", "name", "text", "summary", "content"];

function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return nl >= 0 ? s.slice(0, nl) : s;
}

/**
 * NDJSON (one JSON value per line, no wrapping `[...]`) parsed as an array —
 * or undefined if any non-empty line fails to parse or fewer than 2 lines
 * are present. `gh ... --jq '.[] | {...}'` and similar CLI filters emit this
 * shape natively; without recognizing it, a stored NDJSON string reads as an
 * opaque blob and falls through to a blind character-slice truncation with
 * no per-item boundary awareness (2026-07-30 — root cause of a live run
 * losing most of 25 requested commits across TWO independent truncation
 * layers that shared this same gap).
 */
function parseNdjson(text: string): unknown[] | undefined {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length < 2) return undefined;
  try {
    return lines.map((l) => JSON.parse(l));
  } catch {
    return undefined;
  }
}

/** Coerce common array wrappers ({items|data|results|commits|value}) to an array. */
export function asArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    for (const k of ["items", "data", "results", "commits", "value"]) {
      const v = (value as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  if (typeof value === "string") return parseNdjson(value);
  return undefined;
}

/**
 * Flatten nested plain-object fields into dot-notation keys (up to `depth`
 * levels) — e.g. `{sha, commit: {message}}` → `{sha, "commit.message"}`.
 * `compactObject`/`renderTable` previously excluded any key whose value was
 * an object, silently dropping fields like a raw `gh api` commit's
 * `commit.message`/`commit.author.name`/`.date` (only `pickSalient`'s ad hoc
 * recursion saw them, and only the first match). Arrays stop recursion at
 * that key — they're rendered as-is, not flattened further.
 */
function flattenRecord(
  item: Record<string, unknown>,
  depth = 2,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === "object" && !Array.isArray(v) && depth > 0) {
      Object.assign(out, flattenRecord(v as Record<string, unknown>, depth - 1, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

/**
 * The flattened key/value best representing this record's "headline" — the
 * first `SALIENT_FIELDS` name matched either exactly or as a dot-suffix
 * (e.g. `commit.message`).
 */
function findSalient(flat: Record<string, unknown>): { key: string; value: string } | undefined {
  for (const f of SALIENT_FIELDS) {
    for (const [k, v] of Object.entries(flat)) {
      if ((k === f || k.endsWith(`.${f}`)) && typeof v === "string" && v.length > 0) {
        return { key: k, value: firstLine(v) };
      }
    }
  }
  return undefined;
}

/** Every scalar field (dot-flattened) rendered compactly — `k=v | k=v`. */
function compactObject(item: Record<string, unknown>, exceptKey?: string): string {
  return Object.entries(flattenRecord(item))
    .filter(([k, v]) => k !== exceptKey && v !== null && typeof v !== "object")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" | ");
}

/**
 * One line per record: salient headline first, every OTHER scalar field
 * compactly appended after it — never silently drops a field the way
 * picking just the single top-priority salient value used to. A task
 * asking for sha + author + message previously saw only the message text;
 * the model then fabricated plausible-looking values for the rest
 * (2026-07-30, live gh-cli run — the general failure mode: any "bullets"
 * caller on any multi-field record loses every field but one).
 */
function renderRecordLine(item: Record<string, unknown>): string {
  const flat = flattenRecord(item);
  const salient = findSalient(flat);
  const rest = compactObject(item, salient?.key);
  if (salient && rest) return `${salient.value} (${rest})`;
  if (salient) return salient.value;
  return rest || "{}";
}

function renderTable(arr: unknown[]): string {
  const objs = arr.filter(
    (i): i is Record<string, unknown> => !!i && typeof i === "object" && !Array.isArray(i),
  );
  if (objs.length === 0) return arr.map(String).join("\n");
  const flat = objs.map((o) => flattenRecord(o));
  const cols = Array.from(
    flat.reduce<Set<string>>((set, o) => {
      for (const k of Object.keys(o)) if (typeof o[k] !== "object") set.add(k);
      return set;
    }, new Set()),
  );
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const rows = flat.map((o) => `| ${cols.map((c) => String(o[c] ?? "")).join(" | ")} |`);
  return [head, sep, ...rows].join("\n");
}

/** Deterministically render a value into the requested shape — ALL items. */
export function renderValue(value: unknown, format: ResultFormat): string {
  if (format === "json") return JSON.stringify(value, null, 2);

  const arr = asArray(value);
  if (!arr) {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }
  if (format === "table") return renderTable(arr);

  const prefix = format === "bullets" ? "- " : "";
  return arr
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        return prefix + renderRecordLine(item as Record<string, unknown>);
      }
      return prefix + String(item);
    })
    .join("\n");
}

/** Short, no-bulk shape description for a system summary line. */
export function describeShape(value: unknown): string {
  const arr = asArray(value);
  if (arr) {
    const sample = arr.find((i) => i && typeof i === "object") as Record<string, unknown> | undefined;
    const keys = sample ? Object.keys(sample).slice(0, 6).join(", ") : "scalar";
    return `Array(${arr.length}) of {${keys}}`;
  }
  if (value && typeof value === "object") {
    return `Object {${Object.keys(value as object).slice(0, 6).join(", ")}}`;
  }
  return typeof value;
}
