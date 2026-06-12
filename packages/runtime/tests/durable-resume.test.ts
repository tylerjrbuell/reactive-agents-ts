/**
 * durable-resume.test.ts — Phase C (track 1) integration: in-process resume.
 *
 * Proves the read/continue half of crash-resume:
 *   (1) RESUME — a durable run is checkpointed (runStream), then a FRESH agent
 *       with the SAME identity config resumes it from the latest checkpoint and
 *       runs to completion, returning the expected output. The run row flips to
 *       "completed".
 *   (2) GUARD — resuming with a DIFFERENT identity config (changed system
 *       prompt) fails with DurableConfigMismatchError.
 *   (3) LISTRUNS — listRuns() enumerates persisted runs and filters by status.
 *
 * The resume agent uses a different test scenario (returning the final answer on
 * its first call) than the original — legitimate because `durableConfigHash`
 * keys on system prompt / provider / model, NOT the scenario. The restored
 * KernelState carries the completed tool work, so a single follow-up LLM call
 * finalizes the run deterministically (no dependence on provider replay index).
 *
 * Harness modeled on durable-runs-write.test.ts.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

function makeToolDef(name: string) {
  return {
    name,
    description: `Tool ${name}`,
    parameters: [
      {
        name: "input",
        type: "string" as const,
        description: "Input",
        required: true,
      },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  };
}

const echoTools = {
  tools: [
    {
      definition: makeToolDef("echo-tool"),
      handler: (args: { input: string }) => Effect.succeed(`echoed: ${args.input}`),
    },
  ],
};

/** Build a durable agent with a given system prompt + scenario sharing one dir. */
function makeAgent(opts: {
  dir: string;
  systemPrompt: string;
  scenario: ReadonlyArray<{ toolCall?: { name: string; args: Record<string, unknown> }; text?: string }>;
}) {
  return ReactiveAgents.create()
    .withName("resume-subject")
    .withSystemPrompt(opts.systemPrompt)
    .withTestScenario(opts.scenario as never)
    .withTools(echoTools)
    .withReasoning()
    .withMaxIterations(4)
    .withDurableRuns({ dir: opts.dir, checkpointEvery: 1 })
    .build();
}

/** Run a durable agent to completion via runStream so checkpoints are written. */
async function captureRun(agent: Awaited<ReturnType<typeof makeAgent>>): Promise<string> {
  for await (const _event of agent.runStream("compute the answer")) {
    void _event;
  }
  const runs = await agent.listRuns();
  expect(runs.length).toBeGreaterThanOrEqual(1);
  return runs[0]!.runId;
}

describe("durable runs — resume", () => {
  it("resumes a checkpointed run from its latest checkpoint to completion", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-ok-"));
    try {
      // Phase 1: original run writes checkpoints + a run row.
      const original = await makeAgent({
        dir,
        systemPrompt: "You are a precise calculator.",
        scenario: [
          { toolCall: { name: "echo-tool", args: { input: "hi" } } },
          { text: "FINAL ANSWER: forty-two" },
        ],
      });
      const runId = await captureRun(original);
      await original.dispose();

      // Phase 2: a fresh agent (same identity) resumes the run to completion.
      const resumeAgent = await makeAgent({
        dir,
        systemPrompt: "You are a precise calculator.",
        scenario: [{ text: "FINAL ANSWER: forty-two" }],
      });
      try {
        const result = await resumeAgent.resumeRun(runId);
        expect(result.output).toContain("forty-two");

        const completed = await resumeAgent.listRuns({ status: "completed" });
        expect(completed.some((r) => r.runId === runId)).toBe(true);
      } finally {
        await resumeAgent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it("rejects resume when the agent config hash mismatches", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-mismatch-"));
    try {
      const original = await makeAgent({
        dir,
        systemPrompt: "You are a precise calculator.",
        scenario: [
          { toolCall: { name: "echo-tool", args: { input: "hi" } } },
          { text: "FINAL ANSWER: forty-two" },
        ],
      });
      const runId = await captureRun(original);
      await original.dispose();

      // Different system prompt → different identity hash → guard must fire.
      const drifted = await makeAgent({
        dir,
        systemPrompt: "You are a poet.",
        scenario: [{ text: "FINAL ANSWER: forty-two" }],
      });
      try {
        let err: unknown;
        try {
          await drifted.resumeRun(runId);
        } catch (e) {
          err = e;
        }
        expect(err).toBeDefined();
        expect(String(err)).toContain("DurableConfigMismatch");
      } finally {
        await drifted.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);

  it("listRuns enumerates persisted runs and filters by status", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-list-"));
    try {
      const agent = await makeAgent({
        dir,
        systemPrompt: "You are a precise calculator.",
        scenario: [
          { toolCall: { name: "echo-tool", args: { input: "hi" } } },
          { text: "FINAL ANSWER: done" },
        ],
      });
      try {
        const runId = await captureRun(agent);

        const all = await agent.listRuns();
        expect(all.some((r) => r.runId === runId)).toBe(true);

        const completed = await agent.listRuns({ status: "completed" });
        expect(completed.every((r) => r.status === "completed")).toBe(true);

        const failed = await agent.listRuns({ status: "failed" });
        expect(failed.some((r) => r.runId === runId)).toBe(false);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 45000);
});
