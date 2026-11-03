// File: src/testing/runtime-fixtures.ts
//
// Internal test support — unstable, not part of the public API.
//
// Typed fixture builders for the runtime's core shapes. Tests used to hand-build
// partial `ExecutionContext` / `PhaseDeps` / `Task` literals and widen them with
// a double cast. Each builder returns a COMPLETE, valid object built from real
// defaults (`defaultReactiveAgentsConfig`, the TaskSchema decoder, real Refs), so
// a test states only the fields it depends on and the compiler checks the rest.
//
// This file must stay free of double casts (enforced by
// tests/testing/runtime-fixtures.test.ts).

import { Effect, Ref, Schema } from "effect";
import { TaskSchema, type Task } from "@reactive-agents/core";
import type { HookRegistryValue, PhaseDeps } from "../engine/runtime-context.js";
import {
  defaultReactiveAgentsConfig,
  type ExecutionContext,
  type ReactiveAgentsConfig,
} from "../types.js";

/** Default agent id used by every builder here. */
export const FIXTURE_AGENT_ID = "agent-test";

/**
 * Build an `ExecutionContext`: phase `bootstrap`, state `running`, iteration 0,
 * `maxIterations: 10`, empty messages/tool results/metadata. Override any field.
 */
export function makeExecutionContext(
  overrides: Partial<ExecutionContext> = {},
): ExecutionContext {
  return {
    taskId: "t-1",
    agentId: FIXTURE_AGENT_ID,
    sessionId: "s-1",
    phase: "bootstrap",
    agentState: "running",
    iteration: 0,
    maxIterations: 10,
    messages: [],
    toolResults: [],
    cost: 0,
    tokensUsed: 0,
    startedAt: new Date(),
    metadata: {},
    ...overrides,
  };
}

/** Overrides for {@link makeTask}; ids may be plain strings (branded on decode). */
export type TaskOverrides = Omit<Partial<Task>, "id" | "agentId"> & {
  readonly id?: string;
  readonly agentId?: string;
};

/**
 * Build a `Task` by decoding through the real `TaskSchema` (so ids are properly
 * branded and invalid overrides throw). Defaults: type `query`, status `pending`.
 */
export function makeTask(overrides: TaskOverrides = {}): Task {
  return Schema.decodeUnknownSync(TaskSchema)({
    id: "t-1",
    agentId: FIXTURE_AGENT_ID,
    type: "query",
    input: "test task",
    priority: "medium",
    status: "pending",
    metadata: {},
    createdAt: new Date(),
    ...overrides,
  });
}

/** Build a `ReactiveAgentsConfig` from the real defaults. */
export function makeRuntimeConfig(
  overrides: Partial<ReactiveAgentsConfig> = {},
): ReactiveAgentsConfig {
  return defaultReactiveAgentsConfig(FIXTURE_AGENT_ID, overrides);
}

/** Pass-through hook registry: registers nothing, returns the context unchanged. */
export const passThroughHooks: HookRegistryValue = {
  register: () => Effect.succeed(() => {}),
  run: (_phase, _timing, ctx) => Effect.succeed(ctx),
  list: () => Effect.succeed([]),
};

/**
 * Build a `PhaseDeps`: no optional services wired (all `null`), pass-through
 * hooks, real `Ref`-backed phase state, a default task and config.
 */
export function makePhaseDeps(overrides: Partial<PhaseDeps> = {}): PhaseDeps {
  return {
    task: makeTask(),
    config: makeRuntimeConfig(),
    hooks: passThroughHooks,
    obs: null,
    eb: null,
    ks: null,
    guardrail: null,
    behavioral: null,
    tools: null,
    state: {
      cancelledTasks: Ref.unsafeMake(new Set<string>()),
      runningContexts: Ref.unsafeMake(new Map<string, ExecutionContext>()),
    },
    isNormal: false,
    executionStartMs: Date.now(),
    ...overrides,
  };
}
