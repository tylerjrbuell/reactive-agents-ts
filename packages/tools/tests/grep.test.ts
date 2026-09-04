import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect } from "effect";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { grepHandler, grepTool } from "../src/skills/grep.js";
import { withFileRoot } from "../src/skills/file-operations.js";

const tmpDir = path.join(process.cwd(), ".tmp-grep-test-" + Date.now());

beforeAll(async () => {
  await fs.mkdir(path.join(tmpDir, "src"), { recursive: true });
  await fs.mkdir(path.join(tmpDir, "node_modules", "some-pkg"), { recursive: true });
  await fs.writeFile(
    path.join(tmpDir, "src", "a.ts"),
    "export function handleClick() {\n  console.log(\"clicked\");\n}\n",
  );
  await fs.writeFile(
    path.join(tmpDir, "src", "b.md"),
    "# Notes\nTODO: handleClick needs a test\n",
  );
  await fs.writeFile(
    path.join(tmpDir, "node_modules", "some-pkg", "index.ts"),
    "export function handleClick() {} // should never be found\n",
  );
});
afterAll(() => fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {}));

const run = (args: Record<string, unknown>) =>
  withFileRoot(tmpDir, () => Effect.runPromise(grepHandler(args))) as Promise<{
    matches: { file: string; line: number; text: string }[];
    totalMatches: number;
    filesScanned: number;
    truncated: boolean;
  }>;

describe("grep tool definition", () => {
  it("has name 'grep'", () => expect(grepTool.name).toBe("grep"));
});

describe("grepHandler", () => {
  it("finds a pattern within a glob-scoped file set", async () => {
    const result = await run({ pattern: "handleClick", glob: "src/**/*.ts" });
    expect(result.totalMatches).toBe(1);
    expect(result.matches[0].file).toBe("src/a.ts");
    expect(result.matches[0].line).toBe(1);
  });

  it("searches across file types when glob is unset", async () => {
    const result = await run({ pattern: "handleClick", path: "src" });
    expect(result.totalMatches).toBe(2); // a.ts definition + b.md TODO mention
    const files = result.matches.map((m) => m.file).sort();
    expect(files).toEqual(["src/a.ts", "src/b.md"]);
  });

  it("excludes node_modules by default", async () => {
    const result = await run({ pattern: "should never be found" });
    expect(result.totalMatches).toBe(0);
  });

  it("is case-insensitive by default, case-sensitive when requested", async () => {
    const ci = await run({ pattern: "HANDLECLICK", glob: "src/**/*.ts" });
    expect(ci.totalMatches).toBe(1);

    const cs = await run({ pattern: "HANDLECLICK", glob: "src/**/*.ts", caseSensitive: true });
    expect(cs.totalMatches).toBe(0);
  });

  it("truncates at maxMatches and reports truncated: true", async () => {
    const result = await run({ pattern: "handleClick", maxMatches: 1 });
    expect(result.matches.length).toBe(1);
    expect(result.truncated).toBe(true);
  });

  it("rejects a scope path that escapes the file root", async () => {
    await expect(run({ pattern: "x", path: "../../../../../etc" })).rejects.toThrow(/traversal/i);
  });

  it("rejects an invalid regex pattern with a message naming the pattern", async () => {
    await expect(run({ pattern: "(unclosed" })).rejects.toThrow(/Invalid regex pattern/);
  });

  it("rejects an empty pattern", async () => {
    await expect(run({ pattern: "" })).rejects.toThrow(/non-empty string/);
  });

  it("returns no matches (not an error) for a pattern that isn't present", async () => {
    const result = await run({ pattern: "definitely-not-present-xyz" });
    expect(result.totalMatches).toBe(0);
    expect(result.matches).toEqual([]);
  });
});
