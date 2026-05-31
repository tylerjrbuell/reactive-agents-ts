import { describe, it, expect } from "bun:test";
import { Effect, Ref } from "effect";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeWriteResultToFileHandler } from "../src/skills/write-result-to-file.js";

const commits = Array.from({ length: 20 }, (_, i) => ({
  sha: `sha${i}`,
  commit: { message: `feat: change ${i}\n\nbody that must not leak into a bullet` },
}));

function run(store: Map<string, string>, args: Record<string, unknown>) {
  const ref = Ref.unsafeMake(store);
  return Effect.runPromise(makeWriteResultToFileHandler(ref)(args) as Effect.Effect<unknown, never>);
}

describe("write_result_to_file — reference materialization", () => {
  it("writes ALL 20 items from a stored JSON result (no truncation, no marker)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wrtf-"));
    const out = join(dir, "out.md");
    const store = new Map([["_tool_result_1", JSON.stringify(commits)]]);

    const res = (await run(store, { result_ref: "_tool_result_1", path: out, format: "bullets" })) as {
      written: boolean;
      items: number;
    };
    expect(res.written).toBe(true);
    expect(res.items).toBe(20);

    const content = readFileSync(out, "utf-8");
    expect(content.split("\n").length).toBe(20);
    expect(content).toContain("- feat: change 0");
    expect(content).not.toContain("body that must not leak");
    expect(content).not.toContain("[STORED:");
  });

  it("honest failure on unknown ref — does NOT write a placeholder file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wrtf-"));
    const out = join(dir, "nope.md");
    const store = new Map([["_tool_result_1", "[]"]]);

    const err = await run(store, { result_ref: "_tool_result_9", path: out }).then(
      () => null,
      (e) => e,
    );
    expect(err).not.toBeNull();
    expect(String(err?.message ?? err)).toContain("_tool_result_1"); // surfaces available ids
    expect(existsSync(out)).toBe(false); // NO placeholder written
  });
});
