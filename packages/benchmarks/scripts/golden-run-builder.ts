/**
 * Single source of truth for the golden-run agent configuration.
 *
 * Each step pairs the code line shown on the docs home page with the call that
 * actually runs, so the displayed snippet cannot drift from the captured run.
 * `capture-golden-run.ts` applies the steps; the docs generator imports
 * `goldenBuilderLines()` for display.
 */
import type { ReactiveAgentBuilder } from "@reactive-agents/runtime";

export const GOLDEN_PROVIDER = "ollama";
export const GOLDEN_MODEL = "gemma4:e4b";
export const GOLDEN_TASK = `Compare the moon counts of Jupiter, Saturn, and Mars. Write a markdown report to ./report.md and the raw data as a JSON array to ./data.json.`;

/** Receipt-signing option. The private key is supplied at capture time only. */
export interface GoldenBuildOptions {
  readonly privateKeyJwk: JsonWebKey;
  /** Failed-run variant: iteration cap. Omitted for the success capture. */
  readonly maxIterations?: number;
}

interface BuilderStep {
  /** Line shown in docs (no leading indent, no trailing newline). */
  readonly line: string;
  readonly apply: (b: ReactiveAgentBuilder, o: GoldenBuildOptions) => ReactiveAgentBuilder;
}

const STEPS: readonly BuilderStep[] = [
  { line: `.withProvider("${GOLDEN_PROVIDER}")`, apply: (b) => b.withProvider(GOLDEN_PROVIDER) },
  { line: `.withModel("${GOLDEN_MODEL}")`, apply: (b) => b.withModel(GOLDEN_MODEL) },
  { line: `.withReasoning()`, apply: (b) => b.withReasoning() },
  { line: `.withTools({ builtins: true })`, apply: (b) => b.withTools({ builtins: true }) },
  { line: `.withObservability()`, apply: (b) => b.withObservability() },
  // gemma4:e4b advertises a `thinking` capability; without this every captured
  // thought step has empty content.
  { line: `.withThinking(true)`, apply: (b) => b.withThinking(true) },
  // Debrief synthesis is memory-gated.
  { line: `.withMemory()`, apply: (b) => b.withMemory() },
  {
    line: `.withReceiptSigning({ privateKeyJwk })`,
    apply: (b, o) => b.withReceiptSigning({ privateKeyJwk: o.privateKeyJwk }),
  },
];

/** Lines of the displayed builder chain, in order, with the `create()` opener and `build()` closer. */
export const goldenBuilderLines = (): readonly string[] => [
  `const agent = await ReactiveAgents.create()`,
  ...STEPS.map((s) => `  ${s.line}`),
  `  .build();`,
];

/** Apply every step (plus the optional failure-variant cap) to a fresh builder. */
export const applyGoldenBuilder = (
  start: ReactiveAgentBuilder,
  options: GoldenBuildOptions,
): ReactiveAgentBuilder => {
  let b = STEPS.reduce((acc, s) => s.apply(acc, options), start);
  if (options.maxIterations !== undefined) b = b.withMaxIterations(options.maxIterations);
  return b;
};
