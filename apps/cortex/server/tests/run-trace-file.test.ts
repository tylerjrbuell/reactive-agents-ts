import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRunTraceFile } from "../services/run-trace-file.js";

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
