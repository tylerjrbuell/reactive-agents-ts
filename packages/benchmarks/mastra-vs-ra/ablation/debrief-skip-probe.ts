// Ablation probe for debrief trivial-skip gate (fa831f44 / GH #143)
//
// Measures actual saved Ollama LLM call on trivial tasks by counting POST
// requests to /api/chat from inside the same process via fetch monkey-patch
// (the bench `runner.ts` does not capture debrief-LLM tokens — see GH #143).
//
// Tasks: k1 (Paris), k3 (RGB), f2 (days of week) — all should classify trivial.
// N=3 repetitions per task per tier.

import { config as dotenvConfig } from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

dotenvConfig({ path: resolve(__dirname, "../../../../.env") });

import { TASKS, type Task as BenchTask } from "../tasks.js";
import { verify } from "../verifier.js";

import { ReactiveAgents } from "reactive-agents";

const TRIVIAL_TASK_IDS = ["k1-france-capital", "k3-rgb-colors", "f2-no-tool-knowledge-recovery"] as const;
const N = Number(process.env.ABLATION_N ?? "3");

type TierId = "local" | "frontier";
interface Tier {
  id: TierId;
  provider: "ollama" | "anthropic";
  modelId: string;
}
const ALL_TIERS: Record<TierId, Tier> = {
  local: { id: "local", provider: "ollama", modelId: "qwen3.5:latest" },
  frontier: { id: "frontier", provider: "anthropic", modelId: "claude-sonnet-4-6" },
};

const tierFlag = (process.env.ABLATION_TIERS ?? "local").split(",").map((s) => s.trim()) as TierId[];
const TIERS: Tier[] = tierFlag.map((id) => ALL_TIERS[id]).filter(Boolean);

// ── Ollama call counter via fetch monkey-patch ──────────────────────────────
let ollamaCallCount = 0;
const ollamaCallSites: string[] = [];
const originalFetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : (input instanceof URL ? input.toString() : input.url);
  if (url.includes("localhost:11434") || url.includes("127.0.0.1:11434")) {
    if (url.includes("/api/chat") || url.includes("/api/generate")) {
      ollamaCallCount++;
      ollamaCallSites.push(`${new Date().toISOString().slice(11,23)} ${init?.method ?? "GET"} ${url.replace(/^https?:\/\/[^/]+/, "")}`);
    }
  }
  return originalFetch(input as RequestInfo, init);
}) as typeof fetch;

function resetCallCount() {
  ollamaCallCount = 0;
  ollamaCallSites.length = 0;
}

// ── Per-run probe ───────────────────────────────────────────────────────────
interface Row {
  arm: "before" | "after"; // populated by outer shell script
  tier: TierId;
  task: string;
  iter: number;
  success: boolean;
  reason: string;
  ollamaCalls: number;
  reportedTokens: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  debriefPresent: boolean;
  taskComplexity: string | undefined;
  outputPreview: string;
  error?: string;
}

async function runOne(task: BenchTask, tier: Tier, iter: number): Promise<Omit<Row, "arm">> {
  resetCallCount();
  const t0 = Date.now();
  let agent: Awaited<ReturnType<typeof ReactiveAgents.create>> | null = null;
  try {
    const builder = ReactiveAgents.create()
      .withName(`ablate-${task.id}-${iter}`)
      .withProvider(tier.provider)
      .withModel({ model: tier.modelId })
      .withMemory()  // memory ON — this is where the gate has effect
      .withReasoning({ defaultStrategy: "reactive", maxIterations: task.maxIterations });
    agent = await builder.build();

    const taskInput = { input: task.prompt, id: `${task.id}-${iter}-${Date.now()}` };
    // ReactiveAgents.run signature varies — use plain prompt overload
    const result = await agent.run(task.prompt);
    const output = (result as unknown as { output?: string }).output ?? "";
    const md = (result as unknown as { metadata?: { tokensUsed?: number; inputTokens?: number; outputTokens?: number; complexity?: string; taskComplexity?: string } }).metadata ?? {};
    const debrief = (result as unknown as { debrief?: unknown }).debrief;
    const v = verify(output, task.verifier);
    return {
      tier: tier.id,
      task: task.id,
      iter,
      success: v.passed,
      reason: v.reason,
      ollamaCalls: ollamaCallCount,
      reportedTokens: md.tokensUsed ?? 0,
      inputTokens: md.inputTokens ?? 0,
      outputTokens: md.outputTokens ?? 0,
      durationMs: Date.now() - t0,
      debriefPresent: debrief !== undefined && debrief !== null,
      taskComplexity: md.complexity ?? md.taskComplexity,
      outputPreview: output.slice(0, 80).replace(/\n/g, " "),
    };
  } catch (err) {
    return {
      tier: tier.id,
      task: task.id,
      iter,
      success: false,
      reason: "exception",
      ollamaCalls: ollamaCallCount,
      reportedTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      durationMs: Date.now() - t0,
      debriefPresent: false,
      taskComplexity: undefined,
      outputPreview: "",
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    if (agent) { try { await agent.dispose(); } catch {} }
  }
}

async function main() {
  const arm = (process.env.ABLATION_ARM ?? "unknown") as "before" | "after";
  const rows: Row[] = [];
  console.log(`ARM=${arm}  TIERS=${TIERS.map((t) => t.id).join(",")}  N=${N}`);
  for (const tier of TIERS) {
    for (const tid of TRIVIAL_TASK_IDS) {
      const task = TASKS.find((t) => t.id === tid)!;
      const repN = tier.id === "frontier" ? 1 : N;  // frontier: 1 per task (cost)
      for (let i = 1; i <= repN; i++) {
        const label = `[${arm}|${tier.id}|${tid}|n${i}/${repN}]`.padEnd(60);
        process.stdout.write(`${label} `);
        const r = await runOne(task, tier, i);
        rows.push({ arm, ...r });
        const sigil = r.success ? "✓" : "✗";
        const dbg = r.debriefPresent ? "dbg+" : "dbg-";
        const cx = r.taskComplexity ?? "?";
        console.log(`${sigil} calls=${r.ollamaCalls} tok=${r.reportedTokens} ${dbg} cx=${cx} ${(r.durationMs/1000).toFixed(1)}s${r.error ? " ERR: " + r.error.slice(0,60) : ""}`);
      }
    }
  }
  const outDir = resolve(__dirname, "results");
  mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const fname = `ablation-${arm}-${ts}.json`;
  writeFileSync(resolve(outDir, fname), JSON.stringify(rows, null, 2));
  console.log(`\nWrote ablation/results/${fname}`);

  // Quick summary
  const grouped = new Map<string, Row[]>();
  for (const r of rows) {
    const k = `${r.tier}|${r.task}`;
    const arr = grouped.get(k) ?? [];
    arr.push(r);
    grouped.set(k, arr);
  }
  console.log("\n── per-cell summary ──");
  for (const [k, rs] of grouped) {
    const calls = rs.map(r => r.ollamaCalls);
    const succ = rs.filter(r => r.success).length;
    const dbgRate = rs.filter(r => r.debriefPresent).length;
    const avgCalls = calls.reduce((a,b)=>a+b,0) / calls.length;
    console.log(`  ${k.padEnd(35)} n=${rs.length} succ=${succ}/${rs.length} avgCalls=${avgCalls.toFixed(2)} dbgPresent=${dbgRate}/${rs.length}`);
  }
}

main().catch((err) => { console.error("Fatal:", err); process.exit(1); });
