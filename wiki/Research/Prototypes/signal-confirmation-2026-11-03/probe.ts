// signal-confirmation cell. args: MODEL SHAPE REP OUTROOT
import { mkdtempSync, mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const [MODEL, SHAPE, REP, OUTROOT] = process.argv.slice(2);
const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts";
const HERE = dirname(new URL(import.meta.url).pathname);
const slug = MODEL.replace(/[^a-z0-9]+/gi, "_");
const cell = `${SHAPE}__${slug}__r${REP}`;
const outDir = join(OUTROOT, cell); mkdirSync(outDir, { recursive: true });
const work = mkdtempSync(join(tmpdir(), "sigc-")); const traceDir = join(work, "trace");
process.env.REACTIVE_AGENTS_TRACE_DIR = traceDir; process.chdir(work);
const rt: any = await import(`${ROOT}/packages/runtime/src/index.ts`);
const stub = join(ROOT, "wiki/Research/Prototypes/wire-corpus-2026-11-02/umami-stub-mcp.ts");
const base = (model: string, iters = 8) => rt.ReactiveAgents.create().withName("sig-probe").withProvider("ollama").withModel(model)
  .withReasoning({ defaultStrategy: "reactive" }).withMaxIterations(iters).withTracing({ dir: traceDir });
let out = "", err = "", success: boolean | null = null, iters = 0, terminatedBy: any = null; const t0 = Date.now();
try {
  let agent: any; let r: any;
  if (SHAPE === "a-clean") {
    agent = await base(MODEL).withTools({ builtins: ["file-write", "file-read"] }).build();
    r = await agent.run("Write the text 'hello sig' to a file named hi.txt, then read it back and reply with exactly the file contents.");
  } else if (SHAPE === "b-stall") {
    agent = await base(MODEL, 4).withMCP({ name: "umami", transport: "stdio", command: "bun", args: ["run", stub] }).build();
    r = await agent.run("Analyze the umami stats for all tracked websites. Keep a todo list. For each website report pageviews, its top page, referrers and device split, then summarize which site performs best.");
  } else if (SHAPE === "c-required") {
    agent = await base(MODEL, 6).withTools({ builtins: ["file-read"] }).withRequiredTools({ tools: ["web-search"], maxRetries: 1 }).build();
    r = await agent.run("Search the web for the current population of Lisbon and reply with the number.");
  } else if (SHAPE === "d-toolproto") {
    agent = await base(MODEL, 8).withTools({ builtins: ["file-write", "file-read", "code-execute"] }).build();
    r = await agent.run("Use code-execute to compute the sum of squares of 1..50, write it to sum.txt with file-write, read it back and reply with the number.");
  } else if (SHAPE === "e-badmodel") {
    agent = await base("no-such-model:99b").build();
    r = await agent.run("Say hi.");
  } else if (SHAPE === "f-plan") {
    agent = await base(MODEL).withTools({ builtins: ["file-write", "file-read"] }).build();
    const s = agent.session();
    const c1 = await s.chat("Hi, I want to build a tiny notes file.");
    const c2 = await s.chat("Write the three lines alpha, beta, gamma into notes.txt using file-write.", { posture: "plan", origin: "user", useTools: true });
    r = { output: String(c2?.message ?? JSON.stringify(c2)), success: true, metadata: {}, _c1: c1 };
  } else if (SHAPE === "g-contract") {
    agent = await base(MODEL, 8).withTools({ builtins: ["file-write", "file-read"] }).withContract({
      prompt: "Write 'contract-ok' into out.txt and reply done.", tools: [{ kind: "required", name: "file-write" }],
      success: { type: "regex", pattern: "ZZZ-NEVER-MATCHES" } }).build();
    r = await agent.run("Write 'contract-ok' into out.txt and reply done.");
  } else if (SHAPE === "i-timeout") {
    agent = await base(MODEL, 20).withTimeout(2500).withMCP({ name: "umami", transport: "stdio", command: "bun", args: ["run", stub] }).build();
    r = await agent.run("Analyze the umami stats for every website in great detail, one tool call per metric, and write a long report.");
  } else if (SHAPE === "h-verifier") {
    agent = await base(MODEL, 6).withVerification({}).build();
    r = await agent.run("What was the exact closing price of Tesla stock on 2019-03-14? Give the number to the cent, no hedging.");
  }
  out = String(r?.output ?? ""); success = r?.success ?? null; iters = r?.metadata?.stepsCount ?? 0; terminatedBy = r?.terminatedBy ?? r?.metadata?.terminatedBy ?? null;
  writeFileSync(join(outDir, "result.json"), JSON.stringify({ success: r?.success, terminatedBy: r?.terminatedBy, metadata: r?.metadata, receipt: r?.receipt, output: out.slice(0, 500) }, null, 1));
  await agent.dispose?.();
} catch (e) { err = String(e).slice(0, 400); }
await new Promise((r) => setTimeout(r, 1500));
const tdest = join(outDir, "trace"); mkdirSync(tdest, { recursive: true }); let n = 0;
if (existsSync(traceDir)) for (const f of readdirSync(traceDir)) { copyFileSync(join(traceDir, f), join(tdest, f)); n++; }
writeFileSync(join(outDir, "cell.json"), JSON.stringify({ cell, model: MODEL, shape: SHAPE, rep: +REP, success, terminatedBy, err, iters, ms: Date.now() - t0, nTraceFiles: n, out: out.slice(0, 200) }));
console.log("CELL " + JSON.stringify({ cell, success, terminatedBy, err: err.slice(0, 120), iters, ms: Date.now() - t0, n }));
process.exit(0);
