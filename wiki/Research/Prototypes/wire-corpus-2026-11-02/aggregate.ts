// aggregate wire-corpus cells -> markdown tables + per-request CSV. usage: bun aggregate.ts CORPUS_DIR
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const DIR = process.argv[2]!; const cells = join(DIR, "cells");
const jl = (p: string) => existsSync(p) ? readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];
type Row = { model: string; task: string; cls: string; rep: number; i: number; nTools: number; prov: Record<string, number>; schemaBytes: number; promptEval: number; schemaTok: number | null; share: number | null; estShare: number | null; numCtxHttp: number | null; numCtx: number | null; src: string; clamped: boolean; guard: boolean; diff: boolean; promptEst: number | null; outReq: number | null; outSent: number | null; numPredictHttp: number | null };
const rows: Row[] = []; const cellMeta: any[] = []; const mismatch: string[] = [];
for (const c of readdirSync(cells)) {
  const cj = join(cells, c, "cell.json"); if (!existsSync(cj)) continue;
  const m = JSON.parse(readFileSync(cj, "utf8")); cellMeta.push(m);
  const http = jl(join(cells, c, "http-wire.jsonl")).sort((a, b) => a.seq - b.seq);
  const tdir = join(cells, c, "trace"); const wr: any[] = [];
  if (existsSync(tdir)) for (const f of readdirSync(tdir)) for (const e of jl(join(tdir, f))) if (e.kind === "guard-fired" && e.guard === "wire-request") wr.push(e);
  wr.sort((a, b) => a.seq - b.seq);
  if (wr.length !== http.length) mismatch.push(`${c}: trace wire-request=${wr.length} http=${http.length}`);
  const n = Math.min(wr.length, http.length);
  for (let i = 0; i < n; i++) {
    const w = wr[i].metadata, h = http[i]; const prov: Record<string, number> = {};
    for (const t of w.toolsShipped) prov[t.provenance] = (prov[t.provenance] ?? 0) + 1;
    rows.push({ model: m.model, task: m.task, cls: m.task.startsWith("U") ? "umami-MCP" : "simple", rep: m.rep, i, nTools: w.toolsShipped.length, prov, schemaBytes: h.toolsBytes, promptEval: h.promptEval, schemaTok: h.schemaTokensExact, share: h.schemaTokensExact != null && h.promptEval ? h.schemaTokensExact / h.promptEval : null, estShare: null, numCtxHttp: h.numCtxBody, numCtx: w.numCtx, src: w.numCtxSource, clamped: !!w.outputClamped, guard: !!w.headTruncationGuardFired, diff: w.toolSurfaceDiff != null && (w.toolSurfaceDiff.added.length + w.toolSurfaceDiff.removed.length > 0), promptEst: w.promptTokensEstimate, outReq: w.outputBudgetRequested, outSent: w.outputBudget, numPredictHttp: h.numPredictBody });
  }
}
const mean = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
const med = (a: number[]) => { if (!a.length) return NaN; const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]!; };
const f = (x: number, d = 1) => Number.isFinite(x) ? x.toFixed(d) : "n/a";
let md = "";
const groups = new Map<string, Row[]>();
for (const r of rows) { const k = `${r.model} | ${r.cls}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
md += "| model | class | cells (pass/run) | requests | tools/req | prov mix (mean per req) | schema bytes | prompt tok (mean) | schema tok exact (mean) | schema share mean / median / min-max | est-vs-http prompt (kernel/HTTP) | numCtx(http) | numCtxSource | out-clamped | head-trunc fired | surface diff turns |\n|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|\n";
for (const [k, g] of [...groups].sort()) {
  const [model, cls] = k.split(" | ");
  const cm = cellMeta.filter((c) => c.model === model && (c.task.startsWith("U") ? "umami-MCP" : "simple") === cls);
  const sh = g.map((r) => r.share).filter((x): x is number => x != null);
  const pm: Record<string, number> = {}; for (const r of g) for (const [p, c] of Object.entries(r.prov)) pm[p] = (pm[p] ?? 0) + c;
  const provStr = Object.entries(pm).map(([p, c]) => `${p}:${f(c / g.length)}`).join(" ");
  const ctxs = [...new Set(g.map((r) => r.numCtxHttp))].join(","); const srcs = [...new Set(g.map((r) => r.src))].join(",");
  const ratio = mean(g.filter((r) => r.promptEst && r.promptEval).map((r) => r.promptEst! / r.promptEval));
  md += `| ${model} | ${cls} | ${cm.filter((c) => c.pass).length}/${cm.length} | ${g.length} | ${f(mean(g.map((r) => r.nTools)))} | ${provStr} | ${f(mean(g.map((r) => r.schemaBytes)), 0)} | ${f(mean(g.map((r) => r.promptEval)), 0)} | ${f(mean(g.map((r) => r.schemaTok).filter((x): x is number => x != null)), 0)} | ${f(mean(sh) * 100)}% / ${f(med(sh) * 100)}% / ${f(Math.min(...sh) * 100)}-${f(Math.max(...sh) * 100)}% | ${f(ratio, 2)} | ${ctxs} | ${srcs} | ${g.filter((r) => r.clamped).length}/${g.length} | ${g.filter((r) => r.guard).length}/${g.length} | ${g.filter((r) => r.diff).length}/${g.length} |\n`;
}
// by task
md += "\n| model | task | cells pass/run | requests | mean tools | mean prompt tok | mean schema share |\n|---|---|---|---|---|---|---|\n";
const tg = new Map<string, Row[]>(); for (const r of rows) { const k = `${r.model} | ${r.task}`; (tg.get(k) ?? tg.set(k, []).get(k)!).push(r); }
for (const [k, g] of [...tg].sort()) { const [model, task] = k.split(" | "); const cm = cellMeta.filter((c) => c.model === model && c.task === task); const sh = g.map((r) => r.share).filter((x): x is number => x != null); md += `| ${model} | ${task} | ${cm.filter((c) => c.pass).length}/${cm.length} | ${g.length} | ${f(mean(g.map((r) => r.nTools)))} | ${f(mean(g.map((r) => r.promptEval)), 0)} | ${f(mean(sh) * 100)}% |\n`; }
md += `\nmismatches (trace vs http request count): ${mismatch.length ? mismatch.join("; ") : "none"}\n`;
writeFileSync(join(DIR, "summary-tables.md"), md);
writeFileSync(join(DIR, "per-request.csv"), "model,task,rep,i,nTools,schemaBytes,promptEval,schemaTokExact,share,numCtxHttp,numCtxTrace,numCtxSource,outReq,outSent,numPredictHttp,clamped,guard,surfaceDiff,promptEstKernel\n" + rows.map((r) => [r.model, r.task, r.rep, r.i, r.nTools, r.schemaBytes, r.promptEval, r.schemaTok, r.share?.toFixed(4), r.numCtxHttp, r.numCtx, r.src, r.outReq, r.outSent, r.numPredictHttp, r.clamped, r.guard, r.diff, r.promptEst].join(",")).join("\n") + "\n");
console.log(md);
