/**
 * Overhaul — system-owned result store + deterministic materializer.
 *
 * Principle #1/#2/#7: tool results live in a SYSTEM store keyed by a stable
 * reference id. The model never holds the bulk inline and never copies a marker;
 * it orchestrates by reference. When a deliverable consumes a result, the system
 * MATERIALIZES the full data deterministically (no LLM) into the requested shape.
 *
 * This is the brick that fixes the 20-commit overflow: `materialize(ref, "bullets")`
 * renders ALL N items from stored data, regardless of any context-window budget.
 *
 * Pure + dependency-free. Lives outside kernel/** so it is A/B-able and sidesteps
 * the kernel-warden pilot; the kernel calls it through one flag-gated seam.
 */

export type ResultFormat = "bullets" | "json" | "table" | "lines";

export interface StoredResult {
  /** Stable reference id, e.g. "commits_1". Model references this; never sees the bulk. */
  readonly ref: string;
  /** Producing tool, e.g. "github/list_commits". */
  readonly tool: string;
  /** The full, uncompressed result value as the tool returned it. */
  readonly value: unknown;
  /** When stored (for recency / eviction policy later). */
  readonly storedAt: number;
}

/** System-side store. NOT a model-facing tool — read only by the ContextManager
 *  (for summaries) and the reference resolver (for materialization). */
export class ResultStore {
  private readonly map = new Map<string, StoredResult>();
  private seq = 0;

  /** Store a result, return its stable ref. Ref is derived from the tool name +
   *  a monotonic counter so it is deterministic and human-legible. */
  put(tool: string, value: unknown): string {
    const base = tool.split("/").pop() ?? tool;
    const slug = base.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
    const ref = `${slug}_${++this.seq}`;
    this.map.set(ref, { ref, tool, value, storedAt: Date.now() });
    return ref;
  }

  get(ref: string): StoredResult | undefined {
    return this.map.get(ref);
  }

  has(ref: string): boolean {
    return this.map.has(ref);
  }

  /** A short, model-facing SYSTEM SUMMARY of a stored result — count + schema +
   *  the ref. NO bulk data, NO `[STORED:]` marker, NO recall hint. This is what
   *  the model sees in place of the result body. */
  summarize(ref: string): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    const shape = describeShape(s.value);
    return `[stored as result_ref="${ref}"] ${s.tool} succeeded: ${shape}. The full data is held in the system store; reference it by id "${ref}".`;
  }

  /** Deterministically render a stored result into the requested shape. This is
   *  the materialization that fills a deliverable — ALL items, no truncation. */
  materialize(ref: string, format: ResultFormat = "bullets"): string {
    const s = this.map.get(ref);
    if (!s) return `[unknown result_ref="${ref}"]`;
    return renderValue(s.value, format);
  }
}

// ─── pure rendering helpers ──────────────────────────────────────────────────

/** Salient one-line field for an object (commit.message, issue.title, etc.). */
const SALIENT_FIELDS = ["message", "title", "name", "text", "summary", "content"];

function pickSalient(item: Record<string, unknown>): string | undefined {
  // direct salient field
  for (const f of SALIENT_FIELDS) {
    const v = item[f];
    if (typeof v === "string" && v.length > 0) return firstLine(v);
  }
  // one level of nesting (e.g. { commit: { message } })
  for (const v of Object.values(item)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = pickSalient(v as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
}

function firstLine(s: string): string {
  const nl = s.indexOf("\n");
  return nl >= 0 ? s.slice(0, nl) : s;
}

function asArray(value: unknown): unknown[] | undefined {
  if (Array.isArray(value)) return value;
  // common wrappers: { items: [...] } / { data: [...] } / { results: [...] }
  if (value && typeof value === "object") {
    for (const k of ["items", "data", "results", "commits", "value"]) {
      const v = (value as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return undefined;
}

export function renderValue(value: unknown, format: ResultFormat): string {
  if (format === "json") return JSON.stringify(value, null, 2);

  const arr = asArray(value);
  if (!arr) {
    // scalar / non-array object — render as-is
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  }

  if (format === "table") return renderTable(arr);

  // bullets | lines — one rendered item per row
  const prefix = format === "bullets" ? "- " : "";
  return arr
    .map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const salient = pickSalient(item as Record<string, unknown>);
        return prefix + (salient ?? compactObject(item as Record<string, unknown>));
      }
      return prefix + String(item);
    })
    .join("\n");
}

function compactObject(item: Record<string, unknown>): string {
  return Object.entries(item)
    .filter(([, v]) => v !== null && typeof v !== "object")
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(" | ");
}

function renderTable(arr: unknown[]): string {
  const objs = arr.filter(
    (i): i is Record<string, unknown> => !!i && typeof i === "object" && !Array.isArray(i),
  );
  if (objs.length === 0) return arr.map(String).join("\n");
  const cols = Array.from(
    objs.reduce<Set<string>>((set, o) => {
      for (const k of Object.keys(o)) if (typeof o[k] !== "object") set.add(k);
      return set;
    }, new Set()),
  );
  const head = `| ${cols.join(" | ")} |`;
  const sep = `| ${cols.map(() => "---").join(" | ")} |`;
  const rows = objs.map((o) => `| ${cols.map((c) => String(o[c] ?? "")).join(" | ")} |`);
  return [head, sep, ...rows].join("\n");
}

function describeShape(value: unknown): string {
  const arr = asArray(value);
  if (arr) {
    const sample = arr.find((i) => i && typeof i === "object") as
      | Record<string, unknown>
      | undefined;
    const keys = sample ? Object.keys(sample).slice(0, 6).join(", ") : "scalar";
    return `Array(${arr.length}) of {${keys}}`;
  }
  if (value && typeof value === "object") {
    return `Object {${Object.keys(value as object).slice(0, 6).join(", ")}}`;
  }
  return typeof value;
}
