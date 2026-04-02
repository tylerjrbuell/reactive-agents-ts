/**
 * Config Parity Test — Anti-Staleness Guard
 *
 * Verifies that every non-trivial AgentConfig field is wired through the
 * POST /api/runs → LaunchParams pipeline. When a new builder method is added
 * and AgentConfig gains a new field, add a corresponding assertion here AND
 * wire the field in:
 *
 *   1. apps/cortex/ui/src/lib/types/agent-config.ts   (AgentConfig type)
 *   2. apps/cortex/server/services/runner-service.ts   (LaunchParams + builder)
 *   3. apps/cortex/server/services/gateway-process-manager.ts  (fireAgent builder)
 *   4. apps/cortex/server/api/runs.ts                  (POST body schema)
 *   5. apps/cortex/ui/src/routes/lab/+page.svelte      (builder run() call)
 *
 * HOW TO USE: Run `bun test apps/cortex/server/tests --timeout 15000`.
 * A failure here means a new config field isn't wired somewhere.
 */

import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { applySchema } from "../db/schema.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService, type LaunchParams } from "../services/runner-service.js";
import { runsRouter } from "../api/runs.js";

function captureRunnerLayer(captured: { params: LaunchParams | null }) {
  return Layer.succeed(CortexRunnerService, {
    start: (params) => { captured.params = params; return Effect.succeed({ agentId: "x", runId: "y" }); },
    pause: () => Effect.void,
    stop: () => Effect.void,
    getActive: () => Effect.succeed(new Map()),
  });
}

/**
 * A "maximal" POST body covering every wired AgentConfig field.
 * When you add a new field to AgentConfig, add it here AND assert it below.
 */
const FULL_CONFIG_BODY = {
  prompt:             "test prompt",
  provider:           "anthropic",
  model:              "claude-sonnet-4-6",
  temperature:        0.5,
  maxTokens:          1000,
  strategy:           "reactive",
  maxIterations:      8,
  minIterations:      2,
  verificationStep:   "reflect",
  tools:              ["web-search"],
  systemPrompt:       "You are helpful",
  agentName:          "parity-agent",
  timeout:            30000,
  cacheTimeout:       3600000,
  progressCheckpoint: 3,
  retryPolicy:        { enabled: true, maxRetries: 2, backoffMs: 500 },
  fallbacks:          { enabled: true, providers: ["openai"], errorThreshold: 2 },
  metaTools:          { enabled: true, brief: true, find: true, pulse: false, recall: true, harnessSkill: false },
};

describe("AgentConfig → LaunchParams parity", () => {
  it("all wired fields pass through POST /api/runs to runner.start()", async () => {
    const captured = { params: null as LaunchParams | null };
    const db = new Database(":memory:");
    applySchema(db);
    const app = new Elysia().use(
      runsRouter(CortexStoreServiceLive(db), captureRunnerLayer(captured)),
    );

    const res = await app.handle(
      new Request("http://localhost/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(FULL_CONFIG_BODY),
      }),
    );
    expect(res.status).toBe(200);

    const p = captured.params!;
    expect(p).not.toBeNull();

    // ── Core ──────────────────────────────────────────────────────────────
    expect(p.prompt).toBe("test prompt");
    expect(p.provider).toBe("anthropic");
    expect(p.model).toBe("claude-sonnet-4-6");
    expect(p.temperature).toBe(0.5);
    expect(p.maxTokens).toBe(1000);

    // ── Strategy / iterations ─────────────────────────────────────────────
    expect(p.strategy).toBe("reactive");
    expect(p.maxIterations).toBe(8);
    expect(p.minIterations).toBe(2);
    expect(p.verificationStep).toBe("reflect");

    // ── Tools / system prompt ─────────────────────────────────────────────
    expect(p.tools).toEqual(["web-search"]);
    expect(p.systemPrompt).toBe("You are helpful");
    expect(p.agentName).toBe("parity-agent");

    // ── Execution controls ────────────────────────────────────────────────
    expect(p.timeout).toBe(30000);
    expect(p.cacheTimeout).toBe(3600000);
    expect(p.progressCheckpoint).toBe(3);

    // ── retryPolicy ───────────────────────────────────────────────────────
    expect(p.retryPolicy?.maxRetries).toBe(2);
    expect(p.retryPolicy?.backoffMs).toBe(500);

    // ── Fallbacks ─────────────────────────────────────────────────────────
    expect(p.fallbacks?.providers).toEqual(["openai"]);
    expect(p.fallbacks?.errorThreshold).toBe(2);

    // ── Meta tools ────────────────────────────────────────────────────────
    expect(p.metaTools?.enabled).toBe(true);
    expect(p.metaTools?.brief).toBe(true);
    expect(p.metaTools?.find).toBe(true);
    expect(p.metaTools?.recall).toBe(true);
    expect(p.metaTools?.harnessSkill).toBe(false);
  });
});
