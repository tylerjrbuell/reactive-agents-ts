/**
 * act-symmetry.test.ts — Phase E (E1 + E2) of the canonical-tool-execution plan.
 *
 * E1 (unconditional): a 2-call PARALLEL batch through `handleActing` fires
 * `observation.tool-result` once per executed tool — closing the #195 bug class
 * for parallel turns (batch tool-results were invisible to .on()/.tap()).
 *
 * E2 (gated, default OFF): with RA_TOOL_OBSERVE_SYMMETRY=1 the SINGLE path
 * attaches a `verification` to the obsStep AND forks a semantic-memory store;
 * with the flag unset, neither happens (byte-identical to the pre-Phase-E single
 * path — pinned by the Phase B golden-master, re-asserted here for the memory leg).
 */
import { describe, it, expect } from "bun:test";
import { Effect } from "effect";
import { HarnessPipeline, RegistrationHarness } from "@reactive-agents/core";
import type { ObservationStepLike } from "@reactive-agents/core";
import { TestLLMServiceLayer } from "@reactive-agents/llm-provider";
import type { MemoryId } from "@reactive-agents/memory";
import { handleActing } from "../../../src/kernel/capabilities/act/act.js";
import { TextParseDriver } from "@reactive-agents/tools";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelState,
  type MaybeService,
  type MemoryServiceInstance,
  type ToolServiceInstance,
} from "../../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../src/context/context-profile.js";
import type { StepId } from "../../../src/types/step.js";

function successToolService(): MaybeService<ToolServiceInstance> {
  return {
    _tag: "Some",
    value: {
      execute: (req) =>
        Effect.succeed({ success: true, result: { ok: req.toolName } }),
      getTool: () => Effect.fail(new Error("no schema")),
      listTools: () => Effect.succeed([]),
    },
  };
}

// Mock MemoryService that records every storeSemantic call.
function recordingMemoryService(): {
  service: MaybeService<MemoryServiceInstance>;
  stored: unknown[];
} {
  const stored: unknown[] = [];
  return {
    service: {
      _tag: "Some",
      value: {
        storeSemantic: (entry) => {
          stored.push(entry);
          return Effect.succeed("mem-id" as MemoryId);
        },
      },
    },
    stored,
  };
}

function recordingPipeline(tag: string): {
  pipeline: HarnessPipeline;
  steps: ObservationStepLike[];
  ctxs: Record<string, unknown>[];
} {
  const steps: ObservationStepLike[] = [];
  const ctxs: Record<string, unknown>[] = [];
  const rh = new RegistrationHarness();
  rh.tap(tag, (step, ctx) => {
    steps.push(step as ObservationStepLike);
    ctxs.push(ctx as Record<string, unknown>);
  });
  return { pipeline: new HarnessPipeline(rh._collected), steps, ctxs };
}

function baseState(pendingCalls: { id: string; name: string; arguments: Record<string, unknown> }[]): KernelState {
  return {
    ...initialKernelState({
      maxIterations: 3,
      strategy: "react-kernel",
      kernelType: "react",
      taskId: "symmetry-task",
    }),
    status: "acting",
    steps: [
      { id: "thought-1" as StepId, type: "thought", content: "go", timestamp: new Date() },
    ],
    meta: {
      pendingNativeToolCalls: pendingCalls,
      lastThought: "go",
      lastThinking: null,
    },
  };
}

function baseContext(
  pipeline: HarnessPipeline,
  opts?: { batch?: boolean; memoryService?: MaybeService<MemoryServiceInstance> },
): KernelContext {
  const profile = CONTEXT_PROFILES["mid"];
  return {
    input: {
      task: "Gather data",
      availableToolSchemas: [
        { name: "web-search", description: "search the web", parameters: [] },
        { name: "http-get", description: "fetch a url", parameters: [] },
      ],
      harnessPipeline: pipeline,
      ...(opts?.batch
        ? { nextMovesPlanning: { enabled: true, allowParallelBatching: true, maxBatchSize: 3 } }
        : {}),
    } as KernelContext["input"],
    profile,
    compression: {
      budget: profile.toolResultMaxChars ?? 800,
      previewItems: 3,
      autoStore: true,
      codeTransform: true,
    },
    toolService: successToolService(),
    hooks: noopHooks,
    toolCallingDriver: new TextParseDriver(),
    ...(opts?.memoryService ? { memoryService: opts.memoryService } : {}),
  };
}

describe("act symmetry — E1 batch compose tags (unconditional)", () => {
  it("fires observation.tool-result once per executed tool in a 2-call parallel batch", async () => {
    const { pipeline, steps, ctxs } = recordingPipeline("observation.tool-result");
    const layer = TestLLMServiceLayer();

    await Effect.runPromise(
      handleActing(
        baseState([
          { id: "b1", name: "web-search", arguments: { query: "btc" } },
          { id: "b2", name: "http-get", arguments: { url: "https://x" } },
        ]),
        baseContext(pipeline, { batch: true }),
      ).pipe(Effect.provide(layer)),
    );

    // Both parallel tool-results fired (was 0 before E1).
    expect(steps.length).toBe(2);
    const firedTools = ctxs.map((c) => c.toolName).sort();
    expect(firedTools).toEqual(["http-get", "web-search"]);
    for (const c of ctxs) {
      expect(c.phase).toBe("act");
      expect(c.healed).toBe(false);
      expect(typeof c.durationMs).toBe("number");
    }
    for (const s of steps) {
      expect(s.type).toBe("observation");
    }
  });
});

describe("act symmetry — E2 single path gated by RA_TOOL_OBSERVE_SYMMETRY", () => {
  it("WITH flag=1: single-path obsStep has verification AND memory.storeSemantic invoked", async () => {
    const prev = process.env.RA_TOOL_OBSERVE_SYMMETRY;
    process.env.RA_TOOL_OBSERVE_SYMMETRY = "1";
    try {
      const { pipeline, steps } = recordingPipeline("observation.tool-result");
      const mem = recordingMemoryService();
      const layer = TestLLMServiceLayer();

      await Effect.runPromise(
        handleActing(
          baseState([{ id: "s1", name: "web-search", arguments: { query: "btc" } }]),
          baseContext(pipeline, { memoryService: mem.service }),
        ).pipe(Effect.provide(layer)),
      );

      expect(steps.length).toBe(1);
      expect(steps[0]!.metadata?.verification).toBeDefined();
      // memory write is forked (daemon) — give the fiber a tick to run.
      await new Promise((r) => setTimeout(r, 50));
      expect(mem.stored.length).toBeGreaterThanOrEqual(1);
    } finally {
      if (prev === undefined) delete process.env.RA_TOOL_OBSERVE_SYMMETRY;
      else process.env.RA_TOOL_OBSERVE_SYMMETRY = prev;
    }
  });

  it("WITHOUT flag: single-path obsStep has NO verification AND memory not called", async () => {
    const prev = process.env.RA_TOOL_OBSERVE_SYMMETRY;
    delete process.env.RA_TOOL_OBSERVE_SYMMETRY;
    try {
      const { pipeline, steps } = recordingPipeline("observation.tool-result");
      const mem = recordingMemoryService();
      const layer = TestLLMServiceLayer();

      await Effect.runPromise(
        handleActing(
          baseState([{ id: "s1", name: "web-search", arguments: { query: "btc" } }]),
          baseContext(pipeline, { memoryService: mem.service }),
        ).pipe(Effect.provide(layer)),
      );

      expect(steps.length).toBe(1);
      expect(steps[0]!.metadata?.verification).toBeUndefined();
      await new Promise((r) => setTimeout(r, 50));
      expect(mem.stored.length).toBe(0);
    } finally {
      if (prev === undefined) delete process.env.RA_TOOL_OBSERVE_SYMMETRY;
      else process.env.RA_TOOL_OBSERVE_SYMMETRY = prev;
    }
  });
});

describe("act batch healing — batch members get arg-repair (tier parity with single path)", () => {
  it("heals a typo'd tool name in a parallel batch member → it executes (was bypassing healing)", async () => {
    const { pipeline, steps, ctxs } = recordingPipeline("observation.tool-result");
    const layer = TestLLMServiceLayer();

    await Effect.runPromise(
      handleActing(
        // Second call's tool name is a typo ("web-serch") that fuzzy-matches the
        // real "web-search" schema. Pre-fix: batch bypassed healing → guard
        // rejected the unknown tool → only 1 result. Post-fix: healed → executes.
        baseState([
          { id: "h1", name: "http-get", arguments: { url: "https://x" } },
          { id: "h2", name: "web-serch", arguments: { query: "btc" } },
        ]),
        baseContext(pipeline, { batch: true }),
      ).pipe(Effect.provide(layer)),
    );

    // Both executed (the typo'd member was healed, not rejected).
    expect(steps.length).toBe(2);
    const byTool = ctxs.map((c) => c.toolName).sort();
    expect(byTool).toEqual(["http-get", "web-search"]);
    // The healed member reports healed=true; the clean one false.
    const healed = ctxs.find((c) => c.toolName === "web-search");
    expect(healed?.healed).toBe(true);
    const clean = ctxs.find((c) => c.toolName === "http-get");
    expect(clean?.healed).toBe(false);
  });
});
