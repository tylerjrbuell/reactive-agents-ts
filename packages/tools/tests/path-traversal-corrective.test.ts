// Run: bun test packages/tools/tests/path-traversal-corrective.test.ts
//
// Corrective traversal rejections (issue #201, 2026-08-20).
//
// Live witness: granite4:latest invents absolute paths ("/home/user/logs.txt",
// "/app/logs.txt", bare "/logs.txt") for a file the task named as ./logs.txt.
// The guard correctly refused every one — and the bare rejection made the
// model guess again from nothing: 2-4 failed file-read calls per affected rep,
// one rep needing 8 iterations and 8,065 tokens to recover (vs ~2,200 clean).
//
// The guard still refuses. What changes is the error: it names the working
// root, states the relative-path rule, and when a suffix of the rejected path
// actually exists under the root, names that exact path — so the model's next
// call can be the right one instead of another guess. Every case here is
// deterministic: real tmp dirs, no model, no network.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  confinePath,
  fileReadHandler,
  fileWriteHandler,
  withFileRoot,
} from "../src/skills/file-operations.js";

async function sandboxWithLogs(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "corrective-guard-"));
  await writeFile(join(root, "logs.txt"), "line1\n");
  return root;
}

const readIn = (root: string, path: string) =>
  withFileRoot(root, () => Effect.runPromise(Effect.flip(fileReadHandler({ path }))));

describe("corrective traversal rejection: hallucinated absolute paths", () => {
  it("names the existing in-root file when the basename matches (the issue's exact shape)", async () => {
    const root = await sandboxWithLogs();
    for (const invented of ["/home/user/logs.txt", "/app/logs.txt", "/logs.txt"]) {
      const err = await readIn(root, invented);
      expect(err.message).toContain("Path traversal");
      expect(err.message).toContain(root);
      expect(err.message).toContain('"./logs.txt"');
      expect(err.message).toContain("relative to the working root");
    }
  });

  it("prefers the deepest existing suffix over the bare basename", async () => {
    const root = await mkdtemp(join(tmpdir(), "corrective-guard-"));
    await mkdir(join(root, "data"), { recursive: true });
    await writeFile(join(root, "data", "logs.txt"), "x\n");
    const err = await readIn(root, "/home/user/data/logs.txt");
    expect(err.message).toContain('"./data/logs.txt"');
  });

  it("falls back to the relative-path instruction when nothing under the root matches", async () => {
    const root = await mkdtemp(join(tmpdir(), "corrective-guard-"));
    const err = await readIn(root, "/home/user/notes.md");
    expect(err.message).toContain("Path traversal");
    expect(err.message).toContain(root);
    expect(err.message).toContain('"./notes.md"');
    expect(err.message).toContain("Use a relative path");
  });

  it("file-write rejections carry the same corrective instruction", async () => {
    const root = await mkdtemp(join(tmpdir(), "corrective-guard-"));
    const err = await withFileRoot(root, () =>
      Effect.runPromise(
        Effect.flip(fileWriteHandler({ path: "/home/user/output.txt", content: "hi" })),
      ),
    );
    expect(err.message).toContain("Path traversal");
    expect(err.message).toContain('"./output.txt"');
  });
});

describe("the guard itself is unchanged", () => {
  it("still refuses relative escapes, correctively", async () => {
    const root = await sandboxWithLogs();
    const err = await readIn(root, "../../etc/passwd");
    expect(err.message).toContain("Path traversal");
    expect(err.message).toContain(root);
  });

  it("refuses a sibling whose name only shares the root string prefix", async () => {
    const root = await mkdtemp(join(tmpdir(), "corrective-guard-"));
    const sibling = `${root}-secrets`;
    await mkdir(sibling);
    await writeFile(join(sibling, "keys.txt"), "outside\n");

    const err = await readIn(root, join(sibling, "keys.txt"));

    expect(err.message).toContain("Path traversal");
    expect(err.message).toContain(root);
  });

  it("a suggestion never escapes the root: ../logs.txt outside is not offered", async () => {
    // Sibling layout: root/inner is the sandbox, root/logs.txt sits OUTSIDE it.
    // The rejected path's suffix (logs.txt) exists only outside, so no
    // suggestion may be made — offering it would point the model at an escape.
    const outer = await mkdtemp(join(tmpdir(), "corrective-guard-"));
    await writeFile(join(outer, "logs.txt"), "outside\n");
    const inner = join(outer, "inner");
    await mkdir(inner);
    const err = await readIn(inner, join(outer, "logs.txt"));
    expect(err.message).toContain("Path traversal");
    expect(err.message).not.toContain("exists under the root");
    expect(err.message).toContain('"./logs.txt"'); // the generic instruction only
  });

  it("legitimate relative reads inside the root still work", async () => {
    const root = await sandboxWithLogs();
    const content = await withFileRoot(root, () =>
      Effect.runPromise(fileReadHandler({ path: "./logs.txt" })),
    );
    expect(content).toBe("line1\n");
  });

  it("confinePath returns the resolved path for in-root input", async () => {
    const root = await sandboxWithLogs();
    const resolved = await withFileRoot(root, () => confinePath("./logs.txt"));
    expect(resolved).toBe(join(root, "logs.txt"));
  });
});
