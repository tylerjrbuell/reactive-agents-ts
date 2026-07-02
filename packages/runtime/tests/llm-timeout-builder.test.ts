import { describe, test, expect } from "bun:test";
import { ReactiveAgents } from "../src";

// Probe Ollama once at module load (top-level await). The live test below
// auto-skips when no server is reachable (e.g. CI), staying keyless-safe.
const ollamaState = await (async (): Promise<
  { up: true; model: string } | { up: false }
> => {
  try {
    const res = await fetch("http://localhost:11434/api/tags", {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return { up: false };
    const body = (await res.json()) as { models?: Array<{ name: string }> };
    const model = body.models?.find((m) => !m.name.includes("embed"))?.name;
    return model ? { up: true, model } : { up: false };
  } catch {
    return { up: false };
  }
})();

/**
 * `.withLlmTimeout(ms)` — per-LLM-call timeout for local (Ollama) providers.
 *
 * Distinct from `.withTimeout(ms)`, which bounds the whole agent run
 * (`_executionTimeoutMs`, enforced in execution-engine). This method sets
 * `_ollamaTimeoutMs`, which threads:
 *   builder._ollamaTimeoutMs
 *     → RuntimeOptions.ollamaTimeoutMs (runtime-construction → createRuntime)
 *     → createLLMProviderLayer(..., { ollamaTimeoutMs })  (runtime.ts)
 *     → LLMConfig.ollamaTimeoutMs                          (llm-provider)
 *     → resolveLocalTimeoutMs(request, config)             (local provider)
 */
describe(".withLlmTimeout — per-call local timeout plumbing", () => {
  // ── Keyless / CI-safe: builds with the `test` provider, which needs no API
  // key AND no live server (the `ollama` provider runs a build-time connection
  // probe that is unreachable in CI). These prove the builder SURFACE — the
  // method chains, builds offline, and coexists with `.withTimeout`. The
  // ollama-specific timeout behavior is proven by the live test below. ──
  test("builder method is chainable and coexists with .withTimeout (keyless, serverless)", async () => {
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withLlmTimeout(600_000) // per-call ceiling
      .withTimeout(900_000) // run-level ceiling — independent concern
      .withMaxIterations(1)
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  test("keyless build: .withLlmTimeout works with no cloud key configured", async () => {
    // The `test` provider is keyless-exempt; a builder using .withLlmTimeout
    // must build without any cloud key or live server (mirrors CI).
    const agent = await ReactiveAgents.create()
      .withProvider("test")
      .withLlmTimeout(1)
      .build();
    expect(agent).toBeDefined();
    await agent.dispose();
  });

  // ── Live proof (auto-skips when no Ollama server, e.g. CI). ──
  // A 1ms per-call timeout MUST surface the rich LLMTimeoutError. The agent
  // never sets `request.timeoutMs`, so the "limit 1ms" in that error can ONLY
  // have come from `config.ollamaTimeoutMs` — i.e. the builder value reached
  // the LLMConfig end-to-end.
  test.skipIf(!ollamaState.up)(
    "live: builder .withLlmTimeout(1) reaches LLMConfig → rich timeout error",
    async () => {
      const model = ollamaState.up ? ollamaState.model : "";
      const agent = await ReactiveAgents.create()
        .withProvider("ollama")
        .withModel(model)
        .withLlmTimeout(1) // 1ms — guarantees a timeout on any real generation
        .withMaxIterations(1)
        .build();

      let message = "";
      try {
        await agent.run("Say hi.");
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      } finally {
        await agent.dispose();
      }

      // "limit 1ms" proves config.ollamaTimeoutMs === 1 (our builder value)
      // won the `request.timeoutMs ?? config.ollamaTimeoutMs ?? default` race.
      expect(message).toContain("timed out");
      expect(message).toContain("limit 1ms");
      expect(message).toContain(model);
    },
    30_000,
  );
});
