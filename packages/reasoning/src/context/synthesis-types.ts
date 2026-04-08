/**
 * Intelligent Context Synthesis (ICS) — shared types (no runtime deps on templates).
 */
import type { Effect } from "effect";
import type { LLMMessage, LLMService } from "@reactive-agents/llm-provider";
import type { ToolSchema } from "../strategies/kernel/utils/tool-utils.js";
import type { KernelMessage } from "../strategies/kernel/kernel-state.js";
import type { ModelTier } from "./context-profile.js";

/** The current phase of a task execution (inlined from deleted task-phase.ts). */
export type TaskPhase = "orient" | "gather" | "synthesize" | "produce" | "verify";

// ─── Entropy shape for synthesis (no @reactive-agents/reactive-intelligence dependency) ───

/** Minimal entropy surface used by escalation logic in ContextSynthesizer */
export interface SynthesisEntropySignals {
  readonly composite?: number;
  readonly trajectory?: { readonly shape?: string };
}

// ─── SynthesisStrategy ───────────────────────────────────────────────────────

/**
 * A synthesis strategy function — the primary extension point for ICS.
 * Takes all framework signals and returns the exact messages the model will receive.
 */
export type SynthesisStrategy = (
  input: SynthesisInput,
) => Effect.Effect<readonly LLMMessage[], never, LLMService>;

// ─── SynthesisConfig ─────────────────────────────────────────────────────────

/**
 * Configuration for context synthesis behavior.
 * Configured via .withReasoning({ synthesis: "auto" }).
 */
export interface SynthesisConfig {
  readonly mode: "auto" | "fast" | "deep" | "custom" | "off";
  readonly model?: string;
  readonly provider?: string;
  readonly temperature?: number;
  readonly synthesisStrategy?: SynthesisStrategy;
}

// ─── SynthesisSignalsSnapshot ────────────────────────────────────────────────

/** Snapshot of signals used for synthesis — included in EventBus event for observability */
export interface SynthesisSignalsSnapshot {
  readonly entropy: number | undefined;
  readonly trajectoryShape: string | undefined;
  readonly tier: ModelTier;
  readonly requiredTools: readonly string[];
  readonly toolsUsed: readonly string[];
  readonly iteration: number;
  readonly lastErrors: readonly string[];
}

// ─── SynthesisInput ──────────────────────────────────────────────────────────

/** All inputs required to synthesize context for the next LLM call */
export interface SynthesisInput {
  readonly transcript: readonly KernelMessage[];
  readonly task: string;
  readonly taskPhase: TaskPhase;
  readonly requiredTools: readonly string[];
  readonly toolsUsed: ReadonlySet<string>;
  readonly availableTools: readonly ToolSchema[];
  readonly entropy: SynthesisEntropySignals | undefined;
  readonly iteration: number;
  readonly maxIterations: number;
  readonly lastErrors: readonly string[];
  readonly tier: ModelTier;
  readonly tokenBudget: number;
  readonly synthesisConfig: SynthesisConfig;
}

// ─── SynthesizedContext ──────────────────────────────────────────────────────

/** The output of context synthesis — what the model will actually receive */
export interface SynthesizedContext {
  readonly messages: readonly LLMMessage[];
  readonly synthesisPath: "fast" | "deep" | "custom";
  readonly synthesisReason: string;
  readonly taskPhase: TaskPhase;
  readonly estimatedTokens: number;
  readonly signalsSnapshot: SynthesisSignalsSnapshot;
}
