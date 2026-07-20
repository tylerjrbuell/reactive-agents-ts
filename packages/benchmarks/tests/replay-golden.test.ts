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

import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { loadRecordedRun, replay } from "@reactive-agents/replay";
import { makeReplayAgent } from "../src/replay-agent.js";

const TRACE_DIR = mkdtempSync(join(tmpdir(), "ra-replay-golden-"));
const REPLAY_ROOT = mkdtempSync(join(tmpdir(), "ra-replay-golden-root-"));
const TASK = "Write a short note to ./note.md and report done.";

// NOTE (2026-07-19, debt burndown): the trace dir is set EXPLICITLY on the
// builder below via `.withObservability({ tracing: { dir: TRACE_DIR } })`,
// NOT via `process.env.REACTIVE_AGENTS_TRACE_DIR`. Bun runs test files
// concurrently in one process, and that env var is process-global: two other
// suites (diagnose, meta-tools-default-surface) mutate it, so a shared-env
// approach raced — the recorder wrote its LLM exchanges to another suite's
// dir, leaving this golden's llmTable empty (deterministic CI failure). An
// explicit builder dir is captured on the agent and immune to that race.

afterAll(() => {
  rmSync(TRACE_DIR, { recursive: true, force: true });
  rmSync(REPLAY_ROOT, { recursive: true, force: true });
});

describe("replay rail — record a harness run, replay it deterministically", () => {
  it("reproduces the recorded deliverable with no live provider", async () => {
    // ── RECORD: a real run through the harness on the scripted test provider ──
    const before = new Set(readdirSync(TRACE_DIR));
    const recorder = await ReactiveAgents.create()
      .withProvider("test")
      .withModel("test")
      // Explicit trace dir — immune to the process-global REACTIVE_AGENTS_TRACE_DIR
      // race under Bun's concurrent test-file execution (see module header).
      .withObservability({ tracing: { dir: TRACE_DIR } })
      .withTestScenario([
        { match: "note\\.md", toolCall: { name: "file-write", args: { path: "./note.md", content: "hello from the harness" } } },
        { text: "FINAL ANSWER: wrote the note and it is done." },
      ])
      .withTools({ builtins: ["file-write"] })
      // Static required list: suppresses the tool-relevance classifier (whose
      // prompt embeds the task text and would consume the match-guarded
      // toolCall turn — the scenario would then never reach the kernel) and
      // forces the tool to fire, so this golden exercises the REAL tool rail.
      .withRequiredTools({ tools: ["file-write"] })
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

    const result = await replay(run, () =>
      makeReplayAgent(run, {
        traceDir: null,
        builtins: ["file-write"],
        requiredTools: ["file-write"],
        // "recorded" tool mode erases the tool SURFACE (its listTools is []),
        // which with required tools force-abstains before the first model
        // call — see the module header of replay-agent.ts. Tool-using goldens
        // replay in "live" mode inside a confined fileRoot, same as the lane.
        toolMode: "live",
        fileRoot: REPLAY_ROOT,
      }),
    );

    // THE KEYSTONE ASSERTION: the whole harness, re-run against the recorded
    // model stream with no live provider, reproduces the recorded deliverable
    // exactly. Cutting `.withReplayLLM` (so the live/test provider answers
    // instead) breaks this — the run no longer follows the recording.
    expect(result.replay.output).toBe(recorded.output);

    // The trace now carries the deliverable (run-completed.output, W-C fix in
    // run-finalize → event-bus → trace normalize), so the trace-side diff is
    // no longer blind: assert it agrees with the record-side oracle above.
    expect(result.diff.outputDiff.equal).toBe(true);

    // And the golden exercised the REAL tool rail: the recording carries the
    // file-write call (args included — kernel-hooks now threads them through).
    expect(run.toolTable.size).toBeGreaterThan(0);
  });
});
