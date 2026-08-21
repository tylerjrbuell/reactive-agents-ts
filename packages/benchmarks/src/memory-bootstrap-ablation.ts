// memory-bootstrap-ablation — does default-on MemoryService (bootstrap()+flush())
// clear the project lift rule (09 §6.7)?
//
// THE MECHANISM. `.withLearning()` / `.withMemory()` wires MemoryService into
// the layer. Two phases touch it per run:
//   - BOOTSTRAP (engine/phases/bootstrap.ts): calls memoryService.bootstrap(agentId)
//     -> { semanticContext, recentEpisodes, ... }, threaded into ctx.memoryContext
//     and injected into the think prompt (agent-loop/reasoning-think.ts:100-140).
//   - MEMORY_FLUSH (engine/phases/memory-flush.ts): AFTER a non-trivial run,
//     snapshots the session to episodic SQLite, decays unused entries, and
//     (when the response is substantial OR >=2 tool calls were made) runs an
//     LLM extraction pass that stores semantic entries.
// Memory is default-OFF (`_enableMemory = false` in builder.ts) since v0.12.
// This measures whether flipping the default clears >=3pp lift / <=15% token
// overhead across >=2 tiers (09's lift rule table).
//
// WHY A SINGLE RUN CANNOT SHOW LIFT. memory-flush.ts writes AFTER the run
// completes; bootstrap.ts reads BEFORE the run starts. The mechanism can only
// pay off across a SESSION BOUNDARY: a later `agent.run()` on the same
// `agentId` (same dbPath) bootstrapping from what an earlier run flushed.
// So this is a 2-SESSION protocol, not a 1-shot task:
//   Session 1 (ON and OFF alike): forces >=3 tool calls so
//   `classifyComplexity` returns "complex" (not "trivial"/"moderate") —
//   trivial runs skip memory-flush entirely, and "moderate" forks it as a
//   fire-and-forget daemon that may not have finished writing before session
//   2 starts. "complex" is the one classification that runs memory-flush
//   BLOCKING (memory-flush-dispatch.ts:44-50), so by the time session 1's
//   `agent.run()` resolves, the flush (if wired) has completed.
//   Session 2 (fresh `.build()`, same `withAgentId`/dbPath): asks the agent
//   to recall facts established in session 1 WITHOUT restating them in the
//   session-2 prompt. Correctness = the recalled facts appear in the answer.
//
// MANIPULATION CHECK. A silently-no-op ON arm (memory wired but never
// actually populated) would produce a fake null result indistinguishable
// from "the mechanism doesn't help". Before trusting any accuracy/token
// delta, this script opens the ON arm's SQLite file directly after session 1
// and asserts semantic_memory + session_snapshots rows exist for the
// agentId. If that check fails the cell is flagged BROKEN and excluded from
// the verdict math.
//
//   bun run packages/benchmarks/src/memory-bootstrap-ablation.ts [runs]
//
// Tiers are read from MEMORY_ABLATION_TIERS (comma-separated `provider/model`,
// default "ollama/cogito:14b,ollama/qwen3:14b").
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import type { ToolDefinition } from "@reactive-agents/tools";
import { Database } from "@reactive-agents/runtime-shim";

// ─── Fact fixture (session 1 establishes these; session 2 must recall them
//     WITHOUT the prompt restating them) ───
const FACTS = {
  codename: "Nightjar-7",
  region: "eu-west-2",
  contact: "Priya Rao",
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
  readonly calls: number;
  readonly toolCalls: number;
  readonly iterations: number;
  readonly status: string;
  readonly threw: boolean;
}

async function runSession(
  provider: string,
  model: string,
  agentId: string,
  dbPath: string | undefined,
  arm: "on" | "off",
  prompt: string,
  root: string,
): Promise<SessionResult> {
  const dir = mkdtempSync(join(tmpdir(), "ra-mem-trace-"));
  let output = "";
  let threw = false;
  try {
    let b = ReactiveAgents.create()
      .withName(`mem-${arm}-${agentId}`)
      .withAgentId(agentId)
      .withProvider(provider as never)
      .withModel(model)
      .withTools({ builtins: [], tools: [noteFactTool()] } as never)
      .withReasoning({ defaultStrategy: "reactive" })
      .withMaxIterations(8)
      .withTracing({ dir });
    if (arm === "on") {
      b = b.withLearning({ tier: "standard", dbPath });
    } else {
      b = b.withoutMemory();
    }
    const agent = await b.build();
    const r = await agent.run(prompt);
    await agent.dispose();
    output = String(r.output ?? "");
  } catch (e) {
    output = `THREW: ${String(e).slice(0, 200)}`;
    threw = true;
  }

  let tokens = 0;
  let calls = 0;
  let toolCalls = 0;
  let iterations = 0;
  let status = "unknown";
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const e = JSON.parse(line) as {
          kind?: string;
          status?: string;
          iter?: number;
          toolName?: string;
          response?: { tokensIn?: number; tokensOut?: number };
        };
        if (typeof e.iter === "number" && e.iter > iterations) iterations = e.iter;
        if (e.kind === "run-completed") status = e.status ?? "unknown";
        if (e.kind === "tool-call") toolCalls++;
        if (e.kind === "llm-exchange") {
          tokens += (e.response?.tokensIn ?? 0) + (e.response?.tokensOut ?? 0);
          calls++;
        }
      } catch {
        /* skip malformed line */
      }
    }
  }
  rmSync(dir, { recursive: true, force: true });
  void root;
  return { output, tokens, calls, toolCalls, iterations, status, threw };
}

/** Manipulation check: query the ON arm's SQLite file directly for rows
 *  belonging to this agentId. A failure here means the ON arm never actually
 *  persisted anything — any accuracy/token delta downstream is not trustworthy. */
function checkPersisted(dbPath: string, agentId: string): { semantic: number; snapshots: number; episodes: number } {
  if (!existsSync(dbPath)) return { semantic: 0, snapshots: 0, episodes: 0 };
  const db = new Database(dbPath);
  try {
    const q = (table: string) => {
      try {
        const rows = db.query(`SELECT COUNT(*) as count FROM ${table} WHERE agent_id = '${agentId.replace(/'/g, "''")}'`).all();
        const first = rows[0] as { count?: number } | undefined;
        return Number(first?.count ?? 0);
      } catch {
        return -1; // table doesn't exist / query failed
      }
    };
    return {
      semantic: q("semantic_memory"),
      snapshots: q("session_snapshots"),
      episodes: q("episodic_log"),
    };
  } finally {
    db.close();
  }
}

interface CellResult {
  readonly tier: string;
  readonly arm: "on" | "off";
  readonly run: number;
  readonly s1: SessionResult;
  readonly s2: SessionResult;
  readonly combinedTokens: number;
  readonly correct: boolean;
  readonly correctParts: number; // 0-3, how many of the 3 facts appeared
  readonly persisted?: { semantic: number; snapshots: number; episodes: number };
  readonly broken: boolean;
}

async function runCell(
  tier: string,
  provider: string,
  model: string,
  arm: "on" | "off",
  runIdx: number,
): Promise<CellResult> {
  const agentId = `mem-abl-${arm}-${randomUUID().slice(0, 8)}`;
  const workDir = mkdtempSync(join(tmpdir(), "ra-mem-db-"));
  const dbPath = join(workDir, "memory.db");
  const root = mkdtempSync(join(tmpdir(), "ra-mem-root-"));

  const s1 = await runSession(provider, model, agentId, dbPath, arm, SESSION1_PROMPT, root);

  let persisted: { semantic: number; snapshots: number; episodes: number } | undefined;
  let broken = false;
  if (arm === "on") {
    persisted = checkPersisted(dbPath, agentId);
    // Manipulation check: expect at least a session snapshot to have been
    // written by memory-flush.ts's unconditional `snapshot()` call on a
    // non-trivial (3-tool-call => "complex") run.
    if (persisted.snapshots === 0 && persisted.semantic === 0 && persisted.episodes === 0) {
      broken = true;
    }
  }

  const s2 = await runSession(provider, model, agentId, dbPath, arm, SESSION2_PROMPT, root);

  const lower = s2.output.toLowerCase();
  const parts = [
    lower.includes(FACTS.codename.toLowerCase()),
    lower.includes(FACTS.region.toLowerCase()),
    lower.includes(FACTS.contact.toLowerCase()),
  ];
  const correctParts = parts.filter(Boolean).length;
  const correct = correctParts === 3;

  rmSync(workDir, { recursive: true, force: true });
  rmSync(root, { recursive: true, force: true });

  return {
    tier, arm, run: runIdx,
    s1, s2,
    combinedTokens: s1.tokens + s2.tokens,
    correct, correctParts,
    persisted, broken,
  };
}

if (import.meta.main) {
  const runs = Number(process.argv[2] ?? "3");
  const tierSpecs = (process.env.MEMORY_ABLATION_TIERS ?? "ollama/cogito:14b,ollama/qwen3:14b").split(",");

  const cells: CellResult[] = [];
  for (const spec of tierSpecs) {
    const [provider, model] = spec.split("/");
    const tier = spec;
    for (let i = 0; i < runs; i++) {
      for (const arm of ["on", "off"] as const) {
        const c = await runCell(tier, provider!, model!, arm, i + 1);
        cells.push(c);
        console.log(
          `[${tier}] run${i + 1} arm=${arm.padEnd(3)} ` +
            `s1=${String(c.s1.tokens).padStart(6)}t/${c.s1.toolCalls}tc/${c.s1.status} ` +
            `s2=${String(c.s2.tokens).padStart(6)}t/${c.s2.status} ` +
            `combined=${String(c.combinedTokens).padStart(7)}t ` +
            `recall=${c.correctParts}/3 ${c.correct ? "OK " : "BAD"} ` +
            `${arm === "on" ? `persisted=${JSON.stringify(c.persisted)}${c.broken ? " **BROKEN-NO-OP**" : ""}` : ""}`,
        );
      }
    }
  }

  console.log(`\n── Summary (n=${runs} per arm per tier) ──`);
  for (const spec of tierSpecs) {
    const tier = spec;
    const on = cells.filter((c) => c.tier === tier && c.arm === "on");
    const off = cells.filter((c) => c.tier === tier && c.arm === "off");
    const brokenOn = on.filter((c) => c.broken).length;
    const accOn = on.filter((c) => c.correct).length / (on.length || 1);
    const accOff = off.filter((c) => c.correct).length / (off.length || 1);
    const meanTok = (xs: CellResult[]) => xs.reduce((s, c) => s + c.combinedTokens, 0) / (xs.length || 1);
    const tokOn = meanTok(on);
    const tokOff = meanTok(off);
    const overheadPct = tokOff > 0 ? ((tokOn - tokOff) / tokOff) * 100 : 0;
    const liftPp = (accOn - accOff) * 100;
    console.log(
      `${tier}: ON acc=${(accOn * 100).toFixed(0)}% (${on.filter((c) => c.correct).length}/${on.length}) ` +
        `OFF acc=${(accOff * 100).toFixed(0)}% (${off.filter((c) => c.correct).length}/${off.length}) ` +
        `lift=${liftPp.toFixed(1)}pp | tok ON=${tokOn.toFixed(0)} OFF=${tokOff.toFixed(0)} overhead=${overheadPct.toFixed(1)}% ` +
        `| brokenOn=${brokenOn}/${on.length}`,
    );
  }

  console.log(`\nJSON ${JSON.stringify({ runs, tierSpecs, cells })}`);
}
