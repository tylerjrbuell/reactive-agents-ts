// args: ROOT MODEL POSTURE(plan|execute) REP [GO=1]  -- one cell per process
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [ROOT, MODEL, POSTURE, REP, GO] = process.argv.slice(2);
const work = mkdtempSync(join(tmpdir(), "pp-work-"));
const traceDir = join(work, "trace");
process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
process.chdir(work);
const rt = await import(`${ROOT}/packages/runtime/src/index.ts`);
const TASK = "Plan how to find the current BTC price and write it to a file";
const agent = await rt.ReactiveAgents.create().withName("pp-probe").withProvider("ollama").withModel(MODEL)
  .withReasoning({ defaultStrategy: "reactive" }).withMaxIterations(10)
  .withMetaTools({ enabled: true, todo: true })
  .withTools({ builtins: ["web-search", "crypto-price", "file-write"] })
  .withTracing({ dir: traceDir }).build();
const t0 = Date.now(); const turns: any[] = [];
const sess = agent.session();
async function turn(msg: string, posture: string) {
  let out = "", err = "";
  try { const r: any = await sess.chat(msg, { useTools: true, ...(posture === "plan" ? { posture: "plan" } : {}) }); out = String(r.message ?? r.output ?? JSON.stringify(r)); }
  catch (e) { err = String(e).slice(0, 300); }
  turns.push({ posture, out: out.slice(0, 1500), err });
}
await turn(TASK, POSTURE);
if (GO) await turn("/go — go ahead and carry out the plan", "execute");
try { await sess.end(); await agent.dispose?.(); } catch {}
// trace scan
const ev: any[] = [];
try { for (const f of readdirSync(traceDir)) for (const l of readFileSync(join(traceDir, f), "utf8").split("\n")) if (l) { try { ev.push(JSON.parse(l)); } catch {} } } catch {}
const kinds: Record<string, number> = {}; for (const e of ev) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const toolEnds = ev.filter((e) => e.kind === "tool-call-end");
const toolsRun = toolEnds.map((e) => ({ n: e.toolName ?? e.name, ok: e.ok ?? e.success, r: String(e.result ?? e.output ?? e.error ?? "").slice(0, 100) }));
const guards = ev.filter((e) => e.kind === "guard-fired").map((e) => `${e.guard}:${e.outcome ?? ""}`);
const llm = ev.filter((e) => e.kind === "llm-exchange");
const wire = llm.map((e) => e.toolSchemaNames);
const guidance = llm.map((e) => { const s = JSON.stringify(e); const m = s.match(/Guidance:[^"]{0,400}/g); return m ? m.map((x) => x.replace(/\\n/g, " | ")) : []; });
const rc = ev.filter((e) => e.kind === "run-completed").map((e) => ({ s: e.status ?? e.success, t: e.terminatedBy ?? e.terminated_by, k: Object.keys(e).join(",") }));
const vv = ev.filter((e) => e.kind === "verifier-verdict").map((e) => JSON.stringify(e).slice(0, 200));
console.log("CELL " + JSON.stringify({ rc, vv, model: MODEL, posture: POSTURE, rep: +REP, go: !!GO, ms: Date.now() - t0, kinds, toolsRun, guards, wire, guidance, turns, sampleKeys: toolEnds[0] ? Object.keys(toolEnds[0]) : [] }));
