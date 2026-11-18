/**
 * Phase Z: run one shape through the real kernel (`executeReactive`) against a
 * scripted policy, under one harness config. Lives under tests/ because it uses
 * `provideTestEnvelope` (scripts/check-cross-cutting.sh forbids that in
 * production src). Zero tokens, no live model, no filesystem writes.
 */
import { Effect, Layer, Logger, LogLevel } from "effect";
import { EventBus, EventBusLive } from "@reactive-agents/core";
import {
  buildRunEnvelope,
  CONTEXT_PROFILES,
  defaultReasoningConfig,
  executeReactive,
  provideTestEnvelope,
  type HarnessConfig,
} from "@reactive-agents/reasoning";
import { mockToolServiceLayer } from "@reactive-agents/reasoning/testing";
import { describeTurn, policyLLMLayer, requestTokens, hasTools } from "../../src/sim/policy-model.js";
import type { Ideal, Shape } from "../../src/sim/shape.js";
import { withTier, type Tier } from "../../src/sim/tier.js";

/** Result of one arm (one shape, one harness config, one seed). */
export interface ArmResult {
  /** Reached the shape's ideal: terminatedBy, status, tool sequence, turn bound. */
  readonly meetsIdeal: boolean;
  /** How many of the four ideal components (terminatedBy, status, toolSeq, turns) were missed. */
  readonly distance: number;
  readonly terminatedBy: string;
  readonly status: string;
  /** Agent (think) calls. */
  readonly turns: number;
  /** Sum of request-derived input tokens over all agent calls. */
  readonly requestTokens: number;
  /** Sorted mechanism activity keys (`guard:<g>:<outcome>`, `signal:<kind>@<origin>`). */
  readonly activityKeys: readonly string[];
  readonly toolSeq: readonly string[];
  /** Why each non-pass guard fired, in order (diagnosis aid). */
  readonly guardReasons: readonly string[];
  readonly output: string;
  /** Agent turns that shipped no tools. */
  readonly toollessTurns: number;
  /** Stable projection of the whole request log: equal traces mean the mechanism changed nothing. */
  readonly trace: string;
}

/** Options of one arm. */
export interface ArmOptions {
  readonly seed?: number;
  /** Wrap the shape's policy with a tier's failure rates. */
  readonly tier?: Tier;
  /** Probability the model follows a steering signal. Default: the tier's, else 1. */
  readonly compliance?: number;
}

type ReactiveInput = Parameters<typeof executeReactive>[0];

const missed = (r: Pick<ArmResult, "terminatedBy" | "status" | "turns" | "toolSeq">, ideal: Ideal): number =>
  Number(r.terminatedBy !== ideal.terminatedBy) +
  Number(r.status !== ideal.status) +
  Number(r.toolSeq.join(",") !== ideal.toolSeq.join(",")) +
  Number(r.turns > ideal.maxTurns);

/** Run one arm. */
export async function runArm(shape: Shape, harness: HarnessConfig, opts: ArmOptions = {}): Promise<ArmResult> {
  const seed = opts.seed ?? 7;
  const compliance = opts.compliance ?? opts.tier?.complianceGivenGuidance ?? 1;
  const model =
    opts.tier === undefined
      ? shape.policy
      : withTier(shape.policy, { ...opts.tier, complianceGivenGuidance: compliance });
  const policy = policyLLMLayer(model, seed, { compliance });

  const toolSeq: string[] = [];
  const perToolCalls = new Map<string, number>();
  const byName = new Map(shape.tools.map((t) => [t.name, t]));
  const tools = mockToolServiceLayer({
    execute: (req) => {
      toolSeq.push(req.toolName);
      const tool = byName.get(req.toolName);
      const index = perToolCalls.get(req.toolName) ?? 0;
      perToolCalls.set(req.toolName, index + 1);
      // The mock's request type says `args`; the runtime ToolInput carries `arguments`.
      const bag: unknown = "arguments" in req ? req.arguments : req.args;
      const args: Readonly<Record<string, unknown>> = typeof bag === "object" && bag !== null ? { ...bag } : {};
      if (tool === undefined) return Effect.fail(new Error(`unknown tool ${req.toolName}`));
      const out = tool.run(args, index);
      return out.ok ? Effect.succeed({ success: true, result: out.result }) : Effect.fail(new Error(out.error));
    },
    getTool: (name: string) => {
      const tool = byName.get(name);
      return Effect.succeed({ name, description: tool?.description ?? "test", parameters: tool?.parameters ?? [] });
    },
  });

  const keys = new Set<string>();
  const reasons: string[] = [];
  const input: ReactiveInput = {
    taskDescription: shape.task,
    taskType: "research",
    memoryContext: "",
    availableTools: shape.tools.map((t) => t.name),
    availableToolSchemas: shape.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters.map((p) => ({ ...p, description: p.name })),
    })),
    requiredTools: shape.run.requiredTools,
    config: {
      ...defaultReasoningConfig,
      strategies: {
        ...defaultReasoningConfig.strategies,
        reactive: {
          ...defaultReasoningConfig.strategies.reactive,
          maxIterations: shape.run.maxIterations,
          maxIterationsExplicit: true,
        },
      },
    },
    contextProfile: { ...CONTEXT_PROFILES[shape.run.tier], thinkingModel: true },
  };
  const program = Effect.gen(function* () {
    const bus = yield* EventBus;
    yield* bus.subscribe((ev) => {
      if (ev._tag === "GuardFiredEmitted" && ev.outcome !== "pass") {
        keys.add(`guard:${ev.guard}:${ev.outcome}`);
        reasons.push(`it${ev.iteration} ${ev.guard}:${ev.outcome}: ${ev.reason}`);
      } else if (ev._tag === "HarnessSignalInjectedEmitted") {
        keys.add(`signal:${ev.signalKind}@${ev.origin.replace(/:\d+(?::\d+)?$/, "")}`);
      }
      return Effect.void;
    });
    return yield* executeReactive(input);
  });
  const result = await Effect.runPromise(
    provideTestEnvelope(
      program.pipe(
        Effect.provide(Layer.mergeAll(policy.layer, tools, EventBusLive)),
        Effect.provide(Logger.minimumLogLevel(LogLevel.None)),
      ),
      buildRunEnvelope({ harness }),
    ),
  );

  const agent = policy.agentCalls();
  // `terminatedBy` rides result metadata at runtime but is not on the schema type.
  const meta: unknown = result.metadata;
  const terminatedBy = typeof meta === "object" && meta !== null && "terminatedBy" in meta ? String(meta.terminatedBy) : "";
  const base = { terminatedBy, status: String(result.status), turns: agent.length, toolSeq };
  const distance = missed(base, shape.ideal);
  return {
    ...base,
    meetsIdeal: distance === 0,
    distance,
    requestTokens: agent.reduce((n, c) => n + c.inputTokens, 0),
    activityKeys: [...keys].sort(),
    guardReasons: reasons,
    output: String(result.output ?? ""),
    toollessTurns: agent.filter((c) => !hasTools(c.req)).length,
    trace: JSON.stringify(
      policy.calls.map((c) => ({
        p: c.purpose,
        tools: (c.req.tools ?? []).map((t) => t.name),
        n: c.req.messages.length,
        tok: requestTokens(c.req),
        tc: c.req.toolChoice,
        r: describeTurn(c.turn),
      })),
    ),
  };
}
