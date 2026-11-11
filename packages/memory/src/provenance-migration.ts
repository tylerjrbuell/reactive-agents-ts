// Provenance columns for semantic_memory and procedural_memory.
//
// `CREATE TABLE IF NOT EXISTS` never adds columns to a table that already
// exists, so a database created before provenance shipped needs an explicit
// ALTER. This step is idempotent: it reads `PRAGMA table_info` and only adds
// the columns that are missing. The indexes are created here (not in the core
// schema SQL) because on an old database the core SQL runs before the columns
// exist. FTS5 triggers only reference rowid/id/content/tags, so adding columns
// leaves them intact.

import type { DatabaseLike } from "@reactive-agents/runtime-shim";

type MigrationDb = Pick<DatabaseLike, "exec" | "prepare">;

const PROVENANCE_TABLES = ["semantic_memory", "procedural_memory"] as const;
const PROVENANCE_COLUMNS = ["task_id", "run_id"] as const;

const columnNames = (db: MigrationDb, table: string): Set<string> => {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  const names = new Set<string>();
  for (const row of rows) {
    if (typeof row === "object" && row !== null && "name" in row && typeof row.name === "string") {
      names.add(row.name);
    }
  }
  return names;
};

/**
 * Add nullable `task_id` / `run_id` columns (plus lookup indexes) to the
 * semantic and procedural memory tables when they are missing. Safe to run on
 * every open; existing rows keep their data and read back with no provenance.
 */
export const migrateProvenanceColumns = (db: MigrationDb): void => {
  for (const table of PROVENANCE_TABLES) {
    const existing = columnNames(db, table);
    for (const column of PROVENANCE_COLUMNS) {
      if (!existing.has(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
      }
    }
  }
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_semantic_task ON semantic_memory(task_id);
    CREATE INDEX IF NOT EXISTS idx_semantic_run ON semantic_memory(run_id);
    CREATE INDEX IF NOT EXISTS idx_procedural_task ON procedural_memory(task_id);
    CREATE INDEX IF NOT EXISTS idx_procedural_run ON procedural_memory(run_id);
  `);
};
