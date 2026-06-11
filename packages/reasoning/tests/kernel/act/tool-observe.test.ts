import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import type {
  KernelStateLike,
  LifecycleFailurePayload,
  ObservationStepLike,
} from "@reactive-agents/core";
import { executeToolAndObserve } from "../../../src/kernel/capabilities/act/tool-observe.js";
import type {
  MaybeService,
  ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";

const syntheticState: KernelStateLike = {
  taskId: "test-task",
  strategy: "react",
  kernelType: "react",
  steps: [],
  toolsUsed: new Set<string>(),
  iteration: 0,
  tokens: 0,
  status: "acting",
  output: null,
  error: null,
  meta: {},
};

// Minimal ToolService stub: echoes args, success=true unless toolName === "boom".
function stubToolService(): MaybeService<ToolServiceInstance> {
  return {
    _tag: "Some",
    value: {
      execute: (req) =>
        req.toolName === "boom"
          ? Effect.fail(new Error("kaboom"))
          : Effect.succeed({ success: true, result: { ok: req.toolName } }),
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    },
  };
}

// Run an Effect whose only remaining requirement is LLMService — never reached
// because extractFactsLLM is off, so no LLM service is provided.
const runNoLLM = <A>(eff: Effect.Effect<A, never, never>): Promise<A> =>
  Effect.runPromise(eff);

// Build a recording pipeline using the public RegistrationHarness → HarnessPipeline
// path (HarnessPipeline has no public mutation method; taps register via the harness).
function recordingPipeline(): {
  pipeline: HarnessPipeline;
  observations: ObservationStepLike[];
  failures: LifecycleFailurePayload[];
} {
  const observations: ObservationStepLike[] = [];
  const failures: LifecycleFailurePayload[] = [];
  const rh = new RegistrationHarness();
  rh.tap("observation.tool-result", (step) => {
    observations.push(step);
  });
  rh.tap("lifecycle.failure", (payload) => {
    failures.push(payload);
  });
  return { pipeline: new HarnessPipeline(rh._collected), observations, failures };
}

describe("executeToolAndObserve", () => {
  it("fires observation.tool-result through the pipeline", async () => {
    const { pipeline, observations } = recordingPipeline();

    const result = await runNoLLM(
      executeToolAndObserve(
        stubToolService(),
        { toolName: "web-search", args: { query: "x" } },
        { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c1" },
        { pipeline, extractFactsLLM: false },
      ),
    );

    expect(result.success).toBe(true);
    expect(observations.length).toBe(1);
    const obsResult = observations[0]?.metadata?.observationResult as
      | { toolName?: string }
      | undefined;
    expect(obsResult?.toolName).toBe("web-search");
    expect(result.obsStep.metadata?.observationResult?.toolName).toBe("web-search");
    expect(result.obsStep.metadata?.toolCallId).toBe("c1");
  });

  it("fires lifecycle.failure on tool error", async () => {
    const { pipeline, failures } = recordingPipeline();

    const result = await runNoLLM(
      executeToolAndObserve(
        stubToolService(),
        { toolName: "boom", args: {} },
        { iteration: 2, phase: "act", strategy: "react", state: syntheticState, callId: "c2" },
        { pipeline, extractFactsLLM: false },
      ),
    );

    expect(result.success).toBe(false);
    expect(failures.length).toBe(1);
    expect(failures[0]?.reason).toBe("tool-error");
  });

  it("no-ops tag emission when pipeline is absent (still builds obsStep)", async () => {
    const result = await runNoLLM(
      executeToolAndObserve(
        stubToolService(),
        { toolName: "web-search", args: { query: "x" } },
        { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c3" },
        { extractFactsLLM: false },
      ),
    );
    expect(result.obsStep.type).toBe("observation");
    expect(result.success).toBe(true);
  });

  it("returns a failed observation when ToolService is None", async () => {
    const noneService: MaybeService<ToolServiceInstance> = { _tag: "None" };
    const result = await runNoLLM(
      executeToolAndObserve(
        noneService,
        { toolName: "web-search", args: {} },
        { iteration: 1, phase: "act", strategy: "react", state: syntheticState, callId: "c4" },
        { extractFactsLLM: false },
      ),
    );
    expect(result.success).toBe(false);
    expect(result.content).toContain("ToolService is not available");
  });
});
