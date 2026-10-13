// Run: bun test packages/reasoning/tests/kernel/wire-payload-honesty.test.ts --timeout 15000
/**
 * W2d 2.4 — FC wire-payload honesty (design law #1's payload half).
 *
 * Measured (wave 2 audit): on local models the FC `tools:` array is ~4,000
 * corrected tokens — ~49% of an 8K window — and ~80% of that is DESCRIPTION
 * strings the tier profile already declared it cannot afford. The
 * `toolSchemaDetail:"names-and-types"` profile (local tier) suppressed
 * descriptions in PROMPT TEXT (think.ts :821-830 driverSchemas stripper) but
 * the WIRE ARRAY kept shipping them — the profile was lying about the payload.
 *
 * Pins:
 *  - local-tier native-fc request: wire tools carry NO description strings
 *    (top level + per-param), while name / type / required / enum / items are
 *    KEPT (exactly the profile's declared semantics, same as the existing
 *    prompt-text stripper — no second stripper).
 *  - frontier-tier request: descriptions byte-unchanged (big models keep tool
 *    fidelity; the gate must not fire there).
 *  - payload shrink demonstrated on the description-heavy fixture.
 */
import { describe, it, expect } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { LLMService } from "@reactive-agents/llm-provider";
import type {
  CompletionRequest,
  CompletionResponse,
  StreamEvent,
  StructuredCompletionRequest,
} from "@reactive-agents/llm-provider";
import { NativeFCDriver } from "@reactive-agents/tools";
import type { ToolSchema } from "../../src/kernel/capabilities/attend/tool-formatting.js";
import { handleThinking } from "../../src/kernel/capabilities/reason/think.js";
import {
  noopHooks,
  type KernelContext,
  type KernelState,
} from "../../src/kernel/state/kernel-state.js";
import { CONTEXT_PROFILES, type ContextProfile } from "../../src/context/context-profile.js";

const RICH_TOOL: ToolSchema = {
  name: "web-search",
  description:
    "Search the public web for documents, news and pages. Returns ranked results with titles, " +
    "snippets and URLs. Use this whenever the task needs current external information. " +
    "d".repeat(600),
  parameters: [
    {
      name: "query",
      type: "string",
      description: "The search query string, in natural language. " + "p".repeat(240),
      required: true,
    },
    {
      name: "count",
      type: "number",
      description: "How many results to return, between 1 and 10. " + "c".repeat(200),
    },
    { name: "order", type: "string", enum: ["relevance", "date"] },
    {
      name: "tags",
      type: "array",
      description: "Filter tags. " + "t".repeat(200),
      items: { type: "string" },
    },
  ],
};

function makeState(): KernelState {
  return {
    taskId: "wire-payload-test",
    strategy: "reactive",
    kernelType: "react",
    steps: [],
    toolsUsed: new Set<string>(),
    scratchpad: new Map<string, string>(),
    iteration: 0,
    tokens: 0,
    cost: 0,
    status: "thinking",
    output: null,
    error: null,
    llmCalls: 0,
    meta: { maxIterations: 10 },
    controllerDecisionLog: [],
    messages: [],
  };
}

function makeContext(profile: ContextProfile): KernelContext {
  return {
    input: {
      task: "Search the web for the current Tesla stock price.",
      availableToolSchemas: [RICH_TOOL],
    },
    profile,
    compression: {
      enabled: false,
      maxResultChars: 4000,
      previewLines: 10,
      arrayPreviewItems: 5,
    },
    toolService: { _tag: "None" },
    hooks: noopHooks,
    toolCallingDriver: new NativeFCDriver(),
  };
}

const CANNED_EVENTS: readonly StreamEvent[] = [
  { type: "text_delta", text: "Searching now — the price is reported at $412." },
  { type: "content_complete", content: "Searching now — the price is reported at $412." },
  { type: "usage", usage: { inputTokens: 50, outputTokens: 12, totalTokens: 62, estimatedCost: 0 } },
];

/** Runs one think turn at the given profile; returns the captured wire request. */
async function captureRequest(profile: ContextProfile): Promise<CompletionRequest> {
  const captured: CompletionRequest[] = [];
  const layer = Layer.succeed(
    LLMService,
    LLMService.of({
      complete: (_request: CompletionRequest) =>
        Effect.succeed<CompletionResponse>({
          content: "",
          stopReason: "end_turn",
          usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0 },
          model: "test",
        }),
      stream: (request: CompletionRequest) => {
        captured.push(request);
        return Effect.succeed(Stream.fromIterable(CANNED_EVENTS));
      },
      completeStructured: <A>(_request: StructuredCompletionRequest<A>) =>
        Effect.die("unused in wire payload test"),
      embed: (texts: readonly string[]) =>
        Effect.succeed(texts.map(() => new Array<number>(8).fill(0))),
      countTokens: (messages: readonly unknown[]) => Effect.succeed(messages.length),
      getModelConfig: () => Effect.succeed({ provider: "ollama", model: "qwen3:4b" }),
      getStructuredOutputCapabilities: () =>
        Effect.succeed({
          nativeJsonMode: false,
          jsonSchemaEnforcement: false,
          prefillSupport: false,
          grammarConstraints: false,
        }),
      capabilities: () =>
        Effect.succeed({
          supportsToolCalling: true,
          supportsStreaming: true,
          supportsSystemPrompt: true,
          supportsLogprobs: false,
          supportsNativeStreaming: true,
          supportsPromptCaching: false,
        }),
    }),
  );

  await Effect.runPromise(
    handleThinking(makeState(), makeContext(profile)).pipe(Effect.provide(layer)),
  );
  const request = captured[0];
  if (request === undefined) throw new Error("no wire request captured");
  return request;
}

interface WireTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema?: Record<string, unknown>;
}

function wireTool(request: CompletionRequest): WireTool {
  const tools = request.tools as readonly WireTool[] | undefined;
  const t = tools?.[0];
  if (t === undefined) throw new Error("wire tools array missing/empty");
  return t;
}

function properties(tool: WireTool): Record<string, Record<string, unknown>> {
  return (tool.inputSchema?.properties ?? {}) as Record<string, Record<string, unknown>>;
}

describe("W2d 2.4 — FC wire payload honors toolSchemaDetail", () => {
  it("local tier (names-and-types): descriptions STRIPPED from the wire array; name/type/required/enum/items KEPT", async () => {
    const request = await captureRequest(CONTEXT_PROFILES.local);
    const tool = wireTool(request);

    expect(tool.name).toBe("web-search");
    expect(tool.description === "" || tool.description === undefined).toBe(true);

    const props = properties(tool);
    expect(props.query?.type).toBe("string");
    expect(Boolean(props.query?.description)).toBe(false);
    expect(props.count?.type).toBe("number");
    expect(Boolean(props.count?.description)).toBe(false);
    expect(props.tags?.type).toBe("array");
    expect(Boolean(props.tags?.description)).toBe(false);
    // KEPT per plan: enum + array items + required list.
    expect(props.order?.enum).toEqual(["relevance", "date"]);
    expect(props.tags?.items).toEqual({ type: "string" });
    expect(request.tools).toBeDefined();
    const required = (tool.inputSchema?.required ?? []) as readonly string[];
    expect(required).toContain("query");

    // Description text must not survive anywhere in the payload.
    const serialized = JSON.stringify(request.tools);
    expect(serialized).not.toContain("ranked results");
    expect(serialized).not.toContain("natural language");
  }, 15000);

  it("frontier tier (full): descriptions byte-present (big-model tool fidelity NOT regressed)", async () => {
    const request = await captureRequest(CONTEXT_PROFILES.frontier);
    const tool = wireTool(request);

    expect(tool.description).toBe(RICH_TOOL.description);
    const props = properties(tool);
    expect(props.query?.description).toBe(RICH_TOOL.parameters[0]?.description);
    const serialized = JSON.stringify(request.tools);
    expect(serialized).toContain("ranked results");
  }, 15000);

  it("description-heavy fixture: local payload is ≥2x smaller than the frontier payload (window reclaimed)", async () => {
    const localTools = (await captureRequest(CONTEXT_PROFILES.local)).tools;
    const frontierTools = (await captureRequest(CONTEXT_PROFILES.frontier)).tools;
    const localSize = JSON.stringify(localTools).length;
    const frontierSize = JSON.stringify(frontierTools).length;
    expect(localSize * 2).toBeLessThan(frontierSize);
  }, 15000);
});
