// Run: bun test packages/tools/tests/sandbox-escapes.test.ts --timeout 20000
//
// 2026-11-12 security audit (H1, H2, M1). Each case reproduced a real escape
// from the file-root / spill-dir sandbox; each must now be refused with the
// legitimate use of the same tool left working.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Effect, Ref } from "effect";
import * as fs from "node:fs/promises";
import { existsSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import * as path from "node:path";

import { grepHandler } from "../src/skills/grep.js";
import {
  confinePath,
  fileReadHandler,
  fileWriteHandler,
  withFileRoot,
} from "../src/skills/file-operations.js";
import { isWithinRoot } from "../src/skills/file-root.js";
import { makeRecallHandler } from "../src/skills/recall.js";
import { resolveScratchpadValue, setScratchpadBounded } from "../src/scratchpad-spill.js";

let base: string;
let root: string;
let outside: string;

beforeAll(async () => {
  base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), "sandbox-escapes-")));
  root = path.join(base, "work");
  outside = path.join(base, "work-secret"); // shares the string prefix of `root`
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(outside, { recursive: true });
  await fs.writeFile(path.join(root, "ok.txt"), "TOPSECRET inside\n");
  await fs.writeFile(path.join(outside, "s.txt"), "TOPSECRET outside\n");
  await fs.symlink(path.join(outside, "s.txt"), path.join(root, "link-file"));
  await fs.symlink(outside, path.join(root, "link-dir"));
});
afterAll(() => fs.rm(base, { recursive: true, force: true }).catch(() => {}));

describe("H2 — grep cannot leave the file root", () => {
  const grep = (args: Record<string, unknown>) =>
    withFileRoot(root, () => Effect.runPromise(grepHandler(args))) as Promise<{
      matches: { file: string; text: string }[];
      totalMatches: number;
    }>;

  it("finds in-root content (control)", async () => {
    const r = await grep({ pattern: "TOPSECRET", path: "." });
    expect(r.matches.map((m) => m.file)).toEqual(["ok.txt"]);
  });

  it("refuses a glob that climbs out of the scope", async () => {
    await expect(grep({ pattern: "TOPSECRET", path: ".", glob: "../work-secret/*.txt" })).rejects.toThrow(
      /Path traversal/,
    );
  });

  it("refuses an absolute glob", async () => {
    await expect(grep({ pattern: "TOPSECRET", path: ".", glob: `${outside}/*.txt` })).rejects.toThrow(
      /Path traversal/,
    );
  });

  it("refuses a sibling directory that merely shares the root's string prefix", async () => {
    await expect(grep({ pattern: "TOPSECRET", path: outside })).rejects.toThrow(/Path traversal/);
  });

  it("does not follow a symlinked scope or symlinked files out of the root", async () => {
    await expect(grep({ pattern: "TOPSECRET", path: "link-dir" })).rejects.toThrow(/Path traversal/);
    const r = await grep({ pattern: "TOPSECRET", path: "." });
    expect(r.matches.some((m) => m.text.includes("outside"))).toBe(false);
  });

  it("isWithinRoot is separator-aware", () => {
    expect(isWithinRoot("/a/work", "/a/work/x")).toBe(true);
    expect(isWithinRoot("/a/work", "/a/work")).toBe(true);
    expect(isWithinRoot("/a/work", "/a/work-secret")).toBe(false);
  });
});

describe("M1 — file tools resolve symlinks before confining", () => {
  it("confinePath refuses a symlink leaf that points outside the root", async () => {
    await withFileRoot(root, async () => {
      await expect(confinePath("link-file")).rejects.toThrow(/Path traversal/);
      await expect(confinePath("link-dir/s.txt")).rejects.toThrow(/Path traversal/);
    });
  });

  it("file-read refuses the symlink and does not return the target", async () => {
    const result = await withFileRoot(root, () =>
      Effect.runPromise(Effect.either(fileReadHandler({ path: "link-file" }))),
    );
    expect(result._tag).toBe("Left");
  });

  it("file-write through a symlink does not touch the target", async () => {
    const result = await withFileRoot(root, () =>
      Effect.runPromise(Effect.either(fileWriteHandler({ path: "link-file", content: "pwned" }))),
    );
    expect(result._tag).toBe("Left");
    expect(await fs.readFile(path.join(outside, "s.txt"), "utf-8")).toBe("TOPSECRET outside\n");
  });

  it("a write to a NOT-YET-EXISTING path under a symlinked dir is refused", async () => {
    await withFileRoot(root, async () => {
      await expect(confinePath("link-dir/new.txt")).rejects.toThrow(/Path traversal/);
    });
  });

  it("non-existent write targets inside the root still resolve", async () => {
    await withFileRoot(root, async () => {
      expect(await confinePath("sub/dir/new.txt")).toBe(path.join(root, "sub/dir/new.txt"));
    });
  });

  it("a symlink that stays inside the root is allowed", async () => {
    await fs.symlink(path.join(root, "ok.txt"), path.join(root, "link-inside"));
    await withFileRoot(root, async () => {
      expect(await confinePath("link-inside")).toBe(path.join(root, "link-inside"));
    });
  });
});

describe("H1 — recall cannot read arbitrary files through a spill marker", () => {
  const NAMESPACE = "test-sandbox-escapes";
  const SPILL_ROOT = path.join(homedir() || ".", ".reactive-agents", "spill", NAMESPACE);
  afterAll(() => {
    if (existsSync(SPILL_ROOT)) rmSync(SPILL_ROOT, { recursive: true, force: true });
  });

  const secret = () => path.join(outside, "s.txt");

  it("resolveScratchpadValue leaves a marker pointing outside the spill dir inert", () => {
    const marker = `[SPILLED_TO_DISK:${secret()}]`;
    expect(resolveScratchpadValue(marker)).toBe(marker);
  });

  it("a marker reaching the spill dir through a symlink is inert too", async () => {
    const link = path.join(base, "spill-link");
    await fs.symlink(secret(), link);
    // Park the link inside the real spill dir so only the realpath check can stop it.
    await fs.mkdir(SPILL_ROOT, { recursive: true });
    const inSpill = path.join(SPILL_ROOT, "evil.txt");
    await fs.symlink(secret(), inSpill);
    const marker = `[SPILLED_TO_DISK:${inSpill}]`;
    expect(resolveScratchpadValue(marker)).toBe(marker);
  });

  it("a genuine spill still round-trips", () => {
    const scratchpad = new Map<string, string>();
    const big = "x".repeat(200);
    setScratchpadBounded(scratchpad, "k1", "a".repeat(50), NAMESPACE, 100);
    setScratchpadBounded(scratchpad, "k2", big, NAMESPACE, 100);
    expect(scratchpad.get("k2")!.startsWith("[SPILLED_TO_DISK:")).toBe(true);
    expect(resolveScratchpadValue(scratchpad.get("k2")!)).toBe(big);
  });

  it("recall refuses to store a model-authored marker, so a read cannot dereference it", async () => {
    const store = Effect.runSync(Ref.make(new Map<string, string>()));
    const handler = makeRecallHandler(store, {});
    const written = (await Effect.runPromise(
      handler({ key: "x", content: `[SPILLED_TO_DISK:${secret()}]` }),
    )) as { saved: boolean; error?: string };
    expect(written.saved).toBe(false);
    const read = (await Effect.runPromise(handler({ key: "x", full: true }))) as { found?: boolean; content?: string };
    expect(read.found).toBe(false);
    expect(JSON.stringify(read)).not.toContain("TOPSECRET");
  });

  it("recall read of a marker planted straight into the store does not leak the file", async () => {
    const store = Effect.runSync(Ref.make(new Map([["x", `[SPILLED_TO_DISK:${secret()}]`]])));
    const handler = makeRecallHandler(store, {});
    const read = (await Effect.runPromise(handler({ key: "x", full: true }))) as { content?: string };
    expect(JSON.stringify(read)).not.toContain("TOPSECRET");
  });
});
