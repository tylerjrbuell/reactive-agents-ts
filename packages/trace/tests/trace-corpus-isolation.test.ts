// Run: bun test packages/trace/tests/trace-corpus-isolation.test.ts
// Pins: tests never write to the real ~/.reactive-agents/traces corpus.
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { Effect } from "effect";
import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder.js";
import { defaultTraceDir, resolveTraceDir } from "../src/paths.js";
import type { TraceEvent } from "../src/events.js";

describe("trace corpus isolation", () => {
  it("under a test runner the canonical resolver away from the real dir", () => {
    expect(resolveTraceDir()).not.toBe(defaultTraceDir());
  });

  it("a recorder built with the hard-coded default dir writes to the override, not the real corpus", async () => {
    const runId = `01TESTISO${Date.now().toString(36).toUpperCase()}${process.pid}`;
    // boundary: minimal run-started fixture (empty config)
    const ev = { kind: "run-started", runId, rootRunId: runId, depth: 0, timestamp: 1, iter: -1, seq: 1, task: "t", model: "test-model", provider: "test", config: {} } as unknown as TraceEvent;
    await Effect.runPromise(
      Effect.gen(function* () {
        const r = yield* TraceRecorderService;
        yield* r.emit(ev);
        yield* r.flush(runId);
      }).pipe(Effect.provide(TraceRecorderServiceLive({ dir: defaultTraceDir() }))),
    );
    expect(readdirSync(resolveTraceDir())).toContain(`${runId}.jsonl`);
    expect(existsSync(`${defaultTraceDir()}/${runId}.jsonl`)).toBe(false);
  });
});
