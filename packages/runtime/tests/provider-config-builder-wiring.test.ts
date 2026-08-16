import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { ReactiveAgents } from "../src";

/**
 * #198 — `.withProvider(provider, { baseUrl, apiKey, headers })` end-to-end
 * plumbing through the FULL builder chain:
 *   builder._providerConfig
 *     → BuilderRuntimeStateView._providerConfig (runtime-construction.ts)
 *     → RuntimeOptions.providerConfig            (createRuntime)
 *     → createLLMProviderLayer(..., modelParams)  (runtime.ts)
 *     → LLMConfig.providerConfig                  (llm-provider)
 *
 * Everything up to here was covered by unit tests inside `@reactive-agents/
 * llm-provider` (litellm-dynamic-config.test.ts, groq-xai-provider.test.ts),
 * which construct LLMConfig/layers directly — none of them exercise the
 * runtime package's own wiring. This file closes that gap.
 */
describe(".withProvider(provider, config) — full builder-to-LLMConfig wiring", () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;

  beforeEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    if (originalOpenAIKey !== undefined) process.env.OPENAI_API_KEY = originalOpenAIKey;
  });

  // ── Build-validation gap: an inline apiKey must satisfy the key
  // requirement even with no env var set — readProviderApiKey() only reads
  // process.env and has no visibility into providerConfig on its own. ──
  test("strict validation does NOT throw when apiKey is supplied inline via .withProvider (no env var)", async () => {
    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    const agent = await ReactiveAgents.create()
      .withProvider("litellm", { baseUrl: "http://127.0.0.1:1/v1", apiKey: "sk-inline" })
      .withStrictValidation()
      .withMaxIterations(1)
      .build();

    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("strict validation DOES throw for litellm with no key anywhere (regression guard)", async () => {
    expect(process.env.OPENAI_API_KEY).toBeUndefined();

    await expect(
      ReactiveAgents.create()
        .withProvider("litellm")
        .withStrictValidation()
        .withMaxIterations(1)
        .build(),
    ).rejects.toThrow(/Missing OPENAI_API_KEY/);
  });

  // ── Live proof the baseUrl/apiKey/headers actually reach LLMConfig at
  // runtime, through the WHOLE builder chain — a real local HTTP server
  // stands in for "any OpenAI-compatible endpoint" (llama.cpp server,
  // Deepseek, a LiteLLM proxy). Bun's fetch connection-refused error omits
  // the target URL, so asserting on an error message can't prove the
  // baseUrl arrived — asserting the agent's ANSWER came from content only
  // this server could have returned is unambiguous, black-box proof. ──
  test("live: .withProvider('litellm', { baseUrl, apiKey, headers }) reaches a real OpenAI-compatible endpoint end-to-end", async () => {
    let receivedAuth: string | null | undefined = null;
    let receivedCustomHeader: string | null | undefined = null;
    const server = Bun.serve({
      port: 0,
      fetch(req) {
        receivedAuth = req.headers.get("authorization");
        receivedCustomHeader = req.headers.get("x-e2e-probe");
        // The reactive kernel calls llm.stream(), not llm.complete() — respond
        // with SSE, mirroring litellm.ts's parser (data: {...}\n\n, [DONE]).
        const body = new ReadableStream({
          start(controller) {
            const enc = new TextEncoder();
            controller.enqueue(
              enc.encode(
                `data: ${JSON.stringify({
                  choices: [{ delta: { content: "sentinel-e2e-response" }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                })}\n\n`,
              ),
            );
            controller.enqueue(enc.encode("data: [DONE]\n\n"));
            controller.close();
          },
        });
        return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
      },
    });

    try {
      const agent = await ReactiveAgents.create()
        .withProvider("litellm", {
          baseUrl: `http://127.0.0.1:${server.port}`,
          apiKey: "sk-e2e-inline",
          headers: { "X-E2E-Probe": "yes" },
        })
        .withModel("sentinel-model")
        .withMaxIterations(1)
        .build();

      const result = await agent.run("Say hi.");
      await agent.dispose();

      expect(result.output).toContain("sentinel-e2e-response");
      // TS narrows these to the literal `null` initializer at this point —
      // the mutation only happens inside the `fetch` closure above, which
      // control-flow analysis can't see executing. Cast past the narrowing.
      expect(receivedAuth as string | null).toBe("Bearer sk-e2e-inline");
      expect(receivedCustomHeader as string | null).toBe("yes");
    } finally {
      server.stop(true);
    }
  }, 15_000);
});
