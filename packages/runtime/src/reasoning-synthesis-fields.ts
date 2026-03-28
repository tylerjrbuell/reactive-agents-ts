import type { SynthesisStrategy } from "@reactive-agents/reasoning";

/**
 * ICS fields allowed on each `.withReasoning({ strategies: { ... } })` bundle.
 * Merged with top-level synthesis options in {@link resolveSynthesisConfigForStrategy}.
 */
export interface StrategySynthesisFields {
  readonly synthesis?: "auto" | "fast" | "deep" | "custom" | "off";
  readonly synthesisModel?: string;
  readonly synthesisProvider?: string;
  readonly synthesisStrategy?: SynthesisStrategy;
  readonly synthesisTemperature?: number;
}

/** Narrow input shape for synthesis resolution (avoids importing `builder`). */
export interface ReasoningSynthesisResolutionInput {
  readonly synthesis?: StrategySynthesisFields["synthesis"];
  readonly synthesisModel?: string;
  readonly synthesisProvider?: string;
  readonly synthesisStrategy?: SynthesisStrategy;
  readonly synthesisTemperature?: number;
  readonly strategies?: Partial<{
    reactive: StrategySynthesisFields;
    planExecute: StrategySynthesisFields;
    treeOfThought: StrategySynthesisFields;
    reflexion: StrategySynthesisFields;
  }>;
}
