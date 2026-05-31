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

function pickSalient(item: Record<string, unknown>): string | undefined {
  for (const f of SALIENT_FIELDS) {
    const v = item[f];
    if (typeof v === "string" && v.length > 0) return firstLine(v);
  }
  for (const v of Object.values(item)) {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = pickSalient(v as Record<string, unknown>);
      if (nested) return nested;
    }
  }
  return undefined;
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
  return undefined;
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
        const salient = pickSalient(item as Record<string, unknown>);
        return prefix + (salient ?? compactObject(item as Record<string, unknown>));
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
