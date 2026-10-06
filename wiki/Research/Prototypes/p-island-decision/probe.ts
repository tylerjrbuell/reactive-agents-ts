/**
 * p-island-decision - THROWAWAY probe.
 *
 * Question: which SDK primitive should drive one island agent's per-tick
 * decision?
 *   A) stateless structured call   - .withOutputSchema + agent.run() per tick,
 *                                    engine supplies a compact memory string
 *   B) persistent session          - agent.session() + session.chat() per tick
 *   C) memory-backed structured    - .withMemory() + .withOutputSchema + run()
 *
 * Metrics per variant: schema-valid rate, tokens/tick, latency/tick, canary
 * leak (does the agent reference facts it was never told?), first-tick recall.
 *
 * Run:
 *   PROBE_MODEL=nimble:latest bun run wiki/Research/Prototypes/p-island-decision/probe.ts
 *
 * Not wired into anything. Delete after the finding is recorded.
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";
import { ReactiveAgents } from "reactive-agents";

// ─── config ──────────────────────────────────────────────────────────────────

const MODEL = process.env.PROBE_MODEL ?? "nimble:latest";
const TICKS = Number(process.env.PROBE_TICKS ?? "3");

// ─── hidden ground truth (canaries the agent must NEVER see or reference) ────

const HIDDEN_CANARIES = ["D4", "poisoned", "Orin's secret cache"];

const WORLD = {
  island: "Thorn Atoll, 12x12 tiles",
  // A resource the agent can actually perceive (at/near her tile).
  nearby: "A cluster of ripe berries at the forest edge (east, ~1 tile away).",
  // Facts that exist in the world but are NOT in this agent's perception.
  hidden: {
    cacheTile: "D4",
    secret: "the northern spring is poisoned",
    orinCache: "Orin buried a secret cache of dried fish three days ago",
  },
};

// What agent "Mira" perceives each tick. Partial observability is enforced by
// the engine: it builds this string and simply never includes WORLD.hidden.
function perceive(tick: number): string {
  const base = [
    "You are Mira, a castaway on Thorn Atoll.",
    "Traits: cautious, practical. Skills: foraging, fishing. Needs: hunger 7/10, thirst 4/10, energy 6/10.",
    "Inventory: 1 spear, 0 food, half a gourd of water.",
    "Location: west beach (tile C6). Terrain around you: sand west, forest east, freshwater stream north-east.",
  ];
  const perTick: Record<number, string> = {
    1: `Current observation (tick 1): ${WORLD.nearby}`,
    2: "Current observation (tick 2): you moved toward the forest edge; the berries you spotted are now 1 tile ahead. Hunger rising (8/10).",
    3: "Current observation (tick 3): you are at the forest edge. Berries still present. A stranger, Kell, is visible 2 tiles south, carrying a full waterskin.",
  };
  return [...base, perTick[tick] ?? perTick[TICKS]!].join("\n");
}

const INSTRUCTION = [
  "Decide what to do this tick.",
  "Reply with ONLY a JSON object, no prose, matching this shape:",
  '{"goal":string,"reasoning_summary":string,"plan":string[],"action":{"type":<one of move|gather|hunt|build|craft|eat|drink|rest|trade|share|talk|inspect>,"target":string?}}',
  "Only use facts in the observation above.",
].join("\n");

// ─── decision schema ─────────────────────────────────────────────────────────

const ActionType = Schema.Literal(
  "move", "gather", "hunt", "build", "craft", "eat",
  "drink", "rest", "trade", "share", "talk", "inspect",
);

const DecisionSchema = Schema.Struct({
  goal: Schema.String,
  reasoning_summary: Schema.String,
  plan: Schema.Array(Schema.String),
  action: Schema.Struct({
    type: ActionType,
    target: Schema.optional(Schema.String),
  }),
});
type Decision = typeof DecisionSchema.Type;

const ACTION_VOCAB = new Set([
  "move", "gather", "hunt", "build", "craft", "eat",
  "drink", "rest", "trade", "share", "talk", "inspect",
]);

// ─── helpers ─────────────────────────────────────────────────────────────────

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1]! : text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function validity(obj: unknown): { valid: boolean; actionType?: string } {
  if (obj === null || typeof obj !== "object") return { valid: false };
  const o = obj as Record<string, unknown>;
  const action = o.action as Record<string, unknown> | undefined;
  const type = typeof action?.type === "string" ? action.type : undefined;
  const ok =
    typeof o.goal === "string" &&
    typeof o.reasoning_summary === "string" &&
    Array.isArray(o.plan) &&
    type !== undefined &&
    ACTION_VOCAB.has(type);
  return { valid: ok, actionType: type };
}

function leaks(text: string): string[] {
  const hits: string[] = [];
  for (const c of HIDDEN_CANARIES) if (text.toLowerCase().includes(c.toLowerCase())) hits.push(c);
  return hits;
}

function recallMentionsBerries(text: string): boolean {
  return /\bberr/i.test(text);
}

// COST: ollama metadata.cost is very likely 0; keep tokens as the real signal.

interface TickMetric {
  tick: number;
  mode: "structured" | "session";
  valid: boolean;
  actionType?: string;
  tokens: number;
  inputTokens?: number;
  outputTokens?: number;
  ms: number;
  leakHits: string[];
  raw?: string;
  error?: string;
}

async function buildStructured(memory: boolean) {
  let b = ReactiveAgents.create()
    .withName(memory ? "probe-memory" : "probe-stateless")
    .withProvider("ollama")
    .withModel(MODEL)
    .withReactiveIntelligence({ telemetry: false })
    .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
    .withOutputSchema(DecisionSchema, { mode: "fast", onParseFail: "degrade" });
  b = memory ? b.withMemory({ tier: "standard", dbPath: ":memory:" }) : b.withoutMemory();
  return b.build();
}

async function runStructured(memory: boolean): Promise<{
  ticks: TickMetric[];
  recall: boolean | null;
  recallText: string;
}> {
  const agent = await buildStructured(memory);
  const ticks: TickMetric[] = [];
  const memoryLines: string[] = [];

  try {
    for (let tick = 1; tick <= TICKS; tick++) {
      const engineMemory = memoryLines.length
        ? `\nYour memory of earlier ticks:\n${memoryLines.join("\n")}`
        : "";
      const prompt = `${perceive(tick)}${engineMemory}\n\n${INSTRUCTION}`;
      const t0 = Date.now();
      try {
        const result = await agent.run(prompt);
        const ms = Date.now() - t0;
        const obj = result.object;
        const { valid, actionType } = validity(obj);
        const raw = `${result.output} ${JSON.stringify(obj ?? "")}`;
        const m = result.metadata;
        ticks.push({
          tick,
          mode: "structured",
          valid,
          actionType,
          tokens: m.tokensUsed,
          inputTokens: m.inputTokens,
          outputTokens: m.outputTokens,
          ms,
          leakHits: leaks(raw),
          raw: raw.slice(0, 400),
          error: result.objectError,
        });
        if (valid) {
          const d = obj as Decision;
          memoryLines.push(`- tick ${tick}: goal="${d.goal}", action=${d.action.type}`);
        }
      } catch (err) {
        ticks.push({
          tick,
          mode: "structured",
          valid: false,
          tokens: 0,
          ms: Date.now() - t0,
          leakHits: [],
          error: (err as Error).message,
        });
      }
    }

    // First-tick recall probe.
    let recall: boolean | null = null;
    let recallText = "";
    try {
      const r = await agent.run(
        "In one short sentence, what did you observe on your very first tick?",
      );
      recallText = r.output;
      recall = recallMentionsBerries(r.output);
    } catch {
      recall = null;
    }
    return { ticks, recall, recallText };
  } finally {
    await agent.dispose();
  }
}

async function runSession(): Promise<{
  ticks: TickMetric[];
  recall: boolean | null;
  recallText: string;
}> {
  const agent = await ReactiveAgents.create()
    .withName("probe-session")
    .withProvider("ollama")
    .withModel(MODEL)
    .withReactiveIntelligence({ telemetry: false })
    .withReasoning({ maxIterations: 1, defaultStrategy: "reactive" })
    .build();
  const session = agent.session();
  const ticks: TickMetric[] = [];
  try {
    for (let tick = 1; tick <= TICKS; tick++) {
      const prompt = `${perceive(tick)}\n\n${INSTRUCTION}`;
      const t0 = Date.now();
      try {
        const reply = await session.chat(prompt);
        const ms = Date.now() - t0;
        const obj = extractJson(reply.message);
        const { valid, actionType } = validity(obj);
        ticks.push({
          tick,
          mode: "session",
          valid,
          actionType,
          tokens: reply.tokens ?? 0,
          ms,
          leakHits: leaks(reply.message),
          raw: reply.message.slice(0, 400),
        });
      } catch (err) {
        ticks.push({
          tick,
          mode: "session",
          valid: false,
          tokens: 0,
          ms: Date.now() - t0,
          leakHits: [],
          error: (err as Error).message,
        });
      }
    }

    let recall: boolean | null = null;
    let recallText = "";
    try {
      const r = await session.chat(
        "In one short sentence, what did you observe on your very first tick?",
      );
      recallText = r.message;
      recall = recallMentionsBerries(r.message);
    } catch {
      recall = null;
    }
    return { ticks, recall, recallText };
  } finally {
    await session.end();
    await agent.dispose();
  }
}

function summarize(name: string, ticks: TickMetric[]): string {
  const ok = ticks.filter((t) => t.valid).length;
  const totalTokens = ticks.reduce((a, t) => a + t.tokens, 0);
  const totalMs = ticks.reduce((a, t) => a + t.ms, 0);
  const leak = ticks.flatMap((t) => t.leakHits);
  const errs = ticks.filter((t) => t.error).length;
  return [
    `### ${name}`,
    `- schema-valid:     ${ok}/${ticks.length}`,
    `- avg tokens/tick:  ${(totalTokens / Math.max(ticks.length, 1)).toFixed(0)}`,
    `- avg latency/tick: ${(totalMs / Math.max(ticks.length, 1)).toFixed(0)}ms`,
    `- canary leaks:     ${leak.length ? leak.join(", ") : "none"}`,
    `- errors:           ${errs}`,
    "",
    "| tick | valid | action | tokens | ms | leak |",
    "|---|---|---|---|---|---|",
    ...ticks.map(
      (t) =>
        `| ${t.tick} | ${t.valid ? "yes" : "NO"} | ${t.actionType ?? (t.error ? "err" : "-")} | ${t.tokens} | ${t.ms} | ${t.leakHits.join(",") || "-"} |`,
    ),
    "",
    ...ticks
      .filter((t) => !t.valid)
      .flatMap((t) => [
        `> invalid tick ${t.tick} raw: \`${(t.raw ?? t.error ?? "").replace(/\n/g, " ").slice(0, 300)}\``,
        "",
      ]),
    "",
  ].join("\n");
}

async function main() {
  console.log(`\n=== p-island-decision probe ===`);
  console.log(`model=${MODEL} ticks=${TICKS}\n`);

  const results: string[] = [];
  const verdicts: string[] = [];

  // Smoke: can the local model emit valid structured output at all?
  console.log("A) stateless structured ...");
  const a = await runStructured(false);
  results.push(summarize("A) stateless structured (.withOutputSchema + run)", a.ticks));
  verdicts.push(`A first-tick recall: ${a.recall}  ||  ${a.recallText.slice(0, 120).replace(/\n/g, " ")}`);

  console.log("B) persistent session ...");
  const b = await runSession();
  results.push(summarize("B) persistent session (agent.session + chat)", b.ticks));
  verdicts.push(`B first-tick recall: ${b.recall}  ||  ${b.recallText.slice(0, 120).replace(/\n/g, " ")}`);

  console.log("C) memory-backed structured ...");
  const c = await runStructured(true);
  results.push(summarize("C) memory-backed structured (.withMemory + run)", c.ticks));
  verdicts.push(`C first-tick recall: ${c.recall}  ||  ${c.recallText.slice(0, 120).replace(/\n/g, " ")}`);

  const md = [
    `# p-island-decision - probe results`,
    "",
    `- model: \`${MODEL}\``,
    `- ticks/variant: ${TICKS}`,
    `- canaries: ${HIDDEN_CANARIES.join(", ")}`,
    "",
    ...results,
    "## continuity / recall",
    ...verdicts.map((v) => `- ${v}`),
    "",
  ].join("\n");

  console.log("\n" + md);
  await writeFile(fileURLToPath(new URL("./RESULTS-p-island-decision.md", import.meta.url)), md);
}

if (import.meta.main) {
  await main();
}
