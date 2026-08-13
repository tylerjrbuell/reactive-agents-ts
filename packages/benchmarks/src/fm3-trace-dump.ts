import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { defineTool } from "@reactive-agents/tools";
const tools = [defineTool({ name: "file_write_note", description: "Write text to a note file.",
  input: Schema.Struct({ path: Schema.String, content: Schema.String }),
  handler: async (a) => `wrote ${a.content.length} chars to ${a.path}`, timeoutMs: 5000 })];
const dir = mkdtempSync(join(tmpdir(), "ra-dump-"));
const agent = await ReactiveAgents.create().withName("dump").withProvider("ollama" as never)
  .withModel("gemma4:12b").withReasoning({ defaultStrategy: "reactive" })
  .withTools({ tools } as never).withMaxIterations(12).withTracing({ dir }).build();
await agent.run("Write the text 'hello world' to ./note.txt using the note tool, then confirm it is done.");
await agent.dispose();
const interesting = new Set(["llm-exchange","tool-call-end","guard-fired","assessment","arbitration",
  "harness-signal","verifier-verdict","control-decision","decision-evaluated","intervention-dispatched","ledger-entry"]);
for (const f of readdirSync(dir)) for (const l of readFileSync(join(dir,f),"utf8").split("\n")) {
  if (!l.trim()) continue; let e: Record<string,unknown>;
  try { e = JSON.parse(l) as Record<string,unknown>; } catch { continue; }
  const k = String(e["kind"] ?? "");
  if (!interesting.has(k)) continue;
  const r = (e["response"] ?? {}) as Record<string,unknown>;
  const extra = k === "llm-exchange" ? `stop=${r["stopReason"]} tc=${Array.isArray(r["toolCalls"])?(r["toolCalls"] as unknown[]).length:0}`
    : JSON.stringify(e).slice(0, 260);
  console.log(`[it${e["iter"] ?? "?"}] ${k.padEnd(20)} ${extra}`);
}
