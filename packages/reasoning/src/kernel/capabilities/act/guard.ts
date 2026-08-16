/**
 * Guard pipeline for the acting phase.
 *
 * Each Guard is a pure function: (toolCall, state, input) → GuardOutcome.
 * Guards run in order; first failure short-circuits with an observation
 * injected back into the LLM context on the next turn.
 *
 * Strategies configure their own chain by passing a custom Guard[] to checkToolCall().
 */
import type { KernelState, KernelInput } from "../../../kernel/state/kernel-state.js";
import type { ToolCallSpec } from "@reactive-agents/tools";
import { isParallelBatchSafeTool, isConversationalReplyTool } from "../decide/tool-gating.js";
import {
  buildSuccessfulToolCallCounts,
  getMissingRequiredToolsByCount,
  getEffectiveMissingRequiredTools,
} from "../verify/requirement-state.js";
import { findUnconsumedStoredKeys } from "../verify/unconsumed-evidence.js";
import { resolveScratchpadValue } from "@reactive-agents/tools";
import { META_TOOLS as META_TOOL_NAMES, INTROSPECTION_META_TOOLS, isDelegationTool } from "../../../kernel/state/kernel-constants.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuardOutcome =
  | { readonly pass: true }
  | { readonly pass: false; readonly observation: string };

export type Guard = (
  tc: ToolCallSpec,
  state: KernelState,
  input: KernelInput,
) => GuardOutcome;

/**
 * HS-115 / Audit G-E — derive an effective required-tool list.
 *
 * When the caller declared `input.requiredTools`, that wins (explicit user intent
 * always trumps inference). Otherwise we fall back to the comprehend phase's
 * tool nominations (seeded onto `state.meta.nominatedTools` by runner.ts),
 * keeping only those at confidence ≥ 0.7 so weak signals do not block progress.
 *
 * Returns a string[] of tool names — caller-compatible with the existing
 * `input.requiredTools ?? []` shape.
 */
function effectiveRequiredTools(state: KernelState, input: KernelInput): readonly string[] {
  const declared = input.requiredTools ?? [];
  if (declared.length > 0) return declared;
  // `state.meta` is mandatory per KernelState's interface, but some tests
  // construct partial states; defend with optional-chain so the fallback path
  // is a strict superset of "no requiredTools declared".
  const nominated = state.meta?.nominatedTools ?? [];
  if (nominated.length === 0) return [];
  return nominated.filter((n) => n.confidence >= 0.7).map((n) => n.name);
}

function buildActionToolCallCounts(state: KernelState): Readonly<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const step of state.steps) {
    if (step.type !== "action") continue;
    const toolName = (step.metadata?.toolCall as { name?: string } | undefined)?.name;
    if (!toolName) continue;
    counts[toolName] = (counts[toolName] ?? 0) + 1;
  }
  return counts;
}

/**
 * The model's most recent call to `toolName`: whether its observation FAILED,
 * and the argument signature of that call. Used to recognise a
 * correction-after-failure — a call whose arguments DIFFER from a just-failed
 * one is the model adapting to feedback (schema error, validation error), i.e.
 * progress, not blind repetition. Returns null when the tool was never called.
 */
function lastCallToTool(
  state: KernelState,
  toolName: string,
): { readonly failed: boolean; readonly argsJson: string } | null {
  for (let i = state.steps.length - 1; i >= 0; i--) {
    const step = state.steps[i]!;
    if (step.type !== "action") continue;
    const stepTc = step.metadata?.toolCall as { name?: string; arguments?: unknown } | undefined;
    if (stepTc?.name !== toolName) continue;
    const next = state.steps[i + 1];
    const failed =
      next?.type === "observation" &&
      next.metadata?.observationResult?.success === false;
    return { failed, argsJson: JSON.stringify(stepTc.arguments ?? {}) };
  }
  return null;
}

/**
 * Candidate argument keys identifying WHAT a call targets (file path, URL,
 * resource id). Used to tell "3 calls to file-write, 3 different files" (not
 * repetition) apart from "3 calls to file-write, same path" (actually stuck).
 */
const TARGET_ARG_KEYS = ["path", "file", "target", "url", "id", "command"] as const;

/**
 * True when `tc`'s target argument (path/file/target/url/id) differs from
 * every PRIOR call to the same tool. Root fix for the 2026-08-15 rw-7 finding:
 * `repetitionGuard`'s ceiling of 2 for non-parallel-safe tools blocked a 3rd
 * `file-write` call on a task that legitimately required fixing 3 separate
 * source files — the guard counted calls by tool name alone, with no notion
 * of "different target = different unit of work". A tool call carrying no
 * recognized target-ish argument (targetKey undefined) is conservatively
 * treated as NOT distinct, preserving prior behavior for tools this doesn't
 * apply to.
 */
/** For a `command`-shaped arg (a full CLI invocation string), the "target"
 *  that matters is the subcommand (`repo view` vs `repo log`), not the whole
 *  string — two calls varying only their trailing positional/flag args (e.g.
 *  `keep notes get x` vs `keep notes get y`) are the SAME unit of work, not
 *  distinct targets, and must still hit the repetition ceiling. */
function commandTargetValue(key: string, value: string): string {
  if (key !== "command") return value;
  return value.trim().split(/\s+/).slice(0, 2).join(" ");
}

function hasDistinctTarget(tc: ToolCallSpec, state: KernelState): boolean {
  const args = tc.arguments as Record<string, unknown> | undefined;
  const targetKey = TARGET_ARG_KEYS.find((k) => typeof args?.[k] === "string");
  if (!targetKey) return false;
  const targetValue = commandTargetValue(targetKey, args![targetKey] as string);
  for (const step of state.steps) {
    if (step.type !== "action") continue;
    const stepTc = step.metadata?.toolCall as
      | { name?: string; arguments?: Record<string, unknown> }
      | undefined;
    if (stepTc?.name !== tc.name) continue;
    const stepValue = stepTc.arguments?.[targetKey];
    if (typeof stepValue === "string" && commandTargetValue(targetKey, stepValue) === targetValue) {
      return false;
    }
  }
  return true;
}

/** Cap on total injected evidence chars — keeps the deterministic injection
 *  from blowing a local model's context window on a large fetched page. */
const UNCONSUMED_EVIDENCE_INJECT_CHAR_CAP = 6000;

/**
 * Deterministic evidence-grounding guard (2026-08-16 root fix). Root cause
 * (traced live against gemma4:e4b via `rax diagnose`): the harness's only
 * remedy for unread compressed evidence was an ADVISORY nudge suggesting the
 * model call `recall()` — measured firing correctly 5/5 times in one run and
 * being ignored 5/5 times. Soft nudges have no enforcement power over a weak
 * local model; the model went on to write a final answer from memory instead
 * of the evidence it had already fetched (in one traced case, fabricating
 * episode descriptions never present in any tool observation).
 *
 * This guard makes grounding deterministic instead of advisory: on the FIRST
 * `final-answer` attempt with unconsumed stored evidence, it blocks the call
 * and substitutes the model's own advisory-text budget for the ACTUAL full
 * content (via the same scratchpad the harness's own deliverable-assembly
 * fallback already resolves through — `runner-helpers/deliverable.ts`'s
 * `resolveStoredToolObservation`) — no tool call, no model compliance
 * required. Fires at most ONCE: a second `final-answer` attempt passes
 * regardless of remaining unconsumed keys, so the model can never be trapped
 * in a retry loop — it has now been shown the evidence directly; what it does
 * with it from there is the verifier's job, not this guard's.
 */
export const unconsumedEvidenceGuard: Guard = (tc, state) => {
  if (tc.name !== "final-answer") return { pass: true };
  const priorFinalAnswerAttempts = state.steps.some((step) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name?: string } | undefined;
    return stepTc?.name === "final-answer";
  });
  if (priorFinalAnswerAttempts) return { pass: true };

  const keys = findUnconsumedStoredKeys(state.steps);
  if (keys.length === 0) return { pass: true };
  const payloads = keys
    .map((k) => state.scratchpad.get(k))
    .filter((v): v is string => typeof v === "string" && v.length > 0)
    .map(resolveScratchpadValue);
  if (payloads.length === 0) return { pass: true };

  let joined = payloads.join("\n\n---\n\n");
  if (joined.length > UNCONSUMED_EVIDENCE_INJECT_CHAR_CAP) {
    joined = `${joined.slice(0, UNCONSUMED_EVIDENCE_INJECT_CHAR_CAP)}\n…(truncated)`;
  }

  return {
    pass: false,
    observation:
      `Before finalizing: earlier tool results were shown to you only as short previews. ` +
      `Here is the COMPLETE content, expanded automatically — ground your answer in it (do not ` +
      `invent details not present here), then call final-answer again:\n\n${joined}`,
  };
};

/** Re-export for backward compatibility. */
export const META_TOOL_SET = INTROSPECTION_META_TOOLS;

// ─── Individual Guards ────────────────────────────────────────────────────────

/** Blocks tools explicitly listed in input.blockedTools. */
export const blockedGuard: Guard = (tc, _state, input) => {
  const isBlocked = input.blockedTools?.includes(tc.name) ?? false;
  if (isBlocked) {
    return {
      pass: false,
      observation: `⚠️ BLOCKED: ${tc.name} already executed successfully in a prior pass.`,
    };
  }
  return { pass: true };
};

/** Blocks calls to tools not present in the current tool schema set. */
export const availableToolGuard: Guard = (tc, _state, input) => {
  if (META_TOOL_NAMES.has(tc.name) || isDelegationTool(tc.name)) return { pass: true };

  const knownToolNames = new Set(
    (input.allToolSchemas ?? input.availableToolSchemas ?? []).map((schema) => schema.name),
  );
  if (knownToolNames.has(tc.name)) return { pass: true };

  // Always name the ACTUAL available tools rather than narrowing to a
  // search/fetch-named subset whenever one happens to exist — see the
  // matching fix + live-QA repro note in tool-execution.ts's ToolNotFoundError
  // catch branch, the same heuristic duplicated here.
  const suggestion = `Available tools include: ${[...knownToolNames].slice(0, 5).join(", ")}.`;

  return {
    pass: false,
    observation: `Tool "${tc.name}" is not available in this run. ${suggestion} Use EXACT tool names from the tool list.`,
  };
};

/** Blocks the exact same tool+arguments pair if it already succeeded. */
export const duplicateGuard: Guard = (tc, state, input) => {
  const currentActionJson = JSON.stringify({ tool: tc.name, args: tc.arguments });

  // Single pass over state.steps: find the first prior action matching this
  // exact tool+args call that was followed by a successful observation.
  // Previously this guard ran two identical scans (`.some()` to detect a
  // duplicate, then `.findIndex()` to locate it) each re-running
  // JSON.stringify() per step — O(N) stringify calls done twice, every
  // proposed tool call, every kernel iteration. Both scans shared the exact
  // same predicate and both short-circuit on first match, so `.some()` and
  // `.findIndex()` always agreed on the same index; folding them into one
  // loop halves the per-call cost without changing behavior.
  let priorSuccessIdx = -1;
  for (let idx = 0; idx < state.steps.length; idx++) {
    const step = state.steps[idx]!;
    if (step.type !== "action") continue;
    const stepTc = step.metadata?.toolCall as { name: string; arguments: unknown } | undefined;
    if (!stepTc) continue;
    if (JSON.stringify({ tool: stepTc.name, args: stepTc.arguments }) !== currentActionJson) continue;
    const next = state.steps[idx + 1];
    if (next?.type === "observation" && next.metadata?.observationResult?.success === true) {
      priorSuccessIdx = idx;
      break;
    }
  }

  if (priorSuccessIdx < 0) return { pass: true };

  // Surface prior result with advisory — don't re-execute
  const priorObsContent = state.steps[priorSuccessIdx + 1]?.content ?? "";
  // HS-115 anti-scaffold closure: fall back to meta.nominatedTools when caller
  // declared no requiredTools, so missing-tool hints surface even for tasks
  // that only signal requirements via keyword cues ("what's 17*29" → calculator).
  const reqTools = effectiveRequiredTools(state, input);
  const missingReq = getEffectiveMissingRequiredTools(
    state.steps,
    reqTools,
    input.requiredToolQuantities,
  );
  const nextHint = missingReq.length > 0
    ? `You still need to call: ${missingReq.join(", ")}. Do that now.`
    : "Give FINAL ANSWER if all steps are complete.";
  const dupContent = `${priorObsContent} [Already done — do NOT repeat. ${nextHint}]`;

  return {
    pass: false,
    observation: dupContent,
  };
};

/** Blocks side-effect tools (send*, create*, delete*, etc.) from running twice. */
export const sideEffectGuard: Guard = (tc, state, _input) => {
  // Conversational reply tools are repeatable output channels, not once-only
  // mutations — the gateway contract requires calling them more than once
  // (ack, then answer). Exempt them here; `duplicateGuard` (which runs first)
  // still blocks an *identical* re-send, and `repetitionGuard` caps the count.
  if (isConversationalReplyTool(tc.name)) return { pass: true };

  const SIDE_EFFECT_PREFIXES = ["send", "create", "delete", "push", "merge", "fork", "update", "assign", "remove"];
  const isSideEffectTool = SIDE_EFFECT_PREFIXES.some(
    (p) => tc.name.toLowerCase().includes(p),
  );
  if (!isSideEffectTool) return { pass: true };

  const sideEffectAlreadyDone = state.steps.some((step, idx) => {
    if (step.type !== "action") return false;
    const stepTc = step.metadata?.toolCall as { name: string } | undefined;
    if (stepTc?.name !== tc.name) return false;
    const next = state.steps[idx + 1];
    return next?.type === "observation" && next.metadata?.observationResult?.success === true;
  });

  if (!sideEffectAlreadyDone) return { pass: true };

  return {
    pass: false,
    observation: `⚠️ ${tc.name} already executed successfully with different parameters. Side-effect tools must NOT be called twice. Move on to the next step or give FINAL ANSWER.`,
  };
};

/** Nudges the LLM when it calls the same non-meta tool too many times.
 *  Parallel-safe tools (http-get, web-search, etc.) allow up to maxBatchSize
 *  calls before triggering; sequential-only tools are limited to 2. */
export const repetitionGuard: Guard = (tc, state, input) => {
  if (META_TOOL_NAMES.has(tc.name)) return { pass: true };
  if (isDelegationTool(tc.name)) return { pass: true };

  const actionCounts = buildActionToolCallCounts(state);
  const priorCallsOfSameTool = actionCounts[tc.name] ?? 0;

  // requiredToolQuantities[tool] is a FLOOR (min calls required by the task).
  // The repetition-guard threshold is a CEILING (max before nudging).
  // For parallel-safe tools the ceiling is always at least maxBatchSize;
  // for sequential-only tools it's at least 2.
  // We take max(floor, default-ceiling) so a low minCalls value never
  // shrinks the allowed call window for parallel-safe tools.
  const quantityLimit = input.requiredToolQuantities?.[tc.name] ?? 0;
  const maxBatchSize = input.nextMovesPlanning?.maxBatchSize ?? 4;
  const defaultCeiling = isParallelBatchSafeTool(tc.name) ? maxBatchSize : 2;
  const threshold = Math.max(quantityLimit, defaultCeiling);
  if (priorCallsOfSameTool < threshold) return { pass: true };

  // Distinct-target carve-out: a call to a new file/URL/resource is a new
  // unit of work, not repetition of the ceiling-triggering pattern.
  if (hasDistinctTarget(tc, state)) return { pass: true };

  // FM-16 layer D-guard: don't force a stop while escalation (FM-17 layer 3)
  // hasn't exhausted its widened budget yet — the model may not have actually
  // SEEN enough of the prior results to know it's done. Reads `stallCount`,
  // which is deliberately the CURRENT-stall signal: it resets on any clean
  // iteration, because the question this guard asks is "is the run stalling
  // RIGHT NOW".
  //
  // NOTE: that is a DIFFERENT clock from the projector's render escalation,
  // which keys on `RequirementProgress.refEscalation` — a monotonic per-ref
  // level that never resets (assess.ts, finding I2). The two share a numeric
  // ceiling of 4 but NOT a meaning: `MAX_ESCALATION_LEVEL` bounds render COST
  // per ref; `ESCALATION_EXHAUSTED` gates a CONTROL action. A ref can sit at a
  // fully-widened 7x budget while `stallCount` is 0 — correctly so, because a
  // clean iteration means the model just saw something it had not seen before.
  const ESCALATION_EXHAUSTED = 4;
  const stalledRequirement = [...(state.meta?.assessment?.requirementProgress ?? new Map())]
    .find(([, p]) => p.stallCount > 0);
  if (stalledRequirement && stalledRequirement[1].stallCount < ESCALATION_EXHAUSTED) {
    return { pass: true };
  }

  // Converging-retry carve-out (root fix 2026-08-06). A call that ADAPTS to a
  // prior failure — distinct arguments after the tool's last call failed — is
  // progress, not repetition. This is the natural schema→attempt→correct loop
  // that schema-driven CLI / API tools require (e.g. gws-cli: `schema` →
  // `create --json <wrong>` → validation error → `create --json <fixed>`).
  // Counting by tool NAME alone blocked the corrective call and forced a
  // premature, often FABRICATED, final answer (the side-effect never ran).
  // `duplicateGuard` still blocks identical-args re-calls, and the loop
  // detector's "N same-tool calls with no successful observation" pattern +
  // the iteration cap bound an endless fail/correct loop.
  const last = lastCallToTool(state, tc.name);
  if (last?.failed && last.argsJson !== JSON.stringify(tc.arguments ?? {})) {
    return { pass: true };
  }

  // Build missing-tools hint with N/M count progress when quantities are known.
  // HS-115 anti-scaffold closure: same nominator-fallback path as duplicateGuard.
  const reqTools = effectiveRequiredTools(state, input);
  const quantities = input.requiredToolQuantities ?? {};
  const successfulCounts = buildSuccessfulToolCallCounts(state.steps);
  const missingRequired = getEffectiveMissingRequiredTools(
    state.steps,
    reqTools,
    quantities,
  );
  const missingHint = missingRequired.length > 0
    ? ` You still need to call: ${missingRequired.map((t) => {
        const needed = quantities[t];
        if (!needed || needed <= 1) return t;
        const actual = successfulCounts[t] ?? 0;
        return `${t} (${actual}/${needed} calls done)`;
      }).join(", ")}. Do that now instead of repeating ${tc.name}.`
    : " Use final-answer to respond now.";
  const stallSuffix = stalledRequirement
    ? ` The harness has shown you everything it has on requirement "${stalledRequirement[0]}"; this line of evidence is exhausted.`
    : "";
  const nudge = `⚠️ You have already called ${tc.name} ${priorCallsOfSameTool} times. Stop repeating this tool.${missingHint}${stallSuffix}`;

  return {
    pass: false,
    observation: nudge,
  };
};

/**
 * Returns true when the same meta-introspection tool has been called
 * consecutiveCount times already and is being called again.
 *
 * Threshold: block on the 3rd+ consecutive identical call (consecutiveCount >= 2).
 * The first repeat (count === 1) is allowed with a warning via the guard message.
 */
export function isConsecutiveMetaToolSpam(opts: {
  toolName: string;
  lastMetaToolCall: string | undefined;
  consecutiveCount: number;
}): boolean {
  if (!META_TOOL_SET.has(opts.toolName)) return false;
  return opts.toolName === opts.lastMetaToolCall && opts.consecutiveCount >= 2;
}

/**
 * Blocks a meta-introspection tool (brief/pulse/find/recall) when it has been
 * called 3+ consecutive times with the same tool name.
 * Redirects the model to either use a task tool or call final-answer.
 */
export const metaToolDedupGuard: Guard = (tc, state) => {
  if (!META_TOOL_SET.has(tc.name)) return { pass: true };
  const lastMeta = state.lastMetaToolCall;
  const count = state.consecutiveMetaToolCount ?? 0;
  if (isConsecutiveMetaToolSpam({ toolName: tc.name, lastMetaToolCall: lastMeta, consecutiveCount: count })) {
    return {
      pass: false,
      observation: `You just called ${tc.name} ${count} times in a row. Nothing has changed. Stop calling ${tc.name} and either use a task tool or call final-answer.`,
    };
  }
  return { pass: true };
};

// ─── Default Pipeline ─────────────────────────────────────────────────────────

/** Default guard chain used by the standard ReAct kernel. */
export const defaultGuards: Guard[] = [
  blockedGuard,
  availableToolGuard,
  duplicateGuard,
  sideEffectGuard,
  repetitionGuard,
  metaToolDedupGuard,
  unconsumedEvidenceGuard,
];

// ─── Pipeline Runner ──────────────────────────────────────────────────────────

/**
 * Builds a guard-check function from a guard pipeline.
 * Guards run in order; first failure short-circuits.
 *
 * @example
 * // Standard usage
 * const check = checkToolCall(defaultGuards);
 *
 * // Strategy-specific: skip repetition guard
 * const check = checkToolCall([blockedGuard, duplicateGuard, sideEffectGuard]);
 */
export function checkToolCall(guards: Guard[]) {
  return (tc: ToolCallSpec, state: KernelState, input: KernelInput): GuardOutcome => {
    for (const guard of guards) {
      const outcome = guard(tc, state, input);
      if (!outcome.pass) return outcome;
    }
    return { pass: true };
  };
}
