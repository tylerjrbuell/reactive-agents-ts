/**
 * Calibration probe runner — measures per-model behavior via targeted Ollama HTTP probes.
 *
 * Runs 5 probes (steering compliance, parallel batching, recall behavior, system prompt
 * decay, compression threshold) and produces a ModelCalibration JSON.
 *
 * Designed to be: free (local models), deterministic (temp=0), minimal deps.
 * One run takes about 30-120s per model (v3 attention + size probes are long).
 * Large models: `--probes` runs a subset and `--probe-timeout` caps each probe;
 * `--commit` merges what was measured into the existing JSON
 * (calibration-merge.ts), so a model can be calibrated across invocations.
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
import {
  PROBE_FIELDS,
  isProbeField,
  mergeProbeCalibration,
  type MeasuredCalibration,
  type ProbeField,
  type ProbeResults,
} from "./calibration-merge.js";

// Shared resolution (OLLAMA_ENDPOINT → OLLAMA_HOST → OLLAMA_BASE → localhost)
// so calibrating a model and running it can never disagree about the endpoint.
const OLLAMA_BASE = resolveOllamaEndpoint();
// v3 (2026-11-10): graded steering, per-turn attention, distractor result-size
// ladder to 8000 (calibration-scoring.ts). v2 scorers could not tell models apart.
const PROBE_VERSION = 3;

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

/**
 * Lazy-load the Ollama SDK — same pattern as local.ts provider. With a signal,
 * every request carries it, so a per-probe timeout cancels the HTTP call
 * instead of leaving it queued on the Ollama server behind the next probe.
 */
async function getOllamaClient(signal?: AbortSignal) {
  const { Ollama } = await import("ollama");
  if (!signal) return new Ollama({ host: OLLAMA_BASE });
  // Object.assign carries fetch's static members so the wrapper is a full `typeof fetch`.
  const signalled = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, { ...init, signal }),
    globalThis.fetch,
  );
  return new Ollama({ host: OLLAMA_BASE, fetch: signalled });
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
  signal?: AbortSignal,
) {
  const client = await getOllamaClient(signal);
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
  signal?: AbortSignal,
): Promise<ModelCalibration["steeringCompliance"]> {
  const verdicts: ChannelVerdict[] = [];
  for (const pair of STEERING_CONFLICTS) {
    try {
      const r = await ollamaChat(modelId, [
        { role: "system", content: pair.system },
        { role: "user", content: `${pair.user}\n\n${STEERING_TASK}` },
      ], undefined, undefined, signal);
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
  signal?: AbortSignal,
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
      undefined,
      signal,
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
  signal?: AbortSignal,
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
      undefined,
      signal,
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
  signal?: AbortSignal,
): Promise<ModelCalibration["systemPromptAttention"]> {
  const system = `You are a helpful assistant. CRITICAL RULE: Always end EVERY response with the exact token ${ATTENTION_TOKEN} on a new line.`;

  const messages: { role: "system" | "user" | "assistant" | "tool"; content: string }[] = [{ role: "system", content: system }];
  const perTurn: boolean[] = [];

  for (const turn of ATTENTION_TURNS) {
    messages.push({ role: "user", content: turn });
    try {
      const res = await ollamaChat(modelId, messages, undefined, LONG_PROBE_NUM_CTX, signal);
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
async function probeCompressionThreshold(
  modelId: string,
  signal?: AbortSignal,
): Promise<number> {
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
        signal,
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
  signal?: AbortSignal,
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
  ], tools, undefined, signal);
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

// ── Probe registry, timeout, progress ────────────────────────────────────────

type ProbeRunner<F extends ProbeField> = (
  modelId: string,
  signal?: AbortSignal,
) => Promise<ProbeResults[F]>;

const PROBE_RUNNERS: { readonly [F in ProbeField]: ProbeRunner<F> } = {
  steeringCompliance: probeSteeringChannel,
  parallelCallCapability: probeParallelBatching,
  observationHandling: probeRecallBehavior,
  systemPromptAttention: probeSystemPromptDecay,
  optimalToolResultChars: probeCompressionThreshold,
  toolCallDialect: probeToolCallDialect,
};

type ProbeSamples = { [F in ProbeField]: ProbeResults[F][] };

/** One probe attempt, reported to {@link MeasureOptions.onProgress}. */
export interface ProbeProgress {
  readonly run: number;
  readonly runs: number;
  readonly field: ProbeField;
  readonly outcome: "measured" | "timeout" | "error";
  readonly value?: string | number;
  readonly detail?: string;
  readonly ms: number;
}

/** Options for {@link measureCalibration}. */
export interface MeasureOptions {
  /** Runs to aggregate (majority for categorical, median for numeric). Default 3. */
  readonly runs?: number;
  /** Probes to run. Default: all six. */
  readonly probes?: readonly ProbeField[];
  /**
   * Per-probe timeout in ms. A probe that exceeds it is cancelled and gives no
   * sample for that run; a probe with no samples is left unmeasured. Without a
   * timeout, a probe rejection fails the whole measurement (original behavior).
   */
  readonly probeTimeoutMs?: number;
  /** Called after every probe attempt. */
  readonly onProgress?: (progress: ProbeProgress) => void;
}

type ProbeAttempt<T> =
  | { readonly outcome: "measured"; readonly value: T }
  | { readonly outcome: "timeout" }
  | { readonly outcome: "error"; readonly detail: string };

async function attemptProbe<T>(
  run: (signal?: AbortSignal) => Promise<T>,
  timeoutMs: number | undefined,
): Promise<ProbeAttempt<T>> {
  if (timeoutMs === undefined) return { outcome: "measured", value: await run() };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve("timeout");
    }, timeoutMs);
  });
  const probe = run(controller.signal).then((value) => ({ value }));
  // The race may settle on the timer first; keep a late rejection handled.
  probe.catch(() => undefined);
  try {
    const raced = await Promise.race([probe, timedOut]);
    // Probes swallow request failures into a fallback verdict, so an aborted
    // probe can still resolve: the abort, not the value, decides.
    if (raced === "timeout" || controller.signal.aborted) return { outcome: "timeout" };
    return { outcome: "measured", value: raced.value };
  } catch (err) {
    if (controller.signal.aborted) return { outcome: "timeout" };
    return { outcome: "error", detail: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function sampleProbe<F extends ProbeField>(
  field: F,
  modelId: string,
  samples: ProbeSamples,
  run: number,
  options: MeasureOptions & { readonly runs: number },
): Promise<void> {
  const started = Date.now();
  const runner: ProbeRunner<F> = PROBE_RUNNERS[field];
  const attempt = await attemptProbe((signal) => runner(modelId, signal), options.probeTimeoutMs);
  if (attempt.outcome === "measured") samples[field].push(attempt.value);
  options.onProgress?.({
    run,
    runs: options.runs,
    field,
    outcome: attempt.outcome,
    ...(attempt.outcome === "measured" ? { value: attempt.value } : {}),
    ...(attempt.outcome === "error" ? { detail: attempt.detail } : {}),
    ms: Date.now() - started,
  });
}

// Sequential on purpose: Ollama serves one model's requests from a queue, so
// concurrent probes made a short probe wait behind long thinking-model ones
// until the client's fetch timed out (qwen3:4b, v3, 2026-11-10).
async function collectSamples(
  modelId: string,
  options: MeasureOptions & { readonly runs: number },
): Promise<ProbeSamples> {
  const samples: ProbeSamples = {
    steeringCompliance: [],
    parallelCallCapability: [],
    observationHandling: [],
    systemPromptAttention: [],
    optimalToolResultChars: [],
    toolCallDialect: [],
  };
  const probes = options.probes ?? PROBE_FIELDS;
  for (let run = 1; run <= options.runs; run++) {
    for (const field of PROBE_FIELDS) {
      if (probes.includes(field)) await sampleProbe(field, modelId, samples, run, options);
    }
  }
  return samples;
}

function aggregateSamples(samples: ProbeSamples): Partial<ProbeResults> {
  const out: Partial<ProbeResults> = {};
  if (samples.steeringCompliance.length > 0) out.steeringCompliance = majority(samples.steeringCompliance);
  if (samples.parallelCallCapability.length > 0) out.parallelCallCapability = majority(samples.parallelCallCapability);
  if (samples.observationHandling.length > 0) out.observationHandling = majority(samples.observationHandling);
  if (samples.systemPromptAttention.length > 0) out.systemPromptAttention = majority(samples.systemPromptAttention);
  if (samples.optimalToolResultChars.length > 0) out.optimalToolResultChars = median(samples.optimalToolResultChars);
  if (samples.toolCallDialect.length > 0) out.toolCallDialect = majority(samples.toolCallDialect);
  return out;
}

/**
 * Measure a model with a chosen probe subset, a per-probe timeout and progress
 * reporting. `fields` holds only probes that produced at least one sample, so
 * the result can be merged into an existing calibration across invocations
 * (see {@link commitCalibration}).
 */
export async function measureCalibration(
  modelId: string,
  options: MeasureOptions = {},
): Promise<MeasuredCalibration> {
  const runs = options.runs ?? 3;
  const samples = await collectSamples(modelId, { ...options, runs });
  return {
    modelId,
    calibratedAt: new Date().toISOString(),
    probeVersion: PROBE_VERSION,
    runsAveraged: runs,
    fields: aggregateSamples(samples),
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
  // No timeout: every probe yields a sample per run or the call rejects.
  const samples = await collectSamples(modelId, { runs });
  return {
    modelId,
    calibratedAt: new Date().toISOString(),
    probeVersion: PROBE_VERSION,
    runsAveraged: runs,
    steeringCompliance: majority(samples.steeringCompliance),
    parallelCallCapability: majority(samples.parallelCallCapability),
    observationHandling: majority(samples.observationHandling),
    systemPromptAttention: majority(samples.systemPromptAttention),
    optimalToolResultChars: median(samples.optimalToolResultChars),
    toolCallDialect: majority(samples.toolCallDialect),
  };
}

// ── Commit (merge into the calibration JSON) ─────────────────────────────────

/** Outcome of {@link commitCalibration}. */
export type CommitOutcome =
  | {
      readonly ok: true;
      readonly path: string;
      readonly stamped: boolean;
      readonly kept: readonly ProbeField[];
    }
  | { readonly ok: false; readonly path: string; readonly reason: string };

/**
 * Merge a measurement into `<dir>/<normalized id>.json` and write it.
 * Probe fields replace; actOrAnswer, classifierReliability, alias maps and any
 * other field the probes do not measure are kept (calibration v3 ablation,
 * 2026-11-11: overwriting dropped the act-or-answer prior). `dir` defaults to
 * this module's `calibrations/` directory.
 */
export async function commitCalibration(
  measured: MeasuredCalibration,
  dir?: string,
): Promise<CommitOutcome> {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { normalizeModelId } = await import("./calibration.js");
  const outDir = dir ?? path.join(path.dirname(new URL(import.meta.url).pathname), "calibrations");
  const outPath = path.join(outDir, `${normalizeModelId(measured.modelId)}.json`);

  let existing: Record<string, unknown> | undefined;
  if (fs.existsSync(outPath)) {
    try {
      const parsed: unknown = JSON.parse(fs.readFileSync(outPath, "utf8"));
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ok: false, path: outPath, reason: "existing calibration is not a JSON object" };
      }
      existing = { ...parsed };
    } catch (err) {
      return { ok: false, path: outPath, reason: `existing calibration unreadable: ${String(err)}` };
    }
  }

  const merged = mergeProbeCalibration(existing, measured);
  if (!merged.ok) return { ok: false, path: outPath, reason: merged.reason };
  fs.writeFileSync(outPath, `${JSON.stringify(merged.calibration, null, 2)}\n`);
  return { ok: true, path: outPath, stamped: merged.stamped, kept: merged.kept };
}

// ── CLI Entry ────────────────────────────────────────────────────────────────

const USAGE =
  "Usage: bun calibration-runner.ts --model <modelId> [--runs N] [--probes <field,...>] [--probe-timeout <seconds>] [--commit]\n" +
  `  probe fields: ${PROBE_FIELDS.join(", ")}`;

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const modelId = flag("--model");
  const commit = args.includes("--commit");

  if (modelId === undefined) {
    console.error(USAGE);
    process.exit(1);
  }

  const runsArg = flag("--runs");
  const runs = runsArg !== undefined ? parseInt(runsArg) : 3;
  const timeoutArg = flag("--probe-timeout");
  const probeTimeoutMs = timeoutArg !== undefined ? Number(timeoutArg) * 1000 : undefined;
  const probesArg = flag("--probes");
  const requested = probesArg?.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  const unknown = requested?.filter((p) => !isProbeField(p)) ?? [];
  if (
    !Number.isInteger(runs) || runs < 1 ||
    (probeTimeoutMs !== undefined && !(probeTimeoutMs > 0)) ||
    unknown.length > 0
  ) {
    if (unknown.length > 0) console.error(`Unknown probe field(s): ${unknown.join(", ")}`);
    console.error(USAGE);
    process.exit(1);
  }
  const probes = requested?.filter(isProbeField);

  // Progress goes to stderr so stdout stays the parseable calibration JSON.
  console.error(
    `Running calibration probes for ${modelId} (${runs} runs` +
      `${probes ? `, probes: ${probes.join(",")}` : ""}` +
      `${probeTimeoutMs !== undefined ? `, per-probe timeout ${probeTimeoutMs / 1000}s` : ""})...`,
  );
  const measured = await measureCalibration(modelId, {
    runs,
    ...(probes ? { probes } : {}),
    ...(probeTimeoutMs !== undefined ? { probeTimeoutMs } : {}),
    onProgress: (p) => {
      const result =
        p.outcome === "measured" ? String(p.value) : p.outcome === "error" ? `error: ${p.detail ?? ""}` : "timeout";
      console.error(`  [run ${p.run}/${p.runs}] ${p.field}: ${result} (${(p.ms / 1000).toFixed(1)}s)`);
    },
  });
  const { fields, ...meta } = measured;
  console.log(JSON.stringify({ ...meta, ...fields }, null, 2));

  const unmeasured = PROBE_FIELDS.filter((f) => fields[f] === undefined);
  if (unmeasured.length > 0) console.error(`Unmeasured: ${unmeasured.join(", ")}`);

  if (commit) {
    const outcome = await commitCalibration(measured);
    if (!outcome.ok) {
      console.error(`\nNot written (${outcome.path}): ${outcome.reason}`);
      process.exit(1);
    }
    console.error(`\nMerged calibration into: ${outcome.path}`);
    if (!outcome.stamped) {
      console.error(
        `Partial measurement: probeVersion/calibratedAt/runsAveraged kept; fields not re-measured: ${outcome.kept.join(", ")}`,
      );
    }
  }
}

if (isMain(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
