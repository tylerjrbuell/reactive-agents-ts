// Run: bun test packages/runtime/tests/required-tools-no-auto-call-budget.test.ts --timeout 20000
//
// Required tools carry NO implicit per-tool call budget.
//
// The runtime used to derive `maxCallsPerTool` from the required-tool set
// (`minCalls + 2` per required tool, so 3 calls for a tool with no quantity).
// Counting calls per tool NAME punishes distinct targets: a task that must read
// six files and write six files had calls 4-6 of each tool silently dropped
// (H3 re-measure 2026-11-05, ledger entry 23: tool-call-dropped 1 -> 8,
// h3-todo-heavy 5/5 -> 0/5). Identical-call loops are the repetition guard's
// job, not a name-level counter's. Pin: 6 distinct reads + 6 distinct writes on
// required tools, no user budget, all 12 execute.
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { ReactiveAgents } from "../src/builder.js";

const BODY = Array.from({ length: 120 }, (_, i) => `line ${i}: lorem ipsum dolor sit amet ${i * 7}`).join("\n");

const makeTool =(name: string, seen: string[]) => ({
  definition: {
    name,
    description: `${name} a path`,
    parameters: [{ name: "path", type: "string" as const, description: "file path", required: true }],
    riskLevel: "low" as const,
    timeoutMs: 5_000,
    requiresApproval: false,
    source: "function" as const,
  },
  handler: (a: Record<string, unknown>) =>
    Effect.sync(() => {
      seen.push(String(a.path));
      // File-sized result: keeps each iteration's token delta above the
      // low-delta early-exit guard's threshold, as real file contents would.
      return `${name} ok: ${String(a.path)}\n${BODY}`;
    }),
});

const pathsFor = (n: number) => Array.from({ length: n }, (_, i) => `notes/item-${i + 1}.md`);

/**
 * Run an n-read + n-write scenario on REQUIRED tools with no user call budget;
 * return the paths each tool handler saw.
 */
const runScenario = async (n: number) => {
  const reads: string[] = [];
  const writes: string[] = [];
  const paths = pathsFor(n);
  const agent = await ReactiveAgents.create()
    .withName("no-auto-call-budget")
    .withTestScenario([
      ...paths.map((p) => ({ toolCall: { name: "file-read", args: { path: p } } })),
      ...paths.map((p) => ({ toolCall: { name: "file-write", args: { path: p } } })),
      { text: `FINAL ANSWER: read and wrote all ${n} items` },
    ])
    .withTools({ tools: [makeTool("file-read", reads), makeTool("file-write", writes)] })
    .withReasoning({ defaultStrategy: "reactive" })
    .withRequiredTools({ tools: ["file-read", "file-write"] })
    .withMaxIterations(20)
    .build();
  try {
    await agent.run(`Read each of the ${n} notes files, then write each of them back.`);
  } finally {
    await agent.dispose();
  }
  // The tool layer resolves `path` args to absolute paths; compare the tail.
  const tail = (seen: readonly string[]) => seen.map((p) => p.slice(p.indexOf("notes/")));
  return { reads: tail(reads), writes: tail(writes) };
};

describe("required tools: no auto per-tool call budget", () => {
  it("runs 6 distinct file-read + 6 distinct file-write calls with no user budget", async () => {
    const { reads, writes } = await runScenario(6);
    expect(reads).toEqual(pathsFor(6));
    expect(writes).toEqual(pathsFor(6));
  }, 60000);

  it("control: 3 + 3 calls (within the old minCalls+2 budget) run on the same harness", async () => {
    // Green before and after the removal. Proves the scenario harness executes
    // required-tool calls at all, so the 6 + 6 pin isolates the call budget as
    // the only variable.
    const { reads, writes } = await runScenario(3);
    expect(reads).toEqual(pathsFor(3));
    expect(writes).toEqual(pathsFor(3));
  }, 60000);
});
