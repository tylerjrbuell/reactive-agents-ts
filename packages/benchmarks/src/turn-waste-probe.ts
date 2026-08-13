// turn-waste-probe — how many LLM round-trips does a 2-tool task actually cost,
// and how many of them were decidable deterministically?
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { defineTool } from "@reactive-agents/tools";

const tools = [
  defineTool({ name: "metrics_fetch", description: "Fetch a named operational metric value.",
    input: Schema.Struct({ metric: Schema.String }),
    handler: async (a) => `metric ${a.metric} = 873`, timeoutMs: 5000 }),
  defineTool({ name: "report_file", description: "File a written report. Returns a report id.",
    input: Schema.Struct({ body: Schema.String }),
    handler: async (a) => `report filed: ${a.body.slice(0, 40)}`, timeoutMs: 5000 }),
];

const dir = mkdtempSync(join(tmpdir(), "ra-turn-"));
const agent = await ReactiveAgents.create()
  .withName("turn-waste").withProvider((process.argv[2] ?? "ollama") as never)
  .withModel(process.argv[3] ?? "qwen3.5:latest")
  .withReasoning({ defaultStrategy: "reactive" })
  .withTools({ tools } as never).withMaxIterations(12).withTracing({ dir }).build();
await agent.run("Fetch the metric 'latency_p99' then file a report with that exact value. Your final answer MUST state the value.");
await agent.dispose();

const seq: string[] = [];
let llm = 0, toolCalls = 0, tokIn = 0, tokOut = 0;
for (const f of readdirSync(dir)) {
  const lines = readFileSync(join(dir, f), "utf8").split("\n").filter((l) => l.trim());
  for (const l of lines) {
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    const k = String(e["kind"] ?? "");
    if (k === "llm-exchange") {
      llm++;
      const r = e["response"] as Record<string, number> | undefined;
      tokIn += r?.["tokensIn"] ?? 0; tokOut += r?.["tokensOut"] ?? 0;
      const req = e["request"] as Record<string, unknown> | undefined;
      const nTools = Array.isArray(req?.["tools"]) ? (req!["tools"] as unknown[]).length : -1;
      seq.push(`LLM#${llm} (toolsOffered=${nTools} in=${r?.["tokensIn"] ?? "?"} out=${r?.["tokensOut"] ?? "?"})`);
    }
    if (k === "tool-call-end") { toolCalls++; seq.push(`  TOOL ${String(e["toolName"])}`); }
  }
}
console.log("\n===== RUN SHAPE =====");
for (const s of seq) console.log(s);
console.log(`\nLLM round-trips: ${llm}   tool calls: ${toolCalls}   tokensIn=${tokIn} tokensOut=${tokOut}`);
console.log(`Minimum necessary LLM calls for a 2-tool task: 3 (call A, call B, synthesize)`);
console.log(`WASTE: ${llm - 3} extra round-trips (${Math.round(100 * (llm - 3) / Math.max(llm, 1))}% of turns)`);
