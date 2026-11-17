/**
 * loop-stop-resume.test.ts — a run a loop guard stopped is continued by
 * `agent.resumeRun(runId, { note?, extraIterations? })`. Zero token.
 *
 * The kernel's own loop trip (real detector, terminal pipeline, checkpoint
 * rail) is pinned in reasoning's `loop-stop-resume.test.ts`. Here the runtime
 * side is pinned on a REAL durable run whose final checkpoint is rewritten to
 * the loop-stopped state the kernel leaves (`failed`, `terminatedBy:
 * loop_graceful`, a `loopStop` record) — then a fresh agent resumes it.
 *
 * Proves: the run id is on the result; the stop summary + `resumable` are on
 * the run row; resume continues without re-running completed tool steps and
 * clears the row's stop; `extraIterations` bounds the continued run; a run
 * that did not loop-stop is refused with `RunNotResumableError`; plain
 * `resumeRun(runId)` is unchanged; the chat failure note names what was done
 * and that Continue is available.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { deserializeKernelState, serializeKernelState, type KernelState, type LoopStopRecord } from "@reactive-agents/reasoning";
import { ReactiveAgents } from "../src/builder.js";
import { RunNotResumableError } from "../src/errors.js";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";
import { assistantTurnOf, failedRunNote } from "../src/chat/history-hygiene.js";
import { prepareLoopStopResume, surfaceLoopStop, tapLoopStop } from "../src/engine/loop-stop-resume.js";
import { summarizeLoopStop } from "../src/loop-stop-summary.js";
import { createDurableRun } from "../src/engine/durable-resume.js";

const toolDef = (name: string) => ({
  name,
  description: `Tool ${name}`,
  parameters: [{ name: "q", type: "string" as const, description: "Input", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
});

interface Counts { read: number; write: number }

const agentOf = (dir: string, counts: Counts, script: readonly unknown[], maxIterations = 12) =>
  ReactiveAgents.create()
    .withName("loop-stop-subject")
    .withSystemPrompt("You research then write.")
    .withTestScenario(script as never)
    .withTools({
      tools: [
        { definition: toolDef("read-tool"), handler: () => { counts.read++; return Effect.succeed("note: ships 2026-03-01"); } },
        { definition: toolDef("write-tool"), handler: () => { counts.write++; return Effect.succeed("wrote notes.md"); } },
      ],
    })
    .withReasoning()
    .withMaxIterations(maxIterations)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .build();

const FIRST_RUN = [
  { toolCall: { name: "read-tool", args: { q: "a" } } },
  { toolCall: { name: "write-tool", args: { q: "notes" } } },
  { text: "FINAL ANSWER: ships 2026-03-01." },
];
const TASK = "Find the release date";

const STOP: LoopStopRecord = {
  reason: "loop_graceful",
  repeatedTool: "write-tool",
  repeatedCall: '{"q":"notes.md"}',
  iteration: 3,
  toolsDone: [{ tool: "read-tool", calls: 1 }, { tool: "write-tool", calls: 3 }],
  unfinished: ["write the final answer"],
};

const withStore = <A>(dir: string, f: (store: RunStoreService["Type"]) => Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* f(yield* RunStoreService);
    }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
  );

/** The state the kernel leaves on a loop stop: failed, terminal reason stamped, record attached. */
const loopStopped = (state: KernelState): KernelState => ({
  ...state,
  status: "failed",
  output: null,
  error: "Loop detected: repeating without progress",
  meta: { ...state.meta, terminatedBy: "loop_graceful", loopStop: STOP },
});

/** A real completed durable run whose final checkpoint is rewritten to the loop-stopped state (as the kernel's loop-stop step writes it). */
async function seedLoopStoppedRun(dir: string): Promise<string> {
  const counts: Counts = { read: 0, write: 0 };
  const agent = await agentOf(dir, counts, FIRST_RUN);
  const first = await agent.run(TASK);
  await agent.dispose();
  const runId = first.runId;
  if (runId === undefined) throw new Error("durable run reported no runId");
  await withStore(dir, (store) =>
    Effect.gen(function* () {
      const ckpt = yield* store.latestCheckpoint(runId);
      if (ckpt === undefined) throw new Error("no checkpoint");
      const stopped = loopStopped(deserializeKernelState(ckpt.stateJson));
      yield* store.putCheckpoint(runId, ckpt.iteration + 1, serializeKernelState(stopped));
      yield* store.setLoopStop(runId, summarizeLoopStop(STOP));
    }),
  );
  return runId;
}

describe("resumeRun continues a loop-stopped run", () => {
  it("a durable run reports its run id; the loop-stop summary and resumable flag ride the run row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-loop-stop-"));
    try {
      const runId = await seedLoopStoppedRun(dir);
      const agent = await agentOf(dir, { read: 0, write: 0 }, []);
      const rows = await agent.listRuns();
      const row = rows.find((r) => r.runId === runId);
      expect(row?.resumable).toBe(true);
      expect(row?.loopStop).toMatchObject({ reason: "loop_graceful", repeatedTool: "write-tool", iteration: 3 });
      expect(row?.loopStop?.toolsDone).toContainEqual({ tool: "write-tool", calls: 3 });
      expect(row?.loopStop?.unfinished).toEqual(["write the final answer"]);
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resumes without re-running completed tool steps, and clears the stop on the row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-loop-stop-"));
    try {
      const runId = await seedLoopStoppedRun(dir);
      const counts: Counts = { read: 0, write: 0 };
      const agent = await agentOf(dir, counts, [{ text: "FINAL ANSWER: ships 2026-03-01." }]);
      const result = await agent.resumeRun(runId, { note: "the notes file is already written" });

      expect(result.success).toBe(true);
      expect(result.output).toContain("2026-03-01");
      expect(result.runId).toBe(runId);
      expect(counts).toEqual({ read: 0, write: 0 });

      const row = (await agent.listRuns()).find((r) => r.runId === runId);
      expect(row?.status).toBe("completed");
      expect(row?.loopStop).toBeUndefined();
      expect(row?.resumable).toBeUndefined();
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("extraIterations bounds the continued run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-loop-stop-"));
    try {
      const runId = await seedLoopStoppedRun(dir);
      const counts: Counts = { read: 0, write: 0 };
      const more = Array.from({ length: 8 }, (_, i) => ({ toolCall: { name: "write-tool", args: { q: `file-${i}` } } }));
      const agent = await agentOf(dir, counts, [...more, { text: "FINAL ANSWER: done." }]);
      // The stopped run's own cap is spent; the resume's budget (not the agent's 12) ends the run.
      const result = await agent.resumeRun(runId, { extraIterations: 1 });
      expect(result.success).toBe(false);
      expect(result.terminatedBy).toBe("max_iterations");
      expect(counts.write).toBeLessThanOrEqual(1);
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a run that did not loop-stop with the typed RunNotResumableError when options are given", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-loop-stop-"));
    try {
      const counts: Counts = { read: 0, write: 0 };
      const agent = await agentOf(dir, counts, FIRST_RUN);
      const first = await agent.run(TASK);
      const runId = first.runId!;
      const error = await agent.resumeRun(runId, { note: "continue" }).then(() => undefined, (e: unknown) => e);
      expect(error).toBeInstanceOf(RunNotResumableError);
      expect(error).toMatchObject({ _tag: "RunNotResumableError", runId });
      await agent.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("loop-stop resume building blocks", () => {
  it("prepareLoopStopResume: undefined for a state no loop guard ended; guidance, note and cap for one that did", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-loop-stop-"));
    try {
      const runId = await seedLoopStoppedRun(dir);
      const ckpt = await withStore(dir, (s) => s.latestCheckpoint(runId));
      const stoppedJson = ckpt!.stateJson;
      const prepared = prepareLoopStopResume({ stateJson: stoppedJson, goal: TASK, note: "use the cache", extraIterations: 4 });
      expect(prepared).toBeDefined();
      const resumed = deserializeKernelState(prepared!.stateJson);
      expect(resumed.status).toBe("thinking");
      expect(resumed.meta.loopStop).toBeUndefined();
      const text = resumed.pendingGuidance?.errorRecovery ?? "";
      expect(text).toContain("write-tool");
      expect(text).toContain(TASK);
      expect(text).toContain("The user adds: use the cache");
      const stopped = deserializeKernelState(stoppedJson);
      expect(prepared!.maxIterations).toBe(Math.max(stopped.iteration, stopped.llmCalls ?? 0) + 4);

      const live = serializeKernelState({ ...stopped, status: "thinking", meta: { ...stopped.meta, terminatedBy: undefined, loopStop: undefined } });
      expect(prepareLoopStopResume({ stateJson: live, goal: TASK })).toBeUndefined();
      expect(prepareLoopStopResume({ stateJson: "not json", goal: TASK })).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tapLoopStop reads the stop off the last checkpoint; surfaceLoopStop stamps runId, summary, resumable and the row", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-loop-stop-"));
    try {
      const runId = await seedLoopStoppedRun(dir);
      const ckpt = await withStore(dir, (s) => s.latestCheckpoint(runId));
      const seen: number[] = [];
      const controller = {
        checkpoint: () => Promise.resolve(undefined),
        onCheckpoint: (_s: string, i: number) => { seen.push(i); },
      };
      const read = tapLoopStop(controller);
      expect(read()).toBeUndefined();
      controller.onCheckpoint(ckpt!.stateJson, 9);
      expect(seen).toEqual([9]);
      const record = read();
      expect(record?.reason).toBe("loop_graceful");

      const dbPath = join(dir, "runs.db");
      await Effect.runPromise(createDurableRun({ dbPath, runId: "tapped", agentId: "a", task: TASK, configHash: "h" }));
      const base = { output: "", success: false, taskId: "t", agentId: "a", metadata: { duration: 0, cost: 0, tokensUsed: 0, stepsCount: 0 } };
      const surfaced = await Effect.runPromise(surfaceLoopStop(base, { runId: "tapped", dbPath, record }));
      expect(surfaced).toMatchObject({ runId: "tapped", resumable: true, loopStop: { reason: "loop_graceful", iteration: 3 } });
      const row = await withStore(dir, (s) => s.getRun("tapped"));
      expect(row?.resumable).toBe(true);

      const plain = await Effect.runPromise(surfaceLoopStop(base, { runId: "x", dbPath, record: undefined }));
      expect(plain.loopStop).toBeUndefined();
      expect(plain.resumable).toBeUndefined();
      const nonDurable = await Effect.runPromise(surfaceLoopStop(base, { record }));
      expect(nonDurable.loopStop?.reason).toBe("loop_graceful");
      expect(nonDurable.resumable).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("chat failure note for a loop-stopped turn", () => {
  const summary = summarizeLoopStop(STOP);

  it("names the stop, what was done, and that Continue is available (resumable only)", () => {
    const turn = assistantTurnOf({ output: "draft", success: false, error: "Loop detected", runId: "r1", loopStop: summary, resumable: true });
    expect(turn.failed).toBe(true);
    expect(turn.runId).toBe("r1");
    expect(turn.resumable).toBe(true);
    expect(turn.content).toContain("previous run failed: Loop detected; no answer was given.");
    expect(turn.content).toContain("loop_graceful");
    expect(turn.content).toContain("write-tool x3");
    expect(turn.content).toContain("Continue is available");

    const notResumable = assistantTurnOf({ output: "draft", success: false, error: "Loop detected", runId: "r1", loopStop: summary });
    expect(notResumable.content).not.toContain("Continue is available");
    expect(notResumable.resumable).toBeUndefined();
  });

  it("is byte-identical to the old note without a loop stop", () => {
    expect(failedRunNote("boom")).toBe("[previous run failed: boom; no answer was given]");
    expect(assistantTurnOf({ output: "x", success: false, error: "boom" }).content).toBe("[previous run failed: boom; no answer was given]");
  });
});
