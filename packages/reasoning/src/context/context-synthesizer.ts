/**
 * ContextSynthesizerService — Intelligent Context Synthesis (ICS) default implementation.
 */
import { Context, Effect, Layer } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type { LLMMessage, ModelConfig } from "@reactive-agents/llm-provider";
import { fastSynthesis } from "./synthesis-templates.js";
import type {
  SynthesizedContext,
  SynthesisConfig,
  SynthesisInput,
  SynthesisSignalsSnapshot,
} from "./synthesis-types.js";

export type {
  SynthesizedContext,
  SynthesisConfig,
  SynthesisInput,
  SynthesisSignalsSnapshot,
  SynthesisStrategy,
  SynthesisEntropySignals,
} from "./synthesis-types.js";

// ─── Service tag ─────────────────────────────────────────────────────────────

export class ContextSynthesizerService extends Context.Tag("ContextSynthesizer")<
  ContextSynthesizerService,
  {
    readonly synthesize: (
      input: SynthesisInput,
    ) => Effect.Effect<SynthesizedContext, never, LLMService>;
  }
>() {}

// ─── Escalation ───────────────────────────────────────────────────────────────

function shouldUseDeepSynthesis(input: SynthesisInput): boolean {
  if (input.synthesisConfig.mode === "fast") return false;
  if (input.synthesisConfig.mode === "deep") return true;
  if (input.synthesisConfig.mode !== "auto") return false;

  if (input.tier === "local" && !input.synthesisConfig.model) return false;

  const missingRequired = input.requiredTools.filter((t) => !input.toolsUsed.has(t));

  // Phase-driven escalation: only escalate to deep when the fast path has provably failed
  // (errors, late iteration, high entropy). Fast templates now include tool schemas (GAP 6)
  // and consolidated messages (GAP 3), so they're sufficient for routine tool sequencing.
  // Deep synthesis uses the executing model and adds latency — reserve it for recovery.
  if (input.tier !== "local" && input.taskPhase === "synthesize" && input.lastErrors.length > 0) {
    return true;
  }

  const entropy = input.entropy?.composite ?? 0;
  const trajectory = input.entropy?.trajectory?.shape;
  const iterationRatio = input.iteration / Math.max(1, input.maxIterations);

  return (
    entropy > 0.6 ||
    trajectory === "stalled" ||
    trajectory === "oscillating" ||
    input.lastErrors.length > 0 ||
    (iterationRatio > 0.6 && missingRequired.length > 0)
  );
}

function buildEscalationReason(input: SynthesisInput): string {
  const reasons: string[] = [];
  const entropy = input.entropy?.composite ?? 0;
  const trajectory = input.entropy?.trajectory?.shape;
  const missingRequired = input.requiredTools.filter((t) => !input.toolsUsed.has(t));

  if (input.tier === "local" && !input.synthesisConfig.model) {
    return "local tier without synthesisModel — using fast path";
  }
  if (input.synthesisConfig.mode === "auto" && input.tier !== "local") {
    if (input.taskPhase === "synthesize" && input.lastErrors.length > 0) {
      return `auto — synthesize phase with ${input.lastErrors.length} error(s), escalating`;
    }
  }
  if (entropy > 0.6) reasons.push(`high entropy (${entropy.toFixed(2)})`);
  if (trajectory === "stalled" || trajectory === "oscillating") {
    reasons.push(`${trajectory} trajectory`);
  }
  if (input.lastErrors.length > 0) reasons.push(`${input.lastErrors.length} tool error(s)`);
  const iterationRatio = input.iteration / Math.max(1, input.maxIterations);
  if (iterationRatio > 0.6 && missingRequired.length > 0) {
    reasons.push(`late iteration (${input.iteration}/${input.maxIterations}) with missing required tools`);
  }

  return reasons.length > 0 ? reasons.join(" + ") : "mode:deep configured";
}

function buildFastReason(input: SynthesisInput): string {
  if (input.synthesisConfig.mode === "fast") return "mode:fast — deterministic templates";
  if (input.tier === "local" && !input.synthesisConfig.model) {
    return "local tier without synthesisModel — fast path";
  }
  return "auto — signals within normal range, fast path sufficient";
}

function estimateMessagesTokens(messages: readonly LLMMessage[]): number {
  return messages.reduce((sum, m) => {
    const c = m.content;
    const text =
      typeof c === "string"
        ? c
        : Array.isArray(c)
          ? c
              .map((block) => ("text" in block ? String((block as { text?: string }).text ?? "") : ""))
              .join("")
          : "";
    return sum + Math.ceil(text.length / 4) + 4;
  }, 0);
}

function buildSignalsSnapshot(input: SynthesisInput): SynthesisSignalsSnapshot {
  return {
    entropy: input.entropy?.composite,
    trajectoryShape: input.entropy?.trajectory?.shape,
    tier: input.tier,
    requiredTools: input.requiredTools,
    toolsUsed: [...input.toolsUsed],
    iteration: input.iteration,
    lastErrors: input.lastErrors,
  };
}

// ─── Deep synthesis ──────────────────────────────────────────────────────────

const DEEP_SYNTHESIS_PROMPT = (input: SynthesisInput): string => {
  const missingTools = input.requiredTools.filter((t) => !input.toolsUsed.has(t));
  const completedTools = [...input.toolsUsed].join(", ") || "none";
  const failedStr = input.lastErrors.join(", ") || "none";
  const missingStr = missingTools.join(", ") || "none";

  return `You are a task progress synthesizer. Produce a brief situation summary.

Task: ${input.task}
Completed tools: ${completedTools}
Failed: ${failedStr}
Required but not yet called: ${missingStr}
Iteration: ${input.iteration}/${input.maxIterations}

Respond ONLY with valid JSON (no markdown, no explanation):
{"accomplished":"one sentence","failed":"what failed and why or empty string","remaining":"what still needs to happen","nextAction":"single most important next call with specific arguments"}`;
};

/**
 * Deep LLM-assisted synthesis — bounded completion call.
 * Exported for user composition.
 */
export function deepSynthesis(
  input: SynthesisInput,
): Effect.Effect<readonly LLMMessage[], never, LLMService> {
  return Effect.gen(function* () {
    const llm = yield* LLMService;
    const temperature = input.synthesisConfig.temperature ?? 0.0;
    const executing = yield* llm.getModelConfig();
    const model: ModelConfig | undefined = input.synthesisConfig.model
      ? {
          provider: (input.synthesisConfig.provider ?? executing.provider) as ModelConfig["provider"],
          model: input.synthesisConfig.model,
        }
      : undefined;

    const response = yield* llm
      .complete({
        messages: [{ role: "user", content: DEEP_SYNTHESIS_PROMPT(input) }],
        maxTokens: 150,
        temperature,
        ...(model ? { model } : {}),
      })
      .pipe(Effect.catchAll(() => Effect.succeed(null)));

    if (response === null) {
      return yield* fastSynthesis(input);
    }

    const content = typeof response.content === "string" ? response.content : "";

    let brief: {
      accomplished?: string;
      failed?: string;
      remaining?: string;
      nextAction?: string;
    } = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) brief = JSON.parse(jsonMatch[0]) as typeof brief;
    } catch {
      return yield* fastSynthesis(input);
    }

    // Keep the full fast template (task + tool result excerpts + phase nudge). Replacing
    // with only task + JSON brief drops search/tool facts and models often re-fetch.
    const baseMessages = yield* fastSynthesis(input);

    const lines: string[] = [];
    if (brief.accomplished) lines.push(`Done: ${brief.accomplished}`);
    if (brief.failed) lines.push(`Failed: ${brief.failed}`);
    if (brief.remaining) lines.push(`Remaining: ${brief.remaining}`);
    if (brief.nextAction) lines.push(`Next action: ${brief.nextAction}`);

    if (lines.length === 0) return baseMessages;

    return [
      ...baseMessages,
      {
        role: "user",
        content: `Synthesized progress (prioritize this next step):\n${lines.join("\n")}`,
      },
    ];
  });
}

// ─── Live layer ───────────────────────────────────────────────────────────────

export const ContextSynthesizerLive = Layer.succeed(ContextSynthesizerService, {
  synthesize: (input: SynthesisInput): Effect.Effect<SynthesizedContext, never, LLMService> =>
    Effect.gen(function* () {
      const { synthesisConfig } = input;

      if (synthesisConfig.mode === "custom" && synthesisConfig.synthesisStrategy) {
        const messages = yield* synthesisConfig.synthesisStrategy(input);
        return {
          messages,
          synthesisPath: "custom" as const,
          synthesisReason: "custom synthesisStrategy provided",
          taskPhase: input.taskPhase,
          estimatedTokens: estimateMessagesTokens(messages),
          signalsSnapshot: buildSignalsSnapshot(input),
        } satisfies SynthesizedContext;
      }

      if (synthesisConfig.mode === "off") {
        const messages = yield* fastSynthesis(input);
        return {
          messages,
          synthesisPath: "fast" as const,
          synthesisReason: "synthesis:off — fast template only",
          taskPhase: input.taskPhase,
          estimatedTokens: estimateMessagesTokens(messages),
          signalsSnapshot: buildSignalsSnapshot(input),
        } satisfies SynthesizedContext;
      }

      const useDeep = shouldUseDeepSynthesis(input);
      const reason = useDeep ? buildEscalationReason(input) : buildFastReason(input);

      const messages = useDeep ? yield* deepSynthesis(input) : yield* fastSynthesis(input);

      return {
        messages,
        synthesisPath: useDeep ? ("deep" as const) : ("fast" as const),
        synthesisReason: reason,
        taskPhase: input.taskPhase,
        estimatedTokens: estimateMessagesTokens(messages),
        signalsSnapshot: buildSignalsSnapshot(input),
      } satisfies SynthesizedContext;
    }),
});
