// Run: bun test packages/reasoning/src/kernel/capabilities/act/one-execution-boundary.test.ts
//
// One execution boundary (2026-08-18) — the kernel parallel-batch loop
// (act.ts) no longer hand-duplicates approval / error-recovery / healing onto
// its own inline `Effect.all(executeNativeToolCall(...))` block. It now calls
// `executeToolAndObserveBatch` (tool-observe.ts), which runs each batch
// member through the SAME per-call pipeline the single-call path's
// `executeToolAndObserve` already runs.
//
// These are BEHAVIORAL-PARITY tests (TDD, RED before the consolidation
// landed) — a parallel batch of >=2 tools must show the identical shape of
// denial / error-recovery / healing that the single-call path already shows,
// not new behavior. See
// wiki/Planning/Implementation-Plans/2026-08-18-step-3-one-execution-boundary.md
// §3b for the corrected framing and abort-gate spec.
import { describe, expect, it } from "bun:test";
import { Effect, Layer } from "effect";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { RunEnvelope, buildRunEnvelope } from "../../envelope/run-envelope.js";
import type { ResolvedApprovalPolicy } from "./approval-gate.js";
import { mockToolServiceLayer } from "../../../testing/tool-service-mock.js";
import { reactKernel } from "../../loop/react-kernel.js";
import { runPass } from "../../loop/run-pass.js";
import type { KernelInput, KernelRunOptions } from "../../state/kernel-state.js";

// Two parallel-safe-by-name tools (see tool-gating.ts `PARALLEL_SAFE_TOOLS`),
// so `planNextMoveBatches` groups them into one batch when
// `nextMovesPlanning.allowParallelBatching` is on.
const SCHEMAS = [
  { name: "find", description: "index lookup", parameters: [{ name: "query", type: "string", required: true }] },
  { name: "recall", description: "scratchpad read", parameters: [{ name: "key", type: "string", required: true }] },
];

// "tinyllama" matches LOCAL_PATTERNS directly (profile-resolver.ts) and has no
// calibration file (unlike "llama3.2:3b", which does and composes a different
// errorRecovery over the base local adapter's) — tier "local", uncalibrated,
// so `adapter.errorRecovery` is the plain local-tier implementation this test
// pins against (adapter.ts:166-178).
const LOCAL_MODEL_ID = "tinyllama";

const baseInput = (overrides: Partial<KernelInput> = {}): KernelInput =>
  ({
    task: "Use find and recall in parallel, then answer.",
    availableToolSchemas: SCHEMAS,
    allToolSchemas: SCHEMAS,
    nextMovesPlanning: { enabled: true, allowParallelBatching: true, maxBatchSize: 2 },
    // Explicit local tier — `runner.ts`'s default-tier inference only picks
    // "local" for `providerName: "ollama"`; this test doesn't set a provider,
    // so it must say so directly (adapter.errorRecovery is local-tier-gated).
    contextProfile: { tier: "local" },
    ...overrides,
  }) as KernelInput;

const baseOpts = (overrides: Partial<KernelRunOptions> = {}): KernelRunOptions => ({
  maxIterations: 6,
  strategy: "reactive",
  kernelType: "react",
  taskId: "one-execution-boundary-test",
  modelId: LOCAL_MODEL_ID,
  ...overrides,
});

describe("one execution boundary — kernel parallel-batch consolidation", () => {
  it("denies a gated batch member by default (deny-by-default), never executing it — same shape as the single-call path", async () => {
    const executed: string[] = [];
    const toolLayer = mockToolServiceLayer({
      execute: (req: { toolName: string; args?: unknown }) =>
        Effect.sync(() => {
          executed.push(req.toolName);
          return { success: true, result: { ok: true } };
        }),
    });

    const scenario = TestLLMServiceLayer([
      { toolCalls: [{ name: "find", args: { query: "x" } }, { name: "recall", args: { key: "y" } }] },
      { text: "Done — the answer is 42." },
    ]);

    // Block mode, gates "find" specifically, no `decide` configured — the
    // canonical deny-by-default rule (approval-gate.ts NO_DECIDER_MESSAGE).
    const approvalPolicy: ResolvedApprovalPolicy = {
      mode: "block",
      tools: new Set(["find"]),
    };
    const envelope = Layer.succeed(RunEnvelope, buildRunEnvelope({ approvalPolicy }));

    const pass = await Effect.runPromise(
      runPass(reactKernel, baseInput(), baseOpts()).pipe(
        Effect.provide(Layer.mergeAll(scenario, toolLayer, envelope)),
      ),
    );

    // The gated tool never actually executed.
    expect(executed).not.toContain("find");
    // The sibling batch member DID execute normally.
    expect(executed).toContain("recall");

    const findObs = pass.steps.find(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "find",
    );
    expect(findObs).toBeDefined();
    expect(findObs?.metadata?.observationResult?.success).toBe(false);
    expect(String(findObs?.content ?? "")).toContain("requires approval, but no approval handler is configured");
    expect(String(findObs?.content ?? "")).toContain("Blocked — the call did not run.");
  });

  it("attaches error-recovery guidance to a failed batch member — identical in form to the single-call failure case", async () => {
    const toolLayer = mockToolServiceLayer({
      execute: (req: { toolName: string; args?: unknown }) =>
        req.toolName === "find"
          ? Effect.succeed({ success: false, result: "404 Not Found" })
          : Effect.succeed({ success: true, result: { ok: true } }),
    });

    const scenario = TestLLMServiceLayer([
      { toolCalls: [{ name: "find", args: { query: "x" } }, { name: "recall", args: { key: "y" } }] },
      { text: "Done — the answer is 42." },
    ]);

    const pass = await Effect.runPromise(
      runPass(reactKernel, baseInput(), baseOpts()).pipe(Effect.provide(Layer.mergeAll(scenario, toolLayer))),
    );

    const findObs = pass.steps.find(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "find",
    );
    expect(findObs).toBeDefined();
    expect(findObs?.metadata?.observationResult?.success).toBe(false);
    // adapter.errorRecovery (local tier) recognizes "404"/"Not Found" and
    // appends recovery guidance — the SAME format the single-call path emits
    // (tool-observe.ts step 6: `[Recovery guidance: ...]`).
    expect(String(findObs?.content ?? "")).toContain("[Recovery guidance:");
  });

  it("still heals a batch member's fuzzy-matched argument name — identically to the single-call path", async () => {
    const seenArgs: Record<string, unknown>[] = [];
    const toolLayer = mockToolServiceLayer({
      // The real `ToolService.execute` call carries the arguments under
      // `arguments` (see tool-execution.ts:724-729), not the mock type's
      // `args` — `ToolServiceMock`'s declared shape is a loose test-double
      // annotation, not the live wire shape.
      execute: (req: { toolName: string; args?: unknown }) =>
        Effect.sync(() => {
          const wire = req as unknown as { toolName: string; arguments?: unknown };
          if (wire.toolName === "find") {
            seenArgs.push((wire.arguments ?? {}) as Record<string, unknown>);
          }
          return { success: true, result: { ok: true } };
        }),
    });

    const scenario = TestLLMServiceLayer([
      // "qury" is an edit-distance-1 typo of the "find" schema's "query" param
      // — runHealingPipeline's param-name healer (edit distance <= 2) repairs
      // it before dispatch, same as the single-call path's upstream heal.
      { toolCalls: [{ name: "find", args: { qury: "x" } }, { name: "recall", args: { key: "y" } }] },
      { text: "Done — the answer is 42." },
    ]);

    const pass = await Effect.runPromise(
      runPass(reactKernel, baseInput(), baseOpts()).pipe(Effect.provide(Layer.mergeAll(scenario, toolLayer))),
    );

    expect(seenArgs.length).toBeGreaterThan(0);
    expect(seenArgs[0]).toHaveProperty("query", "x");
    expect(seenArgs[0]).not.toHaveProperty("qury");

    const findObs = pass.steps.find(
      (s) => s.type === "observation" && s.metadata?.observationResult?.toolName === "find",
    );
    expect(findObs).toBeDefined();
    expect(findObs?.metadata?.observationResult?.success).toBe(true);
  });
});
