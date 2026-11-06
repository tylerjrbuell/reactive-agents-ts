// Run: bun test packages/llm-provider/tests/local-structured-thinking.test.ts --timeout 15000
//
// H3 thinking-cap recheck (2026-11-06): Ollama completeStructured sent no
// `think` param and widened num_predict by THINKING_NUM_PREDICT_ALLOWANCE, so
// qwen3:4b planner calls emitted up to 13,855 tokens for a ~200-500 token plan
// JSON. Structured output now defaults thinking OFF (cloud parity: Anthropic /
// OpenAI / LiteLLM / Gemini structured paths only reserve thinking on explicit
// opt-in): unset → `think: false` on capable models, num_predict = maxTokens.
// Explicit opt-in (request or config `thinking: true`) keeps think:true + the
// allowance, exactly like complete(). Activation key: Effect debug log
// `structured-thinking-suppressed`.

import { describe, it, expect, mock, afterAll } from "bun:test";
import { Effect, HashMap, Layer, Logger, LogLevel, Option, Schema } from "effect";

const realOllamaModule = { ...(await import("ollama")) };
afterAll(() => {
  mock.module("ollama", () => realOllamaModule);
});

const chatCalls: Array<Record<string, unknown>> = [];

mock.module("ollama", () => ({
  Ollama: class MockOllama {
    constructor(_opts?: { host?: string; fetch?: typeof fetch }) {}
    chat = async (opts: Record<string, unknown>) => {
      chatCalls.push(opts);
      return {
        done: true,
        done_reason: "stop",
        message: { role: "assistant", content: '{"answer":"ok"}' },
        prompt_eval_count: 10,
        eval_count: 5,
      };
    };
    show = async (_opts: { model: string }) => ({ capabilities: ["completion", "thinking"] });
    embed = async (_opts: unknown) => ({ embeddings: [[0.1]] });
  },
}));

const { LocalProviderLive, THINKING_NUM_PREDICT_ALLOWANCE } = await import("../src/providers/local.js");
const { resolveStructuredThinking } = await import("../src/providers/ollama-thinking.js");
import { LLMService } from "../src/llm-service.js";
import { LLMConfig } from "../src/llm-config.js";
import { makeLLMConfig } from "./helpers/llm-config.js";

const makeConfig = (overrides: Partial<{ thinking: boolean }> = {}) =>
  Layer.succeed(
    LLMConfig,
    makeLLMConfig({
      defaultProvider: "ollama",
      defaultModel: "qwen3:4b",
      ollamaEndpoint: "http://localhost:11434",
      ...overrides,
    }),
  );

const Answer = Schema.Struct({ answer: Schema.String });

type LogRecord = { readonly message: string; readonly event: string | undefined };

const runStructured = async (
  request: { readonly model: string; readonly maxTokens?: number; readonly thinking?: boolean },
  configLayer = makeConfig(),
): Promise<LogRecord[]> => {
  chatCalls.length = 0;
  const logs: LogRecord[] = [];
  const capture = Logger.make(({ message, annotations }) => {
    const event = Option.getOrUndefined(HashMap.get(annotations, "event"));
    logs.push({
      message: Array.isArray(message) ? message.map(String).join(" ") : String(message),
      event: typeof event === "string" ? event : undefined,
    });
  });
  await Effect.runPromise(
    Effect.gen(function* () {
      const llm = yield* LLMService;
      return yield* llm.completeStructured({
        messages: [{ role: "user", content: "plan" }],
        outputSchema: Answer,
        ...request,
      });
    }).pipe(
      Effect.provide(LocalProviderLive.pipe(Layer.provide(configLayer))),
      Effect.provide(Logger.replace(Logger.defaultLogger, capture)),
      Logger.withMinimumLogLevel(LogLevel.All),
    ),
  );
  return logs;
};

const optionsOf = (call: Record<string, unknown> | undefined) =>
  call?.options as { num_predict?: number } | undefined;

const suppressed = (logs: LogRecord[]) =>
  logs.filter((l) => l.event === "structured-thinking-suppressed");

describe("local completeStructured — thinking cap (H3 2026-11-06)", () => {
  it("thinking-capable model, thinking unset → think:false and num_predict exactly maxTokens", async () => {
    const logs = await runStructured({ model: "qwen3:4b", maxTokens: 4096 });
    expect(chatCalls.length).toBe(1);
    expect(chatCalls[0]?.think).toBe(false);
    expect(optionsOf(chatCalls[0])?.num_predict).toBe(4096);
    expect(suppressed(logs).length).toBe(1);
  }, 15000);

  it("explicit request thinking:true → think:true and the thinking allowance (opt-in honored)", async () => {
    const logs = await runStructured({ model: "qwen3:4b", maxTokens: 4096, thinking: true });
    expect(chatCalls[0]?.think).toBe(true);
    expect(optionsOf(chatCalls[0])?.num_predict).toBe(4096 + THINKING_NUM_PREDICT_ALLOWANCE);
    expect(suppressed(logs).length).toBe(0);
  }, 15000);

  it("config thinking:true → think:true and the allowance; request thinking:false wins over it", async () => {
    await runStructured({ model: "qwen3:4b", maxTokens: 4096 }, makeConfig({ thinking: true }));
    expect(chatCalls[0]?.think).toBe(true);
    expect(optionsOf(chatCalls[0])?.num_predict).toBe(4096 + THINKING_NUM_PREDICT_ALLOWANCE);

    const logs = await runStructured({ model: "qwen3:4b", maxTokens: 4096, thinking: false }, makeConfig({ thinking: true }));
    expect(chatCalls[0]?.think).toBe(false);
    expect(optionsOf(chatCalls[0])?.num_predict).toBe(4096);
    // Caller asked for off explicitly: not a default suppression.
    expect(suppressed(logs).length).toBe(0);
  }, 15000);

  it("non-thinking model (cogito:14b static entry) → no think key, num_predict unchanged, no log", async () => {
    const logs = await runStructured({ model: "cogito:14b", maxTokens: 4096 });
    expect(Object.keys(chatCalls[0] ?? {})).not.toContain("think");
    expect(optionsOf(chatCalls[0])?.num_predict).toBe(4096);
    expect(suppressed(logs).length).toBe(0);
  }, 15000);
});

describe("ollama-thinking seam — resolveStructuredThinking (direct import)", () => {
  const showCapable = { show: async () => ({ capabilities: ["completion", "thinking"] }) };
  const showIncapable = { show: async () => ({ capabilities: ["completion"] }) };

  it("unset → false on a capable model (defaults thinking off for structured output)", async () => {
    expect(await resolveStructuredThinking(showCapable, "seam-structured-capable", undefined)).toBe(false);
  });

  it("unset → undefined (omit) on a non-capable model", async () => {
    expect(await resolveStructuredThinking(showIncapable, "seam-structured-incapable", undefined)).toBeUndefined();
  });

  it("explicit true → true on a capable model; explicit false → false", async () => {
    expect(await resolveStructuredThinking(showCapable, "seam-structured-optin", true)).toBe(true);
    expect(await resolveStructuredThinking(showCapable, "seam-structured-optout", false)).toBe(false);
  });
});
