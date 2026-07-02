// Run: bun test packages/trace/tests/recorder-redaction.test.ts --timeout 15000
//
// F8 — traces were written to disk with systemPrompt / message content / tool
// args unredacted, by default. Any credential a user pastes into a prompt (or
// any tool result) landed cleartext in ~/.reactive-agents/traces/. The recorder
// now redacts secrets at the disk-write boundary; the in-memory snapshot used
// by rax-diagnose/replay (same trust boundary) stays full-fidelity.
import { describe, test, expect, afterAll } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { TraceRecorderService, TraceRecorderServiceLive } from "../src/recorder.js";
import type { TraceEvent } from "../src/events.js";

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const SECRET_KEY = "sk-ant-api03-" + "A".repeat(95);
const SECRET_BEARER = "Bearer ghp_" + "b".repeat(36);

describe("F8 — trace recorder redaction", () => {
  test("redacts secrets in the on-disk JSONL but keeps the in-memory snapshot intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rax-trace-redact-"));
    dirs.push(dir);
    const runId = "run-redact-1";

    const event: TraceEvent = {
      runId,
      timestamp: 1,
      iter: -1,
      seq: 0,
      kind: "run-started",
      task: `summarize this: my key is ${SECRET_KEY} and auth ${SECRET_BEARER}`,
      model: "test",
      provider: "test",
      config: {},
    };

    const snapshot = await Effect.gen(function* () {
      const rec = yield* TraceRecorderService;
      yield* rec.emit(event);
      yield* rec.flush(runId);
      return yield* rec.snapshot(runId);
    }).pipe(Effect.provide(TraceRecorderServiceLive({ dir })), Effect.runPromise);

    const onDisk = readFileSync(join(dir, `${runId}.jsonl`), "utf8");

    // Disk copy must not contain the raw secrets.
    expect(onDisk).not.toContain(SECRET_KEY);
    expect(onDisk).not.toContain("ghp_" + "b".repeat(36));
    expect(onDisk).toContain("[redacted-anthropic-key]");

    // In-memory snapshot (same-process debugging) keeps full fidelity.
    const task = (snapshot[0] as { task: string }).task;
    expect(task).toContain(SECRET_KEY);
  }, 15000);
});
