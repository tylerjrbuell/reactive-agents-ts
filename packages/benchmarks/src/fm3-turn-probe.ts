// fm3-turn-probe — WHY does the kernel spend one more LLM call than inline?
// Dumps, per LLM round-trip: stopReason, whether a tool was called, the thought
// content, and which looksLikeFinalAnswer condition would have blocked promotion.
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Schema } from "effect";
import { writeFileSync } from "node:fs";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { defineTool } from "@reactive-agents/tools";
import { looksLikeFinalAnswer } from "../../reasoning/src/kernel/capabilities/reason/think.js";

// Mirror of looksLikeFinalAnswer's internals so we can report WHICH gate failed.
function diagnose(c: string) {
  const t = c.trim();
  const planning = [
    /\b(?:i (?:should|need to|will|am going to|'ll|'m going to) (?:call|use|invoke|fetch|search|look up|check)\b)/i,
    /\b(?:let me (?:call|use|invoke|fetch|try|check|verify|search)\b)/i,
    /\bnext (?:step|i'll|i will|i should)\b/i,
    /\b(?:i (?:don't|do not) have (?:enough|the)) (?:information|data|context)\b/i,
    /^(?:thinking|reasoning|planning|analysis)\b/i,
  ];
  const positive = [
    /^#{1,3}\s+\w/m, /^\s*\d+\.\s+\w/m, /^\s*[-*]\s+\w/m, /^\s*\|.+\|/m, /```/,
    /\b(?:final answer|in (?:summary|conclusion)|here (?:is|are)|the (?:result|answer|output) is)\b/i,
  ];
  return {
    len: t.length,
    failsLength: t.length < 100,
    failsPlanning: planning.some((r) => r.test(t)),
    failsPositive: !positive.some((r) => r.test(t)),
  };
}

const tools = [
  defineTool({ name: "file_write_note", description: "Write text to a note file. Returns confirmation.",
    input: Schema.Struct({ path: Schema.String, content: Schema.String }),
    handler: async (a) => { writeFileSync(a.path, a.content, "utf8"); return `wrote ${a.content.length} chars to ${a.path}`; }, timeoutMs: 5000 }),
];

const model = process.argv[3] ?? "gemma4:12b";
const dir = mkdtempSync(join(tmpdir(), "ra-fm3-"));
const agent = await ReactiveAgents.create()
  .withName("fm3").withProvider((process.argv[2] ?? "ollama") as never).withModel(model)
  .withReasoning({ defaultStrategy: "reactive" })
  .withTools({ tools } as never).withMaxIterations(12).withTracing({ dir }).build();
const res = await agent.run("Write the text 'hello world' to ./note.txt using the note tool, then confirm it is done.");
await agent.dispose();

let n = 0;
console.log("\n================ PER-ROUND-TRIP =================");
for (const f of readdirSync(dir)) {
  for (const l of readFileSync(join(dir, f), "utf8").split("\n")) {
    if (!l.trim()) continue;
    let e: Record<string, unknown>;
    try { e = JSON.parse(l) as Record<string, unknown>; } catch { continue; }
    const k = String(e["kind"] ?? "");
    if (k === "llm-exchange") {
      n++;
      const r = (e["response"] ?? {}) as Record<string, unknown>;
      const stop = String(r["stopReason"] ?? r["finishReason"] ?? "?");
      const text = String(r["text"] ?? r["content"] ?? "");
      const tc = r["toolCalls"];
      const nTC = Array.isArray(tc) ? tc.length : 0;
      const d = diagnose(text);
      console.log(`\nLLM#${n}  stopReason=${stop}  toolCalls=${nTC}  in=${r["tokensIn"]} out=${r["tokensOut"]}`);
      console.log(`  text(${d.len}ch): ${JSON.stringify(text.slice(0, 220))}`);
      if (nTC === 0) {
        console.log(`  looksLikeFinalAnswer=${looksLikeFinalAnswer(text)}` +
          `  [len<100:${d.failsLength}] [planningPattern:${d.failsPlanning}] [noPositiveSignal:${d.failsPositive}]`);
      }
    }
    if (k === "tool-call-end") console.log(`  -> TOOL ${String(e["toolName"])}`);
  }
}
console.log(`\nTOTAL LLM round-trips: ${n}`);
console.log(`output: ${JSON.stringify(String(res.output ?? "").slice(0, 160))}`);
