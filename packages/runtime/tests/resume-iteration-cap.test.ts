/**
 * resume-iteration-cap.test.ts — a resumed run's iteration cap is raised to
 * restored iteration + extra, never the original cap already spent. Zero token.
 *
 * Runtime half: `prepareResume` hands the run the raised cap AND stamps it on
 * the restored state's `meta.maxIterations` (a plan-budget raised cap lives
 * there). States come from a REAL durable run's checkpoint (scripted provider).
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { deserializeKernelState, serializeKernelState } from "@reactive-agents/reasoning";
import { ReactiveAgents } from "../src/builder.js";
import { RunStoreLive, RunStoreService } from "../src/services/run-store.js";
import { prepareResume } from "../src/engine/run-resume.js";
import { classifyEnd } from "../src/engine/run-interrupt.js";
import { DEFAULT_RESUME_ITERATIONS } from "../src/engine/loop-stop-resume.js";

const toolDef = {
  name: "step-tool",
  description: "A step",
  parameters: [{ name: "q", type: "string" as const, description: "Input", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const steps = Array.from({ length: 8 }, (_, i) => ({ toolCall: { name: "step-tool", args: { q: `s${i}` } } }));

/** The final checkpoint of a run that spent its cap of 3. */
const spentCapCheckpoint = async (dir: string): Promise<string> => {
  const agent = await ReactiveAgents.create()
    .withName("cap-subject")
    .withSystemPrompt("You work.")
    .withTestScenario(steps as never)
    .withTools({ tools: [{ definition: toolDef, handler: () => Effect.succeed("ok") }] })
    .withReasoning()
    .withMaxIterations(3)
    .withDurableRuns({ dir, checkpointEvery: 1 })
    .build();
  const first = await agent.run("do steps");
  await agent.dispose();
  expect(first.success).toBe(false);
  const ckpt = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* (yield* RunStoreService).latestCheckpoint(first.runId!);
    }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
  );
  return ckpt!.stateJson;
};

const budgetStop = { kind: "budget" as const, reason: "max_iterations", toolsDone: [], unfinished: [], iteration: 3 };

describe("a run stopped at its iteration cap resumes past it (end to end)", () => {
  it("resumeRun with no extra does strictly more than the spent cap; the stop reason is max_iterations", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-cap-e2e-"));
    try {
      let calls = 0;
      const build = (from: number) =>
        ReactiveAgents.create()
          .withName("cap-subject")
          .withSystemPrompt("You work.")
          .withTestScenario([...steps.slice(from), { text: "FINAL ANSWER: done." }] as never)
          .withTools({ tools: [{ definition: toolDef, handler: () => { calls++; return Effect.succeed(`result ${calls}: distinct finding number ${calls * 7919}`); } }] })
          .withReasoning()
          .withMaxIterations(3)
          .withDurableRuns({ dir, checkpointEvery: 1 })
          .build();
      const a = await build(0);
      const first = await a.run("do steps");
      await a.dispose();
      expect(first.success).toBe(false);
      const spent = calls;
      const b = await build(spent);
      const row = (await b.listRuns()).find((r) => r.runId === first.runId);
      expect(row?.stop?.kind).toBe("budget");
      expect(row?.stop?.reason).toBe("max_iterations");
      await b.resumeRun(first.runId!);
      // The resumed run may end earlier than its raised cap (a guard, or the script ending); it must not re-stop at the spent cap.
      expect(calls).toBeGreaterThan(spent);
      const ckpt = await Effect.runPromise(
        Effect.gen(function* () {
          return yield* (yield* RunStoreService).latestCheckpoint(first.runId!);
        }).pipe(Effect.provide(RunStoreLive(join(dir, "runs.db")))),
      );
      const resumed = deserializeKernelState(ckpt!.stateJson);
      expect(resumed.meta.maxIterations).toBeGreaterThan(3);
      expect(resumed.iteration).toBeGreaterThan(3);
      await b.dispose();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("classifyEnd stop reason of a budget stop", () => {
  it("an iteration cap keeps the stable reason max_iterations (kind budget)", () => {
    expect(classifyEnd({ success: false, terminatedBy: "max_iterations", error: "The run stopped (max_iterations) before the model wrote a final answer." }, undefined))
      .toEqual({ kind: "budget", reason: "max_iterations" });
  });
});

describe("prepareResume iteration cap", () => {
  it("raises a spent cap to iteration + default extra and stamps it on the state; extraIterations bounds it; a plan-budget cap is replaced; a cap with room is kept", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-cap-"));
    try {
      const json = await spentCapCheckpoint(dir);
      const state = deserializeKernelState(json);
      const reached = Math.max(state.iteration, state.llmCalls ?? 0);

      const dflt = prepareResume({ stateJson: json, goal: "g", stop: budgetStop });
      expect(dflt.maxIterations).toBe(reached + DEFAULT_RESUME_ITERATIONS);
      expect(deserializeKernelState(dflt.stateJson).meta.maxIterations).toBe(reached + DEFAULT_RESUME_ITERATIONS);
      expect(reached + DEFAULT_RESUME_ITERATIONS).toBeGreaterThan(3);

      const bounded = prepareResume({ stateJson: json, goal: "g", stop: budgetStop, extraIterations: 4 });
      expect(bounded.maxIterations).toBe(reached + 4);
      expect(deserializeKernelState(bounded.stateJson).meta.maxIterations).toBe(reached + 4);

      // Plan-budget raised cap (state.meta.maxIterations = 16, spent at iteration 15).
      const planRaised = serializeKernelState({ ...state, iteration: 15, llmCalls: 15, meta: { ...state.meta, maxIterations: 16 } });
      const raised = prepareResume({ stateJson: planRaised, goal: "g", stop: budgetStop });
      expect(raised.maxIterations).toBe(15 + DEFAULT_RESUME_ITERATIONS);
      expect(deserializeKernelState(raised.stateJson).meta.maxIterations).toBe(15 + DEFAULT_RESUME_ITERATIONS);

      // A run that stopped with room left (an error) keeps its own cap.
      const roomy = serializeKernelState({ ...state, iteration: 1, llmCalls: 1, meta: { ...state.meta, maxIterations: 16 } });
      expect(prepareResume({ stateJson: roomy, goal: "g", stop: { ...budgetStop, kind: "error", reason: "boom" } })).toEqual({ stateJson: roomy });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
