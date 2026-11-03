// strategy-outcome cell. args: MODEL STRATEGY OUTROOT  (absolute OUTROOT)
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [MODEL, STRAT, OUTROOT, TASKID, REP] = process.argv.slice(2);
const TASKS: Record<string,string> = { file: "Write the text 'hello sig' to a file named hi.txt, then read it back and reply with exactly the file contents.", plain: "What is 17 times 3, and what is the capital of France? Answer in one sentence." };
const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts";
const cell = `s-${STRAT}__${MODEL.replace(/[^a-z0-9]+/gi, "_")}__${TASKID}__r${REP}`;
const outDir = join(OUTROOT, cell); mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "sigs-")); const traceDir = join(work, "trace");
process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir; process.chdir(work);
const rt: any = await import(`${ROOT}/packages/runtime/src/index.ts`);
let r: any, err = ""; const t0 = Date.now();
try {
  const agent = await rt.ReactiveAgents.create().withName("sig-s").withProvider("ollama").withModel(MODEL)
    .withReasoning({ defaultStrategy: STRAT }).withMaxIterations(6).withTracing({ dir: traceDir })
    .withTools({ builtins: ["file-write", "file-read"] }).build();
  r = await agent.run(TASKS[TASKID]);
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ success: r?.success, terminatedBy: r?.terminatedBy, metadata: r?.metadata, output: String(r?.output ?? "").slice(0, 300) }, null, 1));
  await agent.dispose?.();
} catch (e) { err = String(e).slice(0, 300); }
await new Promise((x) => setTimeout(x, 1500));
const tdest = join(outDir, "trace"); mkdirSync(tdest, { recursive: true });
if (existsSync(traceDir)) for (const f of readdirSync(traceDir)) copyFileSync(join(traceDir, f), join(tdest, f));
writeFileSync(join(outDir, "cell.json"), JSON.stringify({ cell, model: MODEL, shape: "s-" + STRAT, rep: +REP, task: TASKID, success: r?.success ?? null, terminatedBy: r?.terminatedBy ?? null, err, ms: Date.now() - t0 }));
console.log("CELL " + JSON.stringify({ cell, success: r?.success, tb: r?.terminatedBy, err: err.slice(0, 150), ms: Date.now() - t0 }));
process.exit(0);
