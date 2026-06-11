import type { Database } from "bun:sqlite";

export const PROMPT_TYPES = ["system", "persona", "task", "snippet"] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export function isPromptType(v: unknown): v is PromptType {
  return typeof v === "string" && (PROMPT_TYPES as readonly string[]).includes(v);
}

export interface PromptRow {
  id: number;
  name: string;
  body: string;
  type: PromptType;
  tags: string;
  createdAt: number;
  updatedAt: number;
}

export interface PromptInput {
  name?: string;
  body: string;
  type?: PromptType;
  tags?: string[];
}

type RawRow = {
  id: number;
  name: string;
  body: string;
  type: string;
  tags: string;
  created_at: number;
  updated_at: number;
};

function mapRow(r: RawRow): PromptRow {
  return {
    id: r.id,
    name: r.name,
    body: r.body,
    type: isPromptType(r.type) ? r.type : "snippet",
    tags: r.tags,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function insertPrompt(db: Database, input: PromptInput): number {
  const result = db
    .prepare("INSERT INTO cortex_prompts (name, body, type, tags) VALUES (?, ?, ?, ?)")
    .run(input.name ?? "", input.body, input.type ?? "snippet", JSON.stringify(input.tags ?? []));
  return result.lastInsertRowid as number;
}

export function listPrompts(db: Database): PromptRow[] {
  const rows = db
    .prepare(
      "SELECT id, name, body, type, tags, created_at, updated_at FROM cortex_prompts ORDER BY created_at DESC",
    )
    .all() as RawRow[];
  return rows.map(mapRow);
}

export function updatePrompt(db: Database, id: number, input: PromptInput): void {
  db.prepare(
    "UPDATE cortex_prompts SET name = ?, body = ?, type = ?, tags = ?, updated_at = (unixepoch('now','subsec') * 1000) WHERE id = ?",
  ).run(input.name ?? "", input.body, input.type ?? "snippet", JSON.stringify(input.tags ?? []), id);
}

export function deletePrompt(db: Database, id: number): void {
  db.prepare("DELETE FROM cortex_prompts WHERE id = ?").run(id);
}
