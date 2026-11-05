// Run: bun test packages/trace/tests/load-trace-dedupe.test.ts --timeout 15000
//
// H3 baseline 2026-11-05 instrument finding: a timed-out cell flushes its sink
// twice, so every event appears twice. Readers that sum events (tokens, calls,
// guard counts) double-count unless the loader dedupes by (runId, seq).
import { describe, expect, it, afterAll } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadTrace } from "../src/index.js";

const dir = mkdtempSync(join(tmpdir(), "trace-dedupe-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const line = (seq: number, kind: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ kind, runId: "r1", timestamp: 1000 + seq, iter: 0, seq, ...extra });

describe("loadTrace", () => {
  it("keeps one copy of an event written twice (same runId and seq)", async () => {
    const events = [
      line(0, "run-started", { task: "t", model: "m", provider: "ollama", config: {} }),
      line(1, "tool-call-start", { toolName: "file-read" }),
    ];
    const path = join(dir, "dup.jsonl");
    writeFileSync(path, [...events, ...events].join("\n"));
    const t = await loadTrace(path);
    expect(t.events.map((e) => e.seq)).toEqual([0, 1]);
  });

  it("keeps events with the same seq from different runs", async () => {
    const path = join(dir, "two-runs.jsonl");
    writeFileSync(path, [line(0, "tool-call-start", { toolName: "a" }), JSON.stringify({ kind: "tool-call-start", runId: "r2", timestamp: 1, iter: 0, seq: 0, toolName: "b" })].join("\n"));
    const t = await loadTrace(path);
    expect(t.events.length).toBe(2);
  });
});
