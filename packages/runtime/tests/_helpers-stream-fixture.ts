import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";
import type { AgentStreamEvent } from "../src/stream-types.js";

/** Volatile keys stripped so a chunk sequence can be pinned byte-for-byte. */
const VOLATILE = new Set(["timestamp", "durationMs", "metadata", "taskId", "agentId", "receipt", "toolSummary", "runId"]);

const normalize = (e: AgentStreamEvent): Record<string, unknown> => {
  const base = Object.fromEntries(Object.entries(e).filter(([k]) => !VOLATILE.has(k)));
  if (e._tag !== "LedgerEntry") return base;
  // ledger entries carry a per-run ulid stepId
  return { ...base, entry: Object.fromEntries(Object.entries(e.entry).filter(([k]) => k !== "stepId")) };
};

/** Run the canonical root-only scenario and return the normalized chunk sequence. */
export async function recordRootOnlySequence(density: "tokens" | "full"): Promise<Record<string, unknown>[]> {
  const agent = await ReactiveAgents.create()
    .withName("stream-fixture")
    // Pins the pre-checklist chunk sequence; ChecklistUpdated is covered by checklist-stream.test.ts.
    .withObservability({ checklist: false })
    .withTestScenario([
      { toolCall: { name: "echo-tool", args: { input: "hello" } } },
      { text: "FINAL ANSWER: done" },
    ])
    .withTools({
      tools: [
        {
          definition: {
            name: "echo-tool",
            description: "Tool echo-tool",
            parameters: [{ name: "input", type: "string" as const, description: "Input", required: true }],
            riskLevel: "low" as const,
            timeoutMs: 5_000,
            requiresApproval: false,
            source: "function" as const,
          },
          handler: (args: Record<string, unknown>) => Effect.succeed(`echoed: ${String(args.input)}`),
        },
      ],
    })
    .withRequiredTools({ adaptive: false })
    .withMaxIterations(4)
    .build();
  try {
    const out: Record<string, unknown>[] = [];
    for await (const e of agent.runStream("echo hello", { density })) out.push(normalize(e));
    return out;
  } finally {
    await agent.dispose();
  }
}
