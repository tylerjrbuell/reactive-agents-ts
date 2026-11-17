/**
 * Custom tool editor rules: the parameter rows the editor shows, the JSON it previews and the
 * checks before a save. The server (`PATCH /api/tools/lab-custom/:id`, `POST /api/tools/lab-custom`)
 * checks the same name rule; this gives the message before the round trip.
 */
import type { CatalogParam } from "./tool-workshop.js";

/** Parameter types a custom tool offers. */
export const PARAM_TYPES: readonly string[] = ["string", "number", "boolean", "object", "array"];

/** One editable parameter line. `enumText` is comma separated; blank means no enum. */
export interface ParamRow {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly description: string;
  readonly enumText: string;
}

/** A blank parameter line. */
export const EMPTY_PARAM_ROW: ParamRow = { name: "", type: "string", required: false, description: "", enumText: "" };

/** Rows for a saved tool's parameters. */
export function rowsFromParams(params: readonly CatalogParam[]): ParamRow[] {
  return params.map((p) => ({ name: p.name, type: p.type, required: p.required, description: p.description, enumText: (p.enum ?? []).join(", ") }));
}

/** Parameters for the server: rows with no name are dropped, an empty enum is left out. */
export function paramsFromRows(rows: readonly ParamRow[]): CatalogParam[] {
  return rows
    .filter((r) => r.name.trim() !== "")
    .map((r) => {
      const values = r.enumText.split(",").map((v) => v.trim()).filter(Boolean);
      return { name: r.name.trim(), type: r.type, required: r.required, description: r.description.trim(), ...(values.length > 0 ? { enum: values } : {}) };
    });
}

/** The JSON the server stores for these rows, as shown in the preview. */
export function previewJson(rows: readonly ParamRow[]): string {
  return JSON.stringify(paramsFromRows(rows), null, 2);
}

/** Why the tool cannot be saved yet, or null. */
export function customToolProblem(draft: { name: string; description: string; rows: readonly ParamRow[] }): string | null {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(draft.name.trim())) return "Name must be kebab-case: lowercase letters, numbers and hyphens, e.g. my-api-fetcher.";
  if (draft.description.trim() === "") return "Add a description so the agent knows when to use the tool.";
  const named = draft.rows.filter((r) => r.name.trim() !== "").map((r) => r.name.trim());
  const dup = named.find((n, i) => named.indexOf(n) !== i);
  if (dup !== undefined) return `Two parameters are named "${dup}".`;
  return null;
}

/** Add, change or remove one row (new array; an out-of-range index changes nothing). */
export function setRow(rows: readonly ParamRow[], index: number, patch: Partial<ParamRow>): ParamRow[] {
  return rows.map((r, i) => (i === index ? { ...r, ...patch } : r));
}

/** Rows without the one at `index`. */
export function removeRow(rows: readonly ParamRow[], index: number): ParamRow[] {
  return rows.filter((_, i) => i !== index);
}

/** The PATCH body holding only what changed against the saved tool (null when nothing did). */
export function customToolChanges(
  saved: { name: string; description: string; parameters: readonly CatalogParam[] },
  draft: { name: string; description: string; rows: readonly ParamRow[] },
): { name?: string; description?: string; parameters?: CatalogParam[] } | null {
  const out: { name?: string; description?: string; parameters?: CatalogParam[] } = {};
  if (draft.name.trim() !== saved.name) out.name = draft.name.trim();
  if (draft.description.trim() !== saved.description) out.description = draft.description.trim();
  const next = paramsFromRows(draft.rows);
  if (JSON.stringify(next) !== JSON.stringify(saved.parameters)) out.parameters = next;
  return Object.keys(out).length > 0 ? out : null;
}
