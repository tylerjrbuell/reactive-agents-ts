/**
 * prompt-sections-default.ts — Default registry population (APC-3).
 *
 * Extracts the 7 sections currently inlined in `buildIterationSystemPrompt`
 * into registered `PromptSection`s. Each section is byte-identical to its
 * prior inline form, so calling `composePrompt(defaultPromptSectionRegistry,
 * ctx, {shapeGated: false})` produces the same output as the legacy monolith.
 *
 * Section IDs (composition order, matching context-manager.ts:204-296):
 *   1. "identity"                   agent identity + adapter.systemPromptPatch
 *   2. "prior-context"              cross-run memory (conditional on input.priorContext)
 *   3. "static-context"             environment + tools + task + rules (+ adapter.toolGuidance)
 *   4. "tool-elaboration"           optional, via options.toolElaboration
 *   5. "progress"                   iteration + tools-called summary
 *   6. "prior-work"                 distilled observation facts
 *   7. "guidance"                   harness signals
 *
 * Each section's `requiredWhen` defaults to `() => true` so the parity-mode
 * composer reproduces today's behavior exactly. APC-4 tightens predicates
 * with evidence (e.g., guidance + prior-work omitted on trivial-shape
 * tasks per APC-0 discriminator data).
 *
 * Reference:
 *   - Pre-extraction monolith: packages/reasoning/src/context/context-manager.ts:196
 *   - APC-0 evidence:           wiki/Research/Ablations/2026-05-27-apc-0-minimal-prompt-discriminator.md
 */
import type { ProviderAdapter } from "@reactive-agents/llm-provider";
import type { KernelInput, KernelState } from "../kernel/state/kernel-state.js";
import type { ToolSchema } from "../kernel/capabilities/attend/tool-formatting.js";
import {
  buildSystemPrompt,
} from "../kernel/capabilities/attend/context-utils.js";
import {
  buildToolElaborationInjection,
  type ToolElaborationInjectionConfig,
} from "../kernel/capabilities/act/tool-gating.js";
import { buildStaticContext } from "./context-engine.js";
import type { GuidanceContext } from "./context-manager.js";
import type {
  PromptSection,
  PromptSectionContext,
} from "./prompt-composer.js";
import { PromptSectionRegistry } from "./prompt-composer.js";

// ── Typed options bridge ─────────────────────────────────────────────────────

/**
 * Subset of ContextManagerOptions that the default sections consult. Kept
 * here (rather than importing from context-manager) to avoid a circular
 * import: context-manager → prompt-sections-default → context-manager.
 */
interface DefaultSectionOptions {
  readonly toolElaboration?: ToolElaborationInjectionConfig;
  readonly availableTools?: readonly ToolSchema[];
  readonly systemPromptBody?: string;
}

function readOptions(ctx: PromptSectionContext): DefaultSectionOptions {
  return (ctx.options ?? {}) as DefaultSectionOptions;
}

function effectiveTools(
  ctx: PromptSectionContext,
): readonly ToolSchema[] {
  const opts = readOptions(ctx);
  return (
    opts.availableTools ??
    ((ctx.input.availableToolSchemas ?? []) as readonly ToolSchema[])
  );
}

// ── Section: identity ─────────────────────────────────────────────────────────

export const identitySection: PromptSection = {
  id: "identity",
  description:
    "Agent identity + tier-adaptive system prompt + adapter.systemPromptPatch",
  // Identity always required — there is no shape under which we drop it.
  requiredWhen: () => true,
  render: (ctx) => {
    const opts = readOptions(ctx);
    const base = buildSystemPrompt(
      ctx.input.task,
      opts.systemPromptBody ?? ctx.input.systemPrompt,
      ctx.profile.tier,
    );
    const tier = ctx.profile.tier ?? "mid";
    return ctx.adapter?.systemPromptPatch?.(base, tier) ?? base;
  },
  costTokensApprox: 60,
};

/**
 * APC-4 high-confidence-trivial predicate. Returns true when the task is
 * confirmed trivial (high-confidence verdict, no tool/multistep/citation/
 * structured needs) — i.e., a single-fact knowledge recall like
 * `k1-france-capital` or `k3-rgb-colors`.
 *
 * Used as the inverse condition for "drop this section": when this returns
 * TRUE, the section is safe to strip; when FALSE, the section is kept.
 */
function isHighConfidenceTrivial(shape: import("../kernel/capabilities/comprehend/task-shape.js").TaskShape): boolean {
  return (
    shape.complexity === "trivial" &&
    shape.highConfidence &&
    !shape.needsTools &&
    !shape.needsMultiStep &&
    !shape.needsCitation &&
    !shape.needsStructuredOutput
  );
}

// ── Section: prior-context (cross-run memory) ─────────────────────────────────

export const priorContextSection: PromptSection = {
  id: "prior-context",
  description:
    "Cross-run memory (episodic + semantic) from ExecutionEngine — iter 0 only (Lever 2)",
  requiredWhen: () => true,
  render: (ctx) => {
    // Lever 2 (#146): iter 0 only — by iter 1+ the model has memory context
    // in its message thread; resending the system-prompt prior-context block
    // is pure repetition. Empirically dropped without quality cost (c1 -45%,
    // f1 -25% on local-tier).
    if (ctx.state.iteration > 0) return null;
    const prior = ctx.input.priorContext?.trim();
    return prior && prior.length > 0 ? prior : null;
  },
  costTokensApprox: 80,
};

// ── Section: static-context (env + tools + task + rules + toolGuidance) ───────

export const staticContextSection: PromptSection = {
  id: "static-context",
  description:
    "Environment + tool schemas + task + rules; adapter.toolGuidance appended inline",
  // APC-4: strip on high-confidence-trivial tasks. Task text still reaches
  // the LLM as state.messages[0] user role; identity section provides
  // tier-adaptive system framing. APC-0 evidence: -14 to -25% on trivial
  // subset, zero quality regression.
  requiredWhen: (shape) => !isHighConfidenceTrivial(shape),
  render: (ctx) => {
    const availableTools = effectiveTools(ctx);
    const staticContext = buildStaticContext({
      task: ctx.input.task,
      profile: ctx.profile,
      availableToolSchemas: availableTools,
      requiredTools: ctx.input.requiredTools as string[] | undefined,
      environmentContext: ctx.input.environmentContext,
    });
    // Lever 2 (#146): adapter toolGuidance (rationale rules, provider-specific
    // reminders) is stable across iterations — emit on iter 0 only. Static
    // context itself is kept every iter because local-tier models regress on
    // tool tasks when tool reference disappears mid-loop (empirical m2 +28%).
    if (ctx.state.iteration > 0) return staticContext;
    const toolGuidancePatch = ctx.adapter?.toolGuidance?.({
      toolNames: availableTools.map((t) => t.name),
      requiredTools: ctx.input.requiredTools ?? [],
      tier: ctx.profile.tier ?? "mid",
      experienceSummary: undefined,
    });
    return toolGuidancePatch
      ? `${staticContext}\n${toolGuidancePatch}`
      : staticContext;
  },
  costTokensApprox: 200,
};

// ── Section: tool-elaboration ─────────────────────────────────────────────────

export const toolElaborationSection: PromptSection = {
  id: "tool-elaboration",
  description:
    "Opt-in tool-call elaboration hints — iter 0 only (Lever 2)",
  // APC-4: only meaningful when tools are actually needed.
  requiredWhen: (shape) => shape.needsTools,
  render: (ctx) => {
    // Lever 2 (#146): elaboration hints are stable across iterations — emit
    // only on iter 0. Model retains the elaboration context once delivered.
    if (ctx.state.iteration > 0) return null;
    const opts = readOptions(ctx);
    if (!opts.toolElaboration) return null;
    const availableTools = effectiveTools(ctx);
    const section = buildToolElaborationInjection(
      availableTools,
      opts.toolElaboration,
    );
    return section || null;
  },
  costTokensApprox: 50,
};

// ── Section: progress ─────────────────────────────────────────────────────────

export const progressSection: PromptSection = {
  id: "progress",
  description: "Iteration counter + tools called + required-tool status",
  requiredWhen: () => true,
  render: (ctx) => buildProgressText(ctx.state, ctx.input),
  costTokensApprox: 40,
};

function buildProgressText(state: KernelState, input: KernelInput): string | null {
  if (state.toolsUsed.size === 0 && state.iteration === 0) return null;
  const lines: string[] = [];
  const maxIter = (state.meta?.maxIterations as number | undefined) ?? 10;
  lines.push(`Iteration: ${state.iteration + 1}/${maxIter}`);
  if (state.toolsUsed.size > 0) {
    lines.push(`Tools called: ${[...state.toolsUsed].join(", ")}`);
  }
  const requiredTools = (input.requiredTools ?? []) as string[];
  if (requiredTools.length > 0) {
    const pending = requiredTools.filter((t) => !state.toolsUsed.has(t));
    if (pending.length === 0) {
      lines.push(`Required tools: all satisfied ✓`);
    } else {
      lines.push(`Required tools pending: ${pending.join(", ")}`);
    }
  }
  return `Progress:\n${lines.join("\n")}`;
}

// ── Section: prior-work (distilled observations) ──────────────────────────────

export const priorWorkSection: PromptSection = {
  id: "prior-work",
  description: "Distilled extractedFact strings from observation steps",
  requiredWhen: () => true,
  render: (ctx) => buildPriorWorkText(ctx.state),
  costTokensApprox: 100,
};

function buildPriorWorkText(state: KernelState): string | null {
  const facts: string[] = [];
  for (const step of state.steps) {
    if (step.type !== "observation") continue;
    const fact = step.metadata?.extractedFact as string | undefined;
    if (fact) facts.push(`- ${fact}`);
  }
  if (facts.length === 0) return null;
  return `Prior work:\n${facts.join("\n")}`;
}

// ── Section: guidance (harness signals) ───────────────────────────────────────

export const guidanceSection: PromptSection = {
  id: "guidance",
  description: "Harness signals: required tools, loops, ICS, errors, oracle",
  // APC-4: harness guidance is load-bearing on tool/multi-step paths
  // (APC-0: stripping caused +42% to +136% output on those tasks). Drop
  // only on high-confidence-trivial where there is no tool loop to nudge.
  requiredWhen: (shape) => !isHighConfidenceTrivial(shape),
  render: (ctx) => buildGuidanceText(ctx.guidance),
  costTokensApprox: 80,
};

export function buildGuidanceText(guidance: GuidanceContext): string | null {
  const signals: string[] = [];

  if (guidance.requiredToolsPending.length > 0) {
    signals.push(
      `REQUIRED tools not yet called: ${guidance.requiredToolsPending.join(", ")}. Call these before giving a final answer.`,
    );
  }
  if (guidance.loopDetected) {
    signals.push(
      guidance.loopDetectedMessage ??
        "Loop detected: you are repeating the same tool calls. Try a different approach or synthesize what you have.",
    );
  }
  if (guidance.icsGuidance) signals.push(guidance.icsGuidance);
  if (guidance.oracleGuidance) signals.push(guidance.oracleGuidance);
  if (guidance.errorRecovery) signals.push(guidance.errorRecovery);
  if (guidance.actReminder) signals.push(guidance.actReminder);
  if (guidance.qualityGateHint) signals.push(guidance.qualityGateHint);
  if (guidance.evidenceGap) {
    signals.push(
      `Your answer contains claims not supported by tool results: ${guidance.evidenceGap}. Revise using only data from the Observations above.`,
    );
  }

  if (signals.length === 0) return null;
  return `Guidance:\n${signals.map((s) => `- ${s}`).join("\n")}`;
}

// ── Ordered list (composition order) ──────────────────────────────────────────

// ── Section: task-echo (APC-4 trivial-strip safety) ──────────────────────────
//
// When APC-4 strips static-context on high-confidence-trivial tasks, the
// task text is no longer rendered in the system prompt. The execution
// engine seeds the task into state.messages[0] (user role), so production
// flows preserve task visibility — but strategy-level callers that bypass
// the message-seeding path (e.g., direct executeReactive in tests) would
// lose the task entirely.
//
// task-echo fires ONLY when static-context is stripped, emitting a compact
// "Task: {task}" line. Mirrors the RA_MINIMAL_PROMPT escape hatch's
// task-preservation behavior. Mastra-equivalent compact framing.

export const taskEchoSection: PromptSection = {
  id: "task-echo",
  description: "Compact task framing when static-context is stripped",
  // INVERSE of static-context's predicate — fires only when static is dropped.
  requiredWhen: (shape) => isHighConfidenceTrivial(shape),
  render: (ctx) => {
    const trimmed = ctx.input.task?.trim();
    if (!trimmed) return null;
    return `Task: ${trimmed}`;
  },
  costTokensApprox: 30,
};

/**
 * Default ordered list. Sections 1-3 mirror the legacy monolith order.
 * `task-echo` slots immediately after `prior-context` so trivial-stripped
 * prompts have the task in the same logical position as static-context
 * would have placed it. Predicates ensure exactly one of
 * `task-echo` / `static-context` renders per call.
 */
export const DEFAULT_SECTIONS: readonly PromptSection[] = [
  identitySection,
  priorContextSection,
  taskEchoSection,
  staticContextSection,
  toolElaborationSection,
  progressSection,
  priorWorkSection,
  guidanceSection,
];

/** Build a fresh registry pre-populated with the default sections. */
export function makeDefaultSectionRegistry(): PromptSectionRegistry {
  const registry = new PromptSectionRegistry();
  for (const section of DEFAULT_SECTIONS) {
    registry.register(section);
  }
  return registry;
}
