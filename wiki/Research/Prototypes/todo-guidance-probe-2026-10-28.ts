// V5 todo-guidance ablation cell. args: ROOT MODEL TASK ARM REP   ARM in A0|A1|A2|A3
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [ROOT, MODEL, TASK, ARM, REP] = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), "tg-work-"));
const traceDir = join(work, "trace");
process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
process.chdir(work);
const rt = await import(`${ROOT}/packages/runtime/src/index.ts`);
const reasoningPath = Bun.resolveSync("@reactive-agents/reasoning", `${ROOT}/packages/runtime`);
const toolsPath = Bun.resolveSync("@reactive-agents/tools", `${ROOT}/packages/runtime`);
const tl = await import(`${ROOT}/packages/tools/src/index.ts`);

const INV: Record<string, number> = { A100: 120, B200: 45, C300: 21, D400: 9 };
const PRICE: Record<string, number> = { A100: 2, B200: 10, C300: 5, D400: 40 };
const skuParam = { sku: { type: "string" as const, required: true, description: "SKU code, e.g. A100" } };
const inventory = tl.tool("inventory_lookup", "Look up units in stock for a SKU.", {
  params: skuParam, handler: (a: any) => ({ sku: a.sku, units: INV[a.sku] ?? 0 }) });
const price = tl.tool("price_lookup", "Look up unit price for a SKU.", {
  params: skuParam, handler: (a: any) => ({ sku: a.sku, price: PRICE[a.sku] ?? 0 }) });

// multi = task expects a todo plan (>=1 add); control = todo should NOT be used
let prompt = ""; let builtins: string[] = []; let tools: any[] = []; let multi = true;
let check: (o: string) => boolean = () => false;
if (TASK === "W1") { builtins = ["web-search"];
  prompt = "Use web search to find the capital of Australia and the capital of Canada, then find the population of each city. Report both capitals with their populations.";
  check = (o) => /canberra/i.test(o) && /ottawa/i.test(o);
} else if (TASK === "W2") { builtins = ["web-search"];
  prompt = "Search the web to find who created the Python programming language and who created the Rust programming language, then find the year each language first appeared. Answer with both names and years.";
  check = (o) => /guido/i.test(o) && /graydon/i.test(o);
} else if (TASK === "N3") {
  prompt = "Do these three steps: (1) write down the fruits apple, banana, cherry; (2) sort them alphabetically; (3) count the total number of letters across all three. Answer with the total count.";
  check = (o) => /\b17\b/.test(o);
} else if (TASK === "L4") { tools = [inventory, price];
  prompt = "For SKUs A100, B200, C300 and D400, look up the units in stock and the unit price one SKU at a time. Compute each SKU's value (units x price), then the total inventory value. Answer with the total number.";
  check = (o) => /1,?155/.test(o);
} else if (TASK === "C5") { multi = false;
  prompt = "What is 17 times 23? Answer with the number only.";
  check = (o) => /\b391\b/.test(o);
}
const guidance = ARM === "A1" ? { systemLine: true } : ARM === "A2" ? { reminder: true } : ARM === "A3" ? { systemLine: true, reminder: true } : undefined;
let b = rt.ReactiveAgents.create().withName("tg-probe").withProvider("ollama").withModel(MODEL)
  .withReasoning({ defaultStrategy: "reactive" }).withMaxIterations(10)
  .withMetaTools({ enabled: true, todo: true, ...(guidance ? { todoGuidance: guidance } : {}) });
b = b.withTools({ builtins, tools });
const t0 = Date.now(); let out = ""; let err = ""; let tokens = 0; let iters = 0; let success = false;
try {
  const agent = await b.build();
  const r: any = await agent.run(prompt);
  out = String(r.output ?? ""); tokens = r.metadata?.tokensUsed ?? 0; iters = r.metadata?.stepsCount ?? 0; success = !!r.success;
  await agent.dispose?.();
} catch (e) { err = String(e).slice(0, 200); }
// trace scan: replay todo rows from successful todo calls
let vis: string[] = []; let sysHasLine = false, reminderSeen = false; let llm = 0, tokTrace = 0;
let todoCalls = 0, todoOk = 0, adds = 0; const rows = new Map<string, string>(); const actions: string[] = []; let otherTools = 0;
const LINE = "keep your todo list current"; 
try {
  for (const f of readdirSync(traceDir)) for (const l of readFileSync(join(traceDir, f), "utf8").split("\n")) {
    if (!l) continue; const j = JSON.parse(l);
    if (j.kind === "llm-exchange") { llm++; tokTrace += (j.usage?.totalTokens ?? ((j.usage?.inputTokens ?? 0) + (j.usage?.outputTokens ?? 0)) ?? 0);
      if (!vis.length && j.toolSchemaNames) vis = j.toolSchemaNames;
      const s = JSON.stringify(j); if (s.includes(LINE)) sysHasLine = true; if (s.includes("Todo: ") && s.includes("open (")) reminderSeen = true; }
    if (j.kind === "tool-call-end") {
      const name = j.toolName ?? j.name ?? j.tool; if (name !== "todo") { otherTools++; continue; }
      todoCalls++; const s = JSON.stringify(j);
      const args = j.args ?? j.input ?? j.arguments ?? {};
      const act = String(args.action ?? ""); actions.push(act);
      const ok = j.ok ?? j.success ?? !/error|invalid|unknown action/i.test(String(j.result ?? j.output ?? "").slice(0, 80));
      if (ok) { todoOk++; (globalThis as any).__x = s; }
      if (ok && (act === "add" || act === "create" || act === "append")) { const items = Array.isArray(args.items) ? args.items : [0]; for (const _ of items) { rows.set(String(rows.size + 1), "pending"); } adds++; }
      else if (ok && args.id !== undefined) { const id = String(args.id); const st = /^(done|complete|finish|mark_done)/.test(act) ? "done" : /start|begin|in_progress/.test(act) ? "in_progress" : rows.get(id); if (st && rows.has(id)) rows.set(id, st); }
    }
  }
} catch {}
const open = [...rows.values()].filter((s) => s !== "done").length;
// consistent: multi => >=1 add and no open rows; control => no todo use at all
const consistent = err ? false : multi ? (adds >= 1 && open === 0) : todoCalls === 0;
console.log("CELL " + JSON.stringify({ arm: ARM, model: MODEL, task: TASK, rep: +REP, correct: err ? false : check(out), agentSuccess: success, err, consistent, used: todoCalls > 0, adds, todoCalls, todoOk, actions, rows: rows.size, open, otherTools, llm, tokTrace, tokens, iters, ms: Date.now() - t0, reasoningPath, toolsPath, vis, sysHasLine, reminderSeen, out: out.slice(0, 140) }));
