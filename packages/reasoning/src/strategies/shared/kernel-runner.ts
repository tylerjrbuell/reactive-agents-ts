/**
 * shared/kernel-runner.ts — Universal execution loop for all reasoning strategies.
 *
 * Replaces the duplicated while-loops in reactive.ts and react-kernel.ts with a
 * single `runKernel()` function. Every strategy defines a `ThoughtKernel` (one step
 * of reasoning) and hands it to `runKernel()` which handles:
 *
 *   1. Service resolution (LLM, ToolService, EventBus via Effect.serviceOption)
 *   2. Profile merging (input.contextProfile over CONTEXT_PROFILES["mid"])
 *   3. KernelHooks construction from EventBus
 *   4. Immutable KernelContext assembly (frozen for entire execution)
 *   5. Main loop: call kernel repeatedly until done/failed/maxIterations
 *   6. Embedded tool call guard: catch bare tool calls in final output
 *   7. Terminal hooks: onDone / onError
 */
import { Effect } from "effect";
import type { LLMService } from "@reactive-agents/llm-provider";
import { CONTEXT_PROFILES } from "../../context/context-profile.js";
import type { ContextProfile } from "../../context/context-profile.js";
import { resolveStrategyServices } from "./service-utils.js";
import { buildKernelHooks } from "./kernel-hooks.js";
import { parseBareToolCall } from "./tool-utils.js";
import { executeToolCall } from "./tool-execution.js";
import { makeStep } from "./step-utils.js";
import {
  initialKernelState,
  transitionState,
  type KernelState,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type ThoughtKernel,
} from "./kernel-state.js";

// ── Main entry point ──────────────────────────────────────────────────────────

/**
 * Execute a ThoughtKernel in a loop until it reaches "done", "failed", or
 * exhausts `maxIterations`.
 *
 * This is the **universal execution loop** — every reasoning strategy delegates
 * to this function instead of implementing its own while-loop.
 *
 * Post-loop: if the kernel produced a "done" state whose output contains a bare
 * tool call (e.g. `web-search({"query":"test"})`), the runner executes that tool
 * and replaces the output with the tool observation. This guards against models
 * that embed tool calls inside FINAL ANSWER text.
 */
export function runKernel(
  kernel: ThoughtKernel,
  input: KernelInput,
  options: KernelRunOptions,
): Effect.Effect<KernelState, never, LLMService> {
  return Effect.gen(function* () {
    // ── 1. Resolve services ──────────────────────────────────────────────────
    const services = yield* resolveStrategyServices;
    const { toolService, eventBus } = services;

    // ── 2. Build profile ─────────────────────────────────────────────────────
    const profile: ContextProfile = input.contextProfile
      ? ({ ...CONTEXT_PROFILES["mid"], ...input.contextProfile } as ContextProfile)
      : CONTEXT_PROFILES["mid"];

    // ── 3. Build hooks ───────────────────────────────────────────────────────
    const hooks = buildKernelHooks(eventBus);

    // ── 4. Build KernelContext ────────────────────────────────────────────────
    const context: KernelContext = {
      input,
      profile,
      compression: input.resultCompression ?? {
        budget: profile.toolResultMaxChars ?? 800,
        previewItems: 3,
        autoStore: true,
        codeTransform: true,
      },
      toolService,
      hooks,
    };

    // ── 5. Create initial state ──────────────────────────────────────────────
    let state = initialKernelState(options);

    // Mutable scratchpad mirror — needed by the post-loop embedded tool call guard
    // (step 7) which may execute a tool that auto-stores to scratchpad.
    // Synced from state.scratchpad (ReadonlyMap) after each kernel step.
    const mutableScratchpad = new Map<string, string>(state.scratchpad);

    // ── 6. Main loop ─────────────────────────────────────────────────────────
    while (
      state.status !== "done" &&
      state.status !== "failed" &&
      state.iteration < options.maxIterations
    ) {
      state = yield* kernel(state, context);

      // Sync scratchpad: kernel may have added entries
      for (const [k, v] of state.scratchpad) {
        mutableScratchpad.set(k, v);
      }
    }

    // ── 7. Embedded tool call guard ──────────────────────────────────────────
    // After the loop ends with status "done", check if the output contains a
    // bare tool call. If so, execute it and update state.
    if (state.status === "done" && state.output) {
      const bareCall = parseBareToolCall(state.output.trim());
      if (bareCall) {
        const toolResult = yield* executeToolCall(toolService, bareCall, {
          profile,
          compression: context.compression,
          scratchpad: mutableScratchpad,
          agentId: input.agentId,
          sessionId: input.sessionId,
        });

        // Fire action + observation hooks
        yield* hooks.onAction(state, bareCall.tool, bareCall.input);
        yield* hooks.onObservation(state, toolResult.content);

        // Update state with new steps and cleaned output
        const actionStep = makeStep("action", JSON.stringify({
          tool: bareCall.tool,
          input: bareCall.input,
        }));
        const observationStep = makeStep("observation", toolResult.content);

        const newToolsUsed = new Set(state.toolsUsed);
        newToolsUsed.add(bareCall.tool);

        state = transitionState(state, {
          steps: [...state.steps, actionStep, observationStep],
          toolsUsed: newToolsUsed,
          scratchpad: mutableScratchpad,
          output: toolResult.content,
        });
      }
    }

    // ── 8. Terminal hooks ────────────────────────────────────────────────────
    if (state.status === "done") {
      yield* hooks.onDone(state);
    } else if (state.status === "failed") {
      yield* hooks.onError(state, state.error ?? "unknown error");
    }

    // ── 9. Return final state ────────────────────────────────────────────────
    return state;
  });
}
