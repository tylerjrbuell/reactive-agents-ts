/**
 * Loop Detector — pure synchronous loop pattern detection and early-exit helpers.
 *
 * Checks the current step history for loop patterns:
 *   (a) Repeated tool calls — same tool + same args N times in a row
 *   (b) Repeated thoughts — identical thought content N times without interleaved actions
 *   (c) Consecutive thoughts — thoughts with no interleaved action
 *   (d) No-new-evidence — same-name calls (varied args) with no SUBSTANTIVE result
 *   (e) Evidence staleness — N iterations with assess() evidenceDelta == 0
 *
 * (a)/(d)/(e) classify steps through the ONE progress arbiter
 * (kernel/assessment/progress-arbiter.ts, design law #5): a META / pseudo /
 * no-op / failed call is NON-PROGRESS and cannot masquerade as progress. (c)
 * keeps its IC-1 "any action resets" rule (see its note).
 *
 * `detectLoopPattern` returns the message + the ACTUAL pattern id (W4.5 — the
 * strategy handoff carries the id, not just a free-text description).
 * `detectLoop` is the message-only wrapper for existing callers.
 *
 * Also provides `checkAllToolsCalled` for the composite-step early-exit guard.
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
// Design law #5 (W4.7): ONE progress arbiter. Patterns (a)/(c)/(d) and the new
// (e) classify every step through this predicate — a META/no-op call is NOT
// progress, so the guards stop being blind to the varied-args thrash.
import {
  actionToolName,
  classifyActionStep,
  type ObservationLike,
} from "../../../kernel/assessment/progress-arbiter.js";
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

/**
 * Optional loop-detector inputs for the evidence-staleness pattern (e). Kept in
 * an options bag so the four positional params stay stable for existing callers.
 */
export interface LoopDetectorOptions {
  /**
   * Consecutive iterations ending here whose `assess()` produced
   * `evidenceDelta == 0` while work remained (task 4.1). The loop-detector does
   * NOT count this itself — the control plane owns the counter and feeds it in,
   * so (e) is consumed through the shared currency, not a private counter.
   */
  readonly evidenceStaleIterations?: number;
  /** Threshold for (e); defaults to 3 (mirrors the (d) floor). */
  readonly evidenceStaleThreshold?: number;
}

const DEFAULT_EVIDENCE_STALE_THRESHOLD = 3;

/** The stable loop-pattern id (W4.5 — carried into the strategy handoff). */
export interface LoopPatternId {
  readonly id: "a" | "b" | "c" | "d" | "e";
  readonly name: string;
}

/** A detected loop: the human message + the ACTUAL pattern id that tripped. */
export interface LoopDetection {
  readonly message: string;
  readonly pattern: LoopPatternId;
}

const PATTERN_A: LoopPatternId = { id: "a", name: "repeated-tool-call" };
const PATTERN_B: LoopPatternId = { id: "b", name: "repeated-thought" };
const PATTERN_C: LoopPatternId = { id: "c", name: "consecutive-thoughts" };
const PATTERN_D: LoopPatternId = { id: "d", name: "no-new-evidence" };
const PATTERN_E: LoopPatternId = { id: "e", name: "evidence-staleness" };

/**
 * Detect loop patterns in the current step history.
 *
 * Every action step is classified through the ONE progress arbiter (design law
 * #5): a META / pseudo / no-op / failed call is NON-PROGRESS, so patterns
 * (a)/(c)/(d) stop being blind to the varied-args, success:true thrash that the
 * byte-shape guards missed. Pattern (e) fires on sustained `evidenceDelta == 0`.
 *
 * Returns the message + the ACTUAL pattern id, or null if none.
 */
export function detectLoopPattern(
  steps: readonly ReasoningStep[],
  maxSameTool: number,
  maxRepeatedThought: number,
  maxConsecutiveThoughts: number,
  opts?: LoopDetectorOptions,
): LoopDetection | null {
  let loop: LoopDetection | null = null;

  // Observation lookup by toolCallId — the arbiter classifies each ACTION step
  // against the observation that answered it (law #5: one predicate).
  const obsByCallId = new Map<string, ObservationLike>();
  for (const s of steps) {
    if (s.type !== "observation") continue;
    const id = s.metadata?.toolCallId;
    if (typeof id !== "string" || id.length === 0) continue;
    const result = s.metadata?.observationResult as ObservationResultMeta | undefined;
    obsByCallId.set(id, { success: result?.success, content: s.content });
  }
  const verdictOf = (a: ReasoningStep) => {
    const id = (a.metadata?.toolCall as ToolCallMeta | undefined)?.id;
    const obs = typeof id === "string" ? obsByCallId.get(id) : undefined;
    return classifyActionStep(a, obs);
  };

  // (a) Repeated tool calls: same tool + same args N times in a row
  //     Filter first, then take the last N — ensures we compare actual
  //     actions, not a mix of action/thought/observation steps. Routed through
  //     the arbiter only to annotate a META repeat (law #5) — the byte-identical
  //     trigger itself is unchanged.
  const allActions = steps.filter((s) => s.type === "action");
  if (allActions.length >= maxSameTool) {
    const recentActions = allActions.slice(-maxSameTool);
    const firstNorm = normalizeActionContent(recentActions[0]!.content);
    const allSame = recentActions.every((s) => normalizeActionContent(s.content) === firstNorm);
    if (allSame) {
      const metaRepeat = verdictOf(recentActions[0]!).reason === "meta-tool";
      loop = {
        pattern: PATTERN_A,
        message:
          `Loop detected: same tool call repeated ${maxSameTool} times` +
          (metaRepeat ? ` (a meta-tool call is not progress)` : ""),
      };
    }
  }

  // (d) No-new-evidence loop (Move 5 / ground-truth progress): N calls to the
  //     SAME tool (by NAME — arguments may vary) that produce NO SUBSTANTIVE
  //     observation among them. This catches the thrash pattern (a) misses —
  //     re-reading different bad paths, reworded failing searches, paging a
  //     failing API — which otherwise burns silently to maxIterations. W4.7: the
  //     gate is the ARBITER's "substantive" (not raw `success`), so a
  //     success:true META/no-op result (discover-tools → "No tools registered.")
  //     no longer counts as progress. Floor of 3 so a local tier's
  //     maxSameTool=2 does not fire on a single legitimate retry (tool healing
  //     owns small retry bursts).
  if (loop === null) {
    const threshold = Math.max(maxSameTool, 3);
    if (allActions.length >= threshold) {
      const recent = allActions.slice(-threshold);
      const name0 = actionToolName(recent[0]!);
      const ids = recent.map((a) => (a.metadata?.toolCall as ToolCallMeta | undefined)?.id);
      const allLinkable = ids.every((id): id is string => typeof id === "string" && id.length > 0);
      const sameName = name0 !== undefined && recent.every((a) => actionToolName(a) === name0);
      if (sameName && allLinkable) {
        const anySubstantive = recent.some((a) => verdictOf(a).kind === "substantive");
        if (!anySubstantive) {
          loop = {
            pattern: PATTERN_D,
            message:
              `Loop detected: ${threshold} consecutive '${name0}' calls produced no successful result with new task evidence — ` +
              `the tool keeps failing, is a harness helper, or returns nothing new. Change the approach ` +
              `substantially or give your best answer with what you already have.`,
          };
        }
      }
    }
  }

  // (b) Repeated thoughts: identical thought content N times in recent history
  //     Only flag when NO action steps are interleaved — if the model is
  //     making tool calls between identical thoughts, it is progressing
  //     (FC models often produce brief/identical reasoning text before each
  //     tool call; the real work is in the tool calls themselves).
  if (loop === null) {
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
          loop = {
            pattern: PATTERN_B,
            message:
              `Loop detected: the model repeated the same thought ${maxRepeatedThought} times without making progress.\n` +
              `Fix: (1) Add a persona instruction like "Think step-by-step then call tools immediately", ` +
              `(2) Use .withReasoning({ defaultStrategy: 'plan-execute-reflect' }) for multi-step tasks, ` +
              `(3) Check that tool descriptions are clear and unambiguous.`,
          };
        }
      }
    }
  }

  // (c) Consecutive thoughts without any action — agent is stuck thinking
  //     without making progress. Count trailing thought steps (no action between
  //     them). IC-1 rule (unchanged): any ACTION step resets the streak,
  //     observations do NOT. W4.7 NOTE: (c) deliberately keeps "any action
  //     resets" — reclassifying META actions as non-resetting fired the streak on
  //     legitimate recall/find loops (runtime regression). The law-#5 thrash
  //     shape is caught by (d) (same-name, arbiter-gated) and (e) (variety-proof),
  //     so no false-positive-prone change is needed here.
  if (loop === null) {
    let consecutiveThoughts = 0;
    for (let i = steps.length - 1; i >= 0; i--) {
      if (steps[i]!.type === "thought") consecutiveThoughts++;
      else if (steps[i]!.type === "action") break; // any real action resets the streak
    }
    if (consecutiveThoughts >= maxConsecutiveThoughts) {
      loop = {
        pattern: PATTERN_C,
        message:
          `Loop detected: ${consecutiveThoughts} consecutive thinking steps with no tool calls.\n` +
          `Fix: (1) Verify the model supports function calling for your provider, ` +
          `(2) Simplify the task description — the model may not know which tool to use, ` +
          `(3) For local models, try .withContextProfile({ tier: 'local' }) for stronger tool guidance.`,
      };
    }
  }

  // (e) Evidence staleness (task 4.1, W4.7-routed): N consecutive iterations
  //     whose assessment produced NO new substantive evidence (evidenceDelta==0)
  //     while work remained. Fires REGARDLESS of tool variety / args — the
  //     variety-proof backstop for the thrash (a)/(d) still miss. The counter is
  //     fed in from the control plane (see LoopDetectorOptions), never held here.
  if (loop === null && opts?.evidenceStaleIterations !== undefined) {
    const threshold = opts.evidenceStaleThreshold ?? DEFAULT_EVIDENCE_STALE_THRESHOLD;
    // Only meaningful once the model has ATTEMPTED a tool call: a run that never
    // calls a tool is a thought-stall (pattern c's domain), not evidence
    // staleness — firing (e) there would pre-empt the specific diagnosis.
    const attemptedToolCall = steps.some(
      (s) => s.type === "action" && actionToolName(s) !== undefined,
    );
    if (attemptedToolCall && opts.evidenceStaleIterations >= threshold) {
      loop = {
        pattern: PATTERN_E,
        message:
          `Loop detected: ${opts.evidenceStaleIterations} consecutive iterations produced no new task evidence ` +
          `(evidenceDelta 0) while work remained — the model is not progressing regardless of tool variety. ` +
          `Deliver your best answer with what you have, or change the approach substantially.`,
      };
    }
  }

  return loop;
}

/**
 * Message-only wrapper over {@link detectLoopPattern} for existing callers.
 * Returns a descriptive error message if a loop is detected, or null if none.
 */
export function detectLoop(
  steps: readonly ReasoningStep[],
  maxSameTool: number,
  maxRepeatedThought: number,
  maxConsecutiveThoughts: number,
  opts?: LoopDetectorOptions,
): string | null {
  return detectLoopPattern(steps, maxSameTool, maxRepeatedThought, maxConsecutiveThoughts, opts)?.message ?? null;
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
