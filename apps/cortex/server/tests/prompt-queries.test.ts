import { describe, it, expect } from "bun:test";
import { openDatabase } from "../db/schema.js";
import { insertPrompt, listPrompts, deletePrompt } from "../db/prompt-queries.js";

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
});
