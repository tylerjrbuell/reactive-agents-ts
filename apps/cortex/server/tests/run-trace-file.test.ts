import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRunTraceFile, readRunTreeTraces } from "../services/run-trace-file.js";

describe("readRunTraceFile", () => {
  test("returns the tracer JSONL verbatim; rejects traversal and unknown ids", () => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-trace-"));
    try {
      writeFileSync(join(dir, "RUN1.jsonl"), '{"kind":"run-started"}\n');
      writeFileSync(join(dir, "secret.jsonl"), "x");
      expect(readRunTraceFile("RUN1", [dir])).toBe('{"kind":"run-started"}\n');
      expect(readRunTraceFile("missing", [dir])).toBeUndefined();
      expect(readRunTraceFile("../secret", [join(dir, "sub")])).toBeUndefined();
      expect(readRunTraceFile("a/b", [dir])).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("readRunTreeTraces", () => {
  const withDir = (fn: (dir: string) => void): void => {
    const dir = mkdtempSync(join(tmpdir(), "cortex-tree-"));
    try {
      fn(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  test("unparseable root first line is no-trace, not a throw", () => {
    withDir((dir) => {
      writeFileSync(join(dir, "root1.jsonl"), "not json\n{}\n");
      expect(readRunTreeTraces("root1", [dir])).toEqual([]);
    });
  });

  test("child whose first line exceeds 8 KiB is still attributed to its root", () => {
    withDir((dir) => {
      writeFileSync(join(dir, "root2.jsonl"), `${JSON.stringify({ timestamp: 1, rootRunId: "root2" })}\n`);
      const big = JSON.stringify({ timestamp: 2, rootRunId: "root2", pad: "x".repeat(20_000) });
      writeFileSync(join(dir, "child2.jsonl"), `${big}\n{"a":1}\n`);
      expect(readRunTreeTraces("root2", [dir]).map((t) => t.runId)).toEqual(["root2", "child2"]);
    });
  });
});
