/**
 * Tool-call gap measurement harness (local-only, no docker, no cloud keys).
 *
 * Quantifies the weak-model tool-call gap defined in
 * wiki/Architecture/Design-Specs/2026-06-03-weak-model-toolcall-gap.md.
 *
 * For each cell {task × memory}, runs N fresh trials and classifies each by the
 * tool calls the run actually made (from result.metadata.toolCalls — no text
 * capture needed for the a-vs-b mix):
 *   SUCCESS     — the task tool was called and the run succeeded
 *   NO_EMISSION — zero tool calls (mode a: decided-but-didn't-emit / rationale-stop)
 *   DRIFT       — only meta/other tools called, never the task tool (mode b)
 *   OTHER       — task tool called but run not marked success (partial)
 *
 * Tools are custom + deterministic (a namespaced `github/list_commits` that
 * returns fixed data, and `file-write`) so there is no MCP/docker/network/token
 * variance — only the model's emission behavior varies.
 *
 * Env: MODELS (comma-list, default cogito:14b), N (default 20).
 *
 * Run: MODELS=cogito:14b,qwen3:14b,qwen2.5:14b,llama3.1:latest bun apps/examples/toolcall-gap-probe.ts
 */
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

const MODELS = (process.env.MODELS ?? process.env.MODEL ?? "cogito:14b").split(",").map((m) => m.trim()).filter(Boolean);
const N = Number(process.env.N ?? "20");

const FAKE_COMMITS = Array.from({ length: 15 }, (_, i) => `commit ${i + 1}: message ${i + 1}`).join("\n");

// FLAT=1 → flat tool name "list_commits"; else namespaced "github/list_commits"
// (isolates whether the slash-name is what a model can't emit).
// TOOLNAME overrides FLAT — lets a probe isolate name-shape variables directly
// (e.g. TOOLNAME=github_list_commits = compound + underscore, sanitize no-op →
// prompt and FC names MATCH, so it discriminates name-mismatch from prefix-shape).
const COMMITS_TOOL =
  process.env.TOOLNAME ?? (process.env.FLAT === "1" ? "list_commits" : "github/list_commits");

const githubTool = {
  definition: {
    name: COMMITS_TOOL,
    description: "List recent commits for a GitHub repository.",
    parameters: [
      { name: "owner", type: "string", description: "repo owner", required: true },
      { name: "repo", type: "string", description: "repo name", required: true },
      { name: "perPage", type: "number", description: "how many", required: false },
    ],
  },
  handler: (_args: Record<string, unknown>) => Effect.succeed({ commits: FAKE_COMMITS }),
};

type Cell = {
  id: string;
  task: string;
  taskTool: string;
  metaTools: boolean; // are the generic meta-tools (find/pulse/brief/recall) available?
};

// PROBE task: explicit, forcing, NAMES the tool + args (what an offline calibration
// probe would use). BENCH task: realistic, does NOT name the calling mechanism.
// Spike question (PT1): does the probe rate PREDICT the bench rate per model? If
// probe >> bench, a fixed-task probe is an over-optimistic predictor → the
// probe-prior approach is unsound and must lean on realtime correction.
const PROBE = `Call the ${COMMITS_TOOL} tool with owner="tylerjrbuell", repo="reactive-agents-ts", perPage=15. You must call the tool to complete this task.`;
const BENCH = "Fetch the 15 most recent commits to tylerjrbuell/reactive-agents-ts and list each commit message.";
const ALL_CELLS: readonly Cell[] = [
  { id: "PROBE", task: PROBE, taskTool: COMMITS_TOOL, metaTools: false },
  { id: "BENCH", task: BENCH, taskTool: COMMITS_TOOL, metaTools: false },
];
const CELLS: readonly Cell[] = process.env.CELL
  ? ALL_CELLS.filter((c) => c.id === process.env.CELL)
  : ALL_CELLS;

const META = new Set(["find", "pulse", "brief", "recall", "discover-tools", "checkpoint", "context-status"]);

// ERROR distinguished from NO_EMISSION (the v1 harness conflated them → false
// llama3.1 0/20). DRIFT = called only meta/other tools, never the task tool.
type Outcome = "SUCCESS" | "NO_EMISSION" | "DRIFT" | "OTHER" | "ERROR";

function classify(taskTool: string, success: boolean, calls: readonly string[]): Outcome {
  const nonFinal = calls.filter((c) => c !== "final-answer" && c !== "task-complete");
  if (calls.includes(taskTool)) return success ? "SUCCESS" : "OTHER";
  if (nonFinal.length === 0) return "NO_EMISSION";
  if (nonFinal.every((c) => META.has(c))) return "DRIFT";
  return "OTHER";
}

async function runCell(model: string, cell: Cell): Promise<Record<Outcome, number>> {
  const tally: Record<Outcome, number> = { SUCCESS: 0, NO_EMISSION: 0, DRIFT: 0, OTHER: 0, ERROR: 0 };
  for (let i = 0; i < N; i++) {
    const b = ReactiveAgents.create()
      .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task.", tone: "concise" })
      .withProvider("ollama")
      .withModel({ model, numCtx: 12000 })
      .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
      .withTools({ tools: [githubTool], allowedTools: [cell.taskTool], metaTools: cell.metaTools ? undefined : false, ...(process.env.NO_CLASSIFIER === "1" ? { adaptive: false } : {}) });
    try {
      const agent = await b.withObservability({ verbosity: "warn", live: false }).build();
      try {
        const r = await agent.run(cell.task);
        const c = (r.metadata.toolCalls ?? []).map((t) => t.name);
        tally[classify(cell.taskTool, r.success, c)]++;
      } finally {
        await agent.dispose();
      }
    } catch {
      tally.ERROR++; // build/run hard failure — NOT conflated with no-emission
    }
    process.stderr.write(".");
  }
  return tally;
}

const results: Record<string, Record<string, Record<Outcome, number>>> = {};
for (const model of MODELS) {
  results[model] = {};
  process.stderr.write(`\n\n### MODEL=${model} ###`);
  for (const cell of CELLS) {
    process.stderr.write(`\n[${cell.id}] N=${N} `);
    const tally = await runCell(model, cell);
    results[model][cell.id] = tally;
    process.stderr.write(`\n  ${model} ${cell.id}: ${JSON.stringify(tally)}\n`);
    // incremental dump so partial results survive an interrupt
    console.log("GAP_PARTIAL=" + JSON.stringify({ model, cell: cell.id, tally }));
  }
}

console.log("GAP_MATRIX=" + JSON.stringify({ models: MODELS, n: N, cells: CELLS.map((c) => c.id), results }, null, 2));
