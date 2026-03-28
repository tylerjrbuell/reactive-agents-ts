/**
 * Resolves {@link SynthesisConfig} for the current execution strategy:
 * per-strategy `.withReasoning({ strategies: { ... } })` ICS fields override
 * top-level synthesis fields; when `reasoningOptions` is absent, optional
 * legacy `synthesisConfig` on {@link ReactiveAgentsConfig} is used.
 */
import type { SynthesisConfig } from "@reactive-agents/reasoning";
import type { ReasoningSynthesisResolutionInput, StrategySynthesisFields } from "./reasoning-synthesis-fields.js";

const EXEC_STRATEGY_TO_BUNDLE: Readonly<
  Record<string, keyof NonNullable<ReasoningSynthesisResolutionInput["strategies"]>>
> = {
  reactive: "reactive",
  "plan-execute-reflect": "planExecute",
  "tree-of-thought": "treeOfThought",
  reflexion: "reflexion",
};

/** Strip ICS-only keys before merging into {@link ReasoningConfig} strategies. */
export function withoutStrategyIcsOverrides<T extends object | undefined>(
  s: T,
): Omit<NonNullable<T>, keyof StrategySynthesisFields> {
  if (s === undefined) return {} as Omit<NonNullable<T>, keyof StrategySynthesisFields>;
  const {
    synthesis,
    synthesisModel,
    synthesisProvider,
    synthesisStrategy,
    synthesisTemperature,
    ...rest
  } = s as StrategySynthesisFields & Record<string, unknown>;
  return rest as Omit<NonNullable<T>, keyof StrategySynthesisFields>;
}

function baseSynthesisFromReasoningOptions(ro: ReasoningSynthesisResolutionInput | undefined): SynthesisConfig {
  return {
    mode: ro?.synthesis ?? "auto",
    ...(ro?.synthesisModel !== undefined ? { model: ro.synthesisModel } : {}),
    ...(ro?.synthesisProvider !== undefined ? { provider: ro.synthesisProvider } : {}),
    ...(ro?.synthesisStrategy !== undefined ? { synthesisStrategy: ro.synthesisStrategy } : {}),
    ...(ro?.synthesisTemperature !== undefined ? { temperature: ro.synthesisTemperature } : {}),
  };
}

function mergeStrategyOverlay(base: SynthesisConfig, st: StrategySynthesisFields | undefined): SynthesisConfig {
  if (!st) return base;
  return {
    mode: st.synthesis ?? base.mode,
    ...(st.synthesisModel !== undefined ? { model: st.synthesisModel } : base.model !== undefined ? { model: base.model } : {}),
    ...(st.synthesisProvider !== undefined
      ? { provider: st.synthesisProvider }
      : base.provider !== undefined
        ? { provider: base.provider }
        : {}),
    ...(st.synthesisStrategy !== undefined
      ? { synthesisStrategy: st.synthesisStrategy }
      : base.synthesisStrategy !== undefined
        ? { synthesisStrategy: base.synthesisStrategy }
        : {}),
    ...(st.synthesisTemperature !== undefined
      ? { temperature: st.synthesisTemperature }
      : base.temperature !== undefined
        ? { temperature: base.temperature }
        : {}),
  };
}

/**
 * @param executionStrategy - Effective kernel strategy name (e.g. from tier routing).
 * @param legacySynthesisConfig - Optional flattened config when no `reasoningOptions` (tests / manual config).
 */
export function resolveSynthesisConfigForStrategy(
  ro: ReasoningSynthesisResolutionInput | undefined,
  executionStrategy: string,
  legacySynthesisConfig?: SynthesisConfig,
): SynthesisConfig {
  const base =
    ro !== undefined ? baseSynthesisFromReasoningOptions(ro) : (legacySynthesisConfig ?? { mode: "auto" });

  const bundleKey = EXEC_STRATEGY_TO_BUNDLE[executionStrategy];
  const st = bundleKey ? ro?.strategies?.[bundleKey] : undefined;
  return mergeStrategyOverlay(base, st);
}
