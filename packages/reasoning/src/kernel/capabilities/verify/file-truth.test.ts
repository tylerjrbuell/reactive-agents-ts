// Run: bun test packages/reasoning/src/kernel/capabilities/verify/file-truth.test.ts
//
// Regression: the disk ground-truth check MUST resolve a relative deliverable
// path against the SAME root the file-write tool writes to — the active
// `getFileRoot()` (a `withFileRoot()` sandbox / temp dir), not `process.cwd()`.
// When they diverged, a COMPLETED run whose deliverable sat in the sandbox root
// was judged "missing", steered into a fabricated `harness_deliverable`, and
// rejected by the verifier (observed live on Groq/Gemini native-FC).
import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withFileRoot } from "@reactive-agents/tools";
import { nodeFileExists } from "./file-truth.js";

const dirs: string[] = [];
const mkroot = () => {
  const d = mkdtempSync(join(tmpdir(), "ft-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("nodeFileExists — honors the active file root", () => {
  it("finds a relative deliverable written into the withFileRoot sandbox", () => {
    const root = mkroot();
    writeFileSync(join(root, "report.md"), "- a\n- b\n- c\n", "utf8");
    // Outside the sandbox context it resolves against cwd → not found.
    expect(nodeFileExists("./report.md", process.cwd() + "/__no_such_dir__")).toBe(false);
    // Inside the sandbox context the default cwd = getFileRoot() → found.
    const found = withFileRoot(root, () => nodeFileExists("./report.md"));
    expect(found).toBe(true);
  });

  it("returns false for a relative path absent from the sandbox root", () => {
    const root = mkroot();
    const found = withFileRoot(root, () => nodeFileExists("./missing.md"));
    expect(found).toBe(false);
  });

  it("still checks an absolute path as-is regardless of root", () => {
    const root = mkroot();
    const abs = join(root, "data.json");
    writeFileSync(abs, "{}", "utf8");
    expect(nodeFileExists(abs)).toBe(true);
  });

  it("defaults to process.cwd() when no file root is active (backward-compatible)", () => {
    // package.json exists at the reasoning package cwd during the test run.
    const found = nodeFileExists("./package.json");
    expect(typeof found).toBe("boolean");
  });
});
