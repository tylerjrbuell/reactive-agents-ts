// Run: bun test packages/reasoning/src/kernel/capabilities/reason/stable-tool-list.test.ts --timeout 15000
//
// Stable tool list (harness.stableToolList, opt-in, 2026-11-10).
//
// Census 2026-11-10 (wiki/Research/Harness-Reports/2026-11-10-tool-surface-leading-practice.md
// §4, §6): the tool list changed inside one run in 40% of runs. Every change
// rewrites the tool block at the head of the prompt and invalidates the
// provider prompt cache. Causes: final-answer flipping in and out (519 adds,
// 183 removals with NO recorded reason), recall shown once a tool ran, the
// never-prune-to-meta-only fallback showing everything on turn 0 and
// narrowing on turn 1 (trace 01M6RVN500VMRBWEBH953ETFYZ), and the
// head-truncation guard dropping tools mid-run.
//
// Pins:
//   1. RESOLVER: with a pin, the visible list is the pinned list plus appends.
//   2. WIRING: across think turns of one pass the FC `tools` array is
//      identical except for tools appended by discovery.
//   3. CALL TIME: a listed-but-not-ready tool is refused, never run.
//   4. TIGHT WINDOW: the head-truncation guard drops no tool after the pinning turn.
//   5. REASONS: a tool leaving the default surface records why.

import { afterEach, describe, expect, it } from "bun:test";
import { Effect, Layer, Option, Ref, Stream } from "effect";
import { LLMService, type LLMMessage, type StreamEvent } from "@reactive-agents/llm-provider";
import { NativeFCDriver, type ToolCallSpec } from "@reactive-agents/tools";
import { rootContext } from "@reactive-agents/core";
import { bindRun, withRunScope } from "@reactive-agents/core/internal/run-scope";
import { makeRunToolStoresSync, runToolStoresSlot } from "@reactive-agents/tools/internal/run-slots";
import { resolveToolSurface, type ToolSurfaceInputs } from "./tool-surface.js";
import { handleThinking } from "./think.js";
import { preflightHeadTruncation, type WireToolPayload } from "./head-truncation-guard.js";
import { gateTurnToolCalls } from "../decide/tool-call-refusals.js";
import { resolveHarnessConfig } from "../../../harness-config.js";
import {
  initialKernelState,
  noopHooks,
  transitionState,
  type KernelContext,
  type KernelInput,
  type KernelState,
} from "../../state/kernel-state.js";
import { CONTEXT_PROFILES } from "../../../context/context-profile.js";
import type { ToolSchema } from "../attend/tool-formatting.js";

const STABLE = resolveHarnessConfig({ stableToolList: true });
const DEFAULT = resolveHarnessConfig();

const schema = (name: string, scope?: "domain"): ToolSchema =>
  ({ name, description: `${name} tool`, parameters: [], ...(scope ? { scope } : {}) }) as ToolSchema;
const names = (xs: readonly { readonly name: string }[]) => xs.map((t) => t.name);

// ─── 1. Resolver ─────────────────────────────────────────────────────────────

const DOMAIN = ["alpha", "beta", "gamma", "delta"].map((n) => schema(n));
const surfaceInputs = (over: Partial<ToolSurfaceInputs> = {}): ToolSurfaceInputs => ({
  augmented: [...DOMAIN, schema("recall", "domain")],
  finalAnswerSchema: schema("final-answer"),
  lazyMode: true,
  pressureCritical: false,
  hasClassification: false,
  requiredTools: [],
  relevantTools: [],
  allowedTools: [],
  toolsUsed: [],
  discovered: [],
  gateBlockedTools: [],
  missingRequiredTools: [],
  pruneMinTools: 15,
  catalog: [...DOMAIN, schema("web-search")],
  taskText: "Do the job.",
  harness: STABLE,
  iteration: 0,
  ...over,
});

describe("resolver: a pinned list only grows", () => {
  it("control (default): turn 1 narrows the turn-0 never-prune fallback and adds recall", () => {
    const t0 = resolveToolSurface(surfaceInputs({ harness: DEFAULT }));
    const t1 = resolveToolSurface(surfaceInputs({ harness: DEFAULT, toolsUsed: ["alpha"], iteration: 1 }));
    expect(names(t0.visible)).not.toEqual(names(t1.visible));
  });

  it("stable: turn 1 shows the turn-0 list, unchanged", () => {
    const t0 = resolveToolSurface(surfaceInputs());
    const pin = { pinned: names(t0.visible), shed: [], pinnedAt: 0 };
    const t1 = resolveToolSurface(surfaceInputs({ toolsUsed: ["alpha"], iteration: 1, pin }));
    expect(names(t1.visible)).toEqual(names(t0.visible));
    expect(names(t1.callable)).toEqual(names(t0.visible));
    expect(t1.reasons.get("beta")).toBe("visible: pinned at run start (stable tool list)");
  });

  it("stable: recall is listed on turn 0 with a not-ready reason (not hidden)", () => {
    const t0 = resolveToolSurface(surfaceInputs());
    expect(names(t0.visible)).toContain("recall");
    expect(t0.reasons.get("recall")).toContain("not ready");
  });

  it("stable: a discovered tool is appended at the end; the prefix is untouched", () => {
    const t0 = resolveToolSurface(surfaceInputs());
    const pin = { pinned: names(t0.visible), shed: [], pinnedAt: 0 };
    const t1 = resolveToolSurface(surfaceInputs({ discovered: ["web-search"], iteration: 1, pin }));
    expect(names(t1.visible)).toEqual([...names(t0.visible), "web-search"]);
    expect(t1.reasons.get("web-search")).toBe("visible: discovered");
  });

  it("stable: gate narrowing no longer cuts callable below visible", () => {
    const s = resolveToolSurface(
      surfaceInputs({
        requiredTools: ["alpha"],
        relevantTools: ["beta"],
        hasClassification: true,
        gateBlockedTools: ["beta"],
        missingRequiredTools: ["alpha"],
      }),
    );
    expect(names(s.visible)).toContain("beta");
    expect(names(s.callable)).toEqual(names(s.visible));
  });

  it("stable: a shed tool stays out of the list and says why", () => {
    const t0 = resolveToolSurface(surfaceInputs());
    const pin = { pinned: names(t0.visible).filter((n) => n !== "delta"), shed: ["delta"], pinnedAt: 0 };
    const t1 = resolveToolSurface(surfaceInputs({ iteration: 1, pin }));
    expect(names(t1.visible)).not.toContain("delta");
    expect(t1.reasons.get("delta")).toContain("shed");
  });
});

// ─── 5. Reasons on the default surface ───────────────────────────────────────

describe("reasons: a tool withheld before resolution still says why", () => {
  it("withheld final-answer carries its reason", () => {
    const s = resolveToolSurface(
      surfaceInputs({ harness: DEFAULT, withheld: new Map([["final-answer", "hidden: final-answer not offered yet"]]) }),
    );
    expect(s.reasons.get("final-answer")).toBe("hidden: final-answer not offered yet");
  });

  it("strict discover: a discovered tool reports 'discovered', not 'allowed-floor'", () => {
    const strict = resolveHarnessConfig({ disclosureMode: "discover" });
    const s = resolveToolSurface(
      surfaceInputs({ harness: strict, allowedTools: ["web-search"], discovered: ["web-search"] }),
    );
    expect(s.reasons.get("web-search")).toBe("visible: discovered");
  });
});

// ─── 2. Wiring: the FC array across turns of one pass ────────────────────────

const cannedStreamEvents: readonly StreamEvent[] = [
  { type: "text_delta", text: "Thinking." },
  { type: "content_complete", content: "Thinking." },
  { type: "usage", usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 } },
];

let capturedFC: string[] = [];
const stubLLM = Layer.succeed(LLMService, {
  complete: () =>
    Effect.succeed({
      content: "ok",
      stopReason: "end_turn",
      usage: { inputTokens: 8, outputTokens: 4, totalTokens: 12, estimatedCost: 0 },
      model: "test-model",
    }) as never,
  stream: (req: unknown) => {
    capturedFC = ((req as { tools?: readonly { name?: string }[] })?.tools ?? []).map((t) => t.name ?? "");
    return Effect.succeed(Stream.fromIterable(cannedStreamEvents) as never);
  },
  completeStructured: () => Effect.succeed({ ok: true }) as never,
  embed: () => Effect.succeed([]),
  countTokens: () => Effect.succeed(0),
  getModelConfig: () => Effect.succeed({} as never),
  getStructuredOutputCapabilities: () => Effect.succeed({} as never),
  capabilities: () => Effect.succeed({} as never),
} as never);

let discoveredSeed: readonly string[] = [];
const inRun = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
  const stores = makeRunToolStoresSync();
  return Effect.zipRight(Ref.set(stores.discoveredTools, new Set(discoveredSeed)), effect).pipe(
    withRunScope(rootContext("stable-tool-list", "agent"), bindRun(runToolStoresSlot, stores)),
  );
};
afterEach(() => {
  discoveredSeed = [];
});

const contextFor = (input: KernelInput, profile = CONTEXT_PROFILES.local): KernelContext => ({
  input,
  profile,
  compression: { budget: 800, previewItems: 5, autoStore: true, codeTransform: true },
  toolService: Option.none(),
  hooks: noopHooks,
  toolCallingDriver: new NativeFCDriver(),
  memoryService: Option.none(),
});

/** One think turn: returns the FC tool names the model received and the next state. */
const turn = async (
  state: KernelState,
  input: KernelInput,
  profile = CONTEXT_PROFILES.local,
): Promise<{ fc: string[]; state: KernelState }> => {
  capturedFC = [];
  const next = await Effect.runPromise(handleThinking(state, contextFor(input, profile)).pipe(inRun, Effect.provide(stubLLM)));
  return { fc: capturedFC, state: next };
};

const DOMAIN_INPUT = [
  { name: "alpha", description: "Alpha.", parameters: [] },
  { name: "beta", description: "Beta.", parameters: [] },
  { name: "gamma", description: "Gamma.", parameters: [] },
  { name: "recall", description: "Notes.", parameters: [], scope: "domain" as const },
];
const passInput = (harness = STABLE): KernelInput => ({
  task: "Do the job.",
  availableToolSchemas: DOMAIN_INPUT,
  allToolSchemas: [...DOMAIN_INPUT, { name: "web-search", description: "Search the web.", parameters: [] }],
  harness,
});
const freshState = (): KernelState => ({
  ...initialKernelState({ strategy: "reactive", kernelType: "reactive", maxIterations: 8 }),
  messages: [{ role: "user" as const, content: "Do the job." }],
});
/** What an act round leaves behind: a tool ran and the iteration advanced (meta kept). */
const afterAct = (s: KernelState, tool: string): KernelState =>
  transitionState(s, { toolsUsed: new Set([...s.toolsUsed, tool]), iteration: s.iteration + 1, status: "thinking" });

describe("WIRING: one pass, several turns", () => {
  it("control (default): the FC array changes after the first tool runs", async () => {
    const t0 = await turn(freshState(), passInput(DEFAULT));
    const t1 = await turn(afterAct(t0.state, "alpha"), passInput(DEFAULT));
    expect(t1.fc).not.toEqual(t0.fc);
  });

  it("stable: the FC array is identical across turns", async () => {
    const t0 = await turn(freshState(), passInput());
    expect(t0.fc).toContain("recall");
    const t1 = await turn(afterAct(t0.state, "alpha"), passInput());
    const t2 = await turn(afterAct(t1.state, "beta"), passInput());
    expect(t1.fc).toEqual(t0.fc);
    expect(t2.fc).toEqual(t0.fc);
  });

  it("stable: discovery appends at the end and nothing else moves", async () => {
    const t0 = await turn(freshState(), passInput());
    discoveredSeed = ["web-search"];
    const t1 = await turn(afterAct(t0.state, "alpha"), passInput());
    expect(t1.fc).toEqual([...t0.fc, "web-search"]);
  });
});

// ─── 3. Call time: listed but not ready → refused, never run ─────────────────

const call = (name: string, args: Record<string, unknown> = {}): ToolCallSpec => ({ id: `c-${name}`, name, arguments: args });
const pinnedState = (pinned: readonly string[]): KernelState =>
  transitionState(freshState(), { meta: { ...freshState().meta, stableToolList: { pinned, shed: [], pinnedAt: 0 } } });

describe("CALL TIME: readiness is a refusal, not a hidden tool", () => {
  it("recall read before anything is stored is refused with what to do first", async () => {
    const g = await Effect.runPromise(gateTurnToolCalls(pinnedState(["alpha", "recall"]), passInput(), [call("recall", { key: "x" })]));
    expect(g.effective).toHaveLength(0);
    expect(g.refused).toHaveLength(1);
    expect(g.refused[0]!.kind).toBe("not-ready");
    expect(g.refused[0]!.reason).toContain("recall(key, content)");
    expect(g.refusalSteps.length).toBeGreaterThan(0);
  });

  it("recall write is always ready; a ready call in the same turn still runs", async () => {
    const g = await Effect.runPromise(
      gateTurnToolCalls(pinnedState(["alpha", "recall"]), passInput(), [call("recall", { key: "k", content: "note" }), call("alpha")]),
    );
    expect(names(g.effective)).toEqual(["recall", "alpha"]);
    expect(g.refused).toHaveLength(0);
  });

  it("discover-tools with every permitted tool listed is refused", async () => {
    const all = ["alpha", "beta", "gamma", "web-search"];
    const g = await Effect.runPromise(gateTurnToolCalls(pinnedState(all), passInput(), [call("discover-tools", { query: "x" })]));
    expect(g.refused.map((r) => r.kind)).toEqual(["not-ready"]);
  });

  it("control (default): the same recall call is not refused by readiness", async () => {
    const g = await Effect.runPromise(gateTurnToolCalls(pinnedState(["alpha", "recall"]), passInput(DEFAULT), [call("recall", { key: "x" })]));
    expect(g.refused.filter((r) => r.kind === "not-ready")).toHaveLength(0);
  });
});

// ─── 4. Tight window: tools are shed on the pinning turn only ────────────────

const bigTool = (i: number): WireToolPayload => ({
  name: `tool-${i}`,
  description: "",
  inputSchema: {
    type: "object",
    properties: Object.fromEntries(Array.from({ length: 24 }, (_, k) => [`p${k}`, { type: "string", enum: ["a", "b"] }])),
  },
});
const bulky = (i: number): LLMMessage => ({ role: "user", content: `${"payload ".repeat(120)}${i}` });

describe("TIGHT WINDOW: no tool drop after the pinning turn", () => {
  const base = {
    systemPrompt: "You are an agent.",
    messages: [bulky(1), bulky(2), bulky(3), bulky(4)],
    wireTools: [bigTool(1), bigTool(2), bigTool(3), bigTool(4)],
    outputBudget: 256,
    numCtx: 1200,
    tokenizerFamily: "llama" as const,
    requiredTools: [],
    relevantTools: [],
  };

  it("control: the default ladder drops tools first", async () => {
    const r = await Effect.runPromise(preflightHeadTruncation(base));
    expect(r.droppedToolNames.length).toBeGreaterThan(0);
  });

  it("WIRING (ollama, tight window): tools shed on turn 0 stay shed; turn 1 drops none", async () => {
    const wide = Array.from({ length: 8 }, (_, i) => ({
      name: `wide-${i}`,
      description: "A tool with a large schema. ".repeat(6),
      parameters: Array.from({ length: 40 }, (_, k) => ({
        name: `parameter_number_${k}`,
        type: "string",
        description: "x",
        required: false,
        enum: ["first-choice", "second-choice", "third-choice"],
      })),
    }));
    const extra = { ...wide[0]!, name: "wide-extra" };
    const input: KernelInput = {
      task: "Do the job.",
      availableToolSchemas: wide,
      allToolSchemas: [...wide, extra],
      providerName: "ollama",
      harness: STABLE,
    };
    const tight = { ...CONTEXT_PROFILES.local, explicitNumCtx: 3000 };
    const t0 = await turn(freshState(), input, tight);
    const shed = t0.state.meta.stableToolList?.shed ?? [];
    expect(shed.length).toBeGreaterThan(0);
    expect(t0.fc).not.toContain(shed[0]!);
    // Turn 1 appends a discovered large tool: the window overflows again. The
    // default ladder would shed a tool here (tail first: the new one); the
    // stable list ships the grown block and shrinks history instead.
    discoveredSeed = ["wide-extra"];
    const t1 = await turn(afterAct(t0.state, "wide-0"), input, tight);
    expect(t1.fc).toEqual([...t0.fc, "wide-extra"]);
    expect(t1.state.meta.stableToolList?.shed).toEqual(shed);
  });

  it("allowToolDrop: false keeps every tool and shrinks history instead", async () => {
    const r = await Effect.runPromise(preflightHeadTruncation({ ...base, allowToolDrop: false }));
    expect(r.fired).toBe(true);
    expect(r.droppedToolNames).toEqual([]);
    expect(names(r.wireTools)).toEqual(names(base.wireTools));
    expect(r.droppedMessageCount).toBeGreaterThan(0);
  });
});
