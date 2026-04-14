/**
 * Calibration probe runner — measures per-model behavior via targeted Ollama HTTP probes.
 *
 * Runs 5 probes (steering compliance, parallel batching, recall behavior, system prompt
 * decay, compression threshold) and produces a ModelCalibration JSON.
 *
 * Designed to be: free (local models), fast (<30s), deterministic (temp=0), minimal deps.
 */
import type { ModelCalibration } from "./calibration.js";

const OLLAMA_BASE = process.env.OLLAMA_BASE ?? "http://localhost:11434";
const PROBE_VERSION = 1;

// ── Probe Result Types ────────────────────────────────────────────────────────

interface ProbeResults {
  steeringCompliance: ModelCalibration["steeringCompliance"];
  parallelCallCapability: ModelCalibration["parallelCallCapability"];
  observationHandling: ModelCalibration["observationHandling"];
  systemPromptAttention: ModelCalibration["systemPromptAttention"];
  optimalToolResultChars: number;
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

async function ollamaChat(
  modelId: string,
  messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[],
  tools?: readonly unknown[],
) {
  const client = await getOllamaClient();
  return client.chat({
    model: modelId,
    messages,
    ...(tools ? { tools: tools as any } : {}),
    options: { temperature: 0 },
    stream: false,
  });
}

// ── Probe 1: Steering Channel ─────────────────────────────────────────────────

async function probeSteeringChannel(
  modelId: string,
): Promise<ModelCalibration["steeringCompliance"]> {
  const instruction =
    "Respond with ONLY the single word BLUE. No other text, no punctuation.";

  const sysOnly = await ollamaChat(modelId, [
    { role: "system", content: instruction },
    { role: "user", content: "Go." },
  ]);
  const userOnly = await ollamaChat(modelId, [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: instruction },
  ]);
  const hybrid = await ollamaChat(modelId, [
    { role: "system", content: instruction },
    { role: "user", content: instruction },
  ]);

  const check = (r: Awaited<ReturnType<typeof ollamaChat>>) =>
    (r.message?.content ?? "").trim().toUpperCase() === "BLUE";

  const sysOk = check(sysOnly);
  const userOk = check(userOnly);
  const hybridOk = check(hybrid);

  if (hybridOk && !sysOk && !userOk) return "hybrid";
  if (sysOk && !userOk) return "system-prompt";
  if (userOk && !sysOk) return "user-message";
  return "hybrid";
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

async function probeSystemPromptDecay(
  modelId: string,
): Promise<ModelCalibration["systemPromptAttention"]> {
  const system =
    "You are a helpful assistant. CRITICAL RULE: Always end EVERY response with the exact token [VERIFIED] on a new line.";

  const messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[] = [{ role: "system", content: system }];

  for (let turn = 1; turn <= 5; turn++) {
    messages.push({ role: "user", content: `Turn ${turn}: Count to ${turn}.` });
    try {
      const res = await ollamaChat(modelId, messages);
      const reply = res.message?.content ?? "";
      messages.push({ role: "assistant", content: reply });

      if (turn === 5) {
        return reply.trim().endsWith("[VERIFIED]") ? "strong" : "weak";
      }
    } catch {
      return "weak";
    }
  }
  return "moderate";
}

// ── Probe 5: Compression Threshold ────────────────────────────────────────────

async function probeCompressionThreshold(modelId: string): Promise<number> {
  const fact = "The final score was 42.";
  const lengths = [500, 1000, 1500, 2000];
  let maxWorking = 500;

  for (const length of lengths) {
    const padding = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(
      Math.ceil((length - fact.length) / 60),
    );
    const content = `${padding}${fact}${padding}`.slice(0, length);

    try {
      const res = await ollamaChat(modelId, [
        {
          role: "system",
          content: "Extract the factual answer from the content below.",
        },
        {
          role: "user",
          content: `Content:\n${content}\n\nQuestion: What was the final score?`,
        },
      ]);

      const reply = res.message?.content ?? "";
      if (/\b42\b/.test(reply)) {
        maxWorking = length;
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  return maxWorking;
}

// ── Main Runner ───────────────────────────────────────────────────────────────

async function runProbes(modelId: string): Promise<ProbeResults> {
  const [steering, parallel, recall, attention, chars] = await Promise.all([
    probeSteeringChannel(modelId),
    probeParallelBatching(modelId),
    probeRecallBehavior(modelId),
    probeSystemPromptDecay(modelId),
    probeCompressionThreshold(modelId),
  ]);

  return {
    steeringCompliance: steering,
    parallelCallCapability: parallel,
    observationHandling: recall,
    systemPromptAttention: attention,
    optimalToolResultChars: chars,
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

if (import.meta.main) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
