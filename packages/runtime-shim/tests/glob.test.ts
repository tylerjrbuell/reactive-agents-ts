import { test, expect } from "bun:test";
import { glob } from "../src/index.js";
import { tmpdir } from "node:os";
import { mkdir, writeFile as nodeWriteFile, rm } from "node:fs/promises";
import { join } from "node:path";

test("glob finds files matching *.json pattern", async () => {
  const dir = join(tmpdir(), `shim-glob-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    await nodeWriteFile(join(dir, "a.json"), "{}");
    await nodeWriteFile(join(dir, "b.json"), "{}");
    await nodeWriteFile(join(dir, "c.txt"), "skip");

    const g = glob("*.json");
    const matches: string[] = [];
    for await (const f of g.scan({ cwd: dir })) {
      matches.push(f);
    }
    expect(matches.sort()).toEqual(["a.json", "b.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("glob handles empty directory gracefully", async () => {
  const dir = join(tmpdir(), `shim-glob-empty-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    const g = glob("*.json");
    const matches: string[] = [];
    for await (const f of g.scan({ cwd: dir })) {
      matches.push(f);
    }
    expect(matches).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("glob works with nested patterns", async () => {
  const dir = join(tmpdir(), `shim-glob-nested-${Date.now()}`);
  await mkdir(dir, { recursive: true });
  try {
    await mkdir(join(dir, "subdir"), { recursive: true });
    await nodeWriteFile(join(dir, "file.js"), "");
    await nodeWriteFile(join(dir, "subdir", "nested.js"), "");
    await nodeWriteFile(join(dir, "file.ts"), "");

    const g = glob("*.js");
    const matches: string[] = [];
    for await (const f of g.scan({ cwd: dir })) {
      matches.push(f);
    }
    expect(matches).toEqual(["file.js"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
