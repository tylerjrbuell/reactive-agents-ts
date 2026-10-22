/**
 * durable-effect-crash-child.ts — child process for the tool-effect
 * crash-window e2e (GH #262).
 *
 * Runs a side-effecting tool ONCE under durable runs, then deterministically
 * prevents every checkpoint write that would capture the tool's result from
 * committing: a SQLite trigger installed on the shared runs.db up-front
 * aborts any run_checkpoints write whose iteration is >= 2 OR whose serialized
 * kernel state contains the tool's result marker ("committed-262"). Checkpoint
 * writes are fire-and-forget in the runtime (errors swallowed), so the aborted
 * writes do not fail the run — the on-disk state after the child exits is
 * EXACTLY the GH #262 crash window: latest checkpoint = pre-tool state, while
 * the tool effect already happened (and, once the runtime seam is wired, its
 * run_effects row is on disk). The child then hard-exits 137 so the parent
 * must reconstruct purely from disk, like the sibling fixture
 * durable-crash-child.ts.
 *
 * DDL drift note: the fixture duplicates the run_checkpoints DDL (needed so
 * the trigger can be created BEFORE the agent's first RunStoreLive open, which
 * happens lazily at first write). CREATE TABLE IF NOT EXISTS makes the later
 * real open a no-op; the durable-crash e2e guarding this fixture fails loudly
 * if the drift ever breaks the window.
 *
 * Env:
 *   DURABLE_DIR — runs.db directory (shared with the parent + the effect
 *                 counter file used to count real executions across processes).
 */
import { Effect } from "effect";
import { ReactiveAgents } from "../../src/builder.js";
import { Database } from "@reactive-agents/runtime-shim";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.DURABLE_DIR;
if (!dir) {
  console.error("DURABLE_DIR not set");
  process.exit(2);
}

// ── Cross-process side-effect counter ────────────────────────────────────────
// A JSON file counts REAL tool executions across the child and parent
// processes. The parent asserts this stays at 1 after resume — the recovery
// must inject the recorded result, not re-dispatch the tool.
const countFile = join(dir, "effect-count.json");

const readCount = (): number => {
  try {
    const parsed = JSON.parse(readFileSync(countFile, "utf8")) as { count?: number };
    return parsed?.count ?? 0;
  } catch {
    return 0;
  }
};

const sideEffectTool = {
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
  // The result marker doubles as the crash-window trigger's needle: once this
  // string exists in serialized kernel state, no checkpoint may commit.
  handler: (args: Record<string, unknown>) =>
    Effect.succeed(`committed-262 counter=${readCount() + 1} label=${String(args["label"])}`).pipe(
      Effect.tap(() => Effect.sync(() => writeFileSync(countFile, JSON.stringify({ count: readCount() + 1 })))),
    ),
};

// Harmless warm-up tool: a text-only first scenario turn reads as end_turn and
// would terminate the loop before the side effect ever dispatches, so turn 1
// performs one marker-free tool call instead. The crash-window trigger leaves
// the first-post-warm-up checkpoint (iteration 1, no marker) committable, and
// blocks every checkpoint once the side effect exists.
const warmUpTool = {
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
  handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args["input"])}`),
};

// ── Deterministic crash-window injection ─────────────────────────────────────
// Pre-create the checkpoints schema (the agent's RunStoreLive has not opened
// the db yet) and the trigger that aborts every post-effect checkpoint write.
// OR-order matters: the marker clause covers a 0-based-iteration numbering
// (an effect executed within the FIRST tracked iteration), the iteration
// clause covers a 1-based numbering (scenarios put the tool call one
// provider call after the markerless warm-up turn).
mkdirSync(dir, { recursive: true });
const db = new Database(join(dir, "runs.db"));
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
  `CREATE TRIGGER IF NOT EXISTS block_post_effect_checkpoint
   BEFORE INSERT ON run_checkpoints
   FOR EACH ROW
   WHEN NEW.iteration >= 2 OR NEW.state_json LIKE '%committed-262%'
   BEGIN SELECT RAISE(ABORT, 'inspection-window'); END;`,
);
db.close();

// Build with the SAME identity fields the parent resume agent uses
// (system prompt + provider feed the durable config-hash guard).
const agent = await ReactiveAgents.create()
  .withName("effect-crash-subject")
  .withSystemPrompt("You mount one durable side effect and report its marker.")
  .withTestScenario([
    { toolCall: { name: "echo-warmup-tool", args: { input: "warm" } } },
    { toolCall: { name: "side-effect-tool", args: { label: "row-262" } } },
    { text: "FINAL ANSWER: row mounted." },
  ] as never)
  .withTools({ tools: [sideEffectTool, warmUpTool] })
  .withReasoning()
  .withMaxIterations(4)
  .withDurableRuns({ dir, checkpointEvery: 1 })
  .build();

// Drive the run via runStream — the RunController seam the kernel act phase
// reads for the awaited tool-effect observers and durable checkpoints.
for await (const _event of agent.runStream("mount a durable side effect")) {
  void _event;
}

const runs = await agent.listRuns();
process.stdout.write(`RUNID:${runs[0]?.runId ?? ""}\n`);

// Hard termination — same kill signature as durable-crash-child.ts. The
// crash-window state (pre-tool checkpoint + any effect rows) is on disk.
process.exit(137);
