// Run: bun test packages/reasoning/tests/kernel/act/file-root-healing.test.ts --timeout 15000
//
// Regression for a sandbox-escape bug (2026-07-02): act.ts, step-executor.ts,
// and blueprint/worker.ts all passed `process.cwd()` as the healing
// pipeline's path-resolution root, instead of `getFileRoot()` (the
// AsyncLocalStorage-backed sandbox root set by `withFileRoot()` — used by
// the benchmark harness and any future sandboxed run). A relative or
// hallucinated-absolute file-tool path got pre-resolved to an absolute path
// OUTSIDE the sandbox before the file-write/file-read handler's own
// traversal guard ever saw it — which then correctly rejected it. Net
// effect: every file-write call inside a `withFileRoot()` scope, on any
// reasoning strategy (react/plan-execute/blueprint), failed with
// "Path traversal detected", regardless of model or task correctness.
//
// This test encodes the contract the three call sites must uphold: the
// healing pipeline's workingDir MUST reflect the active withFileRoot()
// scope, not the real process cwd.

import { describe, it, expect } from "bun:test";
import { runHealingPipeline, withFileRoot, getFileRoot } from "@reactive-agents/tools";
import type { ToolCallSpec } from "@reactive-agents/tools";

const FILE_TOOL_NAMES = new Set(["file-write", "file-read"]);
const FILE_WRITE_SCHEMA = {
  name: "file-write",
  description: "Write a file",
  parameters: [
    { name: "path", type: "string", required: true },
    { name: "content", type: "string", required: true },
  ],
};

describe("healing pipeline path resolution respects withFileRoot sandbox", () => {
  it("resolves a relative path against getFileRoot(), not process.cwd()", () => {
    withFileRoot("/sandbox/run-abc", () => {
      const call: ToolCallSpec = {
        id: "1",
        name: "file-write",
        arguments: { path: "out.txt", content: "hi" },
      };
      const result = runHealingPipeline(
        call,
        [FILE_WRITE_SCHEMA],
        FILE_TOOL_NAMES,
        getFileRoot(), // ← the fix: this is what act.ts/step-executor.ts/worker.ts must pass
        {},
        {},
      );
      expect(result.call.arguments.path).toBe("/sandbox/run-abc/out.txt");
    });
  });

  // Step 3a (09 §6.6 / F9, 2026-08-18): the healer used to silently remap an
  // out-of-root absolute path to `<root>/<basename>` here — which let the
  // write succeed at a path the model never asked for while terminal
  // verification (checking the model's original path) reported the run
  // FAILED next to a file that was actually written correctly. That remap
  // branch is deleted; file-operations.ts's own `Path traversal detected:`
  // throw is now the sole confinement authority. The healer's root-sourcing
  // fix (getFileRoot(), not process.cwd() — this file's original regression)
  // is unaffected: it still governs relative-path resolution, verified by
  // the sibling tests above and below.
  it("does not remap a hallucinated absolute path — passes it through so the tool's own traversal guard fires", () => {
    withFileRoot("/sandbox/run-abc", () => {
      const call: ToolCallSpec = {
        id: "2",
        name: "file-write",
        arguments: { path: "/some/other/repo/out.txt", content: "hi" },
      };
      const result = runHealingPipeline(
        call,
        [FILE_WRITE_SCHEMA],
        FILE_TOOL_NAMES,
        getFileRoot(),
        {},
        {},
      );
      expect(result.call.arguments.path).toBe("/some/other/repo/out.txt");
    });
  });

  it("would have escaped the sandbox if workingDir were process.cwd() instead of getFileRoot() — proves the bug's mechanism", () => {
    withFileRoot("/sandbox/run-abc", () => {
      const call: ToolCallSpec = {
        id: "3",
        name: "file-write",
        arguments: { path: "out.txt", content: "hi" },
      };
      // The exact regression: passing process.cwd() (the buggy value) instead
      // of getFileRoot() heals the path OUTSIDE the active sandbox.
      const result = runHealingPipeline(
        call,
        [FILE_WRITE_SCHEMA],
        FILE_TOOL_NAMES,
        process.cwd(),
        {},
        {},
      );
      expect(result.call.arguments.path).not.toBe("/sandbox/run-abc/out.txt");
      expect(result.call.arguments.path).toBe(`${process.cwd()}/out.txt`);
    });
  });
});
