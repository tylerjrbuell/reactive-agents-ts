// Seam pin: skills/file-read-heals.ts + fileReadHandler wiring.
//
// Census 2026-11-10 (501 runs): file-read on a directory returned raw EISDIR;
// `apps/cortex/README.md` with root `.../apps/cortex` resolved to
// `apps/cortex/apps/cortex/README.md` (ENOENT); encoding 'utf-16le' failed.
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileReadHandler, listDirectoryHandler, withFileRoot } from "../../src/skills/file-operations.js";
import {
  DIRECTORY_READ_NOTE,
  decodeFileText,
  stripRepeatedRootPrefix,
} from "../../src/skills/file-read-heals.js";

let base = "";
let root = "";
beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "ra-file-read-heals-"));
  root = join(base, "apps", "cortex");
  mkdirSync(join(root, "docs"), { recursive: true });
  writeFileSync(join(root, "README.md"), "# Cortex\n");
  writeFileSync(join(root, "docs", "a.md"), "a");
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

const read = (args: Record<string, unknown>): Promise<unknown> =>
  withFileRoot(root, () => Effect.runPromise(fileReadHandler(args)));

describe("file-read on a directory returns its listing", () => {
  test("listing has list-directory's shape plus a note", async () => {
    const r = (await read({ path: "docs" })) as Record<string, unknown>;
    const listed = (await withFileRoot(root, () =>
      Effect.runPromise(listDirectoryHandler({ path: "docs" })),
    )) as Record<string, unknown>;
    expect(r.note).toBe(DIRECTORY_READ_NOTE);
    expect(r.root).toBe(listed.root);
    expect(r.path).toBe(listed.path);
    expect(r.entries).toEqual(listed.entries);
    expect(r.entries).toEqual([{ name: "a.md", type: "file", bytes: 1 }]);
  });

  test("`.` lists the root", async () => {
    const r = (await read({ path: "." })) as { entries: { name: string }[] };
    expect(r.entries.map((e) => e.name)).toEqual(["README.md", "docs"]);
  });
});

describe("a path repeating the end of the root is read with the repeat stripped", () => {
  test("pure: strips the longest repeated tail", () => {
    expect(stripRepeatedRootPrefix("/x/apps/cortex", "apps/cortex/README.md")).toBe("README.md");
    expect(stripRepeatedRootPrefix("/x/apps/cortex", "./cortex/docs/a.md")).toBe("docs/a.md");
    expect(stripRepeatedRootPrefix("/x/apps/cortex", "docs/a.md")).toBeUndefined();
    expect(stripRepeatedRootPrefix("/x/apps/cortex", "/x/apps/cortex/README.md")).toBeUndefined();
    expect(stripRepeatedRootPrefix("/x/apps/cortex", "cortex")).toBeUndefined();
  });

  test("handler: `apps/cortex/README.md` reads README.md and notes the correction", async () => {
    const r = (await read({ path: "apps/cortex/README.md" })) as Record<string, unknown>;
    expect(r.content).toBe("# Cortex\n");
    expect(r.path).toBe(join(root, "README.md"));
    expect(String(r.note)).toContain('read "README.md" instead');
  });

  test("handler: a plain missing file still fails with ENOENT", async () => {
    await expect(read({ path: "nope.md" })).rejects.toThrow(/ENOENT/);
  });

  test("handler: an exact path is a plain string (no note)", async () => {
    expect(await read({ path: "README.md" })).toBe("# Cortex\n");
  });
});

describe("encoding fallback", () => {
  test("handler: 'utf-16le' on a UTF-8 file reads utf-8 with a note", async () => {
    const r = (await read({ path: "README.md", encoding: "utf-16le" })) as Record<string, unknown>;
    expect(r.content).toBe("# Cortex\n");
    expect(String(r.note)).toContain("not UTF-16");
  });

  test("handler: an unknown encoding reads utf-8 with a note", async () => {
    const r = (await read({ path: "README.md", encoding: "utf-32" })) as Record<string, unknown>;
    expect(r.content).toBe("# Cortex\n");
    expect(String(r.note)).toContain('encoding "utf-32" is not supported');
  });

  test("pure: a real UTF-16LE file (BOM) decodes as UTF-16 under 'utf-16le'", () => {
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("hi", "utf16le")]);
    expect(decodeFileText(buf, "utf-16le")).toEqual({ text: "hi" });
  });

  test("pure: a valid fs encoding name is honored with no note", () => {
    expect(decodeFileText(Buffer.from("hi"), "UTF-8")).toEqual({ text: "hi" });
    expect(decodeFileText(Buffer.from("hi"), "hex")).toEqual({ text: "6869" });
    expect(decodeFileText(Buffer.from("hi"), undefined)).toEqual({ text: "hi" });
  });
});
