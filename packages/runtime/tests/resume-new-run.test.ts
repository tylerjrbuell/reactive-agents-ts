/**
 * resume-new-run.test.ts — `agent.resumeRun(runId, { newRun: true })`.
 *
 * The continuation is its OWN run (new id, own trace file) linked to the parent
 * by `continuedFrom`, while keeping everything `resumeRun` does: the note rides
 * in as guidance, completed tool calls are served from the effect journal (not
 * run again), and the config-hash guard still refuses a drifted agent. The
 * parent's record is untouched. Default `resumeRun(runId)` keeps its own id.
 *
 * Crash window (zero tokens, in-process): a SQLite trigger aborts the checkpoint
 * write that follows the tool result, so the effect row is `succeeded` on disk
 * while the last checkpoint is PRE-tool. The row is then put back to `running`
 * (the on-disk shape of a crashed run) and resumed.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { Database } from "@reactive-agents/runtime-shim";
import { ReactiveAgents } from "../src/builder.js";

const TASK = "mount the effect";

interface Fixture {
  readonly dir: string;
  readonly dispatches: () => number;
  readonly shape: (systemPrompt?: string) => ReturnType<typeof ReactiveAgents.create>;
}

const fixture = (dir: string): Fixture => {
  let dispatches = 0;
  return {
    dir,
    dispatches: () => dispatches,
    shape: (systemPrompt = "You mount one durable side effect.") =>
      ReactiveAgents.create()
        .withName("resume-new-run-subject")
        .withSystemPrompt(systemPrompt)
        .withTestScenario([
          { toolCall: { name: "orders-tool", args: { scope: "orders" } } },
          { text: "FINAL ANSWER: effect mounted." },
        ] as never)
        .withTools({
          tools: [
            {
              definition: {
                name: "orders-tool",
                description: "Side-effecting tool",
                parameters: [{ name: "scope", type: "string" as const, description: "Scope", required: true }],
                riskLevel: "low" as const,
                timeoutMs: 5_000,
                requiresApproval: false,
                source: "function" as const,
              },
              handler: (args: Record<string, unknown>) => {
                dispatches = dispatches + 1;
                return Effect.succeed(`ran ${String(args["scope"])} #${dispatches}`);
              },
            },
          ],
        })
        .withReasoning()
        .withMaxIterations(4)
        .withDurableRuns({ dir, checkpointEvery: 1 }),
  };
};

/** Run once with the post-effect checkpoint faulted, then leave the row as a crashed run would. */
const crashedRun = async (fx: Fixture): Promise<string> => {
  const db = new Database(join(fx.dir, "runs.db"));
  db.exec(
    `CREATE TABLE IF NOT EXISTS run_effects (
      run_id TEXT NOT NULL, effect_id TEXT NOT NULL, tool_name TEXT NOT NULL, tool_call_id TEXT NOT NULL,
      iteration INTEGER NOT NULL, args_json TEXT NOT NULL, status TEXT NOT NULL, result_content TEXT,
      error_text TEXT, created_at INTEGER NOT NULL, committed_at INTEGER, PRIMARY KEY (run_id, effect_id))`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS run_checkpoints (
      run_id TEXT NOT NULL, iteration INTEGER NOT NULL, state_json TEXT NOT NULL, created_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, iteration))`,
  );
  db.exec(
    `CREATE TRIGGER IF NOT EXISTS block_post_effect_checkpoint BEFORE INSERT ON run_checkpoints
     FOR EACH ROW WHEN NEW.state_json LIKE '%ran orders #1%'
     BEGIN SELECT RAISE(ABORT, 'crash-window'); END;`,
  );
  db.close();

  const agent = await fx.shape().build();
  let runId: string | undefined;
  try {
    const first = await agent.run(TASK);
    runId = first.runId;
  } finally {
    await agent.dispose();
  }
  const after = new Database(join(fx.dir, "runs.db"));
  try {
    after.exec("DROP TRIGGER IF EXISTS block_post_effect_checkpoint");
    after.prepare("UPDATE runs SET status = 'running' WHERE run_id = ?").run(runId);
  } finally {
    after.close();
  }
  expect(runId).toBeTruthy();
  return runId!;
};

const rowsOf = <T>(dir: string, sql: string, ...args: string[]): T[] => {
  const db = new Database(join(dir, "runs.db"));
  try {
    return db.prepare(sql).all(...args) as T[];
  } finally {
    db.close();
  }
};

describe("resumeRun(runId, { newRun: true })", () => {
  it("mints a new run id, stamps the parent, keeps the note and recovers the journal", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-new-run-"));
    try {
      const fx = fixture(dir);
      const parentId = await crashedRun(fx);
      expect(fx.dispatches()).toBe(1);
      const parentEffects = rowsOf<{ effect_id: string; status: string }>(
        dir, "SELECT effect_id, status FROM run_effects WHERE run_id = ?", parentId,
      );
      expect(parentEffects.map((r) => r.status)).toEqual(["succeeded"]);

      const agent = await fx.shape().build();
      try {
        const result = await agent.resumeRun(parentId, { newRun: true, note: "note-for-continuation", extraIterations: 6 });
        const newId = result.runId!;

        // New identity + provenance on the result.
        expect(newId).not.toBe(parentId);
        expect(newId.startsWith(`${parentId}-cont-`)).toBe(true);
        expect(result.continuedFrom).toBe(parentId);

        // Journal recovery: the completed tool call was NOT run again.
        expect(fx.dispatches()).toBe(1);

        // The new run's row names the parent; the parent's record is untouched.
        const runs = await agent.listRuns();
        const child = runs.find((r) => r.runId === newId);
        const parent = runs.find((r) => r.runId === parentId);
        expect(child?.continuedFrom).toBe(parentId);
        expect(parent?.continuedFrom).toBeUndefined();
        expect(parent?.status).toBe("running");

        // The parent's journal row is carried under the new id (a second resume of the continuation still sees it).
        const carried = rowsOf<{ effect_id: string; status: string }>(
          dir, "SELECT effect_id, status FROM run_effects WHERE run_id = ?", newId,
        );
        expect(carried).toEqual(parentEffects);

        // Guidance: the note rode in with the restored state.
        const checkpoints = rowsOf<{ state_json: string }>(
          dir, "SELECT state_json FROM run_checkpoints WHERE run_id = ?", newId,
        );
        expect(checkpoints.some((c) => c.state_json.includes("note-for-continuation"))).toBe(true);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("default resumeRun(runId) keeps the run's own id and stamps no continuedFrom", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-default-"));
    try {
      const fx = fixture(dir);
      const parentId = await crashedRun(fx);
      const agent = await fx.shape().build();
      try {
        const result = await agent.resumeRun(parentId);
        expect(result.runId).toBe(parentId);
        expect(result.continuedFrom).toBeUndefined();
        expect(fx.dispatches()).toBe(1);
        const runs = await agent.listRuns();
        expect(runs.filter((r) => r.runId.startsWith(`${parentId}-cont-`))).toEqual([]);
      } finally {
        await agent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("still refuses a drifted agent config (config-hash guard)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-resume-new-run-drift-"));
    try {
      const fx = fixture(dir);
      const parentId = await crashedRun(fx);
      const drifted = await fx.shape("You are a poet.").build();
      try {
        let err: unknown;
        try {
          await drifted.resumeRun(parentId, { newRun: true });
        } catch (e) {
          err = e;
        }
        expect(String(err)).toContain("DurableConfigMismatch");
        const runs = await drifted.listRuns();
        expect(runs.map((r) => r.runId)).toEqual([parentId]);
      } finally {
        await drifted.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
