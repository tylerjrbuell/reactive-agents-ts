// SQL filter on the provenance columns (`task_id`, `run_id`) that semantic
// and procedural rows carry. One home so search and list queries filter the
// same way.

import type { MemoryProvenance } from "./types.js";

/** `AND`-prefixed SQL clauses plus their bound params for a provenance filter. */
export type ProvenanceClause = {
  readonly sql: string;
  readonly params: readonly string[];
};

/**
 * Build `AND <alias>task_id = ? AND <alias>run_id = ?` for the fields the
 * filter sets. An absent or empty filter yields an empty clause.
 *
 * @param filter - taskId / runId to match exactly
 * @param alias - table alias with trailing dot (e.g. `"sm."`), or `""`
 */
export const provenanceClause = (
  filter: MemoryProvenance | undefined,
  alias = "",
): ProvenanceClause => {
  const sql: string[] = [];
  const params: string[] = [];
  if (filter?.taskId !== undefined) {
    sql.push(`AND ${alias}task_id = ?`);
    params.push(filter.taskId);
  }
  if (filter?.runId !== undefined) {
    sql.push(`AND ${alias}run_id = ?`);
    params.push(filter.runId);
  }
  return { sql: sql.join(" "), params };
};
