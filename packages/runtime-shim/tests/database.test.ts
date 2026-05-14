import { test, expect } from "bun:test";
import { Database } from "../src/index.js";

test("Database can be instantiated and exec/prepare/run/all work", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER, name TEXT)");
  const stmt = db.prepare("INSERT INTO t (id, name) VALUES (?, ?)");
  stmt.run(1, "alice");
  stmt.run(2, "bob");
  const rows = db.prepare("SELECT * FROM t ORDER BY id").all() as Array<{ id: number; name: string }>;
  expect(rows).toHaveLength(2);
  expect(rows[0]?.name).toBe("alice");
  expect(rows[1]?.name).toBe("bob");
  db.close();
});

test("Database query() returns statement with all/get/run", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER)");
  db.exec("INSERT INTO t (id) VALUES (1), (2), (3)");
  const result = db.query("SELECT * FROM t").all() as Array<{ id: number }>;
  expect(result).toHaveLength(3);
  expect(result[0]?.id).toBe(1);
  db.close();
});

test("Database prepare().get() returns single row", () => {
  const db = new Database(":memory:");
  db.exec("CREATE TABLE t (id INTEGER, name TEXT)");
  db.prepare("INSERT INTO t VALUES (?, ?)").run(1, "alice");
  const row = db.prepare("SELECT * FROM t WHERE id = ?").get(1) as { id: number; name: string };
  expect(row.name).toBe("alice");
  db.close();
});
