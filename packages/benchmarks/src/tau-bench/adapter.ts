/**
 * τ-bench adapter — knows RA, and nothing about upstream's file format.
 *
 * `loader.ts` owns the upstream schema; this file owns the RA builder wiring and
 * the drive loop. Neither should have to change when the other's world moves.
 *
 *   bun run packages/benchmarks/src/tau-bench/adapter.ts \
 *     --domain retail --tasks 1 --k 3 --model claude-haiku-4-5-20251001 \
 *     --output wiki/Research/Harness-Reports/<date>-tau-bench-smoke.json
 *
 * ── WHAT IS AND IS NOT WIRED ────────────────────────────────────────────────
 * Vendored and real: the 165 TEST-split tasks, both domain policies, and all 30
 * tool declarations, copied verbatim from upstream at a pinned commit.
 *
 * NOT here: an executable environment. Upstream's `tau_bench/envs/base.py` holds
 * the mutable domain database, the tool bodies that mutate it, the LLM-simulated
 * user, and — critically — the reward function, which compares the final database
 * hash against the hash produced by replaying the task's ground-truth actions.
 * That reward is the part that makes a τ-bench number mean anything, and porting
 * it to TypeScript would put THIS repo in charge of scoring itself on a bench it
 * cites as third-party. The `TauBenchEnvironment` port below deliberately mirrors
 * upstream's `Env` API (`reset` / `step(Action)` / `calculateReward`) so the
 * intended implementation is a bridge to upstream's own Python env rather than a
 * reimplementation of it. Until such an implementation is passed in, every entry
 * point here throws rather than scoring anything.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Effect, Schema } from "effect";
import {
  ReactiveAgents,
  ProviderNameSchema,
  type ChatMessage,
  type ProviderName,
} from "@reactive-agents/runtime";
import type { ToolDefinition, ToolParameter } from "@reactive-agents/tools";
import {
  loadDomain,
  isTauBenchDomain,
  TAU_BENCH_PROVENANCE,
  type TauBenchDomain,
  type TauBenchDomainSpec,
  type TauBenchAction,
  type TauBenchJsonSchema,
  type TauBenchTask,
  type TauBenchToolSchema,
} from "./loader.js";
import { passAtK } from "./pass-k.js";

/** Upstream's sentinel action name for "reply to the user" (`types.py`). */
export const RESPOND_ACTION_NAME = "respond";
/** Upstream's default cap in `run.py`. */
export const DEFAULT_MAX_TURNS = 30;

export interface TauBenchEnvStep {
  /** Tool result, or the simulated user's next utterance after a `respond`. */
  readonly observation: string;
  readonly reward: number;
  readonly done: boolean;
}

/**
 * The port to a real τ-bench environment. Mirrors upstream `Env` on purpose —
 * a faithful bridge should be a thin call-through, not a translation layer.
 */
export interface TauBenchEnvironment {
  /** Reset to the task's initial state; returns the simulated user's opener. */
  readonly reset: () => Promise<string>;
  /** Apply a tool action, or `{ name: "respond", kwargs: { content } }`. */
  readonly step: (action: TauBenchAction) => Promise<TauBenchEnvStep>;
  /** Upstream `calc_reward()` — used when the turn cap is hit before `done`. */
  readonly calculateReward: () => Promise<number>;
  readonly close?: () => Promise<void>;
}

export type TauBenchEnvironmentFactory = (
  task: TauBenchTask,
  spec: TauBenchDomainSpec,
) => Promise<TauBenchEnvironment>;

/**
 * The default factory: refuses, with the reason.
 *
 * A stub that returned canned observations would let this file produce a
 * plausible-looking pass^k number that measured nothing, which is the specific
 * failure mode τ-bench was adopted to avoid.
 */
export const unportedEnvironment: TauBenchEnvironmentFactory = async () => {
  throw new Error(
    "No τ-bench environment is wired.\n" +
      "Vendored: tasks, domain policies and tool declarations (real, pinned upstream).\n" +
      "Missing: the executable environment — domain database, tool bodies, simulated\n" +
      "user, and the ground-truth reward function.\n\n" +
      "Pass an implementation of TauBenchEnvironment to runTauBench({ environment }).\n" +
      "Prefer a bridge to upstream's Python env over a TypeScript port: the reward is\n" +
      "the part that makes the score third-party, and a port would hand scoring back\n" +
      "to this repo.",
  );
};

// ── upstream tool schema → RA tool definition ────────────────────────────────

const RA_PARAM_TYPES = ["string", "number", "boolean", "object", "array"] as const;
type RaParamType = (typeof RA_PARAM_TYPES)[number];

const toRaParamType = (jsonType: string | undefined): RaParamType => {
  // Upstream uses JSON Schema's `integer`, which RA folds into `number`.
  if (jsonType === "integer") return "number";
  return (RA_PARAM_TYPES as readonly string[]).includes(jsonType ?? "")
    ? (jsonType as RaParamType)
    : "string";
};

/**
 * RA's `ToolParameter` is flat: it carries `items: { type }` but not a nested
 * `properties` map. Upstream's `book_reservation.flights` is an array OF objects
 * with four described fields. Rather than drop that shape, the sub-schema is
 * appended to the description verbatim — RA's own guidance for object/array
 * params — so the model still sees every constraint upstream wrote.
 */
const toRaParameter = (
  name: string,
  schema: TauBenchJsonSchema,
  required: boolean,
): ToolParameter => {
  const type = toRaParamType(schema.type);
  const nested = schema.items?.properties ?? schema.properties;
  const description =
    nested === undefined
      ? (schema.description ?? "")
      : `${schema.description ?? ""} JSON Schema of each entry: ${JSON.stringify(
          schema.items ?? schema,
        )}`;
  return {
    name,
    type,
    description,
    required,
    ...(type === "array"
      ? { items: { type: toRaParamType(schema.items?.type) } }
      : {}),
    ...(schema.enum !== undefined ? { enum: schema.enum } : {}),
  };
};

export const toRaToolDefinition = (tool: TauBenchToolSchema): ToolDefinition => {
  const { name, description, parameters } = tool.function;
  const required = new Set(parameters.required ?? []);
  return {
    name,
    description,
    parameters: Object.entries(parameters.properties ?? {}).map(([key, schema]) =>
      toRaParameter(key, schema, required.has(key)),
    ),
    // τ-bench tools mutate a sandboxed fixture database, never the host. Marking
    // them high-risk would trip approval gates and stall every trial on a bench
    // whose whole point is unattended reliability measurement.
    riskLevel: "low",
    timeoutMs: 30_000,
    requiresApproval: false,
    category: "custom",
    // Not "builtin": these are host-registered functions, and mislabelling their
    // origin would let RA's own builtin-scoped policies apply to a third-party
    // tool surface that must stay exactly as upstream declared it.
    source: "function",
  };
};

// ── trial execution ──────────────────────────────────────────────────────────

export interface TauBenchTrial {
  readonly solved: boolean;
  readonly reward: number;
  readonly turns: number;
  readonly tokensUsed: number;
  readonly costUsd: number;
  readonly toolCalls: number;
  readonly error?: string;
}

export interface TauBenchRunOptions {
  readonly domain: TauBenchDomain;
  readonly provider: ProviderName;
  readonly model: string;
  /** How many tasks from the head of the TEST split. Default: all of them. */
  readonly taskCount?: number;
  /** Trials per task. pass^k needs at least k, and refuses fewer. */
  readonly k: number;
  readonly maxTurns?: number;
  readonly environment?: TauBenchEnvironmentFactory;
}

export interface TauBenchReport {
  readonly provenance: typeof TAU_BENCH_PROVENANCE;
  readonly domain: TauBenchDomain;
  readonly provider: ProviderName;
  readonly model: string;
  readonly k: number;
  readonly maxTurns: number;
  readonly generatedAt: string;
  readonly tasks: ReadonlyArray<{
    readonly index: number;
    readonly userId: string;
    readonly trials: readonly TauBenchTrial[];
  }>;
  /** Per-task solve vectors, in the shape {@link passAtK} consumes. */
  readonly results: readonly (readonly boolean[])[];
  /** pass^k: fraction of tasks solved in ALL k trials. Reliability. */
  readonly passK: number;
  /** pass^1: mean solve rate across every trial. Accuracy, for contrast. */
  readonly pass1: number;
  /**
   * Trials that threw instead of being scored. Reported next to the score
   * because a run with errors is a partially-measured run, and a reader who
   * cannot see that would read `pass^k` as fully covered.
   */
  readonly erroredTrials: number;
}

/** Upstream scores a task solved only at reward 1.0. */
const isSolved = (reward: number): boolean => reward >= 1 - 1e-9;

/**
 * One independent trial: a fresh environment, a fresh agent, and a
 * user↔agent conversation driven until the simulated user stops or the turn
 * cap is hit. Tool calls reach the environment through the registered handlers,
 * so the agent's own loop is what mutates the domain — the harness under test is
 * doing the work, which is the entire point of the measurement.
 */
export const runTrial = async (
  task: TauBenchTask,
  spec: TauBenchDomainSpec,
  options: TauBenchRunOptions,
): Promise<TauBenchTrial> => {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const factory = options.environment ?? unportedEnvironment;
  let toolCalls = 0;
  let tokensUsed = 0;
  let costUsd = 0;
  let turns = 0;
  // Constructed INSIDE the try: an environment that fails to build is a failed
  // trial like any other, and hoisting it out would let that failure escape as
  // an exception the caller might mistake for an infrastructure error and retry.
  let environment: TauBenchEnvironment | undefined;

  try {
    environment = await factory(task, spec);
    const boundEnvironment = environment;
    const agent = await ReactiveAgents.create()
      .withName(`tau-bench-${spec.domain}-${task.index}`)
      .withProvider(options.provider)
      .withModel(options.model)
      // The domain policy IS the system prompt upstream gives the agent.
      .withSystemPrompt(spec.policy)
      .withMaxIterations(maxTurns)
      .withTools({
        tools: spec.tools.map((tool) => ({
          definition: toRaToolDefinition(tool),
          handler: (args: Record<string, unknown>) =>
            Effect.tryPromise({
              try: async () => {
                toolCalls += 1;
                const stepped = await boundEnvironment.step({
                  name: tool.function.name,
                  kwargs: args,
                });
                return stepped.observation;
              },
              catch: (cause) =>
                new Error(`τ-bench tool ${tool.function.name} failed: ${String(cause)}`),
            }),
        })),
        // Only upstream's tools may be visible: an RA builtin leaking into the
        // surface would make the number un-comparable to published τ-bench runs.
        allowedTools: spec.tools.map((tool) => tool.function.name),
        adaptive: false,
      })
      .build();

    const history: ChatMessage[] = [];
    let userMessage = await boundEnvironment.reset();
    let reward = 0;

    for (turns = 1; turns <= maxTurns; turns += 1) {
      const result = await agent.run(
        userMessage,
        history.length > 0 ? { history } : undefined,
      );
      tokensUsed += result.metadata.tokensUsed;
      costUsd += result.metadata.cost;
      history.push({ role: "user", content: userMessage, timestamp: Date.now() });
      history.push({ role: "assistant", content: result.output, timestamp: Date.now() });

      const stepped = await boundEnvironment.step({
        name: RESPOND_ACTION_NAME,
        kwargs: { content: result.output },
      });
      reward = stepped.reward;
      if (stepped.done) {
        return { solved: isSolved(reward), reward, turns, tokensUsed, costUsd, toolCalls };
      }
      userMessage = stepped.observation;
    }

    // Turn cap hit without the user ending the conversation: upstream still
    // scores the resulting database state rather than recording a zero.
    const finalReward = await boundEnvironment.calculateReward();
    return {
      solved: isSolved(finalReward),
      reward: finalReward,
      turns: maxTurns,
      tokensUsed,
      costUsd,
      toolCalls,
    };
  } catch (cause) {
    // A crashed trial is a FAILED trial, never a dropped one: silently omitting
    // it would raise pass^k by shrinking the denominator.
    return {
      solved: false,
      reward: 0,
      turns,
      tokensUsed,
      costUsd,
      toolCalls,
      error: cause instanceof Error ? cause.message : String(cause),
    };
  } finally {
    await environment?.close?.();
  }
};

export const runTauBench = async (
  options: TauBenchRunOptions,
): Promise<TauBenchReport> => {
  const spec = loadDomain(options.domain);
  const tasks = spec.tasks.slice(0, options.taskCount ?? spec.tasks.length);
  if (tasks.length === 0) throw new Error(`no τ-bench tasks selected for ${options.domain}`);

  const rows: Array<{
    index: number;
    userId: string;
    trials: TauBenchTrial[];
  }> = [];
  for (const task of tasks) {
    const trials: TauBenchTrial[] = [];
    for (let trial = 0; trial < options.k; trial += 1) {
      trials.push(await runTrial(task, spec, options));
    }
    rows.push({ index: task.index, userId: task.userId, trials });
  }

  const results = rows.map((row) => row.trials.map((trial) => trial.solved));
  const allTrials = rows.flatMap((row) => row.trials);
  const errored = allTrials.filter((trial) => trial.error !== undefined);

  // UNMEASURED IS NOT ZERO. A single crashed trial under a working environment
  // is a real failure of the harness and scores as one. But when EVERY trial
  // threw, the bench never ran — emitting `pass^k 0.000` there would publish a
  // score for a measurement that did not happen, which is the exact confusion
  // this repo already pins elsewhere (`unmeasured-is-not-zero.test.ts`).
  if (errored.length === allTrials.length) {
    throw new Error(
      `τ-bench produced no measurement: all ${allTrials.length} trials errored. ` +
        `This is NOT a score of 0.\nFirst error: ${errored[0]?.error ?? "unknown"}`,
    );
  }

  return {
    provenance: TAU_BENCH_PROVENANCE,
    domain: options.domain,
    provider: options.provider,
    model: options.model,
    k: options.k,
    maxTurns: options.maxTurns ?? DEFAULT_MAX_TURNS,
    generatedAt: new Date().toISOString(),
    tasks: rows,
    results,
    passK: passAtK(results, options.k),
    pass1: allTrials.filter((trial) => trial.solved).length / allTrials.length,
    erroredTrials: errored.length,
  };
};

// ── CLI ──────────────────────────────────────────────────────────────────────

const readFlag = (argv: readonly string[], flag: string): string | undefined => {
  const at = argv.indexOf(flag);
  return at >= 0 && at + 1 < argv.length ? argv[at + 1] : undefined;
};

/** Validates `--provider` against RA's own literal set rather than a copy of it. */
const isProviderName = Schema.is(ProviderNameSchema);

/** Provider inference, so `--model claude-haiku-4-5` needs no second flag. */
const inferProvider = (model: string): ProviderName => {
  if (model.startsWith("claude")) return "anthropic";
  if (model.startsWith("gpt") || model.startsWith("o1") || model.startsWith("o3")) return "openai";
  if (model.startsWith("gemini")) return "gemini";
  return "ollama";
};

const resolveProvider = (flag: string | undefined, model: string): ProviderName => {
  if (flag === undefined) return inferProvider(model);
  if (!isProviderName(flag)) throw new Error(`unknown provider: ${flag}`);
  return flag;
};

const main = async (): Promise<void> => {
  const argv = process.argv.slice(2);
  const domainFlag = readFlag(argv, "--domain") ?? "retail";
  if (!isTauBenchDomain(domainFlag)) {
    throw new Error(`unknown τ-bench domain: ${domainFlag} (expected retail or airline)`);
  }
  const model = readFlag(argv, "--model") ?? "claude-haiku-4-5-20251001";
  const k = Number(readFlag(argv, "--k") ?? "3");
  const taskCountFlag = readFlag(argv, "--tasks");
  const output = readFlag(argv, "--output");

  const report = await runTauBench({
    domain: domainFlag,
    provider: resolveProvider(readFlag(argv, "--provider"), model),
    model,
    k,
    ...(taskCountFlag !== undefined ? { taskCount: Number(taskCountFlag) } : {}),
    ...(readFlag(argv, "--max-turns") !== undefined
      ? { maxTurns: Number(readFlag(argv, "--max-turns")) }
      : {}),
  });

  console.log(
    `τ-bench ${report.domain} — ${report.model}\n` +
      `  tasks   ${report.tasks.length}\n` +
      `  pass^1  ${report.pass1.toFixed(3)}  (accuracy)\n` +
      `  pass^${report.k}  ${report.passK.toFixed(3)}  (reliability)\n` +
      (report.erroredTrials > 0
        ? `  ERRORED ${report.erroredTrials} trial(s) — partial coverage, read the score with that in mind\n`
        : "") +
      `  upstream ${report.provenance.repo}@${report.provenance.sha.slice(0, 8)}`,
  );
  if (output !== undefined) {
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`  wrote ${output}`);
  }
};

if (import.meta.main) {
  main().catch((cause: unknown) => {
    console.error(cause instanceof Error ? cause.message : String(cause));
    process.exit(1);
  });
}
