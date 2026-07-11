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
import { Layer } from "effect";
import { ReactiveAgents } from "@reactive-agents/runtime";
import {
  buildSequentialLLMTable,
  makeReplayController,
  makeReplayLLMLayer,
  makeReplayToolLayer,
  type RecordedRun,
} from "@reactive-agents/replay";
import type { AgentRunOutcome } from "@reactive-agents/replay";

export interface ReplayAgentOptions {
  /** Default strategy for the rebuilt agent (recordings don't serialize it reliably). */
  readonly strategy?: string;
  /** Trace dir for the replayed run, or null to disable tracing. Default: null. */
  readonly traceDir?: string | null;
}

export interface ReplayAgentHandle {
  readonly run: (task: string) => Promise<AgentRunOutcome>;
  readonly dispose: () => Promise<void>;
}

/**
 * Build a `{ run, dispose }` handle over a recorded run, suitable for
 * `replay(recordedRun, () => makeReplayAgent(recordedRun))`.
 */
export async function makeReplayAgent(
  run: RecordedRun,
  opts: ReplayAgentOptions = {},
): Promise<ReplayAgentHandle> {
  const seqLLM = makeReplayLLMLayer(buildSequentialLLMTable(run.trace.events));
  const replayTool = makeReplayToolLayer(makeReplayController(run.toolTable), "lenient");

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
    .withTools()
    .withReasoning({ defaultStrategy: strategy })
    .withReplayLLM(seqLLM)
    .withLayers(replayTool);

  builder =
    opts.traceDir === undefined || opts.traceDir === null
      ? builder
      : builder.withTracing({ dir: opts.traceDir });

  const agent = await builder.build();

  return {
    run: async (task: string): Promise<AgentRunOutcome> => {
      const result = await agent.run(task);
      const toolsUsed = result.receipt?.toolsUsed ?? [];
      return {
        output: typeof result.output === "string" ? result.output : String(result.output ?? ""),
        totalTokens: result.receipt ? undefined : undefined,
        toolCalls: toolsUsed.map((name) => ({ toolName: name, argsHash: "", ok: true })),
      };
    },
    dispose: () => agent.dispose(),
  };
}
