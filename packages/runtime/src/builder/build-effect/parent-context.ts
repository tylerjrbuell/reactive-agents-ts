/**
 * Parent-context wiring for sub-agent registrations (W26-B step 2).
 *
 * Sub-agents need read access to (1) the parent's accumulated ACT-phase tool
 * results and (2) the original task description set by run() before execution
 * starts. This module owns the mutable ref-holder, a typed getter, and the
 * after-ACT lifecycle hook that keeps the ref fresh.
 *
 * Extracted from builder.ts:2187-2241.
 */
import { Effect } from "effect";
import type { ParentContext } from "@reactive-agents/tools";
import type { ExecutionContext } from "../../types.js";

export interface ParentExecutionContextSnapshot {
  toolResults: Array<{ toolName: string; result: string }>;
  taskDescription?: string;
}

export interface ParentContextWiring {
  /**
   * Mutable holder for the parent's execution context. Set by the engine's
   * after-ACT hook (when registered) and by run() before execution starts.
   * `null` until either firing fills it.
   */
  readonly ref: { current: ParentExecutionContextSnapshot | null };

  /**
   * Returns the parent context shape consumed by sub-agent handlers. Returns
   * `undefined` when no tool results AND no task description are available.
   */
  readonly getParentContext: () => ParentContext | undefined;

  /**
   * Registers the after-ACT lifecycle hook that updates `ref.current.toolResults`
   * after each tool batch. Caller chooses when to invoke (only when sub-agents
   * are wired). Preserves `taskDescription` across updates.
   */
  readonly registerCaptureHook: (engine: {
    registerHook: (hook: {
      phase: "act";
      timing: "after";
      handler: (
        ctx: ExecutionContext,
      ) => Effect.Effect<ExecutionContext, never>;
    }) => Effect.Effect<unknown, never>;
  }) => Effect.Effect<void, never>;
}

export const setupParentContext = (): ParentContextWiring => {
  const ref: { current: ParentExecutionContextSnapshot | null } = {
    current: null,
  };

  const getParentContext = (): ParentContext | undefined => {
    if (!ref.current) return undefined;
    const ctx = ref.current;
    const items = ctx.toolResults ?? [];
    if (items.length === 0 && !ctx.taskDescription) return undefined;
    return {
      toolResults: items.map((tr) => ({
        toolName: tr.toolName,
        result: tr.result,
      })),
      taskDescription: ctx.taskDescription,
    };
  };

  const registerCaptureHook: ParentContextWiring["registerCaptureHook"] = (
    engine,
  ) =>
    Effect.gen(function* () {
      yield* engine.registerHook({
        phase: "act" as const,
        timing: "after" as const,
        handler: (ctx) =>
          Effect.sync(() => {
            const toolResults = (ctx.toolResults ?? []).map((tr: any) => ({
              toolName: String(tr.toolName ?? tr.name ?? "unknown"),
              result: String(tr.result ?? tr.output ?? "").slice(0, 200),
            }));
            // Preserve task description set by runEffect(), update tool results
            ref.current = {
              toolResults,
              taskDescription: ref.current?.taskDescription,
            };
            return ctx;
          }),
      }) as Effect.Effect<unknown, never>;
    });

  return { ref, getParentContext, registerCaptureHook };
};
