/**
 * durable-crash-child.ts — child process for the crash-resume e2e.
 *
 * Builds a durable test-provider agent, runs a multi-iteration tool task via
 * `runStream` (the RunController seam that fires durable checkpoints), prints
 * the persisted `RUNID:<id>` to stdout, then HARD-EXITS with code 137 to
 * simulate an abrupt kill — without a graceful `dispose()`. The checkpoints are
 * already on disk (synchronous SQLite writes fired during the run), so a
 * separate parent process can reconstruct and finish the run.
 *
 * Env:
 *   DURABLE_DIR — checkpoint directory (shared with the parent).
 *
 * Run by `durable-crash-e2e.test.ts` via `Bun.spawn`.
 */
import { Effect } from "effect";
import { ReactiveAgents } from "../../src/builder.js";

const dir = process.env.DURABLE_DIR;
if (!dir) {
  console.error("DURABLE_DIR not set");
  process.exit(2);
}

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
  handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args["input"])}`),
};

const agent = await ReactiveAgents.create()
  .withName("crash-subject")
  .withSystemPrompt("You are a precise calculator.")
  .withTestScenario([
    { toolCall: { name: "echo-tool", args: { input: "hi" } } },
    { text: "FINAL ANSWER: forty-two" },
  ] as never)
  .withTools({ tools: [echoTool] })
  .withReasoning()
  .withMaxIterations(4)
  .withDurableRuns({ dir, checkpointEvery: 1 })
  .build();

// Drive the run to completion so tool-work checkpoints are persisted.
for await (const _event of agent.runStream("compute the answer")) {
  void _event;
}

const runs = await agent.listRuns();
const runId = runs[0]?.runId ?? "";
process.stdout.write(`RUNID:${runId}\n`);

// Abrupt termination — no dispose(). Checkpoints already flushed to SQLite.
process.exit(137);
