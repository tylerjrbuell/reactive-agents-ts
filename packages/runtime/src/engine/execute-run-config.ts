/**
 * Resolved-run-config snapshot + run-origin resolution.
 *
 * Owns: the `{ mechanisms, disclosure, builder, env }` document stamped on
 * `AgentStarted.config` (and therefore `run-started.config` in the trace) and
 * the {@link resolveRunOrigin} rule behind `AgentStarted.origin`.
 *
 * Measurement only: nothing here is read back by the harness. The shape is the
 * base of the future MechanismRegistry — `mechanisms` is `{ id: state }`.
 *
 * Invariants:
 *  - Deterministic: fixed key order, sorted env keys, sorted tool names.
 *  - Secret-free: no prompts, no API/signing keys, no env values for keys that
 *    look secret, no `taskContext`/`environmentContext` values. Tool lists are
 *    names/counts only.
 *  - Size-bounded: lists are capped; the whole document is capped at
 *    {@link RUN_CONFIG_MAX_CHARS} (over ⇒ `builder` tool-name lists dropped,
 *    `truncated: true`).
 */
import { isRunOrigin, type RunOrigin, type Task } from "@reactive-agents/core";
import { resolveHarnessConfig } from "@reactive-agents/reasoning";
import type { ReactiveAgentsConfig } from "../types.js";
import { disclosureFloor } from "./run-envelope-config.js";
import { disclosureHarness, resolveDisclosure, type ResolvedDisclosure } from "./tool-disclosure.js";
import { leanModeVerifier } from "../lean-verifier.js";
import { ORIGIN_CONTEXT_KEY } from "../chat/todo-seed.js";

/** Hard cap on the serialized snapshot (chars). */
export const RUN_CONFIG_MAX_CHARS = 8 * 1024;
const LIST_CAP = 50;
const ENV_VALUE_CAP = 120;

const SECRET_ENV_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|AUTH|CREDENTIAL/i;

/** The snapshot document. */
export type RunConfigSnapshot = {
  readonly mechanisms: Readonly<Record<string, unknown>>;
  /** Resolved tool disclosure and the layer that decided it (tool-disclosure.ts). */
  readonly disclosure: ResolvedDisclosure;
  readonly builder: Readonly<Record<string, unknown>>;
  readonly env: Readonly<Record<string, string>>;
  readonly truncated?: true;
};

/** `RA_*` env vars that are set, minus secret-looking names; sorted; values capped. */
export function readRaEnv(env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of Object.keys(env).sort()) {
    if (!name.startsWith("RA_") || SECRET_ENV_NAME.test(name)) continue;
    const v = env[name];
    if (v === undefined || v === "") continue;
    out[name] = v.length > ENV_VALUE_CAP ? `${v.slice(0, ENV_VALUE_CAP)}…` : v;
  }
  return out;
}

const names = (xs: readonly string[] | undefined): readonly string[] | undefined =>
  xs === undefined ? undefined : [...xs].sort().slice(0, LIST_CAP);

/** Drop `undefined` values so absent == not-set and key order stays stable. */
const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

/**
 * Detect the lean harness. The flag is not carried on `ReactiveAgentsConfig`;
 * `withLeanHarness()` installs the shared {@link leanModeVerifier}, so its
 * identity is the marker.
 */
export function isLeanHarness(config: ReactiveAgentsConfig): boolean {
  return config.verifier === leanModeVerifier;
}

/**
 * Build the resolved-config snapshot for one run. Pure apart from reading
 * `process.env` through `readRaEnv`/`resolveHarnessConfig`.
 */
export function buildRunConfigSnapshot(args: {
  readonly config: ReactiveAgentsConfig;
  readonly provider: string;
  readonly model: string;
  readonly lean: boolean;
  readonly env?: NodeJS.ProcessEnv;
}): RunConfigSnapshot {
  const { config, provider, model, lean } = args;
  const harness = resolveHarnessConfig(disclosureHarness(config), disclosureFloor(config));
  const disclosure = resolveDisclosure(config, harness, args.env ?? process.env);
  const mechanisms = defined({
    leanHarness: lean,
    longHorizon: config.horizonProfile === "long",
    adaptiveHarness: config.adaptiveHarness === true,
    strategySwitching: config.strategySwitching?.enabled === true,
    reactiveIntelligence: config.enableReactiveIntelligence === true,
    memory: config.enableMemory === true,
    experienceLearning: config.enableExperienceLearning === true,
    memoryConsolidation: config.enableMemoryConsolidation === true,
    selfImprovement: config.enableSelfImprovement === true,
    guardrails: config.enableGuardrails,
    verification: config.enableVerification,
    costTracking: config.enableCostTracking,
    audit: config.enableAudit,
    killSwitch: config.enableKillSwitch === true,
    behavioralContracts: config.enableBehavioralContracts === true,
    durableRuns: config.durableRuns !== undefined,
    approvalPolicy: config.approvalPolicy?.mode ?? false,
    grounding: config.grounding?.mode ?? false,
    fabricationGuard: config.fabricationGuard ?? "off",
    stallPolicy: config.stallPolicy !== undefined,
    customVerifier: config.verifier !== undefined && !lean,
    modelRouting: config.modelRouting !== undefined,
    contract: config.taskContract !== undefined,
    // Resolved harness mechanisms (explicit config > env > tier default > default).
    lazyDisclosure: harness.lazyDisclosure,
    toolDiscovery: harness.toolDiscovery,
    toolIndex: harness.toolIndex,
    verboseRules: harness.verboseRules,
    auditRationale: harness.auditRationale,
    assemblyDebug: harness.assemblyDebug,
    numCtxPolicy: harness.numCtxPolicy,
    actOrAnswer: harness.actOrAnswer,
  });
  const contract = config.taskContract;
  const metaOn = config.metaTools
    ? Object.entries(config.metaTools as Record<string, unknown>)
        .filter(([, v]) => v === true || (typeof v === "object" && v !== null))
        .map(([k]) => k)
    : undefined;
  const builder = defined({
    provider,
    model,
    strategy: config.defaultStrategy,
    maxIterations: config.maxIterations,
    minIterations: config.minIterations,
    executionTimeoutMs: config.executionTimeoutMs,
    temperature: config.temperature,
    maxTokens: config.maxTokens,
    numCtx: config.numCtx,
    thinking: config.thinking,
    calibration:
      config.calibration === undefined
        ? undefined
        : typeof config.calibration === "string"
          ? config.calibration
          : "custom",
    memoryTier: config.memoryTier,
    verificationOnReject: config.verificationOnReject,
    maxVerificationRetries: config.maxVerificationRetries,
    budgetLimits: config.budgetLimits,
    retryPolicy: config.retryPolicy,
    strategySwitching: config.strategySwitching,
    harness: config.reasoningOptions?.harness,
    requiredTools: config.requiredTools
      ? defined({
          count: config.requiredTools.tools?.length ?? 0,
          adaptive: config.requiredTools.adaptive,
          maxRetries: config.requiredTools.maxRetries,
        })
      : undefined,
    contract: contract
      ? {
          toolRequirements: contract.tools.length,
          required: contract.tools.filter((t) => t.kind === "required").length,
          forbidden: contract.tools.filter((t) => t.kind === "forbidden").length,
          fixtures: contract.fixtures?.length ?? 0,
        }
      : undefined,
    tools: defined({
      allowed: config.allowedTools?.length,
      forbidden: config.forbiddenTools?.length,
      focused: config.focusedTools?.length,
      builtins:
        config.builtins === undefined
          ? undefined
          : typeof config.builtins === "boolean"
            ? config.builtins
            : config.builtins.length,
      metaTools: names(metaOn),
      allowedNames: names(config.allowedTools),
      forbiddenNames: names(config.forbiddenTools),
    }),
  });
  const env = readRaEnv(args.env);
  const snap: RunConfigSnapshot = { mechanisms, disclosure, builder, env };
  if (JSON.stringify(snap).length <= RUN_CONFIG_MAX_CHARS) return snap;
  const { tools: _tools, harness: _harness, ...slim } = builder;
  return { mechanisms, disclosure, builder: slim, env, truncated: true };
}

/**
 * Resolve the caller origin for a run: an explicit, valid
 * `task.metadata.context.origin` wins; else a delegated child (parent agent or
 * depth > 0) is `"subagent"`; else `"user"`.
 */
export function resolveRunOrigin(task: Pick<Task, "metadata">): RunOrigin {
  const ctx = task.metadata?.context as Record<string, unknown> | undefined;
  const explicit = ctx?.[ORIGIN_CONTEXT_KEY];
  if (isRunOrigin(explicit)) return explicit;
  const rc = ctx?.["runContext"] as { depth?: number } | undefined;
  if (ctx?.["parentAgentId"] || (typeof rc?.depth === "number" && rc.depth > 0)) return "subagent";
  return "user";
}
