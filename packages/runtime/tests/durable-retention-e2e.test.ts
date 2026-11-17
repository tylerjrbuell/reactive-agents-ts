// Run: bun test packages/runtime/tests/durable-retention-e2e.test.ts --timeout 30000
//
// End-to-end retention: a scripted 10-turn tool session through the real
// builder + runStream write path, before (retention off) vs after (default).
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/builder.js";
import type { DurableRetention } from "../src/services/run-store-retention.js";

const echoDef = {
  name: "echo-tool",
  description: "Echo",
  parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const TURNS = 10;

const session = async (dir: string, retention: DurableRetention) => {
  const scenario = Array.from({ length: TURNS }, () => [
    { toolCall: { name: "echo-tool", args: { input: "hello" } } },
    { text: "FINAL ANSWER: done" },
  ]).flat();
  const agent = await ReactiveAgents.create()
    .withName("retention-e2e")
    .withTestScenario(scenario)
    .withTools({ tools: [{ definition: echoDef, handler: (a) => Effect.succeed(`echoed: ${a.input}`) }] })
    .withReasoning()
    .withMaxIterations(4)
    .withDurableRuns({ dir, retention })
    .build();
  try {
    for (let i = 0; i < TURNS; i++) {
      for await (const _e of agent.runStream(`echo ${i}`)) void _e;
    }
    const runs = await agent.listRuns();
    return { runs, agent, size: statSync(join(dir, "runs.db")).size };
  } catch (e) {
    await agent.dispose();
    throw e;
  }
};

describe("durable retention e2e (10-turn tool session)", () => {
  it("bounds runs.db and refuses resume of a pruned finished run", async () => {
    const offDir = mkdtempSync(join(tmpdir(), "ra-ret-off-"));
    const onDir = mkdtempSync(join(tmpdir(), "ra-ret-on-"));
    try {
      const off = await session(offDir, { keepCompleted: 0, maxAgeDays: 0, compactCheckpoints: false });
      await off.agent.dispose();
      const on = await session(onDir, { keepCompleted: 3 });
      console.log(
        `runs.db 10-turn tool session: retention-off=${off.size} bytes (${off.runs.length} runs), ` +
          `keepCompleted=3 (compacted)=${on.size} bytes (${on.runs.length} runs)`,
      );
      expect(off.runs.length).toBe(TURNS);
      // Pruning runs at the start of each run, so the last run's own row is
      // still `running`/just-finished: at most keepCompleted + 1 remain.
      expect(on.runs.length).toBeLessThanOrEqual(4);
      expect(on.size).toBeLessThan(off.size);

      // Resume of a run that no longer exists is refused with a typed error.
      await expect(on.agent.resumeRun("pruned-run-id")).rejects.toThrow();
      await on.agent.dispose();
    } finally {
      rmSync(offDir, { recursive: true, force: true });
      rmSync(onDir, { recursive: true, force: true });
    }
  }, 60000);
});
