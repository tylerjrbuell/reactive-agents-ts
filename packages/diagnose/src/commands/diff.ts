// `rax diagnose diff <runIdA> <runIdB>` — structural diff between two traces.
//
// Compares stats, event-kind histograms, verifier outcomes, and divergent
// events (steps that differ in count or first appearance). Useful for "did
// my fix make things better or worse" comparisons across two runs of the
// same probe.

import { loadTrace, traceStats } from "@reactive-agents/trace";
import { resolveTracePath } from "../lib/resolve.js";
import { bold, cyan, dim, green, red, yellow } from "../lib/format.js";

export async function diffCommand(idA: string, idB: string): Promise<void> {
  const [pathA, pathB] = await Promise.all([
    resolveTracePath(idA),
    resolveTracePath(idB),
  ]);
  const [a, b] = await Promise.all([loadTrace(pathA), loadTrace(pathB)]);
  const [sa, sb] = [traceStats(a), traceStats(b)];

  console.log("");
  console.log(bold(`Diff ${a.runId} → ${b.runId}`));
  console.log(dim(`  A: ${pathA}`));
  console.log(dim(`  B: ${pathB}`));
  console.log("");

  // ── Stat comparison ──
  type Row = { label: string; a: number; b: number; lowerIsBetter?: boolean };
  const rows: Row[] = [
    { label: "iterations", a: sa.iterations, b: sb.iterations },
    { label: "tool calls", a: sa.toolCalls, b: sb.toolCalls },
    { label: "llm exchanges", a: sa.llmExchanges, b: sb.llmExchanges },
    { label: "verifier verdicts", a: sa.verifierVerdicts, b: sb.verifierVerdicts },
    { label: "verifier rejections", a: sa.verifierRejections, b: sb.verifierRejections, lowerIsBetter: true },
    { label: "harness signals", a: sa.harnessSignalsInjected, b: sb.harnessSignalsInjected, lowerIsBetter: true },
    { label: "interventions dispatched", a: sa.interventionsDispatched, b: sb.interventionsDispatched },
    { label: "interventions suppressed", a: sa.interventionsSuppressed, b: sb.interventionsSuppressed },
    { label: "tokens", a: sa.totalTokens, b: sb.totalTokens, lowerIsBetter: true },
    { label: "duration ms", a: sa.durationMs, b: sb.durationMs, lowerIsBetter: true },
  ];

  console.log(bold("stats"));
  for (const r of rows) {
    const delta = r.b - r.a;
    const arrow = delta === 0 ? dim("=") : delta > 0 ? "↑" : "↓";
    const better = r.lowerIsBetter ? delta < 0 : delta > 0;
    const colored = delta === 0 ? dim("(same)") : (better ? green : red)(`${arrow} ${Math.abs(delta)}`);
    console.log(`  ${r.label.padEnd(28)} ${String(r.a).padStart(8)}  →  ${String(r.b).padStart(8)}  ${colored}`);
  }
  console.log("");

  // ── Event-kind histogram diff ──
  const hA = histogram(a.events.map((e) => e.kind));
  const hB = histogram(b.events.map((e) => e.kind));
  const allKinds = new Set([...hA.keys(), ...hB.keys()]);
  console.log(bold("event kinds"));
  for (const k of [...allKinds].sort()) {
    const ca = hA.get(k) ?? 0;
    const cb = hB.get(k) ?? 0;
    if (ca === cb) continue;
    const delta = cb - ca;
    const arrow = delta > 0 ? cyan(`+${delta}`) : yellow(`${delta}`);
    console.log(`  ${k.padEnd(28)} ${String(ca).padStart(8)}  →  ${String(cb).padStart(8)}  ${arrow}`);
  }
  console.log("");

  // ── Verifier outcome diff ──
  const va = a.events.filter((e) => e.kind === "verifier-verdict") as Extract<typeof a.events[number], { kind: "verifier-verdict" }>[];
  const vb = b.events.filter((e) => e.kind === "verifier-verdict") as Extract<typeof b.events[number], { kind: "verifier-verdict" }>[];
  if (va.length > 0 || vb.length > 0) {
    console.log(bold("verifier verdicts"));
    console.log(`  A: ${verdictSummary(va)}`);
    console.log(`  B: ${verdictSummary(vb)}`);
    console.log("");
  }

  // ── Output divergence ──
  const lastSnapA = lastSnapshot(a.events);
  const lastSnapB = lastSnapshot(b.events);
  if (lastSnapA && lastSnapB) {
    console.log(bold("final state"));
    console.log(`  A: status=${lastSnapA.status} outputLen=${lastSnapA.outputLen} terminatedBy=${lastSnapA.terminatedBy ?? "-"}`);
    console.log(`  B: status=${lastSnapB.status} outputLen=${lastSnapB.outputLen} terminatedBy=${lastSnapB.terminatedBy ?? "-"}`);
    console.log("");
  }
}

function histogram<T extends string>(items: readonly T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const i of items) m.set(i, (m.get(i) ?? 0) + 1);
  return m;
}

function verdictSummary(verdicts: readonly { verified: boolean; checks: readonly { name: string; passed: boolean }[] }[]): string {
  if (verdicts.length === 0) return dim("(none)");
  const passed = verdicts.filter((v) => v.verified).length;
  const failedChecks = new Map<string, number>();
  for (const v of verdicts.filter((x) => !x.verified)) {
    const firstFailed = v.checks.find((c) => !c.passed);
    if (firstFailed) failedChecks.set(firstFailed.name, (failedChecks.get(firstFailed.name) ?? 0) + 1);
  }
  const failStr = [...failedChecks.entries()]
    .map(([name, n]) => `${name}=${n}`)
    .join(", ");
  return `${passed}/${verdicts.length} passed${failStr ? `; failures: ${failStr}` : ""}`;
}

function lastSnapshot(events: readonly { kind: string }[]): { status: string; outputLen: number; terminatedBy?: string } | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e?.kind === "kernel-state-snapshot") return e as never;
  }
  return null;
}
