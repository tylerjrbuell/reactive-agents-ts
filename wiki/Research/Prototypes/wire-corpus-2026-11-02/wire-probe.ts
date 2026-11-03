// wire-corpus probe cell. args: MODEL TASK REP OUTROOT
// Measures (a) trace wire-request facts (kernel) and (b) independent HTTP-level truth:
// every Ollama /api/chat body is captured; tools[] bytes measured; then a differential
// prefill (same request, tools removed, num_predict=1) gives EXACT schema tokens.
import { mkdtempSync, readFileSync, mkdirSync, readdirSync, copyFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const [MODEL, TASK, REP, OUTROOT] = process.argv.slice(2);
const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts";
const HERE = dirname(new URL(import.meta.url).pathname);
const slug = MODEL.replace(/[^a-z0-9]+/gi, "_");
const cell = `${slug}__${TASK}__r${REP}`;
const outDir = join(OUTROOT, "cells", cell); mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "wire-work-"));
const traceDir = join(work, "trace");
process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir;
process.chdir(work);

// ── HTTP-level capture ──
const wirePath = join(outDir, "http-wire.jsonl");
const realFetch = globalThis.fetch;
let reqSeq = 0;
const pending = new Set<Promise<void>>();
globalThis.fetch = Object.assign(async (input: any, init?: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (!url.endsWith("/api/chat") || !init?.body || typeof init.body !== "string") return realFetch(input, init);
  const seq = reqSeq++;
  const body = JSON.parse(init.body);
  const resp = await realFetch(input, init);
  const clone = resp.clone();
  const job = (async () => {
    let promptEval = 0, evalCount = 0, doneReason = "";
    try {
      const txt = await clone.text();
      for (const l of txt.split("\n")) { if (!l.trim()) continue; try { const j = JSON.parse(l); if (j.done) { promptEval = j.prompt_eval_count ?? 0; evalCount = j.eval_count ?? 0; doneReason = j.done_reason ?? ""; } } catch {} }
    } catch {}
    // differential prefill: same body, no tools, 1 token
    let noToolsEval: number | null = null;
    try {
      if (body.tools?.length) {
        const b2 = { ...body, tools: undefined, stream: false, options: { ...(body.options ?? {}), num_predict: 1 } };
        const r2 = await realFetch(input, { ...init, body: JSON.stringify(b2), signal: undefined });
        const j2: any = await r2.json(); noToolsEval = j2.prompt_eval_count ?? null;
      }
    } catch {}
    const toolsJson = JSON.stringify(body.tools ?? []);
    const msgsJson = JSON.stringify(body.messages ?? []);
    appendFileSync(wirePath, JSON.stringify({
      seq, nTools: body.tools?.length ?? 0, toolsBytes: body.tools?.length ? toolsJson.length : 0, msgsBytes: msgsJson.length,
      numCtxBody: body.options?.num_ctx ?? null, numPredictBody: body.options?.num_predict ?? null,
      promptEval, evalCount, doneReason, noToolsEval,
      schemaTokensExact: noToolsEval !== null && promptEval ? promptEval - noToolsEval : null,
      toolNames: (body.tools ?? []).map((t: any) => t.function?.name),
    }) + "\n");
  })();
  pending.add(job); job.finally(() => pending.delete(job));
  return resp;
}, { preconnect: (realFetch as any).preconnect }) as typeof fetch;

const rt = await import(`${ROOT}/packages/runtime/src/index.ts`);
const stub = join(HERE, "umami-stub-mcp.ts");

const TASKS: Record<string, { prompt: string; umami: boolean; builtins?: string[]; check: (o: string, w: string) => boolean }> = {
  U1: { umami: true, prompt: "Use the umami tools to list the tracked websites, then report total pageviews and visitors for the docs site for the last 7 days.", check: (o) => /1,?200/.test(o) && /410/.test(o) },
  U2: { umami: true, prompt: "Analyze the umami stats for the docs site. Keep a todo list. Report its top 3 pages by views.", check: (o) => /getting-started/.test(o) && /builder-api/.test(o) },
  U3: { umami: true, prompt: "Compare visitors between the docs site and the landing site using umami and say which has more.", check: (o) => /820|docs/i.test(o) && /landing/i.test(o) },
  U4: { umami: true, prompt: "How many active visitors are on the blog site right now, and what is its domain? Use umami.", check: (o) => /9/.test(o) && /blog\.reactiveagents\.dev/.test(o) },
  U5: { umami: true, prompt: "Analyze the umami stats for all tracked websites. Keep a todo list. For each website report pageviews and its top page, then summarize which site performs best.", check: (o) => /3,?600|landing|docs/i.test(o) && /\//.test(o) },
  S1: { umami: false, builtins: ["file-write", "file-read"], prompt: "Write the text 'hello wire' to a file named hi.txt, then read it back and reply with exactly the file contents.", check: (o, w) => existsSync(join(w, "hi.txt")) && /hello wire/.test(o) },
  S2: { umami: false, builtins: ["code-execute"], prompt: "Use code-execute to compute 17 * 23 and reply with the number.", check: (o) => /391/.test(o) },
};
const T = TASKS[TASK]!;
let b = rt.ReactiveAgents.create().withName("wire-probe").withProvider("ollama").withModel(MODEL)
  .withReasoning({ defaultStrategy: "reactive" }).withMaxIterations(10).withTracing({ dir: traceDir });
if (T.umami) b = b.withMCP({ name: "umami", transport: "stdio", command: "bun", args: ["run", stub] });
if (T.builtins) b = b.withTools({ builtins: T.builtins });
const t0 = Date.now(); let out = "", err = "", success = false, tokens = 0, iters = 0;
try {
  const agent = await b.build();
  const r: any = await agent.run(T.prompt);
  out = String(r.output ?? ""); tokens = r.metadata?.tokensUsed ?? 0; iters = r.metadata?.stepsCount ?? 0; success = !!r.success;
  await agent.dispose?.();
} catch (e) { err = String(e).slice(0, 300); }
await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, 20000))]); // flush differential prefills
// copy committed traces
const tdest = join(outDir, "trace"); mkdirSync(tdest, { recursive: true });
let nTraceFiles = 0;
if (existsSync(traceDir)) for (const f of readdirSync(traceDir)) { copyFileSync(join(traceDir, f), join(tdest, f)); nTraceFiles++; }
const pass = err ? false : T.check(out, work);
writeFileSync(join(outDir, "cell.json"), JSON.stringify({ model: MODEL, task: TASK, rep: +REP, pass, agentSuccess: success, err, tokens, iters, ms: Date.now() - t0, nTraceFiles, out: out.slice(0, 300) }));
console.log("CELL " + JSON.stringify({ cell, pass, success, err, iters, ms: Date.now() - t0, nTraceFiles }));
process.exit(0);
