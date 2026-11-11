// packages/llm-provider/tests/anthropic-structured-output.test.ts
// Regression: completeStructured() built its JSON Schema string via
// Schema.encodedSchema(request.outputSchema), which returns another Effect
// Schema instance (not a JSON-serializable object). JSON.stringify() on it
// silently evaluated to `undefined`, and the downstream JSON.parse("undefined")
// threw "SyntaxError: JSON Parse error: Unexpected identifier undefined".
// Fixed by swapping in JSONSchema.make(), which returns a real
// JSON-Schema-shaped plain object.
//
// This test exercises the FULL completeStructured() pipeline (schema build +
// SDK call + parse) against a real Schema.Struct, matching the shape used by
// @reactive-agents/judgment's buildBatchSchema (`{ probability: number }`).
//
// Run: bun test packages/llm-provider/tests/anthropic-structured-output.test.ts --timeout 15000

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, FiberRef, Layer, Schema } from "effect";
import { StructuredUsageRef } from "../src/structured-parse-retry.js";

// Bun module mocks are process-global and leak across test FILES. Capture the
// real module and re-install it in afterAll so later files hit the real SDK
// again — mirrors anthropic-provider.test.ts.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
});

// ─── Mock @anthropic-ai/sdk BEFORE the provider module is imported ───

let capturedCreateOpts: Record<string, unknown> | null = null;

type MockMessage = {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text?: string;
    thinking?: string;
    id?: string;
    name?: string;
    input?: unknown;
  }>;
  model: string;
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
};

const mockCreate = mock(async (opts: unknown): Promise<MockMessage> => {
  capturedCreateOpts = opts as Record<string, unknown>;
  const forced = (opts as { tool_choice?: { type?: string } }).tool_choice?.type === "tool";
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    // Forced path: the answer is the structured tool's input. Prompt path:
    // completeStructured() prefills the assistant turn with "{" and prepends
    // it back onto the response content.
    content: forced
      ? [{ type: "tool_use", id: "toolu_1", name: "structured_output", input: { probability: 0.87 } }]
      : [{ type: "text", text: '"probability": 0.87}' }],
    model: "claude-opus-4-8",
    stop_reason: forced ? "tool_use" : "end_turn",
    usage: {
      input_tokens: 10,
      output_tokens: 5,
    },
  };
});

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      create: mockCreate,
    };
  },
}));

// ─── Lazy imports (after mock registration) ───

import type { LLMService as LLMServiceType } from "../src/index.js";
import type { Layer as EffectLayer } from "effect";

let AnthropicProviderLive: EffectLayer.Layer<LLMServiceType>;
let LLMService: typeof import("../src/index.js")["LLMService"];
let LLMConfig: typeof import("../src/index.js")["LLMConfig"];

beforeAll(async () => {
  const mod = await import("../src/index.js");
  AnthropicProviderLive = mod.AnthropicProviderLive;
  LLMService = mod.LLMService;
  LLMConfig = mod.LLMConfig;
});

const ProbabilitySchema = Schema.Struct({ probability: Schema.Number });

function makeLayer() {
  return Layer.provide(
    AnthropicProviderLive,
    Layer.succeed(
      LLMConfig,
      LLMConfig.of({
        defaultProvider: "anthropic",
        defaultModel: "claude-opus-4-8",
        anthropicApiKey: "test-key",
        defaultMaxTokens: 4096,
        defaultTemperature: 0.7,
        supportsPromptCaching: false,
        maxRetries: 0,
        timeoutMs: 15_000,
        embeddingConfig: {
          model: "text-embedding-3-small",
          dimensions: 1536,
          provider: "openai",
          batchSize: 100,
        },
      }),
    ),
  );
}

describe("AnthropicProviderLive completeStructured() — schema build regression", () => {
  // Thinking on → the prompt + prefill path, which carries the schema as text.
  it("builds a valid JSON schema string and does not throw (JSONSchema.make regression)", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
          thinking: true,
        });
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(result).toEqual({ probability: 0.87 });
    expect(mockCreate).toHaveBeenCalled();

    // Regression proper: Schema.encodedSchema(request.outputSchema) resolves
    // to a non-serializable Effect Schema instance, so
    // JSON.stringify(...) on it silently produced the literal string
    // "undefined" in the instruction prompt sent to the model — the model
    // never saw the real field names/types. Assert the actual schema shape
    // reached the wire, not the word "undefined".
    const messages = capturedCreateOpts?.messages as
      | Array<{ role: string; content: unknown }>
      | undefined;
    // Last message is the "{" assistant prefill (anthropic.ts pushes it
    // after the schema instruction) — the schema instruction is the one
    // before it.
    const lastUserMessage = messages?.[messages.length - 2];
    const promptText =
      typeof lastUserMessage?.content === "string"
        ? lastUserMessage.content
        : JSON.stringify(lastUserMessage?.content);

    expect(promptText).toContain("probability");
    expect(promptText).not.toContain("undefined");
  });
});

// H3 instrument gap 1 (2026-11-06): per-attempt report from the Anthropic path —
// stop_reason passes through, `thinking` block text length becomes thinkingChars.
describe("AnthropicProviderLive completeStructured() — per-attempt report", () => {
  it("reports stop reason and thinking size from the raw Messages response", async () => {
    mockCreate.mockResolvedValueOnce({
      id: "msg_test",
      type: "message",
      role: "assistant",
      content: [
        { type: "thinking", thinking: "y".repeat(250) },
        { type: "text", text: '"probability": 0.42}' },
      ],
      model: "claude-opus-4-8",
      stop_reason: "end_turn",
      usage: { input_tokens: 11, output_tokens: 90 },
    });

    const ref = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
          thinking: true,
        });
        return yield* FiberRef.get(StructuredUsageRef);
      }).pipe(Effect.provide(makeLayer())),
    );

    expect(ref?.attempts).toEqual([
      { attempt: 0, parsed: true, inputTokens: 11, outputTokens: 90, stopReason: "end_turn", thinkingChars: 250 },
    ]);
  });
});

// Schema enforcement (2026-11-11): with thinking off, completeStructured forces
// one call to a tool whose input_schema is the target schema and returns the
// tool input. SDK 0.30.x has no native structured-output parameter.
describe("AnthropicProviderLive completeStructured() — forced-tool schema enforcement", () => {
  const run = <A>(outputSchema: Schema.Schema<A>, extra: { thinking?: boolean; maxParseRetries?: number } = {}) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm
          .completeStructured({
            messages: [{ role: "user", content: "Give me a probability." }],
            outputSchema,
            ...extra,
          })
          .pipe(Effect.either);
      }).pipe(Effect.provide(makeLayer())),
    );

  const toolUse = (input: unknown): MockMessage => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    content: [{ type: "tool_use", id: "toolu_1", name: "structured_output", input }],
    model: "claude-opus-4-8",
    stop_reason: "tool_use",
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  it("sends the target schema as a forced tool, with no prefill and no thinking", async () => {
    capturedCreateOpts = null;
    await run(ProbabilitySchema);

    const opts = capturedCreateOpts as Record<string, unknown> | null;
    const tools = opts?.tools as Array<{ name: string; input_schema: Record<string, unknown> }>;
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("structured_output");
    expect(tools[0]!.input_schema.properties).toEqual({ probability: { type: "number" } });
    expect(tools[0]!.input_schema.required).toEqual(["probability"]);
    expect(opts?.tool_choice).toEqual({ type: "tool", name: "structured_output" });
    expect("thinking" in (opts ?? {})).toBe(false);
    const messages = opts?.messages as Array<{ role: string }>;
    expect(messages[messages.length - 1]!.role).toBe("user");
  });

  it("returns the object from the tool input and reports usage", async () => {
    const out = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        const value = yield* llm.completeStructured({
          messages: [{ role: "user", content: "Give me a probability." }],
          outputSchema: ProbabilitySchema,
        });
        return { value, usage: yield* FiberRef.get(StructuredUsageRef) };
      }).pipe(Effect.provide(makeLayer())),
    );
    expect(out.value).toEqual({ probability: 0.87 });
    expect(out.usage?.attempts).toEqual([
      { attempt: 0, parsed: true, inputTokens: 10, outputTokens: 5, stopReason: "tool_use" },
    ]);
  });

  it("unwraps a non-object schema from the value property", async () => {
    mockCreate.mockResolvedValueOnce(toolUse({ value: ["a", "b"] }));
    const out = await run(Schema.Array(Schema.String));
    expect(out._tag).toBe("Right");
    if (out._tag === "Right") expect(out.right).toEqual(["a", "b"]);
    // mockResolvedValueOnce bypasses the capturing implementation; read the call.
    const lastOpts = mockCreate.mock.calls[mockCreate.mock.calls.length - 1]![0] as Record<string, unknown>;
    const tools = lastOpts.tools as Array<{ input_schema: Record<string, unknown> }>;
    expect(tools[0]!.input_schema.required).toEqual(["value"]);
  });

  it("thinking on falls back to the prompt + prefill path (no forced tool)", async () => {
    capturedCreateOpts = null;
    const out = await run(ProbabilitySchema, { thinking: true });
    expect(out._tag).toBe("Right");
    const opts = capturedCreateOpts as Record<string, unknown> | null;
    expect(opts?.tools).toBeUndefined();
    expect(opts?.tool_choice).toBeUndefined();
    expect(opts?.thinking).toBeDefined();
    const messages = opts?.messages as Array<{ role: string; content: unknown }>;
    expect(messages[messages.length - 1]).toEqual({ role: "assistant", content: "{" });
  });

  it("a schema-violating tool input is repaired on the next attempt", async () => {
    mockCreate.mockResolvedValueOnce(toolUse({ probability: "high" }));
    const out = await run(ProbabilitySchema, { maxParseRetries: 1 });
    expect(out._tag).toBe("Right");
    if (out._tag === "Right") expect(out.right).toEqual({ probability: 0.87 });
    const messages = (capturedCreateOpts as Record<string, unknown>).messages as Array<{
      role: string;
      content: unknown;
    }>;
    expect(JSON.stringify(messages[messages.length - 1])).toContain("did not match the schema");
  });

  it("schema violations on every attempt surface as LLMParseError", async () => {
    mockCreate.mockResolvedValueOnce(toolUse({ probability: "high" }));
    mockCreate.mockResolvedValueOnce(toolUse({ probability: "high" }));
    const out = await run(ProbabilitySchema, { maxParseRetries: 1 });
    expect(out._tag).toBe("Left");
    if (out._tag === "Left") {
      expect((out.left as { _tag: string })._tag).toBe("LLMParseError");
      expect((out.left as { attempts?: readonly unknown[] }).attempts).toHaveLength(2);
    }
  });

  it("a response without the tool call surfaces through the parse-retry loop", async () => {
    mockCreate.mockResolvedValueOnce({ ...toolUse({}), content: [], stop_reason: "max_tokens" });
    mockCreate.mockResolvedValueOnce({ ...toolUse({}), content: [], stop_reason: "max_tokens" });
    const out = await run(ProbabilitySchema, { maxParseRetries: 1 });
    expect(out._tag).toBe("Left");
    if (out._tag === "Left") expect((out.left as { _tag: string })._tag).toBe("LLMParseError");
  });

  it("reports schema enforcement in the structured-output capabilities", async () => {
    const caps = await Effect.runPromise(
      Effect.gen(function* () {
        const llm = yield* LLMService;
        return yield* llm.getStructuredOutputCapabilities();
      }).pipe(Effect.provide(makeLayer())),
    );
    expect(caps.jsonSchemaEnforcement).toBe(true);
    expect(caps.nativeJsonMode).toBe(true);
  });
});
