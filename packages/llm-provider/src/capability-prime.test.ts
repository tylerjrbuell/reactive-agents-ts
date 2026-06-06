// packages/llm-provider/src/capability-prime.test.ts
// Run: bun test packages/llm-provider/src/capability-prime.test.ts --timeout 15000
import { describe, it, expect, afterEach } from "bun:test";
import { primeCapability } from "./capability-prime.js";
import {
  resolveCapability,
  _resetProbedRegistryForTesting,
} from "./capability-resolver.js";
import { _resetProbeCacheForTesting } from "./providers/local-probe.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  _resetProbedRegistryForTesting();
  _resetProbeCacheForTesting();
});

function stubShow(model_info: Record<string, unknown>, capabilities: string[]) {
  globalThis.fetch = (async (url: string | URL | Request) => {
    expect(String(url)).toContain("/api/show");
    return new Response(
      JSON.stringify({
        capabilities,
        details: { family: "gemma4", parameter_size: "8.0B" },
        model_info,
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
}

describe("primeCapability — ollama", () => {
  it("probes /api/show and writes through so a later sync resolveCapability returns source=probe with the real window", async () => {
    stubShow({ "gemma4.context_length": 131072 }, ["completion", "tools", "thinking"]);

    // Before prime: unknown model → conservative fallback.
    expect(resolveCapability("ollama", "gemma4:latest").source).toBe("fallback");

    await primeCapability("ollama", "gemma4:latest", { endpoint: "http://x:11434" });

    const cap = resolveCapability("ollama", "gemma4:latest");
    expect(cap.source).toBe("probe");
    expect(cap.maxContextTokens).toBe(131072);
    expect(cap.recommendedNumCtx).toBe(32768); // min(ctx, 32K) VRAM cap
    expect(cap.toolCallDialect).toBe("native-fc");
    expect(cap.supportsThinkingMode).toBe(true);
  });

  it("never throws and leaves the fallback when the probe fails (offline / model not pulled)", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;

    await primeCapability("ollama", "missing:latest", { endpoint: "http://x:11434" });

    expect(resolveCapability("ollama", "missing:latest").source).toBe("fallback");
  });
});

describe("primeCapability — non-probe providers", () => {
  it("is a no-op (does not hit the network) for anthropic", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    await primeCapability("anthropic", "claude-sonnet-4-6");

    expect(called).toBe(false);
  });
});
