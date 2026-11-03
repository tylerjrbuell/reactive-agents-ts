import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
const ROOT = "/home/tylerbuell/Documents/AIProjects/reactive-agents-ts";
const { loadTrace, analyzeRun } = await import(`${ROOT}/packages/trace/src/index.ts`) as any;
const DIR = process.argv[2]!;
const SECRET = /(sk-[A-Za-z0-9]{10,}|api[_-]?key["']?\s*:\s*"[^"]{6,}|Bearer [A-Za-z0-9]{10,}|AIza[0-9A-Za-z_-]{20,})/;
for (const c of readdirSync(DIR).sort()) {
  const td = join(DIR, c, "trace"); if (!existsSync(td)) continue;
  const cell = JSON.parse(readFileSync(join(DIR, c, "cell.json"), "utf8"));
  const res = existsSync(join(DIR, c, "result.json")) ? JSON.parse(readFileSync(join(DIR, c, "result.json"), "utf8")) : null;
  for (const f of readdirSync(td)) {
    const raw = readFileSync(join(td, f), "utf8");
    const tr = await loadTrace(join(td, f)); const ev = tr.events as any[];
    const rs = ev.find((e) => e.kind === "run-started"); const rc = ev.filter((e) => e.kind === "run-completed").at(-1); const ra = ev.filter((e) => e.kind === "run-aborted");
    const gf = ev.filter((e) => e.kind === "guard-fired");
    const td_ = gf.filter((e) => e.guard === "terminal_decision");
    const ov = gf.filter((e) => e.guard === "terminal_status_override");
    const wr = gf.filter((e) => e.guard === "wire-request");
    const others = gf.filter((e) => !["wire-request","terminal_decision","terminal_status_override","deliverable_decision"].includes(e.guard));
    const iters = Math.max(-1, ...ev.map((e) => e.iter ?? -1));
    const neg = ev.filter((e) => e.iter === -1 && !["run-started","run-completed","run-aborted"].includes(e.kind)).map((e) => e.kind);
    const tcEnd = ev.filter((e) => e.kind === "tool-call-end"); const vv = ev.filter((e) => e.kind === "verifier-verdict");
    const kinds: Record<string, number> = {}; for (const e of ev) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
    const an = analyzeRun(tr);
    const sigs = rc?.signals;
    console.log(JSON.stringify({
      cell: c, file: f, nEv: ev.length, kinds,
      cellSuccess: cell.success, cellTerm: cell.terminatedBy, resTerm: res?.terminatedBy, resSuccess: res?.success,
      started: rs && { provider: rs.provider, origin: rs.origin, hasConfig: !!rs.config, mech: rs.config && Object.keys(rs.config.mechanisms ?? {}).length, builderKeys: rs.config && Object.keys(rs.config.builder ?? {}), env: rs.config?.env, secretLeak: SECRET.test(raw) },
      completed: rc && { status: rc.status, terminatedBy: rc.terminatedBy, outcome: rc.outcome, signals: sigs, error: rc.error },
      aborted: ra.length,
      termDec: td_.map((e) => ({ iter: e.iter, reason: e.reason, md: e.metadata })),
      overrides: ov.map((e) => ({ iter: e.iter, reason: e.reason, md: e.metadata })),
      otherGuards: others.map((e) => ({ g: e.guard, iter: e.iter, outcome: e.outcome, reason: e.reason, md: e.metadata })),
      wire: { n: wr.length, providers: [...new Set(wr.map((e) => e.metadata?.provider))], fieldsOk: wr.every((e) => e.metadata?.numCtx != null && e.metadata?.toolsShipped) },
      maxIter: iters, negIter: neg, tcEndIters: tcEnd.map((e) => e.iter), tcEndOk: tcEnd.map((e) => e.ok),
      verdicts: vv.map((e) => ({ iter: e.iter, source: e.source, ok: e.verified ?? e.accepted, action: e.action, keys: Object.keys(e).join(",") })),
      switches: ev.filter((e) => e.kind === "strategy-switched").map((e) => ({ iter: e.iter, reason: e.reason, from: e.from, to: e.to })),
      llmErr: ev.filter((e) => e.kind === "llm-exchange" && (e.error || e.errorClass)).map((e) => ({ provider: e.provider, error: String(e.error ?? "").slice(0, 120), errorClass: e.errorClass })),
      llmProviders: [...new Set(ev.filter((e) => e.kind === "llm-exchange").map((e) => e.provider))],
      analysis: { status: an.status, iterations: an.iterations, honesty: an.honesty, failureModes: an.failureModes?.map((m: any) => m.id ?? m.mode ?? m.name ?? JSON.stringify(m).slice(0, 80)), blind: an.coverage?.blindSpots, hasCause: "cause" in an },
    }));
  }
}
