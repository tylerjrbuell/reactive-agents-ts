/**
 * Calibration probe runner — measures per-model behavior via targeted Ollama HTTP probes.
 *
 * Runs 5 probes (steering compliance, parallel batching, recall behavior, system prompt
 * decay, compression threshold) and produces a ModelCalibration JSON.
 *
 * Designed to be: free (local models), deterministic (temp=0), minimal deps.
 * One run takes about 30-120s per model (v3 attention + size probes are long).
 */
import type { ModelCalibration } from "./calibration.js";
import { isMain } from "@reactive-agents/runtime-shim";
import { resolveOllamaEndpoint } from "./ollama-endpoint.js";
import type { Tool as OllamaTool } from "ollama";
import {
  ATTENTION_TOKEN,
  ATTENTION_TURNS,
  RESULT_QUESTION,
  RESULT_SIZE_LADDER,
  STEERING_CONFLICTS,
  STEERING_TASK,
  answersResultQuestion,
  buildResultPayload,
  keepsAttentionRule,
  scoreAttention,
  scoreResultSize,
  scoreSteering,
  type ChannelVerdict,
} from "./calibration-scoring.js";

// Shared resolution (OLLAMA_ENDPOINT → OLLAMA_HOST → OLLAMA_BASE → localhost)
// so calibrating a model and running it can never disagree about the endpoint.
const OLLAMA_BASE = resolveOllamaEndpoint();
// v3 (2026-11-10): graded steering, per-turn attention, distractor result-size
// ladder to 8000 (calibration-scoring.ts). v2 scorers could not tell models apart.
const PROBE_VERSION = 3;

// ── Probe Result Types ────────────────────────────────────────────────────────

interface ProbeResults {
  steeringCompliance: ModelCalibration["steeringCompliance"];
  parallelCallCapability: ModelCalibration["parallelCallCapability"];
  observationHandling: ModelCalibration["observationHandling"];
  systemPromptAttention: ModelCalibration["systemPromptAttention"];
  optimalToolResultChars: number;
  toolCallDialect: ModelCalibration["toolCallDialect"];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function majority<T extends string>(values: readonly T[]): T {
  if (values.length === 0) throw new Error("majority: empty input");
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T = values[0]!;
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median: empty input");
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) return (sorted[mid - 1]! + sorted[mid]!) / 2;
  return sorted[mid]!;
}

// ── Ollama HTTP Client ────────────────────────────────────────────────────────

/** Lazy-load the Ollama SDK — same pattern as local.ts provider. */
async function getOllamaClient() {
  const { Ollama } = await import("ollama");
  return new Ollama({ host: OLLAMA_BASE });
}

// Fixed context for the long probes (attention conversation, result-size
// ladder) so the measurement is the model's, not the server's default num_ctx
// (8000 chars of records is ~3k tokens).
const LONG_PROBE_NUM_CTX = 8192;

async function ollamaChat(
  modelId: string,
  messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[],
  tools?: readonly OllamaTool[],
  numCtx?: number,
) {
  const client = await getOllamaClient();
  return client.chat({
    model: modelId,
    messages,
    ...(tools ? { tools: [...tools] } : {}),
    options: { temperature: 0, ...(numCtx !== undefined ? { num_ctx: numCtx } : {}) },
    stream: false,
  });
}

// ── Probe 1: Steering Channel ─────────────────────────────────────────────────

// v3: channel-conflict pairs (calibration-scoring.ts). The v2 single-word rule
// passed in every channel, so every model read "hybrid".
async function probeSteeringChannel(
  modelId: string,
): Promise<ModelCalibration["steeringCompliance"]> {
  const verdicts: ChannelVerdict[] = [];
  for (const pair of STEERING_CONFLICTS) {
    try {
      const r = await ollamaChat(modelId, [
        { role: "system", content: pair.system },
        { role: "user", content: `${pair.user}\n\n${STEERING_TASK}` },
      ]);
      verdicts.push(pair.judge(r.message?.content ?? ""));
    } catch {
      verdicts.push("none");
    }
  }
  return scoreSteering(verdicts);
}

// ── Probe 2: Parallel Batching ────────────────────────────────────────────────

async function probeParallelBatching(
  modelId: string,
): Promise<ModelCalibration["parallelCallCapability"]> {
  const tools = [
    {
      type: "function",
      function: {
        name: "get_a",
        description: "Returns A",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "get_b",
        description: "Returns B",
        parameters: { type: "object", properties: {} },
      },
    },
  ];

  try {
    const res = await ollamaChat(
      modelId,
      [
        {
          role: "system",
          content:
            "You have tools get_a and get_b. When asked to get both, call BOTH in the same response.",
        },
        { role: "user", content: "Get A and B." },
      ],
      tools,
    );

    const calls = res.message?.tool_calls ?? [];
    if (calls.length >= 2) return "reliable";
    if (calls.length === 1) return "partial";
    return "sequential-only";
  } catch {
    return "sequential-only";
  }
}

// ── Probe 3: Recall Behavior ──────────────────────────────────────────────────

async function probeRecallBehavior(
  modelId: string,
): Promise<ModelCalibration["observationHandling"]> {
  const tools = [
    {
      type: "function",
      function: {
        name: "recall",
        description: "Retrieve the full text of a previously stored tool result",
        parameters: {
          type: "object",
          properties: { key: { type: "string" } },
          required: ["key"],
        },
      },
    },
  ];

  try {
    const res = await ollamaChat(
      modelId,
      [
        {
          role: "system",
          content: "You have a 'recall' tool to retrieve stored tool results by key.",
        },
        {
          role: "user",
          content:
            "The web-search result is a compressed preview [STORED: _tool_result_1]. Use recall('_tool_result_1') to get the full text before answering. What is the exact price of XRP?",
        },
      ],
      tools,
    );

    const calls = res.message?.tool_calls ?? [];
    if (calls.length > 0 && calls.some((c) => c.function?.name === "recall")) {
      return "uses-recall";
    }
    const content = res.message?.content ?? "";
    if (/\$\d+/.test(content)) return "hallucinate-risk";
    return "needs-inline-facts";
  } catch {
    return "needs-inline-facts";
  }
}

// ── Probe 4: System Prompt Decay ──────────────────────────────────────────────

// v3: every turn is scored (v2 checked only turn 5, so "moderate" was
// unreachable), and later turns ask for terse replies that pull against the
// rule. A failed call counts as a dropped rule for that turn and ends the probe.
async function probeSystemPromptDecay(
  modelId: string,
): Promise<ModelCalibration["systemPromptAttention"]> {
  const system = `You are a helpful assistant. CRITICAL RULE: Always end EVERY response with the exact token ${ATTENTION_TOKEN} on a new line.`;

  const messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[] = [{ role: "system", content: system }];
  const perTurn: boolean[] = [];

  for (const turn of ATTENTION_TURNS) {
    messages.push({ role: "user", content: turn });
    try {
      const res = await ollamaChat(modelId, messages, undefined, LONG_PROBE_NUM_CTX);
      const reply = res.message?.content ?? "";
      messages.push({ role: "assistant", content: reply });
      perTurn.push(keepsAttentionRule(reply));
    } catch {
      perTurn.push(false);
      break;
    }
  }
  return scoreAttention(perTurn.length < ATTENTION_TURNS.length
    ? [...perTurn, ...Array<boolean>(ATTENTION_TURNS.length - perTurn.length).fill(false)]
    : perTurn);
}

// ── Probe 5: Compression Threshold ────────────────────────────────────────────

// v3: a two-record aggregation over distractor game records instead of one
// fact in lorem-ipsum padding, on a ladder up to 8000 chars (v2 stopped at
// 2000, so every model read 2000).
async function probeCompressionThreshold(modelId: string): Promise<number> {
  const passed: Array<readonly [number, boolean]> = [];

  for (const size of RESULT_SIZE_LADDER) {
    try {
      const res = await ollamaChat(
        modelId,
        [
          { role: "system", content: "Answer from the tool result below." },
          { role: "user", content: `Tool result:\n${buildResultPayload(size)}\nQuestion: ${RESULT_QUESTION}` },
        ],
        undefined,
        LONG_PROBE_NUM_CTX,
      );
      const ok = answersResultQuestion(res.message?.content ?? "");
      passed.push([size, ok]);
      if (!ok) break;
    } catch {
      passed.push([size, false]);
      break;
    }
  }

  return scoreResultSize(passed);
}

// ── Main Runner ───────────────────────────────────────────────────────────────

// ── Probe 6: Tool-Calling Dialect (GH #243) ──────────────────────────────────
//
// The MEASUREMENT the runner never had: v1 shipped a hardcoded
// `toolCallDialect: "none"` stub into every prior, and the floor-less W2a
// derivation trusted it — bricking qwen3:4b (GH #243). This probe answers the
// behavioral question: when tools are on the wire, does the model emit a
// parseable native tool_calls block?
//
// Budget discipline (W1 lesson): NO num_predict cap here — thinking-class
// models (qwen3) burn budget inside

/**
 * Probe the tool-calling dialect BEHAVIORALLY (v2 of the probe suite).
 * One required-tool chat call; the verdict is native-fc when the response
 * carries a parseable `message.tool_calls` block naming a known tool, else
 * none. `text-parse` is deliberately NOT detected here — recognizing markup
 * in content is the Wave-3 parser seam's job, not this probe's.
 *
 * @internal exported for the prior-refresh script (GH #243 audit).
 */
export async function probeToolCallDialect(
  modelId: string,
): Promise<ModelCalibration["toolCallDialect"]> {
  const tools: OllamaTool[] = [
    {
      type: "function",
      function: {
        name: "get_weather",
        description: "Get current weather for a city",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string", description: "City name" },
          },
          required: ["city"],
        },
      },
    },
  ];
  const res = await ollamaChat(modelId, [
    {
      role: "user",
      content:
        "What is the weather in Paris right now? You MUST call the get_weather tool.",
    },
  ], tools);
  const calls = (res.message as {
    tool_calls?: Array<{ function?: { name?: string } }>;
  } | undefined)?.tool_calls;
  const emitted =
    Array.isArray(calls) &&
    calls.length > 0 &&
    typeof calls[0]?.function?.name === "string" &&
    calls[0].function.name.length > 0;
  return emitted ? "native-fc" : "none";
}

// Sequential on purpose: Ollama serves one model's requests from a queue, so
// concurrent probes made a short probe wait behind long thinking-model ones
// until the client's fetch timed out (qwen3:4b, v3, 2026-11-10).
async function runProbes(modelId: string): Promise<ProbeResults> {
  const steering = await probeSteeringChannel(modelId);
  const parallel = await probeParallelBatching(modelId);
  const recall = await probeRecallBehavior(modelId);
  const attention = await probeSystemPromptDecay(modelId);
  const chars = await probeCompressionThreshold(modelId);
  const dialect = await probeToolCallDialect(modelId);

  return {
    steeringCompliance: steering,
    parallelCallCapability: parallel,
    observationHandling: recall,
    systemPromptAttention: attention,
    optimalToolResultChars: chars,
    toolCallDialect: dialect,
  };
}

/**
 * Run the full calibration probe suite against a model.
 * Averages N runs for stability (majority vote for categorical, median for numeric).
 */
export async function runCalibrationProbes(
  modelId: string,
  runs: number = 3,
): Promise<ModelCalibration> {
  const results: ProbeResults[] = [];

  for (let i = 0; i < runs; i++) {
    results.push(await runProbes(modelId));
  }

  return {
    modelId,
    calibratedAt: new Date().toISOString(),
    probeVersion: PROBE_VERSION,
    runsAveraged: runs,
    steeringCompliance: majority(results.map((r) => r.steeringCompliance)),
    parallelCallCapability: majority(results.map((r) => r.parallelCallCapability)),
    observationHandling: majority(results.map((r) => r.observationHandling)),
    systemPromptAttention: majority(results.map((r) => r.systemPromptAttention)),
    optimalToolResultChars: median(results.map((r) => r.optimalToolResultChars)),
    toolCallDialect: majority(results.map((r) => r.toolCallDialect)),
  };
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const modelIdx = args.indexOf("--model");
  const runsIdx = args.indexOf("--runs");
  const commit = args.includes("--commit");

  if (modelIdx < 0) {
    console.error(
      "Usage: bun calibration-runner.ts --model <modelId> [--runs N] [--commit]",
    );
    process.exit(1);
  }

  const modelId = args[modelIdx + 1]!;
  const runs = runsIdx >= 0 ? parseInt(args[runsIdx + 1]!) : 3;

  console.log(`Running calibration probes for ${modelId} (${runs} runs)...`);
  const cal = await runCalibrationProbes(modelId, runs);
  console.log(JSON.stringify(cal, null, 2));

  if (commit) {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const { normalizeModelId } = await import("./calibration.js");
    const filename = `${normalizeModelId(modelId)}.json`;
    const outPath = path.join(
      path.dirname(new URL(import.meta.url).pathname),
      "calibrations",
      filename,
    );
    fs.writeFileSync(outPath, JSON.stringify(cal, null, 2));
    console.log(`\nWrote calibration to: ${outPath}`);
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
