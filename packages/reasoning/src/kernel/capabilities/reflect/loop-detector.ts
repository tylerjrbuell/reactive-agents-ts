/**
 * Loop Detector — pure synchronous loop pattern detection and early-exit helpers.
 *
 * Checks the current step history for three loop patterns:
 *   (a) Repeated tool calls — same tool + same args N times in a row
 *   (b) Repeated thoughts — identical thought content N times without interleaved actions
 *   (c) Consecutive thoughts — agent stuck thinking without making any tool calls
 *
 * Also provides `checkAllToolsCalled` for the composite-step early-exit guard.
 *
 * Returns a human-readable error message if a loop is detected, or null if clean.
 *
 * Extracted from kernel-runner.ts to keep the main loop focused on control flow.
 */
import { transitionState } from "../../../kernel/state/kernel-state.js";
// Sprint 3.3 — Sole Termination Authority: loop detector emits a
// "loop-detected" intent and lets the Arbitrator decide success/failure.
import {
  arbitrateAndApply,
  arbitrationContextFromState,
} from "../decide/arbitrator.js";
import type { KernelState, KernelInput, KernelRunOptions } from "../../../kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";

/**
 * Normalize action content for comparison — parses JSON and re-serializes with
 * sorted keys so that `{"a":1,"b":2}` and `{"b":2,"a":1}` are treated as equal.
 * Falls back to trimmed string comparison on parse failure.
 */
export function normalizeActionContent(content: string): string {
  try {
    const parsed = JSON.parse(content);
    return JSON.stringify(parsed, Object.keys(parsed).sort());
  } catch {
    return content.trim();
  }
}

interface ToolCallMeta {
  readonly id?: string;
  readonly name?: string;
}
interface ObservationResultMeta {
  readonly success?: boolean;
}

/** The tool name of an action step, read from its `toolCall` metadata. */
function actionToolName(step: ReasoningStep): string | null {
  const tc = step.metadata?.toolCall as ToolCallMeta | undefined;
  return typeof tc?.name === "string" && tc.name.length > 0 ? tc.name : null;
}

/**
 * Detect loop patterns in the current step history.
 *
 * Returns a descriptive error message if a loop is detected, or null if none.
 */
export function detectLoop(
  steps: readonly ReasoningStep[],
  maxSameTool: number,
  maxRepeatedThought: number,
  maxConsecutiveThoughts: number,
): string | null {
  let loopMsg: string | null = null;

  // (a) Repeated tool calls: same tool + same args N times in a row
  //     Filter first, then take the last N — ensures we compare actual
  //     actions, not a mix of action/thought/observation steps.
  const allActions = steps.filter((s) => s.type === "action");
  if (allActions.length >= maxSameTool) {
    const recentActions = allActions.slice(-maxSameTool);
    const firstNorm = normalizeActionContent(recentActions[0]!.content);
    const allSame = recentActions.every((s) => normalizeActionContent(s.content) === firstNorm);
    if (allSame) {
      loopMsg = `Loop detected: same tool call repeated ${maxSameTool} times`;
    }
  }

  // (d) No-new-evidence loop (Move 5 / ground-truth progress): N calls to the
  //     SAME tool (by NAME — arguments may vary) that produce NO successful
  //     observation among them. This catches the thrash pattern (a) misses —
  //     re-reading different bad paths, reworded failing searches, paging a
  //     failing API — which otherwise burns silently to maxIterations. Gated on
  //     "no successful observation" (the ground-truth progress signal), so a
  //     tool that is genuinely succeeding never trips it. Floor of 3 so a local
  //     tier's maxSameTool=2 does not fire on a single legitimate retry (tool
  //     healing owns small retry bursts).
  if (loopMsg === null) {
    const threshold = Math.max(maxSameTool, 3);
    if (allActions.length >= threshold) {
      const recent = allActions.slice(-threshold);
      const name0 = actionToolName(recent[0]!);
      const ids = recent.map((a) => (a.metadata?.toolCall as ToolCallMeta | undefined)?.id);
      const allLinkable = ids.every((id): id is string => typeof id === "string" && id.length > 0);
      const sameName = name0 !== null && recent.every((a) => actionToolName(a) === name0);
      if (sameName && allLinkable) {
        const recentIds = new Set(ids as string[]);
        const anySuccess = steps.some(
          (s) =>
            s.type === "observation" &&
            typeof s.metadata?.toolCallId === "string" &&
            recentIds.has(s.metadata.toolCallId) &&
            (s.metadata?.observationResult as ObservationResultMeta | undefined)?.success === true,
        );
        if (!anySuccess) {
          loopMsg =
            `Loop detected: ${threshold} consecutive '${name0}' calls produced no successful result — ` +
            `the tool keeps failing or returns nothing new. Change the arguments substantially, ` +
            `use a different tool, or give your best answer with what you already have.`;
        }
      }
    }
  }

  // (b) Repeated thoughts: identical thought content N times in recent history
  //     Only flag when NO action steps are interleaved — if the model is
  //     making tool calls between identical thoughts, it is progressing
  //     (FC models often produce brief/identical reasoning text before each
  //     tool call; the real work is in the tool calls themselves).
  if (loopMsg === null) {
    const allThoughts = steps.filter((s) => s.type === "thought");
    if (allThoughts.length >= maxRepeatedThought) {
      const recentThoughts = allThoughts.slice(-maxRepeatedThought);
      const lastThought = recentThoughts[recentThoughts.length - 1]!.content;
      const allSameThought = recentThoughts.every((s) => s.content === lastThought);
      if (allSameThought) {
        const recentActions = steps.filter((s) => s.type === "action");
        const hasRecentProgress = recentActions.length > 0
          && recentActions.some((a) => {
            const idx = steps.indexOf(a);
            const firstThoughtIdx = steps.indexOf(recentThoughts[0]!);
            return idx >= firstThoughtIdx;
          });
        if (!hasRecentProgress) {
          loopMsg = `Loop detected: the model repeated the same thought ${maxRepeatedThought} times without making progress.\n` +
            `Fix: (1) Add a persona instruction like "Think step-by-step then call tools immediately", ` +
            `(2) Use .withReasoning({ defaultStrategy: 'plan-execute-reflect' }) for multi-step tasks, ` +
            `(3) Check that tool descriptions are clear and unambiguous.`;
        }
      }
    }
  }

  // (c) Consecutive thoughts without any action — agent is stuck thinking
  //     without making progress. Count trailing thought steps (no action between them).
  if (loopMsg === null) {
    let consecutiveThoughts = 0;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i]!.type === "thought") consecutiveThoughts++;
      else if (steps[i]!.type === "action") break; // only a real tool call resets the streak
    }
    if (consecutiveThoughts >= maxConsecutiveThoughts) {
      loopMsg = `Loop detected: ${consecutiveThoughts} consecutive thinking steps with no tool calls.\n` +
        `Fix: (1) Verify the model supports function calling for your provider, ` +
        `(2) Simplify the task description — the model may not know which tool to use, ` +
        `(3) For local models, try .withContextProfile({ tier: 'local' }) for stronger tool guidance.`;
    }
  }

  return loopMsg;
}

/**
 * Early-exit guard for composite plan-execute steps.
 *
 * When `exitOnAllToolsCalled` is enabled and all primary (non-utility) tools have
 * been used, transitions state to "done" and sets terminatedBy = "all_tools_called".
 *
 * Utility tools (e.g. "recall") are excluded — the agent may skip them.
 * Returns the state unchanged if the guard does not fire.
 */
export function checkAllToolsCalled(
  state: KernelState,
  currentInput: KernelInput,
  currentOptions: KernelRunOptions,
): KernelState {
  if (
    !currentOptions.exitOnAllToolsCalled ||
    state.status === "done" ||
    state.status === "failed" ||
    !currentInput.availableToolSchemas ||
    currentInput.availableToolSchemas.length === 0 ||
    state.toolsUsed.size === 0
  ) {
    return state;
  }

  const UTILITY_TOOLS = new Set(["recall"]);
  const primaryTools = currentInput.availableToolSchemas
    .map((t) => t.name)
    .filter((name) => !UTILITY_TOOLS.has(name));

  // If ALL tools are utility tools, don't early-exit (let LLM finish naturally)
  if (primaryTools.length === 0) return state;

  const allPrimaryCalled = primaryTools.every((name) => state.toolsUsed.has(name));
  if (!allPrimaryCalled) return state;

  const lastObs = [...state.steps].reverse().find((s) => s.type === "observation");
  const output = lastObs?.content ?? state.output ?? "[All tools executed successfully]";
  // Sprint 3.3 — flow through the Arbitrator. "All required tools called"
  // is a controller-style signal (the loop-detector decided), so the veto
  // applies — if the controller history shows pathological activity, the
  // Arbitrator converts to exit-failure.
  return arbitrateAndApply(
    state,
    { kind: "loop-detected", output, reason: "all_tools_called" },
    arbitrationContextFromState(state, {
      task: currentInput.task,
      requiredTools: currentInput.requiredTools,
    }),
  );
}
