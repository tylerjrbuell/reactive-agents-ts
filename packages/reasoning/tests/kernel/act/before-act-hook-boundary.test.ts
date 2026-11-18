// Run: bun test packages/reasoning/tests/kernel/act/before-act-hook-boundary.test.ts --timeout 15000
//
// `before act` hook boundary (2026-11-18 extra-iterations diagnosis, lever 5).
//
// Before this fix the act phase fired `before act` hooks in two places: once
// per call on the single-call path, right before that call ran, and once per
// round AFTER every call of the round had executed. The parallel-batch path
// (`nextMovesPlanning.allowParallelBatching`) only had the per-round fire, so a
// killswitch (`requireApprovalFor`-class) on `before act` saw a batch only
// after its tools had already run: it could not block them. Every serial call
// also fired the hook twice.
//
// The fix: one boundary (act/before-act-gate.ts) fires `before act` once per
// pending call, before any call of the round executes, on every path.
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Option } from "effect";
import { EventBusLive, HarnessPipeline, RegistrationHarness, type Phase, type PhaseHookFn } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import { TextParseDriver } from "@reactive-agents/tools";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { reactKernel } from "../../../src/kernel/loop/react-kernel.js";
import { runPass } from "../../../src/kernel/loop/run-pass.js";
import { mockToolServiceLayer } from "../../../src/testing/tool-service-mock.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelRunOptions,
  type KernelState,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

type PendingCall = { id: string; name: string; arguments: Record<string, unknown> };
type HookCtx = Parameters<PhaseHookFn<Phase>>[0];
type HookResult = { readonly abort: "stop" | "terminate"; readonly reason: string } | undefined;

/** Names of the calls stashed on `meta.pendingToolCalls` for this hook fire. */
function pendingNames(meta: Readonly<Record<string, unknown>>): string[] {
  const pending = meta["pendingToolCalls"];
  if (!Array.isArray(pending)) return [];
  return pending.flatMap((c: unknown) =>
    typeof c === "object" && c !== null && "name" in c && typeof c.name === "string" ? [c.name] : [],
  );
}

/** A pipeline with one hook per (kind, phase) pair. */
function pipelineWith(
  hooks: readonly { kind: "before" | "after"; phase: "act" | "bootstrap" | "complete"; fn: (ctx: HookCtx) => HookResult }[],
): HarnessPipeline {
  const reg = new RegistrationHarness();
  for (const h of hooks) {
    if (h.kind === "before") reg.before(h.phase, h.fn);
    else reg.after(h.phase, h.fn);
  }
  return new HarnessPipeline(reg._collected);
}

/** A ToolService that records every executed tool name into the shared log. */
function recordingToolService(log: string[]): Option.Option<ToolServiceInstance> {
  return Option.some({
    execute: (req) => {
      log.push(`exec:${req.toolName}`);
      return Effect.succeed({ success: true, result: { ok: req.toolName } });
    },
    getTool: () => Effect.fail(new Error("no schema")),
    listTools: () => Effect.succeed([]),
  });
}

function actingState(pendingCalls: PendingCall[]): KernelState {
  return {
    ...initialKernelState({ maxIterations: 3, strategy: "react-kernel", kernelType: "react", taskId: "before-act-boundary" }),
    status: "acting",
    steps: [{ id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() }],
    meta: { pendingNativeToolCalls: pendingCalls, lastThought: "go", lastThinking: null },
  };
}

function actingContext(pipeline: HarnessPipeline, toolService: Option.Option<ToolServiceInstance>, batching: boolean): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "Gather data",
      availableToolSchemas: [
        { name: "http-get", description: "fetch a url", parameters: [] },
        { name: "web-search", description: "search the web", parameters: [] },
      ],
      harnessPipeline: pipeline,
      ...(batching ? { nextMovesPlanning: { enabled: true, allowParallelBatching: true, maxBatchSize: 3 } } : {}),
    } as KernelContext["input"],
    profile,
    compression: { budget: profile.toolResultMaxChars ?? 800, previewItems: 3, autoStore: true, codeTransform: true },
    toolService,
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
  };
}

const TWO_CALLS: PendingCall[] = [
  { id: "c1", name: "http-get", arguments: { url: "https://x" } },
  { id: "c2", name: "web-search", arguments: { query: "btc" } },
];

const act = (state: KernelState, ctx: KernelContext) =>
  Effect.runPromise(handleActing(state, ctx).pipe(Effect.provide(TestLLMServiceLayer())));

describe("before-act hook boundary: a killswitch runs before any tool executes", () => {
  it("parallel batch: a blocking before-act hook stops every call of the batch (was: both ran, then the hook fired)", async () => {
    const log: string[] = [];
    const pipeline = pipelineWith([
      { kind: "before", phase: "act", fn: () => ({ abort: "stop", reason: "deny-all" }) },
    ]);
    const out = await act(actingState(TWO_CALLS), actingContext(pipeline, recordingToolService(log), true));
    expect(log).toEqual([]);
    expect(out.meta.terminatedBy).toBe("deny-all");
  });

  it("parallel batch: a hook denying the second member stops the first member too", async () => {
    const log: string[] = [];
    const pipeline = pipelineWith([
      {
        kind: "before", phase: "act",
        fn: (c) => (pendingNames(c.state.meta).includes("web-search") ? { abort: "stop", reason: "deny-search" } : undefined),
      },
    ]);
    const out = await act(actingState(TWO_CALLS), actingContext(pipeline, recordingToolService(log), true));
    expect(log).toEqual([]);
    expect(out.meta.terminatedBy).toBe("deny-search");
  });

  it("serial round: a hook denying the second call stops the round before the first call runs", async () => {
    const log: string[] = [];
    const pipeline = pipelineWith([
      {
        kind: "before", phase: "act",
        fn: (c) => (pendingNames(c.state.meta).includes("web-search") ? { abort: "stop", reason: "deny-search" } : undefined),
      },
    ]);
    const out = await act(actingState(TWO_CALLS), actingContext(pipeline, recordingToolService(log), false));
    expect(log).toEqual([]);
    expect(out.meta.terminatedBy).toBe("deny-search");
  });

  for (const batching of [true, false]) {
    it(`${batching ? "parallel batch" : "serial round"}: before act fires exactly once per call, each before any execution, with that one call stashed`, async () => {
      const log: string[] = [];
      const pipeline = pipelineWith([
        {
          kind: "before", phase: "act",
          fn: (c) => {
            log.push(`hook:${pendingNames(c.state.meta).join(",")}`);
            return undefined;
          },
        },
      ]);
      await act(actingState(TWO_CALLS), actingContext(pipeline, recordingToolService(log), batching));
      expect(log.filter((e) => e.startsWith("hook:"))).toEqual(["hook:http-get", "hook:web-search"]);
      expect(log.slice(0, 2)).toEqual(["hook:http-get", "hook:web-search"]);
      expect(log.filter((e) => e.startsWith("exec:")).sort()).toEqual(["exec:http-get", "exec:web-search"]);
    });
  }

  it("the hook sees the HEALED tool name, so a deny list cannot be dodged by a misspelled name", async () => {
    const log: string[] = [];
    const pipeline = pipelineWith([
      {
        kind: "before", phase: "act",
        fn: (c) => (pendingNames(c.state.meta).includes("web-search") ? { abort: "stop", reason: "deny-search" } : undefined),
      },
    ]);
    const misspelled: PendingCall[] = [{ id: "c1", name: "web_search", arguments: { query: "btc" } }];
    const out = await act(actingState(misspelled), actingContext(pipeline, recordingToolService(log), false));
    expect(log).toEqual([]);
    expect(out.meta.terminatedBy).toBe("deny-search");
  });
});

// ── Whole-run hook counts (runPass on the react kernel) ─────────────────────

const SCHEMAS = [
  { name: "web-search", description: "search", parameters: [{ name: "q", type: "string", required: true }] },
  {
    name: "file-write",
    description: "write a file",
    parameters: [
      { name: "path", type: "string", required: true },
      { name: "content", type: "string", required: true },
    ],
  },
];

describe("hook lifecycle over a whole kernel run", () => {
  it("two serial tool turns: exactly 2 before-act (each before its call), 1 bootstrap, complete once", async () => {
    const log: string[] = [];
    const record = (label: string) => (c: HookCtx): HookResult => {
      log.push(label === "before:act" ? `before:act:${pendingNames(c.state.meta)[0] ?? "?"}` : label);
      return undefined;
    };
    const harnessPipeline = pipelineWith([
      { kind: "before", phase: "bootstrap", fn: record("before:bootstrap") },
      { kind: "after", phase: "bootstrap", fn: record("after:bootstrap") },
      { kind: "before", phase: "act", fn: record("before:act") },
      { kind: "after", phase: "act", fn: record("after:act") },
      { kind: "after", phase: "complete", fn: record("after:complete") },
    ]);
    const toolLayer = mockToolServiceLayer({
      execute: (req: { toolName: string }) => {
        log.push(`exec:${req.toolName}`);
        return Effect.succeed({ success: true, result: { ok: req.toolName } });
      },
      getTool: (name: string) =>
        Effect.succeed({ name, description: "test", parameters: SCHEMAS.find((s) => s.name === name)?.parameters ?? [] }),
    });
    await Effect.runPromise(
      runPass(
        reactKernel,
        { task: "Search then write out.txt.", availableToolSchemas: SCHEMAS, contextProfile: { tier: "local" }, harnessPipeline } as KernelInput,
        { maxIterations: 6, strategy: "reactive", kernelType: "react", taskId: "hook-count", modelId: "llama3.2:3b" } as KernelRunOptions,
      ).pipe(
        Effect.provide(
          Layer.mergeAll(
            TestLLMServiceLayer([
              { toolCall: { name: "web-search", args: { q: "x" } } },
              { toolCall: { name: "file-write", args: { path: "out.txt", content: "hi" } } },
              { text: "Done." },
            ]),
            toolLayer,
            EventBusLive,
          ),
        ),
      ),
    );
    expect(log.filter((e) => e.startsWith("before:act"))).toEqual(["before:act:web-search", "before:act:file-write"]);
    expect(log.filter((e) => e === "before:bootstrap")).toHaveLength(1);
    expect(log.filter((e) => e === "after:complete")).toHaveLength(1);
    // Each before-act directly precedes its own execution.
    expect(log.indexOf("before:act:web-search")).toBeLessThan(log.indexOf("exec:web-search"));
    expect(log.indexOf("exec:web-search")).toBeLessThan(log.indexOf("before:act:file-write"));
    expect(log.indexOf("before:act:file-write")).toBeLessThan(log.indexOf("exec:file-write"));
  }, 15000);
});
