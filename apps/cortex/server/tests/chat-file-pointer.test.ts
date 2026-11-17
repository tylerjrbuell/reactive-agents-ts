// Run: bun run repo test apps/cortex/server/tests/chat-file-pointer.test.ts
//
// A tagged workspace file is sent to the agent as a pointer (path + size + how to read it),
// never as the file's contents, unless the file is at most POINTER_INLINE_MAX_BYTES.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTurnInput } from "../services/chat-attachments.js";
import { ATTACHED_FILE_END, POINTER_INLINE_MAX_BYTES, pointerSentence, workspaceFileBlock } from "../services/chat-file-pointer.js";

let root = "";
const WALL = "see ./wiki/Plans/one.md and ./wiki/Plans/two.md\n".repeat(600);

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "cortex-pointer-"));
  writeFileSync(join(root, "AGENTS.md"), WALL);
  writeFileSync(join(root, "tiny.md"), "tiny body");
  writeFileSync(join(root, "edge.txt"), "e".repeat(POINTER_INLINE_MAX_BYTES));
  writeFileSync(join(root, "edge-plus.txt"), "e".repeat(POINTER_INLINE_MAX_BYTES + 1));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

const base = { provider: "test", model: "test-model", workspaceRoot: undefined as string | undefined };
const build = (files: string[]) => buildTurnInput({ ...base, workspaceRoot: root, message: "summarise this", attachments: { files } });

describe("tagged file pointer", () => {
  it("a file above the threshold is a pointer: path and size, never its contents", () => {
    const r = build(["AGENTS.md"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const text = r.input as string;
    expect(text.startsWith("summarise this\n\n--- Attached file: AGENTS.md (")).toBe(true);
    expect(text).toContain(pointerSentence("AGENTS.md"));
    expect(text).toContain("file-read");
    expect(text.trimEnd().endsWith(ATTACHED_FILE_END)).toBe(true);
    // The path-bearing contents never reach the task text (they are what spawned bogus deliverables).
    expect(text).not.toContain("./wiki/Plans/one.md");
    expect(text.length).toBeLessThan(400);
    expect(r.meta[0]).toMatchObject({ kind: "workspace-file", path: "AGENTS.md", bytes: WALL.length });
  });

  it("a small file is inlined inside the same delimited block", () => {
    const r = build(["tiny.md"]);
    if (!r.ok) throw new Error("refused");
    expect(r.input).toContain("--- Attached file: tiny.md (9 B) ---\n```\ntiny body\n```\n" + ATTACHED_FILE_END);
  });

  it("the threshold is inclusive: 2 KB inlines, one byte more is a pointer", () => {
    const at = build(["edge.txt"]);
    const over = build(["edge-plus.txt"]);
    if (!at.ok || !over.ok) throw new Error("refused");
    expect(at.input as string).toContain("e".repeat(POINTER_INLINE_MAX_BYTES));
    expect(over.input as string).not.toContain("eeee");
    expect(over.input as string).toContain(pointerSentence("edge-plus.txt"));
  });

  it("confinement is unchanged: outside paths and secrets are refused before a pointer exists", () => {
    for (const f of ["../x", "/etc/passwd", ".env"]) expect(build([f])).toMatchObject({ ok: false, code: "bad-file" });
  });

  it("the block shape matches what the framework masks: exact closing line, column-0 opening line, user words first", () => {
    // Literal on purpose (no import from packages): the kernel matches this exact line.
    expect(ATTACHED_FILE_END).toBe("--- End attached file ---");
    const r = build(["AGENTS.md", "tiny.md"]);
    if (!r.ok) throw new Error("refused");
    const lines = (r.input as string).split("\n");
    expect(lines[0]).toBe("summarise this");
    const opens = lines.filter((l) => l.startsWith("--- Attached file: "));
    expect(opens).toHaveLength(2);
    expect(opens.every((l) => /^--- Attached file: .+ \(.+\) ---$/.test(l))).toBe(true);
    expect(lines.filter((l) => l === "--- End attached file ---")).toHaveLength(2);
    expect(lines.indexOf(opens[0]!)).toBeGreaterThan(0);
  });

  it("workspaceFileBlock is pure: pointer vs inline by size", () => {
    expect(workspaceFileBlock({ path: "a.md", totalBytes: 5000, text: "ignored" })).not.toContain("ignored");
    expect(workspaceFileBlock({ path: "a.md", totalBytes: 7, text: "inlined" })).toContain("inlined");
  });
});
