/**
 * runner-helpers/recovery-steering.ts — Tool-failure recovery + steering guidance.
 *
 * Extracted from `kernel/loop/runner.ts` in WS-6 Phase 2. Used by runKernel
 * when a stall guard fires or the loop detector trips — the runner asks
 * `getToolFailureRecovery()` whether failed tool paths still have viable
 * alternatives, then `buildRecoverySteeringGuidance()` formats a user-facing
 * nudge that re-points the model at an alternate path. Policy refusals
 * (block/allowlist/sandbox/path-traversal — 2026-10-23 fix B) are the
 * exception: rotation cannot lift a denial, so those steer the model at the
 * denied tool's own remedy instead.
 */

import {
  type KernelState,
  type KernelInput,
} from "../../../kernel/state/kernel-state.js";
import type { ReasoningStep } from "../../../types/index.js";
import {
  buildSuccessfulToolCallCounts,
  getEffectiveMissingRequiredTools,
} from "../../../kernel/capabilities/verify/requirement-state.js";
import {
  META_TOOLS as RUNNER_META_TOOLS,
  HARNESS_PSEUDO_TOOLS,
} from "../../../kernel/state/kernel-constants.js";

export type ToolFailureRecovery = {
  readonly failedUnresolved: readonly string[];
  readonly alternativeCandidates: readonly string[];
  /**
   * Subset of `failedUnresolved` whose most-recent failure observation looks
   * like a TOOL-POLICY refusal (block / allowlist / sandbox / path-traversal /
   * permission-denied families). 2026-10-23 recovery-steering fix (B): the
   * alternate-path rotation was designed for wrong-guess path errors — a
   * policy-blocked tool cannot be remedied by ANY other tool, so the steer
   * must never name an alternate when a refusal is what is still unresolved
   * (3/6 probe runs named the old "Try an alternate path now: file-read"
   * advice on a blocked file-write actively confusing).
   */
  readonly policyBlocked?: readonly string[];
  /** Truncated refusal text per policy-blocked tool — the tool's own remedy re-surfaced by the steer. */
  readonly policyErrors?: Readonly<Record<string, string>>;
};

export type RecoverySteeringKind = "stall" | "loop";

// ─── Policy-denial classification (2026-10-23, fix B) ─────────────────────────
//
// Conservative denial-family matcher over the failed observation's error text,
// grounded in the actual message shapes this framework produces:
//   - `[Tool "x" is forbidden by contract — blocked.]` /
//     `[Tool "x" is not in allowedTools — blocked. Allowed: ...]` (act/tool-observe.ts)
//   - `Path traversal detected: ... outside the working root ...` (tools
//     file-operations/grep confinePath)
//   - `rm is blocked — ...` allowlist reasons (tools shell-execution)
// Transient/ordinary failures deliberately do NOT match: "connection refused",
// ENOENT, timeouts — those keep the pre-fix rotation/retry steering.

const POLICY_DENIAL_PATTERN =
  /(?:\b(?:blocked|forbidden|sandbox)\b|\bnot allowed\b|allow(?:list|edtools?)\b|path traversal|permission denied|outside the working root)/i;

/** Max refusal-text chars re-surfaced into the steer (keep the nudge compact). */
const POLICY_ERROR_EXCERPT_CHARS = 240;

/**
 * True when a failed tool observation's error text indicates a TOOL-POLICY
 * refusal (block / allowlist / sandbox / path-traversal / permission family)
 * rather than a retryable/rotatable failure. Used by the recovery steer to
 * pick the policy arm that never names an alternate tool.
 */
export function isPolicyDeniedToolError(text: string): boolean {
  return POLICY_DENIAL_PATTERN.test(text);
}

export function buildRecoverySteeringGuidance(
  recovery: ToolFailureRecovery,
  failureRecoveryRedirects: number,
  maxFailureRecoveryRedirects: number,
  kind: RecoverySteeringKind,
): string {
  const progress = `(${failureRecoveryRedirects}/${maxFailureRecoveryRedirects})`;

  // Policy arm (fix B, 2026-10-23): a refusal cannot be lifted by tool
  // rotation — NEVER name an alternate tool here. Re-surface the denial's own
  // remedy and point the model back at the SAME tool's arguments.
  const blockedTool = recovery.policyBlocked?.[0];
  if (blockedTool !== undefined) {
    const excerpt = recovery.policyErrors?.[blockedTool];
    const remedy =
      excerpt !== undefined && excerpt.length > 0 ? ` Its error states the remedy: "${excerpt}".` : "";
    if (kind === "stall") {
      return (
        `Recovery required: ${blockedTool} was refused by tool policy.${remedy} ` +
        `Fix ${blockedTool}'s own arguments per that error and retry it — no alternate tool can lift a policy denial. Do not finalize yet. ${progress}`
      );
    }
    return (
        `Recovery required: loop detected after policy-blocked tool ${blockedTool}.${remedy} ` +
        `Retrying other tools cannot help — fix ${blockedTool}'s own arguments per the error before completion. ${progress}`
    );
  }

  const nextPath =
    recovery.alternativeCandidates[0] ??
    recovery.failedUnresolved[0] ??
    "an available tool";
  const failedList = recovery.failedUnresolved.join(", ");

  if (recovery.alternativeCandidates.length > 0) {
    if (kind === "stall") {
      return (
        `Recovery required: prior tool path failed (${failedList}). Try an alternate path now: ${nextPath}. Do not finalize yet. ${progress}`
      );
    }
    return (
      `Recovery required: loop detected after failed tool path (${failedList}). Try alternate path ${nextPath} before completion. ${progress}`
    );
  }
  if (kind === "stall") {
    return (
      `Recovery required: prior tool path failed (${failedList}). Retry ${nextPath} with corrected arguments/evidence. Do not finalize yet. ${progress}`
    );
  }
  return (
    `Recovery required: loop detected after failed tool path (${failedList}). Retry ${nextPath} with corrected arguments before completion. ${progress}`
  );
}

/**
 * Options for the steps-level recovery scan — the subset of KernelInput the
 * scan actually reads. Extracted (F1, 2026-07-02) so the Arbitrator's
 * grounded-terminal gate — which holds an ArbitrationContext, not a full
 * KernelInput — can reuse the SAME failed-unresolved/alternatives logic.
 */
export interface ToolFailureRecoveryOptions {
  readonly requiredTools?: readonly string[];
  readonly requiredToolQuantities?: Readonly<Record<string, number>>;
  readonly relevantTools?: readonly string[];
  readonly availableToolNames?: readonly string[];
}

/**
 * Identify whether failed tool paths still have viable alternatives.
 *
 * A tool is "failed unresolved" when we saw at least one failed observation and
 * no successful observation for that same tool yet.
 *
 * Fix B (2026-10-23): each unresolved failure's most-recent error text is
 * classified against {@link isPolicyDeniedToolError}; policy refusals land in
 * `policyBlocked`/`policyErrors` so {@link buildRecoverySteeringGuidance} can
 * steer the model at the denial's own remedy instead of an alternate tool
 * that cannot lift it.
 */
export function getToolFailureRecoveryFromSteps(
  steps: readonly ReasoningStep[],
  opts: ToolFailureRecoveryOptions,
): ToolFailureRecovery {
  const successCounts = buildSuccessfulToolCallCounts(steps);
  const successful = new Set<string>(Object.keys(successCounts));
  const failed = new Set<string>();
  /** Most-recent failure text per tool — drives the policy-denial classification. */
  const lastErrorByTool = new Map<string, string>();

  for (const step of steps) {
    if (step.type !== "observation") continue;
    const result = step.metadata?.observationResult as
      | { readonly success?: boolean; readonly toolName?: string; readonly displayText?: string }
      | undefined;
    const toolName = result?.toolName;
    if (!toolName || RUNNER_META_TOOLS.has(toolName)) continue;

    if (result.success === false && (successCounts[toolName] ?? 0) === 0) {
      failed.add(toolName);
      lastErrorByTool.set(toolName, result.displayText || step.content || "");
    }
  }

  const required = opts.requiredTools ?? [];
  const requiredStillNeeded = getEffectiveMissingRequiredTools(
    steps,
    required,
    opts.requiredToolQuantities,
  );
  const relevant = opts.relevantTools ?? [];
  const available = opts.availableToolNames ?? [];

  const candidatePool = [...new Set([...requiredStillNeeded, ...required, ...relevant, ...available])]
    .filter((name) => !RUNNER_META_TOOLS.has(name));

  const failedUnresolved = [...failed].filter((name) => !successful.has(name));
  if (failedUnresolved.length === 0) {
    return {
      failedUnresolved: [],
      alternativeCandidates: [],
      policyBlocked: [],
      policyErrors: {},
    };
  }

  const policyBlocked: string[] = [];
  const policyErrors: Record<string, string> = {};
  for (const name of failedUnresolved) {
    const text = lastErrorByTool.get(name) ?? "";
    if (text.length > 0 && isPolicyDeniedToolError(text)) {
      policyBlocked.push(name);
      policyErrors[name] =
        text.length > POLICY_ERROR_EXCERPT_CHARS
          ? `${text.slice(0, POLICY_ERROR_EXCERPT_CHARS)}…`
          : text;
    }
  }

  const failedUnresolvedSet = new Set(failedUnresolved);
  const requiredStillNeededSet = new Set(requiredStillNeeded);
  const alternativeCandidates = candidatePool.filter((name) => {
    if (failedUnresolvedSet.has(name)) return false;
    return requiredStillNeededSet.has(name) || !successful.has(name);
  });

  return {
    failedUnresolved,
    alternativeCandidates,
    policyBlocked,
    policyErrors,
  };
}

/** Kernel-facing wrapper — preserves the original (state, input) signature. */
export function getToolFailureRecovery(
  state: KernelState,
  input: KernelInput,
): ToolFailureRecovery {
  return getToolFailureRecoveryFromSteps(state.steps, {
    requiredTools: input.requiredTools,
    requiredToolQuantities: input.requiredToolQuantities,
    relevantTools: input.relevantTools,
    availableToolNames: (input.availableToolSchemas ?? []).map((t) => t.name),
  });
}

// ── F3 — repeated-identical-failure detection (2026-07-02) ───────────────────
//
// Bench evidence (cogito:8b rw-8): the model repeated the SAME malformed call
// 4× (`file-write` missing `path`), got 4 identical errors, then gave up and
// shipped a guess. Recovery steering existed but only fired on stall/loop
// guards — several wasted iterations later. This detector lets the runner
// inject the steering at the SECOND identical failure.

/** A trailing streak of identical failures for one tool. */
export interface RepeatedToolFailure {
  readonly toolName: string;
  /** Normalized error class (digits collapsed, lowercased, 80-char prefix). */
  readonly errorClass: string;
  /** Consecutive identical failures in the trailing streak (≥ 2 when returned). */
  readonly streak: number;
  /** Index (in `steps`) of the most recent failure observation in the streak. */
  readonly lastIndex: number;
}

/**
 * Normalize an error string into a comparison class: lowercase, digits
 * collapsed to `#` (timeouts/ports/ids vary run-to-run), 80-char prefix.
 */
export function normalizeToolErrorClass(text: string): string {
  return text.trim().toLowerCase().replace(/\d+/g, "#").slice(0, 80);
}

/**
 * Detect a trailing streak of ≥2 consecutive identical failures (same tool,
 * same normalized error class) among substantive tool observations.
 *
 * "Consecutive" is judged over TOOL observations only — thoughts, actions,
 * harness signals, and metadata-less system observations between failures do
 * not break the streak (they are the normal think→act→observe interleaving).
 * A successful tool observation or a different tool/error DOES break it.
 */
export function detectRepeatedIdenticalToolFailure(
  steps: readonly ReasoningStep[],
): RepeatedToolFailure | null {
  let head: { toolName: string; errorClass: string; index: number } | null = null;
  let streak = 0;

  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (!step || step.type !== "observation") continue;
    const result = step.metadata?.observationResult as
      | { readonly success?: boolean; readonly toolName?: string; readonly displayText?: string }
      | undefined;
    const toolName = result?.toolName;
    // Non-tool observations (harness feedback, guard rejections without a real
    // tool result), meta-tools, and harness pseudo-observations (`system`
    // nudges/redirects — success OR failure) are transparent to the streak.
    if (!result || typeof toolName !== "string" || toolName.length === 0) continue;
    if (RUNNER_META_TOOLS.has(toolName) || HARNESS_PSEUDO_TOOLS.has(toolName)) continue;
    if (result.success !== false) break; // a real success ends the streak

    const errorClass = normalizeToolErrorClass(
      result.displayText || step.content || "",
    );
    if (head === null) {
      head = { toolName, errorClass, index: i };
      streak = 1;
      continue;
    }
    if (toolName === head.toolName && errorClass === head.errorClass) {
      streak++;
      continue;
    }
    break; // different tool or different error class
  }

  if (head !== null && streak >= 2) {
    return {
      toolName: head.toolName,
      errorClass: head.errorClass,
      streak,
      lastIndex: head.index,
    };
  }
  return null;
}
