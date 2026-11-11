// Run: bun test packages/llm-provider/tests/provider-config-api-key.test.ts --timeout 15000
//
// `.withProvider(p, { apiKey })` lands in LLMConfig.providerConfig.apiKey.
// Every adapter must use it over its env-derived key (anthropic and gemini
// used to ignore it), and a rejected config key must not tell the user to set
// an env var the adapter never read. No network: SDK constructors are mocked
// and their options captured.

import { describe, it, expect, mock, beforeAll, afterAll } from "bun:test";
import { Effect, Exit, Layer, Cause, Option } from "effect";
import type { LLMService as LLMServiceTag } from "../src/llm-service.js";

// Bun module mocks are process-global and leak across test FILES: capture the
// real modules and re-install them in afterAll.
const realAnthropicSdk = { ...(await import("@anthropic-ai/sdk")) };
const realGenAi = { ...(await import("@google/genai")) };
const realOllama = { ...(await import("ollama")) };
afterAll(() => {
  mock.module("@anthropic-ai/sdk", () => realAnthropicSdk);
  mock.module("@google/genai", () => realGenAi);
  mock.module("ollama", () => realOllama);
});

let anthropicKey: string | undefined | null = null;
let geminiKey: string | undefined | null = null;
let ollamaHeaders: Record<string, string> | undefined | null = null;

/** The key the mocked Anthropic SDK rejects with a 401 (credential failure). */
const REJECTED_KEY = "rejected-cfg";

mock.module("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    private readonly key: string | undefined;
    constructor(opts: { apiKey?: string }) {
      anthropicKey = opts.apiKey;
      this.key = opts.apiKey;
    }
    messages = {
      create: async () => {
        if (this.key === REJECTED_KEY) {
          // Plain SDK-shaped failure object (status + message).
          return Promise.reject({ status: 401, message: "invalid x-api-key" });
        }
        return {
          id: "msg",
          type: "message",
          role: "assistant",
          content: [{ type: "text", text: "ok" }],
          model: "claude-sonnet-4-6",
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        };
      },
      stream: () => ({ on: () => undefined }),
    };
  },
}));

mock.module("@google/genai", () => ({
  GoogleGenAI: class MockGoogleGenAI {
    constructor(opts: { apiKey?: string }) {
      geminiKey = opts.apiKey;
    }
    models = {
      generateContent: async () => ({
        text: "ok",
        candidates: [{ content: { parts: [{ text: "ok" }] }, finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
      generateContentStream: async () => (async function* () {})(),
      embedContent: async () => ({ embeddings: [] }),
    };
  },
}));

mock.module("ollama", () => ({
  ...realOllama,
  Ollama: class MockOllama {
    constructor(opts: { headers?: Record<string, string> }) {
      ollamaHeaders = opts.headers;
    }
    chat = async () => ({
      model: "llama3.2",
      message: { role: "assistant", content: "ok" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 1,
      eval_count: 1,
    });
    show = async () => ({ capabilities: [], model_info: {} });
  },
}));

type Mod = typeof import("../src/index.js");
type ProviderErrorMod = typeof import("../src/provider-error.js");
let mod: Mod;
let mapProviderError: ProviderErrorMod["mapProviderError"];
let resolveProviderApiKey: ProviderErrorMod["resolveProviderApiKey"];

beforeAll(async () => {
  mod = await import("../src/index.js");
  ({ mapProviderError, resolveProviderApiKey } = await import("../src/provider-error.js"));
});

/** Run one complete() against `live` with env config + `overrides`. */
const runComplete = (
  live: Layer.Layer<LLMServiceTag, never, Mod["LLMConfig"]["Identifier"]>,
  overrides: Partial<Mod["LLMConfig"]["Service"]>,
) => {
  const configLayer = Layer.succeed(
    mod.LLMConfig,
    mod.LLMConfig.of({ ...mod.readLLMConfigFromEnv(), ...overrides }),
  );
  return Effect.runPromiseExit(
    Effect.gen(function* () {
      const llm = yield* mod.LLMService;
      return yield* llm.complete({ messages: [{ role: "user", content: "hi" }] });
    }).pipe(Effect.provide(Layer.provide(live, configLayer))),
  );
};

describe("providerConfig.apiKey precedence (every adapter)", () => {
  it("resolveProviderApiKey: config key wins over env key and reports its source", () => {
    expect(resolveProviderApiKey({ apiKey: "cfg" }, "env")).toEqual({ apiKey: "cfg", source: "config" });
    expect(resolveProviderApiKey(undefined, "env")).toEqual({ apiKey: "env", source: "env" });
    expect(resolveProviderApiKey({}, "env")).toEqual({ apiKey: "env", source: "env" });
  });

  it("anthropic: client is built with providerConfig.apiKey over ANTHROPIC_API_KEY", async () => {
    anthropicKey = null;
    const exit = await runComplete(mod.AnthropicProviderLive, {
      defaultModel: "claude-sonnet-4-6",
      anthropicApiKey: "env-anthropic",
      providerConfig: { apiKey: "cfg-anthropic" },
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(anthropicKey).toBe("cfg-anthropic");
  });

  it("anthropic: falls back to the env-derived key when no providerConfig.apiKey", async () => {
    anthropicKey = null;
    await runComplete(mod.AnthropicProviderLive, {
      defaultModel: "claude-sonnet-4-6",
      anthropicApiKey: "env-anthropic",
      providerConfig: undefined,
    });
    expect(anthropicKey).toBe("env-anthropic");
  });

  it("gemini: client is built with providerConfig.apiKey over GOOGLE_API_KEY", async () => {
    geminiKey = null;
    const exit = await runComplete(mod.GeminiProviderLive, {
      defaultModel: "gemini-2.5-flash",
      googleApiKey: "env-google",
      providerConfig: { apiKey: "cfg-google" },
    });
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(geminiKey).toBe("cfg-google");
  });

  it("gemini: falls back to the env-derived key when no providerConfig.apiKey", async () => {
    geminiKey = null;
    await runComplete(mod.GeminiProviderLive, {
      defaultModel: "gemini-2.5-flash",
      googleApiKey: "env-google",
      providerConfig: undefined,
    });
    expect(geminiKey).toBe("env-google");
  });

  it("ollama: bearer header uses providerConfig.apiKey over OLLAMA_API_KEY", async () => {
    ollamaHeaders = null;
    await runComplete(mod.LocalProviderLive, {
      defaultModel: "llama3.2",
      ollamaEndpoint: "http://127.0.0.1:9",
      ollamaApiKey: "env-ollama",
      providerConfig: { apiKey: "cfg-ollama" },
    });
    expect(ollamaHeaders).toEqual({ Authorization: "Bearer cfg-ollama" });
  });
});

describe("credential-failure wording names the key source", () => {
  const authFail = { status: 401, message: "invalid x-api-key" };

  it("config key: points at the .withProvider apiKey, never at the env var", () => {
    const err = mapProviderError(authFail, "anthropic", "m", "config");
    expect(err.message).toContain('.withProvider("anthropic", { apiKey })');
    expect(err.message).not.toContain("ANTHROPIC_API_KEY");
  });

  it("env key (default): still names the env var to set", () => {
    expect(mapProviderError(authFail, "openai").message).toContain("Set OPENAI_API_KEY");
  });

  it("anthropic adapter: a rejected config key surfaces the config-source hint end to end", async () => {
    const exit = await runComplete(mod.AnthropicProviderLive, {
      defaultModel: "claude-sonnet-4-6",
      anthropicApiKey: "env-anthropic",
      providerConfig: { apiKey: REJECTED_KEY },
    });
    expect(Exit.isFailure(exit)).toBe(true);
    const failure = Exit.isFailure(exit) ? Cause.failureOption(exit.cause) : Option.none();
    const message = Option.isSome(failure) ? (failure.value as { message: string }).message : "";
    expect(message).toContain('.withProvider("anthropic", { apiKey })');
    expect(message).not.toContain("ANTHROPIC_API_KEY");
  });
});
