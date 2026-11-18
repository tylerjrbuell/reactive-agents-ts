/**
 * Think phase — parallel tool hint (harness switch `parallelToolHint`, default OFF).
 *
 * Golden-run diagnosis 2026-11-18 (wiki/Research/Harness-Reports/2026-11-18-extra-iterations):
 * independent tool calls went out one per turn (32% of H3 turns), although the
 * kernel already runs every call of one reply before the next think
 * (act.ts, `planNextMoveBatches`), and calibration rates gemma4:e4b, qwen3:14b,
 * qwen3:4b and cogito:14b parallel-`reliable`. That rating only reached the
 * blueprint worker cap. The default mid / large / frontier system prompt
 * already ends with the batching sentence ({@link PARALLEL_CALLS_SENTENCE});
 * the LOCAL tier's prompt (the golden-run models) and any custom system prompt
 * do not carry it.
 *
 * When the switch is on, the system prompt gains that same sentence (one
 * wording, no second builder) where the base prompt lacks it. It sits in the
 * system prompt (not the per-turn guidance) so the prefix stays byte-stable
 * across turns for prompt caching. It is added when ALL of these hold
 * (deterministic):
 *  - the switch is `"always"`, or it is `true` and the model's calibration
 *    rates `parallelCallCapability` `"reliable"`;
 *  - the base system prompt does not already contain the sentence;
 *  - native function calling, tools not withheld, a domain tool on the surface;
 *  - not plan posture;
 *  - parallel tool calls are not turned off (`nextMovesPlanning.enabled: false`
 *    makes the gate keep only the first call, so inviting more would waste them).
 *
 * Record: one `harness-signal-injected` event per turn it renders
 * (`origin: "parallel-tool-hint"`, activity key `signal:nudge@parallel-tool-hint`).
 * No step, no veto: it changes only the prompt text.
 */
import { Effect } from "effect";
import type { ResolvedHarness } from "../../../harness-config.js";
import { emitHarnessSignalInjected } from "../../utils/diagnostics.js";
import type { KernelContext, KernelState } from "../../state/kernel-state.js";
import { META_TOOLS } from "../../state/kernel-constants.js";
import { isPlanPosture } from "../../policy/run-posture.js";
import type { ToolSchema } from "../attend/tool-formatting.js";
import { PARALLEL_CALLS_SENTENCE } from "../attend/context-utils.js";

/** Trace origin (and activity-key suffix) of the parallel tool hint. */
export const PARALLEL_TOOL_HINT_ORIGIN = "parallel-tool-hint";

/** The system-prompt line: the default prompt's own batching sentence. */
export const PARALLEL_TOOL_HINT = PARALLEL_CALLS_SENTENCE;

/** The deterministic facts {@link shouldShowParallelToolHint} decides from. */
export interface ParallelToolHintFacts {
  readonly mode: ResolvedHarness["parallelToolHint"];
  readonly parallelCallCapability: string | undefined;
  /** The base system prompt already carries the sentence (default mid+ prompt). */
  readonly alreadyInPrompt: boolean;
  readonly nativeFC: boolean;
  readonly toolsWithheld: boolean;
  readonly domainToolsOnSurface: boolean;
  readonly planPosture: boolean;
  readonly parallelCallsDisabled: boolean;
}

/** True when this turn's system prompt carries {@link PARALLEL_TOOL_HINT}. Pure. */
export function shouldShowParallelToolHint(t: ParallelToolHintFacts): boolean {
  if (t.mode === undefined) return false;
  if (t.mode === true && t.parallelCallCapability !== "reliable") return false;
  return !t.alreadyInPrompt && t.nativeFC && !t.toolsWithheld && t.domainToolsOnSurface && !t.planPosture && !t.parallelCallsDisabled;
}

/**
 * The hint line for this turn, or "" when it does not apply; a rendered hint
 * is recorded as one `harness-signal-injected` event. Called once per turn by
 * think.ts with the turn's tool surface.
 */
export function parallelToolHintLine(args: {
  readonly state: KernelState;
  readonly context: KernelContext;
  readonly h: Pick<ResolvedHarness, "parallelToolHint">;
  readonly toolsWithheld: boolean;
  readonly surface: readonly Pick<ToolSchema, "name" | "scope">[];
  /** The base system prompt this turn (the sentence is never added twice). */
  readonly systemPrompt: string;
}): Effect.Effect<string, never> {
  return Effect.gen(function* () {
    const { state, context } = args;
    if (args.h.parallelToolHint === undefined) return "";
    const input = context.input;
    const facts: ParallelToolHintFacts = {
      mode: args.h.parallelToolHint,
      parallelCallCapability: input.calibration?.parallelCallCapability,
      alreadyInPrompt: args.systemPrompt.includes(PARALLEL_CALLS_SENTENCE),
      nativeFC: context.toolCallingDriver.mode === "native-fc",
      toolsWithheld: args.toolsWithheld,
      domainToolsOnSurface: args.surface.some((ts) => ts.scope === "domain" || (ts.scope !== "harness" && !META_TOOLS.has(ts.name))),
      planPosture: isPlanPosture(input),
      parallelCallsDisabled: input.nextMovesPlanning?.enabled === false,
    };
    if (!shouldShowParallelToolHint(facts)) return "";
    yield* emitHarnessSignalInjected({
      taskId: state.taskId,
      iteration: state.iteration,
      signalKind: "nudge",
      // Trace-only (census pin in trace-wire-facts.test.ts): the line rides the
      // system prompt, not a guidance field, so it has no render/effect pair.
      origin: "parallel-tool-hint",
      content: PARALLEL_TOOL_HINT,
      metadata: { mode: facts.mode, parallelCallCapability: facts.parallelCallCapability ?? "unknown" },
    });
    return PARALLEL_TOOL_HINT;
  });
}
