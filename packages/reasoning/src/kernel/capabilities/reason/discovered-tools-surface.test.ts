// Run: bun test packages/reasoning/src/kernel/capabilities/reason/discovered-tools-surface.test.ts
//
// Live regression (trace 01KX6KY8ANMXC1BSQ1SNJN3DAP, gpt-4o, 2026-07-10):
// the model called discover-tools 4 consecutive iterations; the handler
// returned `Top 3 tools matching "search web" (now callable): web-search…`
// and added the names to discoveredToolsStoreRef — yet every subsequent
// request's toolSchemaNames stayed ["file-write","discover-tools"].
//
// Root cause: think.ts built the resolver's `augmented` set from
// input.availableToolSchemas ONLY (the engine's pre-filtered set), while
// discover-tools lists from input.allToolSchemas (the FULL catalog — see
// tool-capabilities.ts `const catalog = input.allToolSchemas ?? []`). A
// discovered tool whose schema lives only in the catalog could NEVER
// surface: discovery was a dead-end for exactly the built-ins the runtime
// filter withholds.
//
// Fix: resolveToolSurface takes the full `catalog`; discovered names resolve
// their schema from catalog when absent from `augmented`, joining the visible
// surface (visible = required + relevant + used + discovered + meta).
//
// Two layers, mirroring forbidden-tools.test.ts:
//   1. RESOLVER (pure): discovered∩catalog joins universe/visible/callable;
//      forbidden and gate-narrowing still beat discovery; undiscovered
//      catalog-only tools stay hidden; dedupe by name; pressure arm unchanged.
//   2. WIRING (real handleThinking + stub LLM): seeds discoveredToolsStoreRef
//      and pins that the NEXT think pass's prompt offers the catalog-only
//      tool — exactly what the discover-tools description promises ("Tools
//      you discover become callable in your next response").
//
// MUTATION CHECK: reverting the catalog union (resolver reading `augmented`
// only) fails "discovered catalog-only tool joins visible AND callable"
// below, plus the Layer-2 wiring test.

import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer, Ref, Stream } from "effect";
import { LLMService, type StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver, discoveredToolsStoreRef } from "@reactive-agents/tools";
import { resolveToolSurface, type ToolSurfaceInputs } from "./tool-surface.js";
import { handleThinking } from "./think.js";
import {
  initialKernelState,
  noopHooks,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

const schema = (name: string): ToolSchema =>
  ({ name, description: `${name} tool`, parameters: [] }) as ToolSchema;

const FINAL_ANSWER = schema("final-answer");

const names = (xs: readonly ToolSchema[]) => xs.map((t) => t.name);

// The regression shape: the surface only carries file-write (+ final-answer);
// web-search lives ONLY in the full catalog.
const baseInputs = (over: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs => ({
  augmented: [schema("file-write"), FINAL_ANSWER],
  finalAnswerSchema: FINAL_ANSWER,
  lazyMode: true,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [],
  relevantTools: [],
  allowedTools: [],
  toolsUsed: ["file-write"],
  discovered: [],
  gateBlockedTools: [],
  missingRequiredTools: [],
  pruneMinTools: 15,
  catalog: [schema("file-write"), schema("web-search"), schema("http-get")],
  ...over,
});

// ─── Layer 1: the resolver invariant ─────────────────────────────────────────

describe("discovered tools resolve schemas from the FULL catalog", () => {
  it("MUTANT-KILLER: discovered catalog-only tool joins universe, visible AND callable", () => {
    const s = resolveToolSurface(baseInputs({ discovered: ["web-search"] }));
    expect(names(s.universe)).toContain("web-search");
    expect(names(s.visible)).toContain("web-search");
    expect(names(s.callable)).toContain("web-search");
    expect(s.reasons.get("web-search")).toBe("visible: discovered");
  });

  it("undiscovered catalog-only tool stays hidden (catalog alone discloses nothing)", () => {
    const s = resolveToolSurface(baseInputs({ discovered: [] }));
    expect(names(s.universe)).not.toContain("http-get");
    expect(names(s.visible)).not.toContain("http-get");
    expect(names(s.callable)).not.toContain("http-get");
  });

  it("discovering one catalog tool does not leak its catalog siblings", () => {
    const s = resolveToolSurface(baseInputs({ discovered: ["web-search"] }));
    expect(names(s.visible)).not.toContain("http-get");
  });

  it("forbidden-by-contract beats discovery (deny is a hard boundary)", () => {
    const s = resolveToolSurface(
      baseInputs({ discovered: ["web-search"], forbiddenTools: ["web-search"] }),
    );
    expect(names(s.universe)).not.toContain("web-search");
    expect(names(s.visible)).not.toContain("web-search");
    expect(names(s.callable)).not.toContain("web-search");
    expect(s.reasons.get("web-search")).toContain("forbidden");
  });

  it("required-tools gate narrowing still excludes a discovered tool from callable", () => {
    const s = resolveToolSurface(
      baseInputs({
        discovered: ["web-search"],
        requiredTools: ["file-write"],
        hasClassification: true,
        gateBlockedTools: ["web-search"],
        missingRequiredTools: ["file-write"],
      }),
    );
    // Visible (the prompt may still reference it) but NOT in the FC offer.
    expect(names(s.visible)).toContain("web-search");
    expect(names(s.callable)).not.toContain("web-search");
    expect(s.reasons.get("web-search")).toContain("gate-narrowed");
  });

  it("pressure-critical narrowing (non-lazy arm) is unchanged — discovery does not re-widen", () => {
    const s = resolveToolSurface(
      baseInputs({ discovered: ["web-search"], lazyMode: false, pressureCritical: true }),
    );
    expect(names(s.universe)).toEqual(["final-answer"]);
    expect(names(s.visible)).toEqual(["final-answer"]);
    expect(s.reasons.get("web-search")).toContain("pressure-critical");
  });

  it("dedupe by name: a discovered tool already in augmented is not duplicated (augmented schema wins)", () => {
    const richer: ToolSchema = {
      name: "file-write",
      description: "file-write tool",
      parameters: [],
    } as ToolSchema;
    const s = resolveToolSurface(
      baseInputs({
        augmented: [richer, FINAL_ANSWER],
        discovered: ["file-write"],
      }),
    );
    expect(names(s.visible).filter((n) => n === "file-write")).toHaveLength(1);
    expect(s.visible.find((t) => t.name === "file-write")).toBe(richer);
  });

  it("no catalog → behavior identical to before (discovered names without schemas stay absent)", () => {
    const s = resolveToolSurface(
      baseInputs({ discovered: ["web-search"], catalog: undefined }),
    );
    expect(names(s.visible)).not.toContain("web-search");
  });
});

// ─── Layer 2: the WIRING (fails if think.ts stops passing the catalog) ───────

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "Thinking." },
  { type: "content_complete", content: "Thinking." },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];

const stubLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
      model: "test-model",
    }) as never,
  stream: () => Effect.succeed(Stream.fromIterable(cannedStreamEvents) as never),
  completeStructured: () => Effect.succeed({ ok: true }) as never,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as never),
  getStructuredOutputCapabilities: () => Effect.succeed({} as never),
  capabilities: () => Effect.succeed({} as never),
} as never);

/** Drive the REAL think phase and capture the system prompt handed to the model. */
const captureSystemPrompt = async (state: KernelState, input: KernelInput): Promise<string> => {
  let captured = "";
  const context: KernelContext = {
    input,
    profile: CONTEXT_PROFILES.local,
    compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
    toolService: { _tag: "None" },
    hooks: {
      ...noopHooks,
      onThought: (_s: KernelState, _t: string, prompt?: { system: string }) => {
        captured = prompt?.system ?? "";
        return Effect.void;
      },
    },
    toolCallingDriver: new NativeFCDriver(),
    memoryService: { _tag: "None" },
  };
  await Effect.runPromise(handleThinking(state, context).pipe(Effect.provide(stubLLM)));
  return captured;
};

const regressionState = (): KernelState => ({
  ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
  messages: [{ role: "user" as const, content: "Search the web and write the result." }],
  toolsUsed: new Set(["file-write"]),
});

// The 01KX6KY8 shape: the engine pre-filtered availableToolSchemas down to
// file-write, but the FULL catalog (what discover-tools lists) has web-search.
const regressionInput: KernelInput = {
  task: "Search the web and write the result.",
  availableToolSchemas: [
    { name: "file-write", description: "Write a file.", parameters: [] },
  ],
  allToolSchemas: [
    { name: "file-write", description: "Write a file.", parameters: [] },
    { name: "web-search", description: "Search the web.", parameters: [] },
  ],
};

const seedDiscovered = (tools: readonly string[]): Promise<void> =>
  Effect.runPromise(Ref.set(discoveredToolsStoreRef, new Set(tools)));

afterEach(async () => {
  await seedDiscovered([]);
});

describe("WIRING: a discovered catalog-only tool is offered on the NEXT think pass", () => {
  it("control: before discovery, web-search is NOT offered", async () => {
    await seedDiscovered([]);
    const system = await captureSystemPrompt(regressionState(), regressionInput);
    expect(system).not.toContain("web-search");
    expect(system).toContain("file-write");
  });

  it("01KX6KY8 regression: after discover-tools surfaces web-search, the next prompt offers it", async () => {
    await seedDiscovered(["web-search"]);
    const system = await captureSystemPrompt(regressionState(), regressionInput);
    expect(system).toContain("web-search");
    expect(system).toContain("file-write");
  });
});
