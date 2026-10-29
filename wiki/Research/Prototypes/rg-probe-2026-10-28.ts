// repetition-guard before/after probe cell. args: ROOT MODEL TASK ARM REP
import { mkdtempSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [ROOT, MODEL, TASK, ARM, REP] = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), "rg-work-"));
const traceDir = join(work, "trace");
process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
process.chdir(work);
const rt = await import(`${ROOT}/packages/runtime/src/index.ts`);
const tl = await import(`${ROOT}/packages/tools/src/index.ts`);
const reasoningPath = Bun.resolveSync("@reactive-agents/reasoning", `${ROOT}/packages/runtime`);

const INV: Record<string, number> = { A100: 120, B200: 45, C300: 21, D400: 9 };
const PRICE: Record<string, number> = { A100: 2, B200: 10, C300: 5, D400: 40 };
let execs: Record<string, number> = {};
const bump = (n: string) => (execs[n] = (execs[n] ?? 0) + 1);
const skuParam = { sku: { type: "string" as const, required: true, description: "SKU code, e.g. A100" } };
const inventory = tl.tool("inventory_lookup", "Look up units in stock for a SKU.", {
  params: skuParam, handler: (a: any) => { bump("inventory_lookup"); return { sku: a.sku, units: INV[a.sku] ?? 0 }; } });
const price = tl.tool("price_lookup", "Look up unit price for a SKU.", {
  params: skuParam, handler: (a: any) => { bump("price_lookup"); return { sku: a.sku, price: PRICE[a.sku] ?? 0 }; } });
let polls = 0;
const status = tl.tool("job_status", "Check the status of the nightly export job.", {
  params: {}, handler: () => { bump("job_status"); polls++; return { status: "pending", eta: "unknown" }; } });

let prompt = ""; let tools: any[] = []; let check: (out: string) => boolean = () => false;
if (TASK === "F") {
  prompt = "Create three files in the current directory using the file-write tool: a.txt containing the word alpha, b.txt containing the word bravo, c.txt containing the word charlie. Then reply 'done'.";
  check = () => ["a.txt:alpha", "b.txt:bravo", "c.txt:charlie"].every((s) => { const [f, w] = s.split(":"); return existsSync(join(work, f!)) && readFileSync(join(work, f!), "utf8").toLowerCase().includes(w!); });
} else if (TASK === "S") {
  tools = [inventory, price];
  prompt = "For SKUs A100, B200, C300 and D400, look up the units in stock and the unit price. Compute the total inventory value (sum of units x price) and answer with the number.";
  // 120*2 + 45*10 + 21*5 + 9*40 = 240+450+105+360 = 1155
  check = (o) => /1,?155/.test(o);
} else if (TASK === "P") {
  tools = [status];
  prompt = "Check the status of the nightly export job with job_status. If it is not ready, check again. Keep checking until it reports 'ready'. Report the final status.";
  // never ready: correct behaviour = stop and honestly report pending (not claim ready)
  check = (o) => /pending|not ready|never|still/i.test(o) && !/\bis ready\b|status: ready|reports? ready/i.test(o);
}
let b = rt.ReactiveAgents.create().withName("rg-probe").withProvider("ollama").withModel(MODEL)
  .withReasoning({ defaultStrategy: "reactive" }).withMaxIterations(12);
b = TASK === "F" ? b.withTools({ builtins: ["file-write"] }) : b.withTools({ tools });
const t0 = Date.now(); let out = ""; let err = ""; let tokens = 0; let iters = 0; let success = false;
try {
  const agent = await b.build();
  const r: any = await agent.run(prompt);
  out = String(r.output ?? ""); tokens = r.metadata?.tokensUsed ?? 0; iters = r.metadata?.stepsCount ?? 0; success = !!r.success;
  await agent.dispose?.();
} catch (e) { err = String(e).slice(0, 200); }
// trace scan
let trips = 0, toolCalls = 0, llm = 0, tokTrace = 0; let vis: string[] = [];
try {
  for (const f of readdirSync(traceDir)) for (const l of readFileSync(join(traceDir, f), "utf8").split("\n")) {
    if (!l) continue; const j = JSON.parse(l);
    if (j.kind === "tool-call-end") { toolCalls++; if (JSON.stringify(j).includes("Stop repeating this tool")) trips++; }
    if (j.kind === "llm-exchange") { llm++; tokTrace += (j.usage?.totalTokens ?? ((j.usage?.inputTokens ?? 0) + (j.usage?.outputTokens ?? 0)) ?? 0); if (!vis.length && j.toolSchemaNames) vis = j.toolSchemaNames; }
  }
} catch {}
console.log("CELL " + JSON.stringify({ arm: ARM, model: MODEL, task: TASK, rep: +REP, pass: err ? false : check(out), agentSuccess: success, err, trips, toolCalls, execs, llm, tokTrace, tokens, iters, ms: Date.now() - t0, vis, reasoning: reasoningPath, out: out.slice(0, 160) }));
