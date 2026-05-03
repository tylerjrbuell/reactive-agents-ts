// Run: bun test packages/judge-server/tests/live-layer.test.ts --timeout 15000
import { describe, it, expect, afterAll } from "bun:test";

// Mitigation per advisor guidance: @reactive-agents/llm-provider's `llmConfigFromEnv`
// reads process.env at module load time. Provide a dummy key so importing the
// package doesn't blow up in CI/dev environments without real credentials.
// The live Layer is constructed lazily — no real API call happens in this test.
process.env.ANTHROPIC_API_KEY ??= "sk-test-dummy";

let server: { stop: (force?: boolean) => void; port: number; activeLayer: "stub" | "live" } | undefined;

afterAll(async () => {
  await server?.stop(true);
});

describe("live judge layer construction", () => {
  it("can be constructed when JUDGE_LAYER=live and required env is present", async () => {
    process.env.JUDGE_LAYER = "live";
    process.env.JUDGE_MODEL = "claude-haiku-4-5-20251001";
    process.env.JUDGE_PROVIDER = "anthropic";
    // Note: this test only validates that the live Layer can be CONSTRUCTED without errors.
    // It does NOT make a real API call (no API key required). Live invocation is verified
    // separately in the Task 11 reproducibility regression with a real API key.
    const { startServer } = await import("../src/index.js");
    server = await startServer({
      port: 0,
      judgeModelSha: "live-layer-test",
      judgeCodeSha: "live-layer-test",
      judgeLayer: "live",
    });
    expect(server.port).toBeGreaterThan(0);
    expect(server.activeLayer).toBe("live");
  }, 15000);

  it("/version endpoint returns the configured SHAs even with live layer", async () => {
    if (!server) throw new Error("server not started");
    const res = await fetch(`http://127.0.0.1:${server.port}/version`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { judgeModelSha: string; judgeCodeSha: string };
    expect(body.judgeModelSha).toBe("live-layer-test");
    expect(body.judgeCodeSha).toBe("live-layer-test");
  }, 15000);
});
