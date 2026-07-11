// Run: bun test packages/benchmarks/tests/replay-golden.test.ts --timeout 30000
//
// The replay-rail keystone, proven end-to-end with NO keys and NO Ollama:
// record a real harness run (test provider → real kernel, tools, assembly,
// trace), then rebuild the WHOLE agent against that recording via
// `.withReplayLLM()` + the sequence-ordered table and assert the deliverable
// reproduces byte-for-byte. This is the deterministic capability-signal lane
// the measurement audit found missing — the `replay()` engine existed but
// nothing wired a real agent through it, because `.withLayers()` cannot
// override LLMService (it is captured at construction). `.withReplayLLM()` can.

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { loadRecordedRun, replay } from "@reactive-agents/replay";
import { makeReplayAgent } from "../src/replay-agent.js";

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-replay-golden-"));
const PRIOR = process.env.REACTIVE_AGENTS_TRACE_DIR;
const TASK = "Write a short note to ./note.md and report done.";

beforeAll(() => {
  process.env.REACTIVE_AGENTS_TRACE_DIR = TRACE_DIR;
});
afterAll(() => {
  if (PRIOR === undefined) delete process.env.REACTIVE_AGENTS_TRACE_DIR;
  else process.env.REACTIVE_AGENTS_TRACE_DIR = PRIOR;
  rmSync(TRACE_DIR, { recursive: true, force: true });
});

describe("replay rail — record a harness run, replay it deterministically", () => {
  it("reproduces the recorded deliverable with no live provider", async () => {
    // ── RECORD: a real run through the harness on the scripted test provider ──
    const before = new Set(readdirSync(TRACE_DIR));
    const recorder = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("test")
      .withTestScenario([
        { match: "note\\.md", toolCall: { name: "file-write", args: { path: "./note.md", content: "hello from the harness" } } },
        { text: "FINAL ANSWER: wrote the note and it is done." },
      ])
      .withTools({ builtins: ["file-write"] })
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(4)
      .build();
    const recorded = await recorder.run(TASK);
    await recorder.dispose();
    expect(recorded.output).toBeTruthy();

    // Find the golden trace this run wrote.
    const newFiles = readdirSync(TRACE_DIR).filter(
      (f) => f.endsWith(".jsonl") && !before.has(f),
    );
    // The per-run file is ULID-named; ignore any catch-all sidecars.
    const goldenName = newFiles.find((f) => /^[0-9A-HJKMNP-TV-Z]{26}\.jsonl$/.test(f));
    expect(goldenName).toBeDefined();
    const goldenPath = join(TRACE_DIR, goldenName!);

    // ── REPLAY: rebuild the whole agent against the recording, no keys ──
    const run = await loadRecordedRun(goldenPath);
    // A non-empty exchange table is the proof the golden actually recorded the
    // model stream; the replay dispenses from it with no live provider.
    expect(run.llmTable.size).toBeGreaterThan(0);

    const result = await replay(run, () => makeReplayAgent(run, { traceDir: null }));

    // THE KEYSTONE ASSERTION: the whole harness, re-run against the recorded
    // model stream with no live provider, reproduces the recorded deliverable
    // exactly. Cutting `.withReplayLLM` (so the live/test provider answers
    // instead) breaks this — the run no longer follows the recording.
    expect(result.replay.output).toBe(recorded.output);

    // NOTE: `result.diff.outputDiff.equal` is intentionally NOT asserted. The
    // diff compares against the RECORDED TRACE's run-completed.output, which the
    // recorder leaves undefined (trace-completeness gap, tracked separately) —
    // so the trace-side output is blind. The record-side AgentResult above is
    // the faithful oracle.
  });
});
