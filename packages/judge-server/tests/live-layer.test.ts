// Run: bun test packages/judge-server/tests/live-layer.test.ts --timeout 15000
import { describe, it, expect, afterAll } from "bun:test";

// @reactive-agents/llm-provider's `LLMConfigFromEnv` now reads process.env
// lazily at layer-build time (D-2026-09-08-O), not at module import — so this
// dummy key is no longer masking an import-time snapshot bug. It's kept
// because the live Layer still needs *some* key present to construct without
// erroring; no real API call happens in this test.
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

  it("judgeEngine:'jev' + judgeLayer:'live' constructs (and starts) without a TYPESAFE_API_KEY — Layer.suspend laziness holds after the withEvents decoration", async () => {
    // No TYPESAFE_API_KEY set anywhere in this test. If buildJudgmentLayer's
    // Layer.suspend wrapper (or the withEvents/EventBusLive composition
    // added around it, code review 2026-09-22) accidentally eagerly
    // constructed the TypeSafeClient at layer-BUILD time instead of
    // request time, this would throw here.
    delete process.env.TYPESAFE_API_KEY;
    const { startServer } = await import("../src/index.js");
    const jevServer = await startServer({
      port: 0,
      judgeModelSha: "jev-live-layer-test",
      judgeCodeSha: "jev-live-layer-test",
      judgeLayer: "live",
      judgeEngine: "jev",
    });
    expect(jevServer.port).toBeGreaterThan(0);
    expect(jevServer.activeLayer).toBe("live");
    expect(jevServer.activeEngine).toBe("jev");
    await jevServer.stop(true);
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
