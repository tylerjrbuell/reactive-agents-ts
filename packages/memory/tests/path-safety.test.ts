import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  escapeLike,
  safeAgentPathSegment,
} from "../src/path-safety.js";
import { defaultUserMemoryPath } from "../src/types.js";
import { MemoryDatabase, MemoryDatabaseLive } from "../src/database.js";
import { MemoryFileSystem, MemoryFileSystemLive } from "../src/fs/memory-file-system.js";
import { searchSemanticRows } from "../src/services/semantic-rows.js";

const HOSTILE = ["../x", "/etc", "..", ".", "", "a/b", "..\\x", "../../.ssh"];
const tmpDirs: string[] = [];
const mkTmp = (): string => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mem-sec-"));
  tmpDirs.push(d);
  return d;
};

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("path-safety seam", () => {
  it("safeAgentPathSegment yields one inert segment", () => {
    for (const id of HOSTILE) {
      const seg = safeAgentPathSegment(id);
      expect(seg).not.toContain("/");
      expect(seg).not.toContain("\\");
      expect(seg).not.toBe("..");
      expect(seg).not.toBe(".");
      expect(seg.length).toBeGreaterThan(0);
    }
    expect(safeAgentPathSegment("agent-1_ok")).toBe("agent-1_ok");
  });

  it("defaultUserMemoryPath stays under the memory base for hostile ids", () => {
    const base = path.resolve(os.homedir(), ".reactive-agents", "memory");
    const home = process.env.HOME;
    process.env.HOME = os.homedir();
    try {
      for (const id of HOSTILE) {
        const p = path.resolve(defaultUserMemoryPath(id));
        expect(p.startsWith(base + path.sep)).toBe(true);
        expect(path.dirname(path.dirname(p))).toBe(base);
      }
    } finally {
      if (home === undefined) delete process.env.HOME;
      else process.env.HOME = home;
    }
  });

  it("MemoryFileSystem keeps hostile ids inside basePath, owner-only modes", async () => {
    const root = mkTmp();
    const base = path.join(root, "base");
    await Effect.runPromise(
      Effect.gen(function* () {
        const mfs = yield* MemoryFileSystem;
        for (const id of HOSTILE) {
          yield* mfs.writeMarkdown(id, "hi", base);
          expect(yield* mfs.readMarkdown(id, base)).toBe("hi");
        }
      }).pipe(Effect.provide(MemoryFileSystemLive)),
    );
    const entries = fs.readdirSync(base);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(fs.statSync(path.join(base, e)).mode & 0o777).toBe(0o700);
    }
    expect(fs.readdirSync(root)).toEqual(["base"]);
    const any = entries[0]!;
    expect(fs.statSync(path.join(base, any, "memory.md")).mode & 0o777).toBe(0o600);
  });

  it("database creates 0700 dir and 0600 db file", async () => {
    const root = mkTmp();
    const dbPath = path.join(root, "nested", "memory.db");
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* MemoryDatabase;
        }).pipe(
          Effect.provide(
            MemoryDatabaseLive({ dbPath } as Parameters<typeof MemoryDatabaseLive>[0]),
          ),
        ),
      ),
    );
    expect(fs.statSync(path.dirname(dbPath)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(dbPath).mode & 0o777).toBe(0o600);
  });

  it("escapeLike escapes wildcards and escape char", () => {
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("LIKE fallback treats % and _ literally", async () => {
    const root = mkTmp();
    const dbPath = path.join(root, "m.db");
    const cfg = { dbPath } as Parameters<typeof MemoryDatabaseLive>[0];
    const hits = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const db = yield* MemoryDatabase;
          const now = new Date().toISOString();
          for (const [id, content] of [
            ["1", "discount 50% today"],
            ["2", "discount 500 today"],
            ["3", "snake_case name"],
            ["4", "snakeXcase name"],
          ] as const) {
            yield* db.exec(
              `INSERT INTO semantic_memory (id, agent_id, content, summary, importance, verified, tags, created_at, updated_at, access_count, last_accessed_at)
               VALUES (?, 'a', ?, ?, 0.5, 0, '[]', ?, ?, 0, ?)`,
              [id, content, content, now, now, now],
            );
          }
          const noFts = { ...db, hasFTS5: false };
          const pct = yield* searchSemanticRows(noFts, { query: "50%", agentId: "a" });
          const us = yield* searchSemanticRows(noFts, { query: "snake_case", agentId: "a" });
          const wild = yield* searchSemanticRows(noFts, { query: "%", agentId: "a" });
          return { pct, us, wild };
        }).pipe(Effect.provide(MemoryDatabaseLive(cfg))),
      ),
    );
    expect(hits.pct.map((e) => e.id)).toEqual(["1"]);
    expect(hits.us.map((e) => e.id)).toEqual(["3"]);
    expect(hits.wild.map((e) => e.id)).toEqual(["1"]);
  });
});
