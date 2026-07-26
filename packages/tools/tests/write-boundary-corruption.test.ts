// Run: bun test packages/tools/tests/write-boundary-corruption.test.ts
//
// A deliverable must never be overwritten with the harness's own text
// (2026-07-26).
//
// Live witness — bench rw-1, claude-haiku, 76k tokens, scored 0%:
//
//   FAIL: databases.json exists and parses as a non-empty JSON array
//         — JSON Parse error: Unexpected identifier "Tool"
//
// The trace shows THREE writes to the same path, in order:
//
//   1. '```json\n[\n  {\n    "name": "LanceDB", …'   ← the real deliverable
//   2. '✓ file-write completed successfully'          ← harness observation text
//   3. '[Tool error: Web search failed: …'            ← harness error text
//
// `file-write` overwrites, so the deliverable the agent had ALREADY produced
// correctly was destroyed by the model echoing back observation strings it had
// just been shown. The run then reported the artifact as produced, because a
// successful write is a successful write.
//
// Both markers are authored BY the harness (`[Tool error: …]` in
// tool-execution.ts + inline-act.ts; `✓ <tool> completed successfully` in
// plan-text.ts). A model passing one as CONTENT is always a mistake — there is
// no legitimate case — which is what makes rejecting them safe rather than
// heuristic. The JSON gate is the backstop for every other corruption mode:
// for an extension whose validity is checkable, writing an unparseable
// deliverable is a guaranteed downstream failure that the run would otherwise
// report as success.
//
// RED-ON-CUT: drop either guard and the matching case below fails.
import { describe, expect, it } from "bun:test";
import { Effect } from "effect";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileWriteHandler, withFileRoot } from "../src/skills/file-operations.js";

/** Writes are confined to the active file root, so every case runs inside one. */
const write = (root: string, path: string, content: string) =>
  withFileRoot(root, () =>
    Effect.runPromise(Effect.either(fileWriteHandler({ path, content }))),
  );

describe("harness-authored text is never deliverable content", () => {
  it("CONTROL: ordinary content writes normally", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const p = join(dir, "notes.md");
    const r = await write(dir, p, "# Notes\n\nreal content\n");
    expect(r._tag).toBe("Right");
    expect(await readFile(p, "utf-8")).toContain("real content");
  });

  it("rejects a [Tool error: …] echo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const r = await write(dir,
      join(dir, "databases.json"),
      '[Tool error: Web search failed: Error: no results for query "vector db"]',
    );
    expect(r._tag).toBe("Left");
  });

  it("rejects a '✓ <tool> completed successfully' echo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const r = await write(dir, join(dir, "out.md"), "✓ file-write completed successfully");
    expect(r._tag).toBe("Left");
  });

  it("does NOT destroy an existing deliverable when the echo is rejected", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const p = join(dir, "databases.json");
    const good = JSON.stringify([{ name: "LanceDB" }]);
    expect((await write(dir, p, good))._tag).toBe("Right");
    // The exact live sequence: the model echoes the error back at the same path.
    await write(dir, p, "[Tool error: Web search failed]");
    // The correct artifact survives — this is the whole point.
    expect(JSON.parse(await readFile(p, "utf-8"))).toEqual([{ name: "LanceDB" }]);
  });
});

describe("an unparseable .json deliverable is refused, not written", () => {
  it("CONTROL: valid JSON writes, and a fenced block is still unwrapped", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const p = join(dir, "data.json");
    const r = await write(dir, p, '```json\n[{"a":1}]\n```');
    expect(r._tag).toBe("Right");
    expect(JSON.parse(await readFile(p, "utf-8"))).toEqual([{ a: 1 }]);
  });

  it("refuses prose written to a .json path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const r = await write(dir, join(dir, "data.json"), "Here are the three databases I found.");
    expect(r._tag).toBe("Left");
  });

  it("leaves non-JSON structured extensions alone (not cheaply checkable)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const p = join(dir, "data.csv");
    const r = await write(dir, p, "name,license\nLanceDB,Apache 2.0\n");
    expect(r._tag).toBe("Right");
    expect(await readFile(p, "utf-8")).toContain("LanceDB");
  });

  it("leaves .md alone — prose is the point there", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-wb-"));
    const r = await write(dir, join(dir, "report.md"), "Here are the three databases I found.");
    expect(r._tag).toBe("Right");
  });
});
