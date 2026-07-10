// Run: bun test packages/tools/test/list-directory.test.ts
//
// The agent asked for this tool and it did not exist.
//
// MEASURED 2026-07-09, claude-haiku-4-5, rails on (grounding + fabrication
// guard + verification). Task needed `./rates.json`, which is absent. Step 8 of
// the trace, verbatim:
//
//     thought: "Let me check what files are available in the current directory:"
//     action:  find({"query":"rates exchange rate","scope":"web"})
//
// It tried to list the directory. The closest thing on its toolbelt was a web
// search. It never recovered; the run died at max_iterations with a dangling
// sentence ("Let me try to find the rates.json file in the current directory
// more carefully:") and wrote nothing.
//
// Without rails the same dead-end produced fabrication instead: haiku took a
// rate off the web (0.873956), qwen3:14b assumed 1:1, and both wrote a wrong
// number to result.txt under `success: true`.
//
// The recovery hint on a failed file-read now names this tool. A hint pointing
// at a tool that does not exist is worse than no hint, so the two ship together
// (see file-read-errors.test.ts).

import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listDirectoryTool, listDirectoryHandler, withFileRoot } from "../src/skills/file-operations.js";

let root: string;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ra-listdir-"));
  writeFileSync(join(root, "orders.json"), '{"orders":[]}');
  writeFileSync(join(root, "README.md"), "rates moved into config.json");
  mkdirSync(join(root, "nested"));
  writeFileSync(join(root, "nested", "deep.txt"), "x");
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

// `withFileRoot` is AsyncLocalStorage — the Effect must be RUN inside the
// store, not merely constructed inside it. (Building it inside and running it
// outside silently falls back to process.cwd().)
const run = (args: Record<string, unknown>, at = root) =>
  withFileRoot(at, () => Effect.runPromise(listDirectoryHandler(args)));

type Listing = {
  root: string;
  path: string;
  entries: { name: string; type: "file" | "dir"; bytes?: number }[];
};

describe("list-directory — the recovery tool the trace asked for", () => {
  it("lists the working root by default, so a model with no path can still look", async () => {
    const r = (await run({})) as Listing;
    expect(r.entries.map((e) => e.name)).toEqual(["README.md", "nested", "orders.json"]);
  });

  it("distinguishes files from directories and sizes the files", async () => {
    const r = (await run({})) as Listing;
    const nested = r.entries.find((e) => e.name === "nested")!;
    const orders = r.entries.find((e) => e.name === "orders.json")!;
    expect(nested.type).toBe("dir");
    expect(nested.bytes).toBeUndefined();
    expect(orders.type).toBe("file");
    expect(orders.bytes).toBeGreaterThan(0);
  });

  it("resolves a relative subdirectory against the root", async () => {
    const r = (await run({ path: "./nested" })) as Listing;
    expect(r.entries.map((e) => e.name)).toEqual(["deep.txt"]);
  });

  it("reports the root it resolved against — a relative path means nothing without it", async () => {
    const r = (await run({})) as Listing;
    expect(r.root).toBe(root);
  });

  it("would have surfaced the README that explains where the missing file went", async () => {
    // The whole point. Both models were structurally unable to discover this.
    const r = (await run({})) as Listing;
    expect(r.entries.some((e) => e.name === "README.md")).toBe(true);
  });
});

describe("the file-root sandbox confines it, exactly as file-read/file-write are confined", () => {
  it("refuses to escape the root via ..", async () => {
    await expect(run({ path: "../.." })).rejects.toThrow(/traversal/i);
  });

  it("refuses an absolute path outside the root", async () => {
    await expect(run({ path: "/etc" })).rejects.toThrow(/traversal/i);
  });

  it("allows an absolute path INSIDE the root", async () => {
    const r = (await run({ path: join(root, "nested") })) as Listing;
    expect(r.entries.map((e) => e.name)).toEqual(["deep.txt"]);
  });

  it("a missing directory fails with a named error, not a silent empty listing", async () => {
    // An empty array would read as "the directory is empty" — a lie that would
    // send the model down the same fabrication path.
    await expect(run({ path: "./no-such-dir" })).rejects.toThrow(/List directory failed/);
  });
});

describe("the tool is registered, not merely defined", () => {
  it("declares itself a read-only builtin needing no approval", () => {
    expect(listDirectoryTool.name).toBe("list-directory");
    expect(listDirectoryTool.source).toBe("builtin");
    expect(listDirectoryTool.produces).toBe("none");
    expect(listDirectoryTool.requiresApproval).toBe(false);
  });

  it("is in the builtin registry, so `withTools({builtins:[...]})` can expose it", async () => {
    const { builtinTools } = await import("../src/skills/builtin.js");
    expect(builtinTools.map((r) => r.definition.name)).toContain("list-directory");
  });

  it("tells the model WHEN to reach for it, not just what it does", () => {
    // A description that only says "lists files" loses to a guess. The trace
    // shows the model guesses when it has no instruction to look.
    expect(listDirectoryTool.description).toMatch(/after any file-read fails/i);
  });
});
