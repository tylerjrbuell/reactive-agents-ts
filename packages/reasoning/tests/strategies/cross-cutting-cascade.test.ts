// cross-cutting-cascade.test.ts — THE cascade regression net (Task 6).
//
// The defect class: seven run-wide harness fields (`taskContract`,
// `fabricationGuard`, `grounding`, `stallPolicy` + the three HITL rails) were
// threaded BY HAND through eight strategy input interfaces. Any interface that
// omitted a field dropped it silently — measured 2026-07-22, `reactive` was the
// ONLY strategy that forwarded them, so `.withStallPolicy()` /
// `.withGrounding()` / `.withFabricationGuard()` / `.withContract()` and the
// approval gate were dead on reflexion, tree-of-thought, plan-execute,
// code-action, blueprint, adaptive and direct.
//
// Task 6 closes it at the ONE universal seam: `runKernel` merges the
// `RunEnvelope` onto the `KernelInput` it runs with. Every strategy reaches the
// kernel through that function, so a wither configured once now applies
// everywhere — including sub-kernels (reflexion's generate/improve passes, ToT's
// branch kernels, plan-execute's composite steps) that were never handed the
// fields at all.
//
// Two layers of coverage, deliberately:
//   §1 MECHANISM — drive `runKernel` directly with a capture kernel and assert
//      exactly what the merge does (fills holes, explicit input wins, no
//      envelope ⇒ untouched). Deterministic; cutting the merge fails all three.
//   §2 REACH — run REAL strategies (test provider, no keys) and assert observable
//      behavior changes from an envelope-only wither. This is what proves the
//      merge reaches strategies that never carried the field.
import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { Effect, Layer } from "effect";
import type { TaskContract } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { ToolService, createToolsLayer } from "@reactive-agents/tools";
import { runKernel } from "../../src/kernel/loop/runner.js";
import { transitionState } from "../../src/kernel/state/kernel-state.js";
import type { KernelInput, ThoughtKernel } from "../../src/kernel/state/kernel-state.js";
import {
  buildRunEnvelope,
  provideTestEnvelope,
} from "../../src/kernel/envelope/run-envelope.js";
import type { RunEnvelopeData } from "../../src/kernel/envelope/run-envelope.js";
import { executeDirect } from "../../src/strategies/direct.js";
import { executeReflexion } from "../../src/strategies/reflexion.js";
import { executeReactive } from "../../src/strategies/reactive.js";
import { defaultReasoningConfig } from "../../src/types/config.js";

const PRIOR_LAZY = process.env.RA_LAZY_TOOLS;
beforeAll(() => {
  process.env.RA_LAZY_TOOLS = "0";
});
afterAll(() => {
  if (PRIOR_LAZY === undefined) delete process.env.RA_LAZY_TOOLS;
  else process.env.RA_LAZY_TOOLS = PRIOR_LAZY;
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

const addToolDef = {
  name: "add",
  description: "Add two numbers together",
  parameters: [
    { name: "a", type: "number" as const, description: "First number", required: true },
    { name: "b", type: "number" as const, description: "Second number", required: true },
  ],
  riskLevel: "low" as const,
  timeoutMs: 5_000,
  requiresApproval: false,
  source: "function" as const,
};

const CONTRACT: TaskContract = {
  prompt: "Add the numbers",
  tools: [{ kind: "required", name: "add" }],
  success: { type: "regex", pattern: "5" },
};

/** Every one of the seven cross-cutting fields, all set to non-default values. */
const FULL_ENVELOPE: RunEnvelopeData = buildRunEnvelope({
  taskContract: CONTRACT,
  fabricationGuard: "warn",
  grounding: { mode: "warn", tolerance: 0.5 },
  stallPolicy: { ignoredNudgeTolerance: 1 },
  approvalPolicy: { mode: "detach", tools: new Set(["add"]) },
  approvalDecision: { gateId: "gate-env", status: "approved" },
  interactionResponse: { interactionId: "int-env", valueJson: '"env"' },
});

// ── §1 MECHANISM — runKernel's envelope merge ────────────────────────────────

/**
 * A ThoughtKernel that records the `KernelInput` the runner actually assembled
 * (`KernelContext.input`) and terminates immediately. The runner is the unit
 * under test; the kernel body is a probe.
 */
function captureKernel(sink: { input?: KernelInput }): ThoughtKernel {
  return (state, context) => {
    sink.input = context.input;
    return Effect.succeed(transitionState(state, { status: "done", output: "captured" }));
  };
}

const BASE_INPUT: KernelInput = {
  task: "Add the numbers 2 and 3",
  availableToolSchemas: [],
  allToolSchemas: [],
};

const RUN_OPTIONS = {
  maxIterations: 1,
  strategy: "cascade-probe",
  kernelType: "react",
  taskId: "cascade-probe",
} as const;

/** Run the capture kernel; `envelope === undefined` ⇒ NO RunEnvelope in context. */
async function captureKernelInput(
  input: KernelInput,
  envelope: RunEnvelopeData | undefined,
): Promise<KernelInput> {
  const sink: { input?: KernelInput } = {};
  const llmLayer = TestLLMServiceLayer([{ text: "FINAL ANSWER: 5" }]);
  const program = runKernel(captureKernel(sink), input, RUN_OPTIONS).pipe(
    Effect.provide(llmLayer),
  );
  await Effect.runPromise(
    envelope === undefined ? program : provideTestEnvelope(program, envelope),
  );
  if (!sink.input) throw new Error("capture kernel never ran");
  return sink.input;
}

describe("cross-cutting cascade §1 — runKernel merges the RunEnvelope", () => {
  it("fills every unset cross-cutting field from the envelope", async () => {
    const seen = await captureKernelInput(BASE_INPUT, FULL_ENVELOPE);

    expect(seen.taskContract).toBe(CONTRACT);
    expect(seen.fabricationGuard).toBe("warn");
    expect(seen.grounding).toEqual({ mode: "warn", tolerance: 0.5 });
    expect(seen.stallPolicy).toEqual({ ignoredNudgeTolerance: 1 });
    expect(seen.approvalPolicy?.mode).toBe("detach");
    expect(seen.approvalDecision?.gateId).toBe("gate-env");
    expect(seen.interactionResponse?.interactionId).toBe("int-env");
  });

  it("an EXPLICIT KernelInput field WINS over the envelope (per-pass overrides survive)", async () => {
    const explicitContract: TaskContract = { ...CONTRACT, prompt: "explicit" };
    const seen = await captureKernelInput(
      {
        ...BASE_INPUT,
        taskContract: explicitContract,
        fabricationGuard: "off",
        grounding: { mode: "block", tolerance: 0.02 },
        stallPolicy: { ignoredNudgeTolerance: 9 },
        approvalPolicy: { mode: "block", tools: new Set(["other"]) },
        approvalDecision: { gateId: "gate-explicit", status: "denied" },
        interactionResponse: { interactionId: "int-explicit", valueJson: '"explicit"' },
      },
      FULL_ENVELOPE,
    );

    expect(seen.taskContract?.prompt).toBe("explicit");
    expect(seen.fabricationGuard).toBe("off");
    expect(seen.grounding).toEqual({ mode: "block", tolerance: 0.02 });
    expect(seen.stallPolicy).toEqual({ ignoredNudgeTolerance: 9 });
    expect(seen.approvalPolicy?.mode).toBe("block");
    expect(seen.approvalDecision?.gateId).toBe("gate-explicit");
    expect(seen.interactionResponse?.interactionId).toBe("int-explicit");
  });

  it("with NO RunEnvelope in context the input is untouched (no-config path byte-identical)", async () => {
    const seen = await captureKernelInput(BASE_INPUT, undefined);

    for (const field of [
      "taskContract",
      "fabricationGuard",
      "grounding",
      "stallPolicy",
      "approvalPolicy",
      "approvalDecision",
      "interactionResponse",
    ] as const) {
      expect(seen[field]).toBeUndefined();
      // Absent, not present-and-undefined: the merge must not add keys.
      expect(Object.hasOwn(seen, field)).toBe(false);
    }
  });

  it("an EMPTY envelope adds nothing (zero behavior change by construction)", async () => {
    const seen = await captureKernelInput(BASE_INPUT, buildRunEnvelope());

    for (const field of [
      "taskContract",
      "fabricationGuard",
      "grounding",
      "stallPolicy",
      "approvalPolicy",
      "approvalDecision",
      "interactionResponse",
    ] as const) {
      expect(Object.hasOwn(seen, field)).toBe(false);
    }
  });
});

// ── §2 REACH — real strategies, envelope-only withers ────────────────────────

const stallConfig = {
  ...defaultReasoningConfig,
  strategies: {
    ...defaultReasoningConfig.strategies,
    reactive: { maxIterations: 12, temperature: 0.7 },
    reflexion: {
      maxRetries: 1,
      selfCritiqueDepth: "shallow" as const,
      kernelMaxIterations: 12,
    },
  },
};

/**
 * A run that GROUNDS once (one successful `add`) then stalls: the model keeps
 * emitting thought-only turns while the required quota (`add` ×5) stays unmet.
 * That is exactly the shape `StallPolicy.ignoredNudgeTolerance` bounds — each
 * nudge is "ignored" because the missing-required set never shrinks.
 */
const STALL_SCENARIO = [
  { match: "step by step", toolCall: { name: "add", args: { a: 2, b: 3 } } },
  { text: "I am thinking about the problem some more." },
];

type StrategyResultShape = {
  readonly steps: readonly unknown[];
  readonly metadata: Record<string, unknown>;
};

function runStalling(
  strategy: "reactive" | "reflexion",
  envelope: RunEnvelopeData | undefined,
): Promise<StrategyResultShape> {
  const llmLayer = TestLLMServiceLayer(STALL_SCENARIO as never);
  const toolsLayer = createToolsLayer();
  const strategyInput = {
    taskDescription: "Add the numbers 2 and 3 using the add tool",
    taskType: "computation",
    memoryContext: "",
    availableTools: ["add"],
    requiredTools: ["add"],
    requiredToolQuantities: { add: 5 },
    config: stallConfig,
  };
  const program = Effect.gen(function* () {
    const tools = yield* ToolService;
    yield* tools.register(addToolDef, (args) =>
      Effect.succeed((args.a as number) + (args.b as number)),
    );
    return strategy === "reactive"
      ? yield* executeReactive(strategyInput as never)
      : yield* executeReflexion(strategyInput as never);
  }).pipe(Effect.provide(Layer.merge(llmLayer, toolsLayer)));

  return Effect.runPromise(
    provideTestEnvelope(program, envelope) as Effect.Effect<StrategyResultShape, never, never>,
  );
}

describe("cross-cutting cascade §2 — envelope withers reach non-reactive strategies", () => {
  // reflexion NEVER carried `stallPolicy`: it is not on `ReflexionInput`, and
  // reflexion's interim Task-5 envelope read only forwarded the three HITL
  // rails. The ONLY way `ignoredNudgeTolerance` can bite a reflexion sub-kernel
  // is runKernel's merge. Cutting the merge makes this case fail.
  it("reflexion: envelope stallPolicy bounds the stall (fewer LLM calls than the default policy)", async () => {
    const loose = await runStalling("reflexion", undefined);
    const tight = await runStalling(
      "reflexion",
      buildRunEnvelope({ stallPolicy: { ignoredNudgeTolerance: 1 } }),
    );

    const looseCalls = loose.metadata.llmCalls as number;
    const tightCalls = tight.metadata.llmCalls as number;
    expect(typeof looseCalls).toBe("number");
    expect(tightCalls).toBeLessThan(looseCalls);
    expect(tight.steps.length).toBeLessThan(loose.steps.length);
  }, 30_000);

  // reactive is the behavior-PRESERVATION control: it read the envelope
  // directly before Task 6, so the same wither must keep working after the
  // interim read is deleted and the merge takes over.
  it("reactive (control): the same envelope stallPolicy still bounds the stall", async () => {
    const loose = await runStalling("reactive", undefined);
    const tight = await runStalling(
      "reactive",
      buildRunEnvelope({ stallPolicy: { ignoredNudgeTolerance: 1 } }),
    );

    expect(tight.steps.length).toBeLessThan(loose.steps.length);
  }, 30_000);

  // `direct` never threaded ANY cross-cutting field before the cascade — it
  // omits them from `DirectInput` on purpose ("multi-iteration concerns"). With
  // maxIterations 2 it does reach the act phase, so an envelope-only approval
  // policy must pause it exactly like reactive.
  it("direct: envelope approvalPolicy gates its tool call (pause, tool NOT executed)", async () => {
    let executed = 0;
    const llmLayer = TestLLMServiceLayer([
      { match: "step by step", toolCall: { name: "add", args: { a: 2, b: 3 } } },
      { text: "FINAL ANSWER: 5." },
    ] as never);
    const toolsLayer = createToolsLayer();

    const program = Effect.gen(function* () {
      const tools = yield* ToolService;
      yield* tools.register(addToolDef, (args) => {
        executed++;
        return Effect.succeed((args.a as number) + (args.b as number));
      });
      return yield* executeDirect({
        taskDescription: "Add the numbers 2 and 3 using the add tool",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        maxIterations: 2,
        config: defaultReasoningConfig,
      });
    }).pipe(Effect.provide(Layer.merge(llmLayer, toolsLayer)));

    const result = await Effect.runPromise(
      provideTestEnvelope(
        program,
        buildRunEnvelope({ approvalPolicy: { mode: "detach", tools: new Set(["add"]) } }),
      ),
    );

    const meta = result.metadata as {
      rawTerminatedBy?: string;
      awaitingApprovalFor?: { toolName: string };
    };
    expect(meta.rawTerminatedBy).toBe("awaiting-approval");
    expect(meta.awaitingApprovalFor?.toolName).toBe("add");
    expect(executed).toBe(0);
  }, 30_000);

  // The judgment half of the cascade (Task 3): every strategy result is minted
  // through `finalizeStrategyResult`, so an ungrounded run records
  // `groundedOnRequired: false` no matter which strategy produced it.
  for (const strategy of ["reactive", "reflexion"] as const) {
    it(`${strategy}: an ungrounded run records verdict.groundedOnRequired === false`, async () => {
      const llmLayer = TestLLMServiceLayer([
        { text: "I never call any tool. FINAL ANSWER: 5." },
      ] as never);
      const toolsLayer = createToolsLayer();
      const strategyInput = {
        taskDescription: "Add the numbers 2 and 3 using the add tool",
        taskType: "computation",
        memoryContext: "",
        availableTools: ["add"],
        requiredTools: ["add"],
        config: stallConfig,
      };
      const program = Effect.gen(function* () {
        const tools = yield* ToolService;
        yield* tools.register(addToolDef, (args) =>
          Effect.succeed((args.a as number) + (args.b as number)),
        );
        return strategy === "reactive"
          ? yield* executeReactive(strategyInput as never)
          : yield* executeReflexion(strategyInput as never);
      }).pipe(Effect.provide(Layer.merge(llmLayer, toolsLayer)));

      const result = (await Effect.runPromise(
        provideTestEnvelope(program) as Effect.Effect<StrategyResultShape, never, never>,
      )) as { metadata: { verdict?: { groundedOnRequired?: boolean } } };

      expect(result.metadata.verdict).toBeDefined();
      expect(result.metadata.verdict?.groundedOnRequired).toBe(false);
    }, 30_000);
  }
});
