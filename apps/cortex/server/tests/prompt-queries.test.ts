import { describe, it, expect } from "bun:test";
import { Database } from "bun:sqlite";
import { openDatabase, applySchema } from "../db/schema.js";
import { insertPrompt, listPrompts, updatePrompt, deletePrompt } from "../db/prompt-queries.js";

describe("prompt-queries", () => {
  it("inserts and lists prompts", () => {
    const db = openDatabase(":memory:");
    insertPrompt(db, { name: "Research", body: "Research {{topic}} thoroughly.", tags: ["research"] });
    const list = listPrompts(db);
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("Research");
    expect(list[0]?.body).toContain("{{topic}}");
  });

  it("deletes a prompt", () => {
    const db = openDatabase(":memory:");
    const id = insertPrompt(db, { name: "Temp", body: "Hello" });
    deletePrompt(db, id);
    expect(listPrompts(db)).toHaveLength(0);
  });

  it("stores and returns prompt type, defaulting to snippet", () => {
    const db = openDatabase(":memory:");
    insertPrompt(db, { name: "Sys", body: "You are a researcher.", type: "system" });
    insertPrompt(db, { name: "NoType", body: "Plain" });
    const list = listPrompts(db);
    expect(list.find((p) => p.name === "Sys")?.type).toBe("system");
    expect(list.find((p) => p.name === "NoType")?.type).toBe("snippet");
  });

  it("updates prompt type", () => {
    const db = openDatabase(":memory:");
    const id = insertPrompt(db, { name: "P", body: "Act as a pirate.", type: "snippet" });
    updatePrompt(db, id, { name: "P", body: "Act as a pirate.", type: "persona" });
    expect(listPrompts(db)[0]?.type).toBe("persona");
  });

  it("migrates legacy cortex_prompts table without type column", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE cortex_prompts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        name        TEXT    NOT NULL DEFAULT '',
        body        TEXT    NOT NULL,
        tags        TEXT    NOT NULL DEFAULT '[]',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000),
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch('now','subsec') * 1000)
      )
    `);
    db.exec("INSERT INTO cortex_prompts (name, body) VALUES ('Legacy', 'old prompt')");
    applySchema(db);
    const list = listPrompts(db);
    expect(list[0]?.name).toBe("Legacy");
    expect(list[0]?.type).toBe("snippet");
  });
});
