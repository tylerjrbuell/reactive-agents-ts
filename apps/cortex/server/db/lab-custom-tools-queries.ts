import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";

export type LabCustomToolRow = {
  tool_id: string;
  name: string;
  description: string;
  parameters_json: string;
  disabled: number;
  created_at: number;
};

export function listLabCustomTools(db: Database): LabCustomToolRow[] {
  return db
    .prepare(
      `SELECT tool_id, name, description, parameters_json, disabled, created_at
       FROM cortex_lab_custom_tools ORDER BY name ASC`,
    )
    .all() as LabCustomToolRow[];
}

export function getLabCustomTool(db: Database, toolId: string): LabCustomToolRow | null {
  const row = db
    .prepare(`SELECT tool_id, name, description, parameters_json, disabled, created_at FROM cortex_lab_custom_tools WHERE tool_id = ?`)
    .get(toolId) as LabCustomToolRow | undefined;
  return row ?? null;
}

export function insertLabCustomTool(
  db: Database,
  params: { name: string; description: string; parametersJson: string },
): string {
  const toolId = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO cortex_lab_custom_tools (tool_id, name, description, parameters_json, disabled, created_at)
     VALUES (?,?,?,?,0,?)`,
  ).run(toolId, params.name.trim(), params.description.trim(), params.parametersJson, now);
  return toolId;
}

export function setLabCustomToolDisabled(db: Database, toolId: string, disabled: boolean): boolean {
  const r = db.prepare(`UPDATE cortex_lab_custom_tools SET disabled = ? WHERE tool_id = ?`).run(disabled ? 1 : 0, toolId);
  return r.changes > 0;
}

export function deleteLabCustomTool(db: Database, toolId: string): boolean {
  const r = db.prepare(`DELETE FROM cortex_lab_custom_tools WHERE tool_id = ?`).run(toolId);
  return r.changes > 0;
}
