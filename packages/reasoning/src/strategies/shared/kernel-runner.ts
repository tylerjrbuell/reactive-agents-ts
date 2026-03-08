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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Normalize action content for comparison — parses JSON and re-serializes with
 * sorted keys so that `{"a":1,"b":2}` and `{"b":2,"a":1}` are treated as equal.
 * Falls back to trimmed string comparison on parse failure.
 */
function normalizeActionContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, Object.keys(parsed).sort());
  } catch {
    return content.trim();
  }
}

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
    const loopCfg = options.loopDetection;
    const maxSameTool = loopCfg?.maxSameToolCalls ?? 3;
    const maxRepeatedThought = loopCfg?.maxRepeatedThoughts ?? 3;

    // Required tools guard — tracks redirect attempts to prevent infinite loops
    const requiredTools = input.requiredTools ?? [];
    const maxRequiredToolRetries = input.maxRequiredToolRetries ?? 2;
    let requiredToolRedirects = 0;

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

      // ── Loop detection ───────────────────────────────────────────────────
      // Check the most recent steps for patterns that indicate a stuck loop.
      // Only fire if the loop hasn't already terminated (status still active).
      if (state.status !== "done" && state.status !== "failed") {
        const steps = state.steps;

        // (a) Repeated tool calls: same tool + same args N times in a row
        //     Normalizes JSON to catch formatting variants (key order, whitespace)
        if (steps.length >= maxSameTool) {
          const recentActions = steps
            .slice(-maxSameTool)
            .filter((s) => s.type === "action");
          if (recentActions.length === maxSameTool) {
            const firstNorm = normalizeActionContent(recentActions[0]!.content);
            const allSame = recentActions.every((s) => normalizeActionContent(s.content) === firstNorm);
            if (allSame) {
              state = transitionState(state, {
                status: "failed",
                error: `Loop detected: same tool call repeated ${maxSameTool} times`,
              });
              break;
            }
          }
        }

        // (b) Repeated thoughts: identical thought content N times in recent history
        if (steps.length >= maxRepeatedThought) {
          const recentThoughts = steps
            .slice(-maxRepeatedThought * 2) // look at a wider window
            .filter((s) => s.type === "thought");
          if (recentThoughts.length >= maxRepeatedThought) {
            const lastThought = recentThoughts[recentThoughts.length - 1]!.content;
            const matchCount = recentThoughts.filter(
              (s) => s.content === lastThought,
            ).length;
            if (matchCount >= maxRepeatedThought) {
              state = transitionState(state, {
                status: "failed",
                error: `Loop detected: identical thought repeated ${matchCount} times`,
              });
              break;
            }
          }
        }
      }

      // ── Required tools guard (in-loop) ─────────────────────────────────
      // When the kernel declares "done" but required tools haven't been called,
      // redirect back to "thinking" with a feedback step — up to the retry limit.
      if (state.status === "done" && requiredTools.length > 0) {
        const missingTools = requiredTools.filter((t) => !state.toolsUsed.has(t));
        if (missingTools.length > 0) {
          requiredToolRedirects++;
          if (requiredToolRedirects > maxRequiredToolRetries) {
            state = transitionState(state, {
              status: "failed",
              error: `Required tools never called after ${maxRequiredToolRetries} redirect(s): ${missingTools.join(", ")}`,
            });
            break;
          }
          // Inject feedback and redirect back to thinking
          const feedbackStep = makeStep(
            "observation",
            `⚠️ Required tools not yet used: ${missingTools.join(", ")}. ` +
            `You MUST call ${missingTools.length === 1 ? "this tool" : "these tools"} before completing the task. ` +
            `(Redirect ${requiredToolRedirects}/${maxRequiredToolRetries})`,
          );
          state = transitionState(state, {
            status: "thinking",
            output: null,
            steps: [...state.steps, feedbackStep],
          });
          // Continue the loop — kernel will see the feedback in steps
        }
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
        yield* hooks.onObservation(state, toolResult.content, toolResult.observationResult.success);

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

    // ── 7b. Post-loop required tools check ───────────────────────────────────
    // Final safety net: if the loop exited with "done" (e.g. via bare tool call
    // guard or max iterations) but required tools still haven't been called, fail.
    if (state.status === "done" && requiredTools.length > 0) {
      const missingTools = requiredTools.filter((t) => !state.toolsUsed.has(t));
      if (missingTools.length > 0) {
        state = transitionState(state, {
          status: "failed",
          error: `Required tools never called: ${missingTools.join(", ")}`,
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
