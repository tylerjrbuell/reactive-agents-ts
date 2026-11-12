// Run: bun run repo test apps/cortex/server/tests/tmp-hygiene.test.ts
//
// /tmp is RAM-backed. Hand-rolled temp DB names (`/tmp/cortex-x-${uuid}.db`, `Date.now()` names)
// were removed with `rmSync(path)` only, leaking `-wal`/`-shm` siblings: ~31k files, 9.8 GB, two
// IDE OOMs. Tests make DB paths with `helpers/tmp-db.ts` (`tmpDbPath` / `rmDbFiles`) or use `:memory:`.
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { rmDbFiles, tmpDbPath } from "./helpers/tmp-db.js";

const TESTS_DIR = import.meta.dir;
const SELF = "tmp-hygiene.test.ts";

const files = readdirSync(TESTS_DIR).filter((f) => f.endsWith(".ts") && f !== SELF);

/** Each rule flags a line that builds a temp DB name by hand. */
const RULES: ReadonlyArray<{ readonly name: string; readonly test: (line: string) => boolean }> = [
  { name: "literal /tmp/cortex path", test: (l) => /["'`]\/tmp\/cortex/.test(l) },
  { name: "unique-suffixed .db name (use tmpDbPath)", test: (l) => /\$\{[^}]*\}\.db\b/.test(l) },
  {
    name: "tmpdir() joined with a pid/clock/random name (use tmpDbPath or tmpDir)",
    test: (l) => /tmpdir\(\)/.test(l) && /(Date\.now|randomUUID|process\.pid|Math\.random)/.test(l),
  },
];

describe("server tests do not hand-roll temp DB names", () => {
  it("scans the test files", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const rule of RULES) {
    it(`no ${rule.name}`, () => {
      const offenders = files.flatMap((f) =>
        readFileSync(join(TESTS_DIR, f), "utf8")
          .split("\n")
          .flatMap((line, i) => (!line.trimStart().startsWith("//") && rule.test(line) ? [`${f}:${i + 1}`] : [])),
      );
      expect(offenders).toEqual([]);
    });
  }
});

describe("tmp-db helper", () => {
  it("rmDbFiles removes the db, its wal/shm siblings and the dir", () => {
    const path = tmpDbPath("hygiene");
    for (const suffix of ["", "-wal", "-shm"]) writeFileSync(path + suffix, "x");
    rmDbFiles(path);
    expect(existsSync(path)).toBe(false);
    expect(existsSync(path + "-wal")).toBe(false);
    expect(existsSync(path + "-shm")).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });
});
