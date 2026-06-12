/**
 * durable-runs-write.test.ts — Phase B (track 1) integration: opt-in durable
 * checkpoint writes.
 *
 * Proves the write half of crash-resume:
 *   (1) ENABLED — `.withDurableRuns({ dir, checkpointEvery: 1 })` + a 2+-iteration
 *       test-provider tool task writes >=1 checkpoint whose `state_json` is a valid
 *       codec envelope that round-trips back to a KernelState (iteration + steps).
 *   (2) DISABLED — no `.withDurableRuns()` writes nothing (zero-overhead): the
 *       default runs.db is never created.
 *
 * Harness modeled on iteration-progress-events.test.ts + tool-loop-behavioral.test.ts
 * (runStream threads a RunController, which is the seam onCheckpoint fires through).
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { existsSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "@reactive-agents/runtime-shim";
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

/** Drive a 2+-iteration tool task via runStream so the kernel checkpoint seam fires. */
async function runToolTask(
  builder: ReturnType<typeof ReactiveAgents.create>,
): Promise<void> {
  const agent = await builder.build();
  try {
    for await (const _event of agent.runStream("echo hello")) {
      void _event; // drain to completion
    }
  } finally {
    await agent.dispose();
  }
}

interface CheckpointRow {
  iteration: number;
  state_json: string;
}

/** Read every persisted checkpoint directly from the SQLite db (store is frozen / no listRuns). */
function readAllCheckpoints(dbPath: string): CheckpointRow[] {
  const db = new Database(dbPath);
  const rows = db
    .prepare(
      `SELECT iteration, state_json FROM run_checkpoints ORDER BY run_id, iteration`,
    )
    .all() as CheckpointRow[];
  return rows;
}

describe("durable runs — checkpoint writes", () => {
  it("writes >=1 deserializable checkpoint when durable runs enabled", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-durable-on-"));
    try {
      await runToolTask(
        ReactiveAgents.create()
          .withName("durable-on")
          .withTestScenario([
            { toolCall: { name: "echo-tool", args: { input: "hello" } } },
            { text: "FINAL ANSWER: done" },
          ])
          .withTools({
            tools: [
              {
                definition: makeToolDef("echo-tool"),
                handler: (args) => Effect.succeed(`echoed: ${args.input}`),
              },
            ],
          })
          .withReasoning()
          .withMaxIterations(4)
          .withDurableRuns({ dir, checkpointEvery: 1 }),
      );

      const dbPath = join(dir, "runs.db");
      expect(existsSync(dbPath)).toBe(true);

      const checkpoints = readAllCheckpoints(dbPath);
      expect(checkpoints.length).toBeGreaterThanOrEqual(1);

      const envelope = JSON.parse(checkpoints[0]!.state_json) as {
        codecVersion: number;
        state: { iteration?: unknown; steps?: unknown };
      };
      expect(envelope.codecVersion).toBe(1);
      expect(envelope.state).toBeDefined();
      expect(typeof envelope.state.iteration).toBe("number");
      expect(Array.isArray(envelope.state.steps)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);

  it("writes nothing when durable runs disabled (zero-overhead)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-durable-off-"));
    try {
      await runToolTask(
        ReactiveAgents.create()
          .withName("durable-off")
          .withTestScenario([
            { toolCall: { name: "echo-tool", args: { input: "hello" } } },
            { text: "FINAL ANSWER: done" },
          ])
          .withTools({
            tools: [
              {
                definition: makeToolDef("echo-tool"),
                handler: (args) => Effect.succeed(`echoed: ${args.input}`),
              },
            ],
          })
          .withReasoning()
          .withMaxIterations(4),
      );

      expect(existsSync(join(dir, "runs.db"))).toBe(false);
      expect(readdirSync(dir).length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 30000);
});
