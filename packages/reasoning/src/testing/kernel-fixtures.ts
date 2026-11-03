// File: src/testing/kernel-fixtures.ts
//
// Internal test support — unstable, not part of the public API.
//
// Typed fixture builders for the kernel's core shapes.
//
// Tests used to hand-build partial `KernelInput` / `KernelState` /
// `KernelRunOptions` / `KernelContext` / `KernelHooks` literals and widen them
// with a double cast. Each builder here returns a COMPLETE, valid object built
// from the kernel's own defaults (`initialKernelState`, `noopHooks`,
// `CONTEXT_PROFILES`, the real `NativeFCDriver`), so a test states only the
// fields it depends on and the compiler checks the rest.
//
// This file must stay free of double casts: that is the point of the design
// (enforced by tests/testing/kernel-fixtures.test.ts).
//
// Exported via the `@reactive-agents/reasoning/testing` subpath — test support,
// not part of the main package API.

import { Option } from "effect";
import { TestLLMService } from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import type { ResultCompressionConfig } from "@reactive-agents/tools";
import { CONTEXT_PROFILES } from "../context/context-profile.js";
import { assess, type RunAssessment } from "../kernel/assessment/assess.js";
import type { RunContract } from "../kernel/contract/run-contract.js";
import type { StrategyServices } from "../kernel/utils/service-utils.js";
import type { Plan, PlanStep } from "../types/plan.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelHooks,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
} from "../kernel/state/kernel-state.js";

/** Default task text used by {@link makeKernelInput}. */
export const FIXTURE_TASK = "test task";

/**
 * Build a `KernelInput`. Only `task` is required by the type; it defaults to
 * {@link FIXTURE_TASK}. Every other field stays absent unless overridden.
 */
export function makeKernelInput(overrides: Partial<KernelInput> = {}): KernelInput {
  return { task: FIXTURE_TASK, ...overrides };
}

/**
 * Build `KernelRunOptions` with the three required fields defaulted
 * (`maxIterations: 10`, `strategy: "reactive"`, `kernelType: "react"`).
 */
export function makeKernelRunOptions(
  overrides: Partial<KernelRunOptions> = {},
): KernelRunOptions {
  return { maxIterations: 10, strategy: "reactive", kernelType: "react", ...overrides };
}

/**
 * Build a `KernelState` from the kernel's own `initialKernelState` (seeded with
 * {@link makeKernelRunOptions} defaults), then apply `overrides`.
 */
export function makeKernelState(overrides: Partial<KernelState> = {}): KernelState {
  return { ...initialKernelState(makeKernelRunOptions()), ...overrides };
}

/** Build `KernelHooks`: every hook is the real `noopHooks` entry unless overridden. */
export function makeKernelHooks(overrides: Partial<KernelHooks> = {}): KernelHooks {
  return { ...noopHooks, ...overrides };
}

/** Default result-compression config, mirroring the runner's profile-derived default. */
const DEFAULT_COMPRESSION: ResultCompressionConfig = {
  budget: CONTEXT_PROFILES.mid.toolResultMaxChars ?? 800,
  previewItems: CONTEXT_PROFILES.mid.toolResultPreviewItems ?? 5,
  autoStore: true,
  codeTransform: true,
};

/**
 * Build a `KernelContext`: mid-tier profile, runner-default compression, no
 * tool or memory service, no-op hooks, and the real native-FC driver.
 */
export function makeKernelContext(overrides: Partial<KernelContext> = {}): KernelContext {
  return {
    input: makeKernelInput(),
    profile: CONTEXT_PROFILES.mid,
    compression: DEFAULT_COMPRESSION,
    toolService: Option.none(),
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
    memoryService: Option.none(),
    ...overrides,
  };
}

/**
 * Build a `StrategyServices` bundle: a scripted `TestLLMService` with no turns
 * and every optional service absent (`Option.none()`), as when only the LLM
 * layer is provided.
 */
export function makeStrategyServices(
  overrides: Partial<StrategyServices> = {},
): StrategyServices {
  return {
    llm: TestLLMService([]),
    toolService: Option.none(),
    promptService: Option.none(),
    eventBus: Option.none(),
    entropySensor: Option.none(),
    reactiveController: Option.none(),
    dispatcher: Option.none(),
    memoryService: Option.none(),
    ...overrides,
  };
}

/**
 * Build a `PlanStep`: a pending `analysis` step `s1` with no retries or tokens.
 * Set `type: "tool_call"` and `toolName` for tool steps.
 */
export function makePlanStep(overrides: Partial<PlanStep> = {}): PlanStep {
  return {
    id: "s1",
    seq: 1,
    title: "step",
    instruction: "step",
    type: "analysis",
    status: "pending",
    retries: 0,
    tokensUsed: 0,
    ...overrides,
  };
}

/** Build an empty linear `Plan` (no steps) for task `t`. */
export function makePlan(overrides: Partial<Plan> = {}): Plan {
  const at = new Date(0).toISOString();
  return {
    id: "plan-1",
    taskId: "t",
    agentId: "agent",
    goal: "goal",
    mode: "linear",
    steps: [],
    status: "active",
    version: 1,
    createdAt: at,
    updatedAt: at,
    totalTokens: 0,
    totalCost: 0,
    ...overrides,
  };
}

/**
 * Build an empty `RunContract`: no requirements, deliverables, constraints or
 * post-conditions, `"short"` horizon.
 */
export function makeRunContract(overrides: Partial<RunContract> = {}): RunContract {
  return {
    requirements: [],
    deliverables: [],
    constraints: [],
    horizon: "short",
    postConditions: [],
    ...overrides,
  };
}

/**
 * Overrides for {@link makeRunAssessment}. The object-valued sections
 * (`requirements`, `deliverables`, `pace`, `health`) merge one level deep, so a
 * test can set e.g. only `pace.band` and keep the computed rest.
 */
export type RunAssessmentOverrides = {
  readonly [K in keyof RunAssessment]?: RunAssessment[K] extends ReadonlyMap<string, unknown>
    ? RunAssessment[K]
    : RunAssessment[K] extends object
      ? Partial<RunAssessment[K]>
      : RunAssessment[K];
};

/**
 * Build a `RunAssessment` by running the real `assess()` over an empty contract
 * and ledger at iteration 0 of 10, then applying `overrides`.
 */
export function makeRunAssessment(overrides: RunAssessmentOverrides = {}): RunAssessment {
  const base = assess(makeRunContract(), [], {
    iteration: 0,
    maxIterations: 10,
    tokensUsed: 0,
    costUsd: 0,
  });
  return {
    ...base,
    ...overrides,
    requirements: { ...base.requirements, ...overrides.requirements },
    deliverables: { ...base.deliverables, ...overrides.deliverables },
    pace: { ...base.pace, ...overrides.pace },
    health: { ...base.health, ...overrides.health },
    requirementProgress: overrides.requirementProgress ?? base.requirementProgress,
  };
}
