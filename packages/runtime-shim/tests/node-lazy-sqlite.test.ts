import { test, expect, beforeAll, afterAll } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Node prints `ExperimentalWarning: SQLite is an experimental feature` the
// moment `node:sqlite` is loaded. The shim must load it lazily (on first
// `new Database(...)`), so importing the package — which every SDK user and
// `rax-diagnose` does — stays silent when no database is opened.
//
// The src tree uses `.js` import specifiers, so Node cannot run it directly;
// bundle it for Node into a temp dir, then spawn real `node` on it.

const nodeVersion = (() => {
  const r = spawnSync("node", ["--version"], { encoding: "utf8" });
  if (r.status !== 0) return undefined;
  const m = /^v(\d+)\.(\d+)/.exec(r.stdout.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : undefined;
})();
const hasNodeSqlite =
  nodeVersion !== undefined &&
  (nodeVersion.major > 22 || (nodeVersion.major === 22 && nodeVersion.minor >= 5));

let dir = "";
let bundle = "";

beforeAll(async () => {
  if (!hasNodeSqlite) return;
  dir = mkdtempSync(join(tmpdir(), "ra-shim-lazy-sqlite-"));
  const out = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../src/index.ts")],
    outdir: dir,
    target: "node",
    format: "esm",
  });
  if (!out.success) throw new Error(out.logs.map(String).join("\n"));
  bundle = join(dir, "index.js");
});

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

function runNode(source: string) {
  const script = join(dir, `probe-${Math.random().toString(36).slice(2)}.mjs`);
  writeFileSync(script, source);
  return spawnSync("node", [script], { encoding: "utf8", timeout: 15_000 });
}

test.skipIf(!hasNodeSqlite)(
  "importing the shim under Node does not load node:sqlite (no ExperimentalWarning)",
  () => {
    const r = runNode(
      `const shim = await import(${JSON.stringify(bundle)});\n` +
        `if (typeof shim.Database !== "function") throw new Error("Database export missing");\n` +
        `console.log("imported");\n`,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("imported");
    expect(r.stderr).not.toContain("ExperimentalWarning");
  },
);

test.skipIf(!hasNodeSqlite)(
  "opening a Database under Node still works (node:sqlite loads on first use)",
  () => {
    const r = runNode(
      `const { Database } = await import(${JSON.stringify(bundle)});\n` +
        `const db = new Database(":memory:");\n` +
        `db.exec("CREATE TABLE t (id INTEGER)");\n` +
        `db.prepare("INSERT INTO t VALUES (?)").run(7);\n` +
        `const second = new Database(":memory:");\n` +
        `second.close();\n` +
        `console.log(JSON.stringify(db.query("SELECT id FROM t").all()));\n` +
        `db.close();\n`,
    );
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`[{"id":7}]`);
  },
);
