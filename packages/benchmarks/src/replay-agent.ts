// The replay rail's last mile: build a REAL agent whose entire LLM path is the
// recorded model stream, so the whole harness (kernel, guards, tool-surface,
// assembly, verifier) runs deterministically against a golden with NO live
// provider and NO keys — the keystone the audit found unwired.
//
// Two seams make it possible, both landed 2026-07-10:
//   - `.withReplayLLM(layer)` swaps the base LLMService upstream of every
//     consumer that captures it at construction (reasoning/engine). `.withLayers`
//     cannot — it merges at the terminal composition, too late for LLMService.
//   - the SEQUENCE-ordered table dispenses the Nth recorded response for the Nth
//     call, immune to the prompt's live date/time and tool-schema text.
//
// Tool modes (W-C, 2026-07-11):
//   - "recorded": ToolService overridden, results dispensed from run.toolTable.
//     KNOWN LIMIT — the override erases the tool SURFACE (its listTools /
//     toFunctionCallingFormat return [], packages/replay/src/replay-tool-layer.ts:60-62),
//     so a replayed kernel with required tools force-abstains before its first
//     LLM call. Fine for tool-free recordings; wrong for tool-using goldens.
//   - "live": real builtin tools execute inside `fileRoot` (AsyncLocalStorage
//     confinement via @reactive-agents/tools withFileRoot). Deterministic for
//     the file-op builtins the golden lane uses, and it exercises the real
//     tool rail — receipt/toolsUsed parity included.
import { ReactiveAgents } from "@reactive-agents/runtime";
import { withFileRoot } from "@reactive-agents/tools";
import {
  buildSequentialLLMTable,
  computeArgsHash,
  makeReplayController,
  makeReplayLLMLayer,
  makeReplayToolLayer,
  type LLMTable,
  type RecordedRun,
} from "@reactive-agents/replay";
import type { AgentRunOutcome } from "@reactive-agents/replay";

export interface ReplayAgentOptions {
  /** Default strategy for the rebuilt agent (recordings don't serialize it reliably). */
  readonly strategy?: string;
  /** Trace dir for the replayed run, or null to disable tracing. Default: null. */
  readonly traceDir?: string | null;
  /** Builtin tools to register — MUST mirror the recorded harness config. */
  readonly builtins?: readonly string[];
  /**
   * Static required-tools list — mirrors the recording AND (because a static
   * list suppresses `wantsClassification`) keeps the tool-relevance classifier
   * from burning an extra LLM call the recording never made.
   */
  readonly requiredTools?: readonly string[];
  /** Max iterations — mirror the recorded harness config. */
  readonly maxIterations?: number;
  /**
   * Adaptive tool filtering (the tool-relevance classifier's LLM round-trip).
   * Goldens record with `false` so the call count is scenario-driven; the
   * replay side must mirror or the classifier consumes a table entry the
   * recording never produced. Default: undefined (framework default).
   */
  readonly adaptiveTools?: boolean;
  /** Tool execution mode; see module header. Default: "recorded" (back-compat). */
  readonly toolMode?: "recorded" | "live";
  /** Root for relative tool paths + traversal confinement in "live" mode. */
  readonly fileRoot?: string;
}

export interface ReplayAgentHandle {
  readonly run: (task: string) => Promise<AgentRunOutcome>;
  readonly dispose: () => Promise<void>;
  /**
   * LLM-table consumption after run(). `dispensed < tableSize` = the replayed
   * harness made FEWER model calls than the recording (under-consumption);
   * over-consumption dies loudly inside the replay LLM layer (table miss).
   */
  readonly stats: () => { readonly dispensed: number; readonly tableSize: number };
}

/** Wrap an LLMTable so every successful dispense is counted. */
function countingTable(table: LLMTable): { table: LLMTable; count: () => number } {
  let dispensed = 0;
  return {
    table: {
      size: table.size,
      next(key) {
        const rec = table.next(key);
        if (rec !== undefined) dispensed++;
        return rec;
      },
    },
    count: () => dispensed,
  };
}

interface ReasoningStepShape {
  readonly type?: string;
  readonly metadata?: {
    readonly toolCall?: { readonly name?: string; readonly arguments?: unknown };
    readonly toolCallId?: string;
    readonly observationResult?: { readonly success?: boolean };
  };
}

/**
 * Honest per-call tool log for the replay diff, read from the replayed run's
 * OWN reasoning steps (action step = name+args, following observation step =
 * ok). Falls back to the receipt's deduped successful names when the run
 * produced no steps (minimal loop). Never fabricates: absent data → [].
 */
function toolCallsFromResult(result: {
  readonly metadata?: unknown;
  readonly receipt?: { readonly toolsUsed?: readonly string[] };
}): AgentRunOutcome["toolCalls"] {
  const meta = result.metadata as { readonly reasoningSteps?: unknown } | undefined;
  const steps = meta?.reasoningSteps;
  if (Array.isArray(steps)) {
    const calls: { toolName: string; argsHash: string; ok: boolean }[] = [];
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i] as ReasoningStepShape;
      const tc = step.metadata?.toolCall;
      if (step.type !== "action" || !tc?.name) continue;
      // The next observation step carries the outcome; conservative default false.
      let ok = false;
      for (let j = i + 1; j < steps.length; j++) {
        const next = steps[j] as ReasoningStepShape;
        if (next.type === "action") break;
        if (next.type === "observation") {
          ok = next.metadata?.observationResult?.success === true;
          break;
        }
      }
      calls.push({ toolName: tc.name, argsHash: computeArgsHash(tc.arguments), ok });
    }
    if (calls.length > 0) return calls;
  }
  const fromReceipt = result.receipt?.toolsUsed ?? [];
  return fromReceipt.map((name) => ({ toolName: name, argsHash: "", ok: true }));
}

/**
 * Build a `{ run, dispose, stats }` handle over a recorded run, suitable for
 * `replay(recordedRun, () => makeReplayAgent(recordedRun))`.
 */
export async function makeReplayAgent(
  run: RecordedRun,
  opts: ReplayAgentOptions = {},
): Promise<ReplayAgentHandle> {
  const counted = countingTable(buildSequentialLLMTable(run.trace.events));
  const seqLLM = makeReplayLLMLayer(counted.table);
  const toolMode = opts.toolMode ?? "recorded";

  const strategy = (opts.strategy ?? "reactive") as
    Parameters<ReturnType<typeof ReactiveAgents.create>["withReasoning"]>[0] extends { defaultStrategy?: infer S }
      ? S
      : never;

  let builder = ReactiveAgents.create()
    // Provider is functionally irrelevant — the LLM path is overridden — but the
    // builder needs one; "test" constructs with no keys. An empty scenario is
    // never consumed because withReplayLLM wins the LLMService tag.
    .withProvider("test")
    .withModel(run.model || "replay")
    .withTools(
      opts.builtins !== undefined || opts.adaptiveTools !== undefined
        ? {
            ...(opts.builtins !== undefined ? { builtins: [...opts.builtins] } : {}),
            ...(opts.adaptiveTools !== undefined ? { adaptive: opts.adaptiveTools } : {}),
          }
        : undefined,
    )
    .withReasoning({ defaultStrategy: strategy })
    .withReplayLLM(seqLLM);

  if (opts.requiredTools !== undefined && opts.requiredTools.length > 0) {
    builder = builder.withRequiredTools({ tools: [...opts.requiredTools] });
  }
  if (opts.maxIterations !== undefined) {
    builder = builder.withMaxIterations(opts.maxIterations);
  }
  if (toolMode === "recorded") {
    builder = builder.withLayers(
      makeReplayToolLayer(makeReplayController(run.toolTable), "lenient"),
    );
  }

  builder =
    opts.traceDir === undefined || opts.traceDir === null
      ? builder
      : builder.withTracing({ dir: opts.traceDir });

  const agent = await builder.build();

  const runOnce = async (task: string): Promise<AgentRunOutcome> => {
    const result = await agent.run(task);
    return {
      output: typeof result.output === "string" ? result.output : String(result.output ?? ""),
      toolCalls: toolCallsFromResult(result),
      iterations: result.metadata.stepsCount,
      totalTokens: result.metadata.tokensUsed,
    };
  };

  return {
    run: (task: string): Promise<AgentRunOutcome> =>
      toolMode === "live" && opts.fileRoot !== undefined
        ? withFileRoot(opts.fileRoot, () => runOnce(task))
        : runOnce(task),
    dispose: () => agent.dispose(),
    stats: () => ({ dispensed: counted.count(), tableSize: counted.table.size }),
  };
}
