// Run: bun test packages/reasoning/src/kernel/capabilities/act/recovery-hint-accuracy.test.ts --timeout 15000
//
// A recovery hint is appended to a failed tool_result, one of the few channels
// that reaches the model's context. A census of 501 recorded runs (2026-11-10)
// found it doing harm in two ways:
//
// 1. file-edit's "'oldText' was not found in crytpo.md ... Read the file first
//    and copy the block verbatim" got "→ Call list-directory(...)" appended,
//    because the matcher keyed on the substring "not found". The file existed;
//    the edit text did not match. The hint sent the model to the wrong tool.
// 2. Errors that already name the fix ("Closest valid call:", "Allowed
//    commands:", "Valid: ...") got a generic hint stacked on top — noise that
//    small models read as a second, competing instruction.

import { describe, expect, it } from "bun:test";
import { getRecoveryHint } from "./recovery-hint.js";

const WITH_LIST_DIR = new Set(["file-read", "file-write", "file-edit", "list-directory"]);

describe("getRecoveryHint: the path-missing hint fires only on a missing path", () => {
  it("file-edit 'oldText was not found' gets no list-directory hint", () => {
    const hint = getRecoveryHint(
      "file-edit",
      "File edit failed: 'oldText' was not found in crytpo.md. Read the file first and copy the block verbatim.",
      WITH_LIST_DIR,
    );
    expect(hint).not.toContain("list-directory");
    expect(hint).toBe("");
  });

  it("a file-edit 'not found' that teaches nothing still gets no path hint", () => {
    const hint = getRecoveryHint("file-edit", "File edit failed: oldText not found in notes.md", WITH_LIST_DIR);
    expect(hint).not.toContain("list-directory");
    expect(hint).not.toContain("No file exists at that path");
  });

  it("a bare ENOENT from file-read still names list-directory when it is exposed", () => {
    const hint = getRecoveryHint(
      "file-read",
      "File read failed: ENOENT: no such file or directory, open './rates.json'",
      WITH_LIST_DIR,
    );
    expect(hint).toContain('list-directory({"path": "."})');
  });

  it("'file not found' from file-read is a missing path too", () => {
    expect(getRecoveryHint("file-read", "File not found: ./rates.json", WITH_LIST_DIR)).toContain("list-directory");
  });

  it("a missing path without list-directory exposed never names it", () => {
    const hint = getRecoveryHint("file-read", "ENOENT: no such file or directory", new Set(["file-read"]));
    expect(hint).not.toContain("list-directory");
    expect(hint).toContain("the same path will fail again");
  });
});

describe("getRecoveryHint: an error that already teaches gets no generic hint", () => {
  const teaching: ReadonlyArray<readonly [string, string]> = [
    ["shell-execute", "Command not allowed: rm. Allowed commands: ls, cat, grep"],
    ["todo", "Invalid action 'begin'. Valid: add | start | done | list"],
    ["file-write", "Invalid arguments. Closest valid call: file-write({\"path\": \"a.md\", \"content\": \"...\"})"],
    ["web-search", "Invalid parameter 'q'. Did you mean 'query'?"],
    ["shell-execute", "Missing required parameter \"command\". Valid call: shell-execute({\"command\":\"git log --oneline -5\"})"],
    ["file-edit", "File edit failed: required field missing. Read the file first and copy the block verbatim."],
    ["file-read", "Path is a directory, not found as a file. Use list-directory to see its entries."],
  ];
  for (const [tool, msg] of teaching) {
    it(`${tool}: "${msg.slice(0, 40)}…" gets no extra hint`, () => {
      expect(getRecoveryHint(tool, msg, WITH_LIST_DIR)).toBe("");
    });
  }

  it("a non-teaching validation error still gets the generic argument hint", () => {
    expect(getRecoveryHint("web-search", "Invalid arguments: query must be a string")).toContain(
      "Check argument format",
    );
  });

  it("a non-file 'not found' keeps the resource hint", () => {
    expect(getRecoveryHint("http-get", "HTTP 404 Not Found")).toContain("requested resource was not found");
  });
});
