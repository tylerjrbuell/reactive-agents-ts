// Run: bun test packages/runtime/tests/run-store-permissions.test.ts --timeout 15000
//
// Security: durable-run storage is owner-only, and an agent id can never
// escape the base directory it is joined into.
import { describe, it, expect, afterEach } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { RunStoreLive, RunStoreService, defaultDurableRunsDir, safeAgentPathSegment } from "../src/services/run-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("run store file modes", () => {
  it.skipIf(process.platform === "win32")("creates the dir 0700 and runs.db 0600", async () => {
    const root = mkdtempSync(join(tmpdir(), "ra-runstore-perm-"));
    dirs.push(root);
    const dir = join(root, "fresh", "agent");
    const dbPath = join(dir, "runs.db");
    await Effect.runPromise(
      Effect.scoped(Effect.gen(function* () {
        yield* RunStoreService;
      })).pipe(Effect.provide(RunStoreLive(dbPath))),
    );
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(dbPath).mode & 0o777).toBe(0o600);
  });
});

describe("agent id containment", () => {
  const home = "/home/u";
  const base = join(home, ".reactive-agents");
  const hostile = ["../evil", "../../etc", "/etc/passwd", "a/../../b", "..", ".", "", "a\\b"];

  for (const id of hostile) {
    it(`contains ${JSON.stringify(id)} under the base dir`, () => {
      const p = defaultDurableRunsDir(id, home);
      const rel = relative(base, p);
      expect(rel.split("/")).toHaveLength(1);
      expect(rel).not.toBe("..");
      expect(isAbsolute(rel)).toBe(false);
      expect(rel.includes("/")).toBe(false);
      expect(rel).not.toBe("");
    });
  }

  it("leaves ordinary ids unchanged", () => {
    expect(safeAgentPathSegment("my-agent_1")).toBe("my-agent_1");
    expect(defaultDurableRunsDir("my-agent", home)).toBe(join(base, "my-agent"));
  });
});
