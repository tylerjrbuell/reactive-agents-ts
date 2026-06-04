/**
 * Diagnostic capture — qwen3 NO_EMISSION under the harness (post floor-fix).
 *
 * Mirrors toolcall-gap-probe BENCH (namespaced custom github tool, allowedTools,
 * meta off, reactive) for a SINGLE run, but with logModelIO so the model's raw
 * thought/content/tool-call output is printed. Goal: distinguish the failure
 *   - FREEZE (empty / <think>-only, no content, no call)
 *   - TEXT-INTENT (states the call in prose, no native tool_calls)
 *   - UNPARSEABLE (<tool_call> XML the resolver drops)
 *
 * Env: MODEL (default qwen3:14b), FLAT=1 → flat tool name.
 * Run: MODEL=qwen3:14b bun apps/examples/qwen3-emission-capture.ts
 */
import { ReactiveAgents } from "reactive-agents";
import { Effect } from "effect";

const MODEL = process.env.MODEL ?? "qwen3:14b";
const COMMITS_TOOL = process.env.FLAT === "1" ? "list_commits" : "github/list_commits";
const FAKE_COMMITS = Array.from({ length: 15 }, (_, i) => `commit ${i + 1}: message ${i + 1}`).join("\n");

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

const BENCH = "Fetch the 15 most recent commits to tylerjrbuell/reactive-agents-ts and list each commit message.";

const agent = await ReactiveAgents.create()
  .withPersona({ role: "Agent", background: "", instructions: "Use the provided tools to solve your task.", tone: "concise" })
  .withProvider("ollama")
  .withModel({ model: MODEL, numCtx: 12000 })
  .withReasoning({ defaultStrategy: "reactive", enableStrategySwitching: false })
  .withTools({ tools: [githubTool], allowedTools: [COMMITS_TOOL], metaTools: false })
  .withObservability({ verbosity: "debug", live: true, logModelIO: true })
  .build();

const r = await agent.run(BENCH);
console.log("CAPTURE_RESULT=" + JSON.stringify({
  tool: COMMITS_TOOL,
  success: r.success,
  terminatedBy: r.terminatedBy ?? null,
  steps: r.metadata.stepsCount,
  toolCalls: (r.metadata.toolCalls ?? []).map((t) => t.name),
  outputLen: r.output.length,
  outputHead: r.output.slice(0, 300),
}));
await agent.dispose();
