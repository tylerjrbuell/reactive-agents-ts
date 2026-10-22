/**
 * durable-tool-effect-crash.test.ts — crash-window recovery of side-effecting
 * tool calls across resume (GH #262).
 *
 * The naive checkpoint-only resume is at-least-once for side effects: a run
 * that crashes (or dies) after a tool executed but before the next boundary
 * checkpoint could commit resumes from a PRE-TOOL checkpoint, re-derives the
 * pending tool call, and re-executes the tool. This suite proves the
 * tool-effect seam fixes both halves of the window:
 *
 *   1. e2e (spawned child process, hard exit 137): a SUCCEEDED side effect is
 *      recorded in the RunStore's run_effects table, seeded into the resumed
 *      run via RecoveredToolEffectsRef, and the kernel injects the recorded
 *      result WITHOUT re-executing the tool (cross-process execution count
 *      stays at 1) while the trust receipt names the effect as "recovered".
 *      Determinism: the child installs a SQLite trigger that aborts every
 *      post-effect checkpoint write, so the on-disk crash window is exact —
 *      no timing race, no flake.
 *   2. upstream ambiguity (in-process, same trigger technique): a row stuck
 *      in status "executing" (terminal write never committed) is NOT seeded —
 *      the resumed run replays the call live (at-least-once is unavoidable
 *      there by design) and the receipt stamps it "ambiguous-then-replayed",
 *      keeping the ambiguity inspectable in the store.
 *
 * Ordinary (non-resume) receipts carry no `effects` field — asserted on the
 * streamed original run in case 2.
 */
import { describe, it, expect } from "bun:test";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import { Database } from "@reactive-agents/runtime-shim";
import type { AgentStreamEvent } from "../src/stream-types.js";

/** Cross-process execution counter (shared with the child fixture). */
const readCount = (dir: string): number => {
  try {
    return (JSON.parse(readFileSync(join(dir, "effect-count.json"), "utf8")) as { count?: number })?.count ?? 0;
  } catch {
    return 0;
  }
};

interface EffectRowLike {
  effect_id: string;
  tool_name: string;
  tool_call_id: string;
  iteration: number;
  args_json: string;
  status: string;
  result_content: string | null;
  error_text: string | null;
}

const queryEffectRows = (dir: string, runId: string): readonly EffectRowLike[] => {
  const db = new Database(join(dir, "runs.db"));
  try {
    return db
      .prepare(
        `SELECT effect_id, tool_name, tool_call_id, iteration, args_json, status, result_content, error_text
           FROM run_effects
          WHERE run_id = ?
       ORDER BY created_at ASC`,
      )
      .all(runId) as EffectRowLike[];
  } finally {
    db.close();
  }
};

/** Same identity fields as the child fixture — the resume config-hash guard. */
const resumeAgentShape = (dir: string) =>
  ReactiveAgents.create()
    .withName("effect-crash-subject")
    .withSystemPrompt("You mount one durable side effect and report its marker.")
    .withTestScenario([
      { toolCall: { name: "echo-warmup-tool", args: { input: "warm" } } },
      { toolCall: { name: "side-effect-tool", args: { label: "row-262" } } },
      { text: "FINAL ANSWER: row mounted." },
    ] as never)
    .withTools({
      tools: [
        {
          definition: {
            name: "echo-warmup-tool",
            description: "Echo input without side effects",
            parameters: [
              { name: "input", type: "string" as const, description: "Input", required: true },
            ],
            riskLevel: "low" as const,
            timeoutMs: 5_000,
            requiresApproval: false,
            source: "function" as const,
          },
          handler: (args: Record<string, unknown>) =>
            Effect.succeed(`echoed: ${String(args["input"])}`),
        },
        {
          definition: {
            name: "side-effect-tool",
            description: "Mount one durable side effect and report its row marker",
            parameters: [
              { name: "label", type: "string" as const, description: "Effect label", required: true },
            ],
            riskLevel: "low" as const,
            timeoutMs: 5_000,
            requiresApproval: false,
            source: "function" as const,
          },
          handler: (args: Record<string, unknown>) => {
            const count = readCount(dir) + 1;
            writeFileSync(join(dir, "effect-count.json"), JSON.stringify({ count }));
            return Effect.succeed(`committed-262 counter=${count} label=${String(args["label"])}`);
          },
        },
      ],
    })
    .withReasoning()
    .withMaxIterations(4)
    .withDurableRuns({ dir, checkpointEvery: 1 });

describe("durable runs — tool-effect crash-window recovery (GH #262)", () => {
  it("a succeeded side effect is injected, not re-executed, on resume; rows + receipt are inspectable", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-effect-crash-"));
    try {
      // ── 1. Child executes the side effect once under the crash window. ──
      const childPath = join(import.meta.dir, "fixtures", "durable-effect-crash-child.ts");
      const proc = Bun.spawn(["bun", childPath], {
        env: { ...process.env, DURABLE_DIR: dir },
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      expect(exitCode).toBe(137);
      expect(existsSync(join(dir, "runs.db"))).toBe(true);
      const runId = stdout.match(/RUNID:(\S+)/)?.[1];
      expect(runId).toBeTruthy();

      // Effect executed EXACTLY once inside the crash window.
      expect(readCount(dir)).toBe(1);

      // ── 2. Parent (different process) resumes purely from disk. ──
      const resumeAgent = await resumeAgentShape(dir).build();
      try {
        const result = await resumeAgent.resumeRun(runId!);

        // The recovery must have injected the RECORDED result: the tool did
        // NOT execute again in this process.
        expect(readCount(dir)).toBe(1);

        // The Store holds the effect rows (ambiguity inspectable at rest).
        const rows = queryEffectRows(dir, runId!);
        const effectRow = rows.find((r) => r.tool_name === "side-effect-tool");
        expect(effectRow).toBeTruthy();
        expect(effectRow!.status).toBe("succeeded");
        expect(effectRow!.result_content).toContain("committed-262");
        expect(effectRow!.effect_id).toContain("fx-");

        // The trust receipt names the recovered effect by its stable identity.
        const effects = result.receipt?.effects ?? [];
        const named = effects.find((e) => e.toolName === "side-effect-tool");
        expect(named).toBeTruthy();
        expect(named!.status).toBe("recovered");
        expect(named!.effectId).toBe(effectRow!.effect_id);
        expect(named!.argsJson).toContain("label");
      } finally {
        await resumeAgent.dispose();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);

  it("an 'executing' (no-terminal-write) effect resumes by live replay and stamps ambiguous-then-replayed", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ra-effect-ambiguous-"));
    try {
      // Pre-create the schemas the agent's RunStoreLive would create, plus
      // two triggers that deterministically reproduce the GH #262 ambiguity:
      // the on-disk signature of a crash between "effect happened" and
      // "outcome durable" is no terminal update AND no post-result
      // checkpoint. Both triggers are scoped to the FIRST dispatch's result
      // marker ("ran orders #<dispatches>" — "#1" only exists in the original
      // run), so the resumed run's own outcome + checkpoint writes commit.
      const db = new Database(join(dir, "runs.db"));
      db.exec(
        `CREATE TABLE IF NOT EXISTS run_effects (
          run_id         TEXT NOT NULL,
          effect_id      TEXT NOT NULL,
          tool_name      TEXT NOT NULL,
          tool_call_id   TEXT NOT NULL,
          iteration      INTEGER NOT NULL,
          args_json      TEXT NOT NULL,
          status         TEXT NOT NULL,
          result_content TEXT,
          error_text     TEXT,
          created_at     INTEGER NOT NULL,
          committed_at   INTEGER,
          PRIMARY KEY (run_id, effect_id)
        )`,
      );
      db.exec(
        `CREATE TABLE IF NOT EXISTS run_checkpoints (
          run_id     TEXT NOT NULL,
          iteration  INTEGER NOT NULL,
          state_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          PRIMARY KEY (run_id, iteration)
        )`,
      );
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS block_terminal_outcome
         BEFORE UPDATE ON run_effects
         FOR EACH ROW
         WHEN OLD.status = 'executing' AND NEW.status = 'succeeded'
           AND NEW.tool_name = 'ambiguous-tool' AND NEW.result_content LIKE '%ran orders #1%'
         BEGIN SELECT RAISE(ABORT, 'crash-window'); END;`,
      );
      db.exec(
        `CREATE TRIGGER IF NOT EXISTS block_post_effect_checkpoint
         BEFORE INSERT ON run_checkpoints
         FOR EACH ROW
         WHEN NEW.state_json LIKE '%ran orders #1%'
         BEGIN SELECT RAISE(ABORT, 'crash-window'); END;`,
      );
      db.close();

      let dispatches = 0;
      const ambiguousAgentShape = () =>
        ReactiveAgents.create()
          .withName("effect-ambiguous-subject")
          .withTestScenario([
            { toolCall: { name: "ambiguous-tool", args: { scope: "orders" } } },
            { text: "FINAL ANSWER: effect mounted." },
          ] as never)
          .withTools({
            tools: [
              {
                definition: {
                  name: "ambiguous-tool",
                  description: "Effect whose terminal outcome write never commits",
                  parameters: [
                    { name: "scope", type: "string" as const, description: "Scope", required: true },
                  ],
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
          .withDurableRuns({ dir, checkpointEvery: 1 });

      const agent = await ambiguousAgentShape().build();
      try {
        // ── 1. Original run: the terminal outcome write is faulted. ──
        let completed: Extract<AgentStreamEvent, { _tag: "StreamCompleted" }> | undefined;
        for await (const event of agent.runStream("mount the effect")) {
          if (event._tag === "StreamCompleted") completed = event;
        }
        expect(completed).toBeTruthy();
        const originalRunId = completed!.runId;
        expect(originalRunId).toBeTruthy();

        // Ordinary streamed runs carry NO effects field on the receipt.
        expect("effects" in (completed!.receipt ?? {})).toBe(false);
        expect(completed!.receipt?.effects).toBeUndefined();

        // On-disk: exactly one row, and the faulted terminal write left it
        // in the ambiguous "executing" state.
        const rows = queryEffectRows(dir, originalRunId!);
        expect(rows.length).toBe(1);
        expect(rows[0]!.tool_name).toBe("ambiguous-tool");
        expect(rows[0]!.status).toBe("executing");

        // ── 2. Resume: an executing row is NOT treated as already done —
        //    the effect is replayed live (at-least-once is unavoidable
        //    without better evidence), and the receipt says so. A fresh
        //    same-identity agent (fresh scenario cursor — the test provider
        //    cursor of the original agent is already exhausted) re-derives
        //    the pending call.
        await agent.dispose();
        const resumeAgent = await ambiguousAgentShape().build();
        try {
          const result = await resumeAgent.resumeRun(originalRunId!);
          expect(dispatches).toBe(2);

          const effects = result.receipt?.effects ?? [];
          expect(effects.length).toBe(1);
          expect(effects[0]!.toolName).toBe("ambiguous-tool");
          expect(effects[0]!.status).toBe("ambiguous-then-replayed");
          expect(effects[0]!.effectId).toBe(rows[0]!.effect_id);

          // The ambiguity stays inspectable at rest (no terminal write ever
          // landed for that effect id).
          const after = queryEffectRows(dir, originalRunId!);
          expect(after.length).toBe(1);
          expect(after[0]!.status).toBe("executing");
        } finally {
          await resumeAgent.dispose();
        }
      } finally {
        void agent;
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60000);
});
