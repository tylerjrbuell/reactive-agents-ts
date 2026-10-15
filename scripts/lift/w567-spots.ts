/**
 * W567 live spot checks — Wave 6 enforcement truth + Wave 7 flywheel presence.
 *
 * Deterministic scripted-provider shapes (same primitives as the suites), run
 * against dist with trace capture into fixtures/post-w567. Each spot prints one
 * JSON line to stdout AND appends to <outDir>/w567-spots.jsonl.
 *
 * Spots:
 *  w6-gateway  — gateway requireApprovalFor gates danger_tool (executed must be 0)
 *  w6-guard    — clean output passes the 6.2 output screen (success true, 0 violations)
 *  w6-kill     — compose timeoutAfter fires mid-run (terminal names timeout, wall bounded)
 *  w7-tier1    — tier1 entropy+NLI checks ride the terminal trace event, verdict untouched
 *  w7-shadow   — auto-shadow Ollama backend emits JudgmentShadow events (N=1, latency noted)
 *
 * Usage: bun run scripts/lift/w567-spots.ts [--out <dir>] [spot ...]
 */
import { mkdirSync, appendFileSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import { timeoutAfter } from "@reactive-agents/compose";

const raw = process.argv.slice(2);
let outDir = join(import.meta.dir, "../../wiki/Research/Harness-Reports/2026-10-12-live-probe-audit-results/fixtures/post-w567");
const only: string[] = [];
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--out") { outDir = resolve(raw[++i]!); continue; }
  only.push(raw[i]!);
}
mkdirSync(outDir, { recursive: true });

type Row = Record<string, unknown>;
const emit = (row: Row) => {
  const line = JSON.stringify(row);
  console.log(line);
  appendFileSync(join(outDir, "w567-spots.jsonl"), line + "\n");
};

const traceLines = (tracePath: string): Record<string, unknown>[] => {
  if (!tracePath || !existsSync(tracePath)) return [];
  const out: Record<string, unknown>[] = [];
  for (const line of readFileSync(tracePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try { out.push(JSON.parse(t)); } catch { /* skip */ }
  }
  return out;
};

const terminalOf = (events: Record<string, unknown>[]) => {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]?.kind === "run-completed") return events[i];
  }
  return undefined;
};

const markerTool = (name: string, onCall: () => void, sleepMs = 0) => ({
  tools: [
    {
      definition: {
        name,
        description: "w567 spot marker tool",
        parameters: [],
        riskLevel: "low" as const,
        timeoutMs: 10_000,
        requiresApproval: false,
        source: "function" as const,
      },
      handler: () => {
        onCall();
        if (sleepMs > 0) {
          return Effect.map(
            Effect.promise(() => new Promise((r) => setTimeout(r, sleepMs))),
            () => "keep going",
          );
        }
        return Effect.succeed("keep going");
      },
    },
  ],
});

const tracePathOf = (r: { metadata?: unknown }): string | undefined =>
  (r.metadata as { tracePath?: string } | undefined)?.tracePath;

async function spotGateway() {
  let executed = 0;
  const started = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("w567-gateway")
    .withTestScenario([{ toolCalls: [{ name: "danger_tool", args: {} }] }])
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(2)
    .withTools(markerTool("danger_tool", () => { executed += 1; }))
    .withGateway({ policies: { requireApprovalFor: ["danger_tool"] } })
    .withObservability({ tracing: { dir: outDir } })
    .build();
  try {
    const r = await agent.run("loop forever");
    const tp = tracePathOf(r) ?? "";
    const term = terminalOf(traceLines(tp));
    emit({ spot: "w6-gateway", executed, expectExecuted: 0, pass: executed === 0, terminatedBy: term?.terminatedBy, wallMs: Date.now() - started, trace: tp.split("/").pop() });
  } finally { await agent.dispose(); }
}

async function spotGuardrail() {
  const started = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("w567-guardrail")
    .withTestScenario([{ text: "The customer record is on file and up to date." }])
    .withGuardrails()
    .withObservability({ tracing: { dir: outDir } })
    .build();
  try {
    const r = await agent.run("Summarize the customer record.");
    const tp = tracePathOf(r) ?? "";
    const events = traceLines(tp);
    const violations = events.filter((e) => e._tag === "GuardrailViolationDetected").length;
    emit({ spot: "w6-guard", success: r.success, violations, expectViolations: 0, pass: r.success === true && violations === 0, wallMs: Date.now() - started, trace: tp.split("/").pop() });
  } finally { await agent.dispose(); }
}

async function spotKillswitch() {
  let calls = 0;
  const started = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("w567-killswitch")
    .withTestScenario([{ toolCalls: [{ name: "loop_tool", args: {} }] }])
    .withReasoning({ defaultStrategy: "reactive" })
    .withMaxIterations(6)
    .withTools(markerTool("loop_tool", () => { calls += 1; }, 120))
    .compose(timeoutAfter({ wallClock: "50ms" }) as never)
    .withObservability({ tracing: { dir: outDir } })
    .build();
  try {
    const r = await agent.run("loop forever");
    const tp = tracePathOf(r) ?? "";
    const term = terminalOf(traceLines(tp));
    const wallMs = Date.now() - started;
    const terminal = String(term?.terminatedBy ?? "");
    emit({ spot: "w6-kill", calls, terminal, wallMs, wallBoundedMs: 60_000, pass: terminal.includes("timeout") && wallMs < 60_000, trace: tp.split("/").pop() });
  } finally { await agent.dispose(); }
}

async function spotTier1() {
  const started = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("w567-tier1")
    .withTestScenario([{ text: "Maybe the capital is possibly Paris, I think, roughly speaking." }])
    .withObservability({ tracing: { dir: outDir } })
    .build();
  try {
    const r = await agent.run("What is the capital of France?");
    const tp = tracePathOf(r) ?? "";
    const names: string[] = [];
    for (const e of traceLines(tp)) {
      const checks = Array.isArray(e.checks)
        ? (e.checks as unknown[]).flatMap((c) => typeof c === "object" && c !== null && typeof (c as Record<string, unknown>).name === "string" ? [String((c as Record<string, unknown>).name)] : [])
        : [];
      if (e.kind === "verdict-emitted" || e.kind === "verifier-verdict") names.push(...checks);
      if (e._tag === "VerifierVerdictEmitted" && e.terminal !== false) names.push(...checks);
    }
    const hasEntropy = names.includes("tier1-semantic-entropy");
    const hasNli = names.includes("tier1-nli");
    emit({ spot: "w7-tier1", success: r.success, checks: [...new Set(names)], hasEntropy, hasNli, pass: r.success === true && hasEntropy && hasNli, wallMs: Date.now() - started, trace: tp.split("/").pop() });
  } finally { await agent.dispose(); }
}

async function spotShadow() {
  const started = Date.now();
  const agent = await ReactiveAgents.create()
    .withName("w567-shadow")
    .withTestScenario([{ text: "Paris is the capital of France." }])
    .withObservability({ tracing: { dir: outDir } })
    .build();
  try {
    const r = await agent.run("What is the capital of France?");
    const tp = tracePathOf(r) ?? "";
    const events = traceLines(tp);
    const shadows = events.filter((e) => e._tag === "JudgmentShadow" || e.kind === "judgment-shadow");
    const wallMs = Date.now() - started;
    emit({ spot: "w7-shadow", success: r.success, shadowEvents: shadows.length, sites: [...new Set(shadows.map((s) => String((s.site ?? s.tagged ?? "?") as string)))], wallMs, note: "presence only, non-gating", trace: tp.split("/").pop() });
  } finally { await agent.dispose(); }
}

const all: Record<string, () => Promise<void>> = {
  "w6-gateway": spotGateway,
  "w6-guard": spotGuardrail,
  "w6-kill": spotKillswitch,
  "w7-tier1": spotTier1,
  "w7-shadow": spotShadow,
};

const run = only.length > 0 ? only : Object.keys(all);
for (const id of run) {
  const fn = all[id];
  if (!fn) { console.error(`unknown spot: ${id}`); process.exit(1); }
  await fn();
}
