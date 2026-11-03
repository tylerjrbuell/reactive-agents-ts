// gap-closure checker. args: DIR
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts";
const { loadTrace, analyzeCause } = await import(`${ROOT}/packages/trace/src/index.ts`) as any;
const DIR = process.argv[2]!;
for (const c of readdirSync(DIR).sort()) {
  const td = join(DIR, c, "trace"); if (!existsSync(td)) continue;
  const cell = JSON.parse(readFileSync(join(DIR, c, "cell.json"), "utf8"));
  const res = existsSync(join(DIR, c, "result.json")) ? JSON.parse(readFileSync(join(DIR, c, "result.json"), "utf8")) : null;
  for (const f of readdirSync(td)) {
    const ev = (await loadTrace(join(td, f))).events as any[];
    const tr = await loadTrace(join(td, f));
    const rc = ev.filter((e) => e.kind === "run-completed").at(-1); const rs = ev.find((e) => e.kind === "run-started");
    const gf = ev.filter((e) => e.kind === "guard-fired");
    const td_ = gf.filter((e) => e.guard === "terminal_decision").at(-1);
    const ov = gf.filter((e) => e.guard === "terminal_status_override");
    const cz = analyzeCause(tr);
    const oc = rc?.outcome;
    console.log(JSON.stringify({
      cell: c, resOK: cell.success, resTB: cell.terminatedBy, rcStatus: rc?.status, rcTB: rc?.terminatedBy, origin: rs?.origin,
      oc: oc && { status: oc.status, auth: oc.authority, kauth: oc.kernelAuthority, hasDeliv: "deliverable" in oc, hasVV: "verifierVerdict" in oc, outst: oc.outstanding, errClass: oc.errorClass, verdict: oc.verdict },
      tdFinal: td_?.metadata?.finalStatus, tdStatus: td_?.metadata?.status, tdAuth: td_?.metadata?.authority,
      ov: ov.map((e) => ({ r: e.reason, outst: e.metadata?.outstanding, fs: e.metadata?.finalStatus })),
      switches: ev.filter((e) => e.kind === "strategy-switched").map((e) => ({ iter: e.iter, ki: e.kernelIteration, from: e.from, to: e.to })),
      kernelIterKinds: [...new Set(ev.filter((e) => e.kernelIteration !== undefined).map((e) => e.kind))].slice(0, 6),
      vv: ev.filter((e) => e.kind === "verifier-verdict").map((e) => ({ it: e.iter, src: e.source, ok: e.verified })),
      llmErr: ev.filter((e) => e.kind === "llm-exchange" && e.response?.error).map((e) => ({ stop: e.response.stopReason, cls: e.response.error.class })),
      aborted: ev.filter((e) => e.kind === "run-aborted").map((e) => ({ cc: e.causeClass, reason: e.reason })),
      negIter: ev.filter((e) => e.iter === -1 && !["run-started","run-completed","run-aborted"].includes(e.kind)).map((e) => e.kind),
      cause: cz && { cause: cz.cause ?? cz.id ?? cz.label, conf: cz.confidence, ev: JSON.stringify(cz.evidence ?? "").slice(0, 160) },
    }));
  }
}
