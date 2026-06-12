/**
 * durable-crash-e2e.test.ts — Phase C crash-resume across an OS process boundary.
 *
 * The marketable "kill it, resume it" guarantee:
 *   1. A CHILD process captures a durable run (checkpoints to a shared dir) and
 *      hard-exits 137 without graceful cleanup (durable-crash-child.ts).
 *   2. This PARENT process — a different OS process that never shared the
 *      child's memory — builds a fresh same-identity agent and `resumeRun()`s
 *      the run purely from the on-disk checkpoint, completing it.
 *   3. The reconstructed output carries the original task's answer and the run
 *      flips to "completed".
 *
 * Determinism: the test provider makes output a pure function of the scenario,
 * so the resumed completion is reproducible without depending on kill timing.
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";

const echoTool = {
  definition: {
    name: "echo-tool",
    description: "Echo input",
    parameters: [
      { name: "input", type: "string" as const, description: "Input", required: true },
    ],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (args: { input: string }) => Effect.succeed(`echoed: ${args.input}`),
};

describe("durable runs — crash-resume e2e", () => {
  it("a hard-killed run resumes in a new process from its on-disk checkpoint", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-crash-e2e-"));
    try {
      // ── 1. Child process captures the run, then hard-exits 137. ──
      const childPath = join(import.meta.dir, "fixtures", "durable-crash-child.ts");
      const proc = Bun.spawn(["bun", childPath], {
        env: { ...process.env, DURABLE_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const exitCode = await proc.exited;

      // Hard exit code preserved; checkpoint db exists on disk.
      expect(exitCode).toBe(137);
      expect(existsSync(join(dir, "runs.db"))).toBe(true);

      const runIdMatch = stdout.match(/RUNID:(\S+)/);
      expect(runIdMatch).not.toBeNull();
      const runId = runIdMatch![1]!;
      expect(runId.length).toBeGreaterThan(0);

      // ── 2. Parent (this process) resumes from the on-disk checkpoint. ──
      const resumeAgent = await ReactiveAgents.create()
        .withName("crash-subject")
        .withSystemPrompt("You are a precise calculator.")
        .withTestScenario([{ text: "FINAL ANSWER: forty-two" }] as never)
        .withTools({ tools: [echoTool] })
        .withReasoning()
        .withMaxIterations(4)
        .withDurableRuns({ dir, checkpointEvery: 1 })
        .build();
      try {
        const result = await resumeAgent.resumeRun(runId);

        // ── 3. Reconstructed output + completed status. ──
        expect(result.output).toContain("forty-two");
        const completed = await resumeAgent.listRuns({ status: "completed" });
        expect(completed.some((r) => r.runId === runId)).toBe(true);
      } finally {
        await resumeAgent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
