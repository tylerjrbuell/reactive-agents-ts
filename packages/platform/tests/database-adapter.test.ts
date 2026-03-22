import { describe, expect, it } from "bun:test";
import { createBunDatabase } from "../src/adapters/bun-database.js";

// ── Shared conformance suite ─────────────────────────────────────────────────

function runConformanceSuite(
  name: string,
  factory: (path: string, options?: { create?: boolean; readonly?: boolean }) => ReturnType<typeof createBunDatabase>,
) {
  describe(`${name} adapter`, () => {
    it("creates an in-memory database", () => {
      const db = factory(":memory:");
      expect(db.isOpen).toBe(true);
      db.close();
    });

    it("exec + run + queryAll", () => {
      const db = factory(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.run("INSERT INTO test (name) VALUES (?)", "alice");
      db.run("INSERT INTO test (name) VALUES (?)", "bob");
      const rows = db.queryAll<{ id: number; name: string }>(
        "SELECT * FROM test ORDER BY id",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.name).toBe("alice");
      expect(rows[1]!.name).toBe("bob");
      db.close();
    });

    it("queryOne returns single row or undefined", () => {
      const db = factory(":memory:");
      db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, val TEXT)");
      db.run("INSERT INTO kv VALUES (?, ?)", "foo", "bar");
      const row = db.queryOne<{ key: string; val: string }>(
        "SELECT * FROM kv WHERE key = ?",
        "foo",
      );
      expect(row?.val).toBe("bar");
      const missing = db.queryOne("SELECT * FROM kv WHERE key = ?", "nope");
      expect(missing).toBeUndefined();
      db.close();
    });

    it("prepare → StatementAdapter run/get/all", () => {
      const db = factory(":memory:");
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, v INTEGER)");
      const insert = db.prepare("INSERT INTO items (v) VALUES (?)");
      insert.run(10);
      insert.run(20);
      const all = db
        .prepare("SELECT * FROM items ORDER BY v")
        .all<{ id: number; v: number }>();
      expect(all).toHaveLength(2);
      expect(all[0]!.v).toBe(10);
      expect(all[1]!.v).toBe(20);
      const one = db
        .prepare("SELECT * FROM items WHERE v = ?")
        .get<{ id: number; v: number }>(10);
      expect(one?.v).toBe(10);
      db.close();
    });

    it("isOpen reflects closed state", () => {
      const db = factory(":memory:");
      expect(db.isOpen).toBe(true);
      db.close();
      // After close, isOpen should be false (bun adapter tracks manually;
      // better-sqlite3 exposes db.open natively).
      expect(db.isOpen).toBe(false);
    });
  });
}

// ── Bun adapter suite (always runs) ─────────────────────────────────────────

describe("DatabaseAdapter conformance", () => {
  runConformanceSuite("bun", createBunDatabase);

  // ── Node adapter suite (runs when better-sqlite3 is installed) ─────────────

  describe("node adapter", () => {
    // Use dynamic require so the test file still loads even without better-sqlite3.
    let createNodeDatabase:
      | typeof import("../src/adapters/node-database.js").createNodeDatabase
      | undefined;
    let available = false;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require("../src/adapters/node-database.js");
      createNodeDatabase = mod.createNodeDatabase;
      // Verify the native addon is actually present by opening a test DB.
      const probe = createNodeDatabase!(":memory:");
      probe.close();
      available = true;
    } catch {
      available = false;
    }

    it("produces same results as bun adapter (skipped when better-sqlite3 absent)", () => {
      if (!available || !createNodeDatabase) return;

      const db = createNodeDatabase(":memory:");
      db.exec("CREATE TABLE test (id INTEGER PRIMARY KEY, name TEXT)");
      db.run("INSERT INTO test (name) VALUES (?)", "alice");
      db.run("INSERT INTO test (name) VALUES (?)", "bob");
      const rows = db.queryAll<{ id: number; name: string }>(
        "SELECT * FROM test ORDER BY id",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]!.name).toBe("alice");
      expect(rows[1]!.name).toBe("bob");
      db.close();
    });

    it("queryOne works (skipped when better-sqlite3 absent)", () => {
      if (!available || !createNodeDatabase) return;

      const db = createNodeDatabase(":memory:");
      db.exec("CREATE TABLE kv (key TEXT PRIMARY KEY, val TEXT)");
      db.run("INSERT INTO kv VALUES (?, ?)", "foo", "bar");
      const row = db.queryOne<{ key: string; val: string }>(
        "SELECT * FROM kv WHERE key = ?",
        "foo",
      );
      expect(row?.val).toBe("bar");
      const missing = db.queryOne("SELECT * FROM kv WHERE key = ?", "nope");
      expect(missing).toBeUndefined();
      db.close();
    });

    it("prepare + StatementAdapter (skipped when better-sqlite3 absent)", () => {
      if (!available || !createNodeDatabase) return;

      const db = createNodeDatabase(":memory:");
      db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, v INTEGER)");
      const insert = db.prepare("INSERT INTO items (v) VALUES (?)");
      insert.run(10);
      insert.run(20);
      const all = db
        .prepare("SELECT * FROM items ORDER BY v")
        .all<{ id: number; v: number }>();
      expect(all).toHaveLength(2);
      const one = db
        .prepare("SELECT * FROM items WHERE v = ?")
        .get<{ id: number; v: number }>(10);
      expect(one?.v).toBe(10);
      db.close();
    });
  });
});
