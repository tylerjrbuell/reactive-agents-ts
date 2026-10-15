// Run: bun test packages/runtime/tests/autoshadow-loop.test.ts --timeout 120000
// (live-gated: needs Ollama reachable; skipped otherwise)
//
// Wave 7.1 review fix — the sink had no producer. With auto-shadow active,
// `JudgmentShadow` bus events must land in the sink DB: this closes the loop
// (sample → record → agreementBySite) end to end. Null-judgment rows count:
// the backend may fail (e.g. model unpulled) and the loop must still record
// the attempt, never break the run.
import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReactiveAgents } from "../src/index.js";
import { createJudgmentShadowSink } from "@reactive-agents/eval";

const live = process.env.REACTIVE_AGENTS_RUN_LIVE_OLLAMA_TESTS === "1";

describe.skipIf(!live)("7.1 auto-shadow closed loop (live Ollama)", () => {
  it("shadow events land in the sink DB", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ra-autoshadow-"));
    const dbPath = join(dir, "shadow.db");
    process.env.REACTIVE_AGENTS_SHADOW_DB = dbPath;
    let agent;
    try {
      agent = await ReactiveAgents.create()
        .withName("autoshadow-loop")
        .withProvider("ollama")
        .withModel("qwen3:4b")
        .withMaxIterations(2)
        .build();
      const r = await agent.run("What is 2+2? Reply with ONLY the number.");
      expect(r.success).toBe(true);
    } finally {
      await agent?.dispose();
      delete process.env.REACTIVE_AGENTS_SHADOW_DB;
    }
    const sink = createJudgmentShadowSink(dbPath);
    const { Effect } = await import("effect");
    const sites = await Effect.runPromise(sink.sites());
    // At least one shadow site sampled (null rows count — backend failure
    // still records the attempt).
    expect(sites.length).toBeGreaterThan(0);
    await rm(dir, { recursive: true, force: true });
  }, 120000);
});
