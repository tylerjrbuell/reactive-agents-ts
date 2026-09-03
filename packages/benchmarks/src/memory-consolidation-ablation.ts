// memory-consolidation-ablation — does default-on MemoryConsolidatorService
// (`_enableMemoryConsolidation` in builder.ts:451) clear the project lift rule
// (09 §2, W6 in the 2026-08-24 external-research-convergence amendment)?
//
// PREREQUISITE FINDING (code-level, not re-derived empirically — see report):
// `MemoryConsolidatorServiceLive` (packages/memory/src/services/memory-consolidator.ts)
// is called from `runtime.ts:731-734` WITHOUT an `onConnect` callback, so its
// `consolidate()` cycle (REPLAY -> CONNECT -> COMPRESS) is 100% SQL
// (SELECT/UPDATE/DELETE against the local SQLite file) with zero
// `LLMService.complete`/`embed` calls anywhere in the path. This means the
// mechanism's billed-token overhead is architecturally 0% by construction —
// the only open question this script measures is ACCURACY lift (does having
// consolidation on change whether facts survive/are recalled across
// sessions), because decay (`compress()`, importance *= decayFactor every
// cycle) and prune (delete below `pruneThreshold`) could in principle HURT
// recall of freshly-written facts, not just help it.
//
// Builder does not enforce ".withMemory() required" despite JSDoc language —
// `_enableMemoryConsolidation` alone triggers `memoryStackNeeded` in
// runtime.ts:587-590 independent of `_enableMemory`. But bootstrap/recall
// injection (bootstrap.ts, reasoning-think.ts) reads from `MemoryService`,
// which is only wired when `_enableMemory` is true — so consolidation alone,
// without memory, cannot produce a recall-visible effect (nothing injects
// into the prompt). This script therefore isolates consolidation's marginal
// effect on TOP of memory-on: arm A = `.withLearning()` (memory only, the
// already-measured 2026-08-21 baseline), arm B = `.withLearning()` +
// `.withMemoryConsolidation({ threshold: 1 })` (fires consolidate() after
// every non-trivial run instead of the default threshold=10, so the small
// n-session protocol below can actually exercise it).
//
// Same 2-session same-agentId/dbPath protocol as memory-bootstrap-ablation.ts.
//
//   bun run packages/benchmarks/src/memory-consolidation-ablation.ts [runs]
//
// Tiers: MEMORY_ABLATION_TIERS env (default cogito:14b,qwen3:14b via ollama).
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import type { ToolDefinition } from "@reactive-agents/tools";
import { Database } from "@reactive-agents/runtime-shim";

const FACTS = {
  codename: "Wrenshadow-9",
  region: "ap-southeast-1",
  contact: "Marco Diallo",
} as const;

const SESSION1_PROMPT =
  "You are onboarding onto a project. Use the note-fact tool exactly three " +
  "times, once per fact, to record the following onboarding facts:\n" +
  `1. The project codename is "${FACTS.codename}".\n` +
  `2. The primary deployment region is "${FACTS.region}".\n` +
  `3. The on-call contact is "${FACTS.contact}".\n` +
  "Call the tool three separate times (one fact per call), then reply with " +
  "a short confirmation paragraph (at least three sentences) summarizing " +
  "all three facts you just recorded.";

const SESSION2_PROMPT =
  "Without asking me anything and without guessing, tell me: (a) this " +
  "project's codename, (b) its primary deployment region, and (c) who the " +
  "on-call contact is. If you do not know, say you don't know.";

function noteFactTool(): { definition: ToolDefinition; handler: (args: Record<string, unknown>) => Effect.Effect<string> } {
  return {
    definition: {
      name: "note-fact",
      description: "Record a single onboarding fact for this project.",
      parameters: [
        { name: "fact", type: "string" as const, description: "The fact text to record", required: true },
      ],
      category: "custom",
      riskLevel: "low",
      timeoutMs: 5_000,
      requiresApproval: false,
      source: "function",
    },
    handler: (args: Record<string, unknown>) =>
      Effect.succeed(`recorded: ${String(args.fact)}`),
  };
}

interface SessionResult {
  readonly output: string;
  readonly tokens: number;
  readonly toolCalls: number;
  readonly status: string;
}

async function runSession(
  provider: string,
  model: string,
  agentId: string,
  dbPath: string,
  arm: "memory-only" | "memory-plus-consolidation",
  prompt: string,
): Promise<SessionResult> {
  const dir = mkdtempSync(join(tmpdir(), "ra-mc-trace-"));
  let output = "";
  try {
    let b = ReactiveAgents.create()
      .withName(`mc-${arm}-${agentId}`)
      .withAgentId(agentId)
      .withProvider(provider as never)
      .withModel(model)
      .withTools({ builtins: [], tools: [noteFactTool()] } as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(8)
      .withTracing({ dir })
      .withLearning({ tier: "standard", dbPath });
    if (arm === "memory-plus-consolidation") {
      b = b.withMemoryConsolidation({ threshold: 1 });
    }
    const agent = await b.build();
    const r = await agent.run(prompt);
    await agent.dispose();
    output = String(r.output ?? "");
  } catch (e) {
    output = `THREW: ${String(e).slice(0, 200)}`;
  }

  let tokens = 0;
  let toolCalls = 0;
  let status = "unknown";
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          kind?: string;
          status?: string;
          response?: { tokensIn?: number; tokensOut?: number };
        };
        if (e.kind === "run-completed") status = e.status ?? "unknown";
        if (e.kind === "tool-call") toolCalls++;
        if (e.kind === "llm-exchange") {
          tokens += (e.response?.tokensIn ?? 0) + (e.response?.tokensOut ?? 0);
        }
      } catch {
        /* skip */
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
  return { output, tokens, toolCalls, status };
}

function checkConsolidated(dbPath: string): { totalRuns: number; semanticRows: number } {
  if (!existsSync(dbPath)) return { totalRuns: 0, semanticRows: 0 };
  const db = new Database(dbPath);
  try {
    const q = (sql: string) => {
      try {
        const rows = db.query(sql).all();
        const first = rows[0] as { c?: number } | undefined;
        return Number(first?.c ?? 0);
      } catch {
        return -1;
      }
    };
    return {
      totalRuns: q(`SELECT total_runs as c FROM consolidation_state WHERE id = 'singleton'`),
      semanticRows: q(`SELECT COUNT(*) as c FROM semantic_memory`),
    };
  } finally {
    db.close();
  }
}

interface CellResult {
  readonly tier: string;
  readonly arm: "memory-only" | "memory-plus-consolidation";
  readonly run: number;
  readonly s1: SessionResult;
  readonly s2: SessionResult;
  readonly combinedTokens: number;
  readonly correctParts: number;
  readonly correct: boolean;
  readonly consolidated?: { totalRuns: number; semanticRows: number };
  readonly broken: boolean;
}

async function runCell(
  tier: string,
  provider: string,
  model: string,
  arm: "memory-only" | "memory-plus-consolidation",
  runIdx: number,
): Promise<CellResult> {
  const agentId = `mc-abl-${arm}-${randomUUID().slice(0, 8)}`;
  const workDir = mkdtempSync(join(tmpdir(), "ra-mc-db-"));
  const dbPath = join(workDir, "memory.db");

  const s1 = await runSession(provider, model, agentId, dbPath, arm, SESSION1_PROMPT);

  let consolidated: { totalRuns: number; semanticRows: number } | undefined;
  let broken = false;
  if (arm === "memory-plus-consolidation") {
    consolidated = checkConsolidated(dbPath);
    // Manipulation check: threshold:1 means notifyEntry() should trip after
    // session 1's non-trivial (3-tool-call) run, so consolidation_state
    // should show total_runs >= 1. If not, the ON+consolidation arm never
    // actually exercised consolidate() and any delta below is not trustworthy.
    if (consolidated.totalRuns < 1) broken = true;
  }

  const s2 = await runSession(provider, model, agentId, dbPath, arm, SESSION2_PROMPT);

  const lower = s2.output.toLowerCase();
  const parts = [
    lower.includes(FACTS.codename.toLowerCase()),
    lower.includes(FACTS.region.toLowerCase()),
    lower.includes(FACTS.contact.toLowerCase()),
  ];
  const correctParts = parts.filter(Boolean).length;

  rmSync(workDir, { recursive: true, force: true });

  return {
    tier, arm, run: runIdx,
    s1, s2,
    combinedTokens: s1.tokens + s2.tokens,
    correctParts,
    correct: correctParts === 3,
    consolidated,
    broken,
  };
}

if (import.meta.main) {
  const runs = Number(process.argv[2] ?? "3");
  const tierSpecs = (process.env.MEMORY_ABLATION_TIERS ?? "ollama/cogito:14b,ollama/qwen3:14b").split(",");

  const cells: CellResult[] = [];
  for (const spec of tierSpecs) {
    const [provider, model] = spec.split("/");
    for (let i = 0; i < runs; i++) {
      for (const arm of ["memory-only", "memory-plus-consolidation"] as const) {
        const c = await runCell(spec, provider!, model!, arm, i + 1);
        cells.push(c);
        console.log(
          `[${spec}] run${i + 1} arm=${arm.padEnd(26)} ` +
            `s1=${String(c.s1.tokens).padStart(6)}t/${c.s1.toolCalls}tc/${c.s1.status} ` +
            `s2=${String(c.s2.tokens).padStart(6)}t/${c.s2.status} ` +
            `combined=${String(c.combinedTokens).padStart(7)}t ` +
            `recall=${c.correctParts}/3 ${c.correct ? "OK " : "BAD"} ` +
            `${arm === "memory-plus-consolidation" ? `consolidated=${JSON.stringify(c.consolidated)}${c.broken ? " **BROKEN-NO-OP**" : ""}` : ""}`,
        );
      }
    }
  }

  console.log(`\n── Summary (n=${runs} per arm per tier) ──`);
  for (const spec of tierSpecs) {
    const memOnly = cells.filter((c) => c.tier === spec && c.arm === "memory-only");
    const memPlus = cells.filter((c) => c.tier === spec && c.arm === "memory-plus-consolidation");
    const brokenPlus = memPlus.filter((c) => c.broken).length;
    const acc = (xs: CellResult[]) => xs.filter((c) => c.correct).length / (xs.length || 1);
    const meanTok = (xs: CellResult[]) => xs.reduce((s, c) => s + c.combinedTokens, 0) / (xs.length || 1);
    const accBase = acc(memOnly);
    const accCand = acc(memPlus);
    const tokBase = meanTok(memOnly);
    const tokCand = meanTok(memPlus);
    const overheadPct = tokBase > 0 ? ((tokCand - tokBase) / tokBase) * 100 : 0;
    const liftPp = (accCand - accBase) * 100;
    console.log(
      `${spec}: memory-only acc=${(accBase * 100).toFixed(0)}% (${memOnly.filter((c) => c.correct).length}/${memOnly.length}) ` +
        `memory+consolidation acc=${(accCand * 100).toFixed(0)}% (${memPlus.filter((c) => c.correct).length}/${memPlus.length}) ` +
        `lift=${liftPp.toFixed(1)}pp | tok base=${tokBase.toFixed(0)} cand=${tokCand.toFixed(0)} overhead=${overheadPct.toFixed(1)}% ` +
        `| brokenPlus=${brokenPlus}/${memPlus.length}`,
    );
  }

  console.log(`\nJSON ${JSON.stringify({ runs, tierSpecs, cells })}`);
}
