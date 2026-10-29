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
const status = tl.tool("get_status", "Get the current status of the background job.", {
  params: TASK === "T2" ? { attempt: { type: "number" as const, required: true, description: "Attempt counter; increment by 1 on every call (1, 2, 3, ...)" } } : {},
  handler: () => { bump("get_status"); return { status: "pending" }; } });
let prompt = ""; let tools: any[] = [status]; let check: (out: string) => boolean = () => false;
if (TASK === "T1") prompt = "Call get_status ONE AT A TIME (never several calls in the same turn): wait for each result before making the next call. Keep calling it until it says done. The job is slow: it will report 'pending' for many polls, which is expected and normal, so do NOT answer after seeing 'pending'. You MUST make at least 8 get_status calls, one per turn, before writing any final answer. After the 8th call, report the last status you saw.";
else prompt = "Call get_status ONE AT A TIME (never several calls in the same turn): wait for each result before making the next call. Keep calling it until it says done. Pass attempt=1 on the first call and increment attempt by 1 on every call. The job is slow: it will report 'pending' for many polls, which is expected and normal, so do NOT answer after seeing 'pending'. You MUST make at least 8 get_status calls, one per turn, before writing any final answer. After the 8th call, report the last status you saw.";
let b = rt.ReactiveAgents.create().withName("rg-probe").withProvider("ollama").withModel(MODEL)
  .withReasoning({ defaultStrategy: "reactive" }).withMaxIterations(14);
b = b.withTools({ tools });
const t0 = Date.now(); let out = ""; let err = ""; let tokens = 0; let iters = 0; let success = false;
try {
  const agent = await b.build();
  const r: any = await agent.run(prompt);
  out = String(r.output ?? ""); tokens = r.metadata?.tokensUsed ?? 0; iters = r.metadata?.stepsCount ?? 0; success = !!r.success;
  await agent.dispose?.();
} catch (e) { err = String(e).slice(0, 200); }
// trace scan
let tcArgs: string[] = []; let dedup = 0; let guards: string[] = []; let trips = 0, toolCalls = 0, llm = 0, tokTrace = 0; let vis: string[] = [];
try {
  for (const f of readdirSync(traceDir)) for (const l of readFileSync(join(traceDir, f), "utf8").split("\n")) {
    if (!l) continue; const j = JSON.parse(l);
    if (j.kind === "tool-call-end") { tcArgs.push(JSON.stringify(j.args ?? null).slice(0,40));  toolCalls++; if (JSON.stringify(j).includes("Stop repeating this tool")) trips++; }
    if (JSON.stringify(j).includes("Already done")) dedup++; if (j.kind === "guard-fired" && j.guard !== "terminal_decision") guards.push(j.guard + ":" + j.outcome); if (j.kind === "llm-exchange") { llm++; tokTrace += (j.usage?.totalTokens ?? ((j.usage?.inputTokens ?? 0) + (j.usage?.outputTokens ?? 0)) ?? 0); if (!vis.length && j.toolSchemaNames) vis = j.toolSchemaNames; }
  }
} catch {}
console.log("CELL " + JSON.stringify({ arm: ARM, model: MODEL, task: TASK, rep: +REP, pass: err ? false : check(out), agentSuccess: success, err, trips, dedup, guards, toolCalls, execs, llm, tokTrace, tokens, iters, ms: Date.now() - t0, tcArgs, vis, reasoning: reasoningPath, out: out.slice(0, 160) }));
