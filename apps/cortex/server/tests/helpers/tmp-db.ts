/**
 * Shared temp-file helpers for Cortex server tests.
 *
 * `/tmp` is a RAM-backed tmpfs on dev machines. A SQLite database opened in WAL mode
 * leaves `<path>-wal` and `<path>-shm` beside `<path>`, so `rmSync(path)` alone leaks
 * two files per test (about 31k files, 9.8 GB, before this helper). Every test that
 * needs an on-disk database makes its path with {@link tmpDbPath} and removes it with
 * {@link rmDbFiles}; a test that needs a scratch directory uses {@link tmpDir}.
 * Prefer `:memory:` when the test does not need a file.
 *
 * Directories are also swept on process `exit` as a best-effort net, but `bun test`
 * does not reliably run it: call {@link rmDbFiles} / {@link rmTmpDirs} in teardown.
 * `tmp-hygiene.test.ts` forbids hand-rolled temp DB names in tests.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dirs = new Set<string>();
const dirByDbPath = new Map<string, string>();
let sweepArmed = false;

function armSweep(): void {
  if (sweepArmed) return;
  sweepArmed = true;
  process.on("exit", () => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });
}

/** A fresh temp directory, removed at process exit (or earlier with `rmSync`). */
export function tmpDir(prefix = "dir"): string {
  armSweep();
  const dir = mkdtempSync(join(tmpdir(), `cortex-${prefix}-`));
  dirs.add(dir);
  return dir;
}

/** Remove every directory {@link tmpDir} made so far. Call it from `afterAll`. */
export function rmTmpDirs(): void {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  dirs.clear();
}

/** A unique `.db` path inside its own fresh temp dir. Remove it with {@link rmDbFiles}. */
export function tmpDbPath(prefix = "db"): string {
  const dir = tmpDir(prefix);
  const path = join(dir, "test.db");
  dirByDbPath.set(path, dir);
  return path;
}

/** Remove a database plus its `-wal`/`-shm` siblings and, for {@link tmpDbPath} paths, the dir. Close the db first. */
export function rmDbFiles(path: string): void {
  for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
  const dir = dirByDbPath.get(path);
  if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
}
