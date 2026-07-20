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
 *   5. apps/cortex/ui/src/routes/lab/+page.svelte      (builder run() call + AgentConfig types)
 *   `additionalToolNames` → merge in `build-cortex-agent.ts` (`mergeCortexUiToolNames`) into `allowedTools`
 *   Phase 1: taskContext, healthCheck → withTaskContext / withHealthCheck
 *   Phase 2: skills → withSkills({ paths, evolution })
 *   MCP / sub-agents also wire through gateway `fireAgent` + `normalizeCortexAgentConfig`.
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
import { getCapabilityManifest } from "@reactive-agents/runtime";

function captureRunnerLayer(captured: { params: LaunchParams | null }) {
  return Layer.succeed(CortexRunnerService, {
    start: (params) => { captured.params = params; return Effect.succeed({ agentId: "x", runId: "y" }); },
    pause: () => Effect.void,
    resume: () => Effect.void,
    stop: () => Effect.void,
    terminate: () => Effect.void,
    getActive: () => Effect.succeed(new Map()),
    listPendingApprovals: () => Effect.succeed([]),
    approveApproval: () => Effect.void,
    denyApproval: () => Effect.void,
    listPendingInteractions: () => Effect.succeed([]),
    respondToInteraction: () => Effect.succeed({ success: true, output: "" }),
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
  runtimeVerification: true,
  auditRationale:     true,
  terminalTools:      true,
  terminalShellAdditionalCommands: "bun, gh",
  tools:              ["web-search"],
  additionalToolNames: "http-get, my-lab-tool",
  systemPrompt:       "You are helpful",
  agentName:          "parity-agent",
  timeout:            30000,
  progressCheckpoint: 3,
  retryPolicy:        { enabled: true, maxRetries: 2, backoffMs: 500 },
  fallbacks:          { enabled: true, providers: ["openai"], errorThreshold: 2 },
  metaTools:          { enabled: true, brief: true, find: true, pulse: false, recall: true, harnessSkill: false },
  agentTools:         [
    { kind: "local", toolName: "researcher", agent: { name: "Research", tools: ["web-search"], maxIterations: 5 } },
  ],
  dynamicSubAgents:   { enabled: true, maxIterations: 6 },
  /** Phase 1 — background context for reasoning (`withTaskContext`) */
  taskContext:        { project: "acme", environment: "staging" },
  /** Phase 1 — enables `agent.health()` on built agents */
  healthCheck:        true,
  skills: {
    paths: ["./.claude/skills", "./skills"],
    evolution: { mode: "suggest", refinementThreshold: 10, rollbackOnRegression: true },
  },
  /** Phase A — cost-aware model routing (`withModelRouting`) */
  modelRouting:       { enabled: true, minTier: "haiku" },
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
    expect(p.runtimeVerification).toBe(true);
    expect(p.auditRationale).toBe(true);
    expect(p.terminalTools).toBe(true);
    expect(p.terminalShellAdditionalCommands).toBe("bun, gh");
    expect(p.terminalShellAllowedCommands).toBeUndefined();

    // ── Tools / system prompt ─────────────────────────────────────────────
    expect(p.tools).toEqual(["web-search"]);
    expect(p.additionalToolNames).toBe("http-get, my-lab-tool");
    expect(p.systemPrompt).toBe("You are helpful");
    expect(p.agentName).toBe("parity-agent");

    // ── Execution controls ────────────────────────────────────────────────
    expect(p.timeout).toBe(30000);
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

    expect(p.agentTools).toHaveLength(1);
    expect(p.agentTools![0]?.kind).toBe("local");
    expect(p.agentTools![0]?.toolName).toBe("researcher");
    expect(p.dynamicSubAgents?.enabled).toBe(true);
    expect(p.dynamicSubAgents?.maxIterations).toBe(6);

    expect(p.taskContext).toEqual({ project: "acme", environment: "staging" });
    expect(p.healthCheck).toBe(true);

    expect(p.skills?.paths).toEqual(["./.claude/skills", "./skills"]);
    expect(p.skills?.evolution?.mode).toBe("suggest");
    expect(p.skills?.evolution?.refinementThreshold).toBe(10);
    expect(p.skills?.evolution?.rollbackOnRegression).toBe(true);

    // ── Model routing (Phase A) ──────────────────────────────────────────
    expect(p.modelRouting?.enabled).toBe(true);
    expect(p.modelRouting?.minTier).toBe("haiku");
  });
});

describe("AgentConfig → LaunchParams — model routing (A1)", () => {
  it("wires modelRouting through POST /api/runs → LaunchParams", async () => {
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
        body: JSON.stringify({
          ...FULL_CONFIG_BODY,
          modelRouting: { enabled: true, minTier: "sonnet", tierModels: { haiku: "claude-haiku-4-5" } },
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(captured.params?.modelRouting?.enabled).toBe(true);
    expect(captured.params?.modelRouting?.minTier).toBe("sonnet");
    expect(captured.params?.modelRouting?.tierModels?.haiku).toBe("claude-haiku-4-5");
  });
});

describe("AgentConfig → LaunchParams — full strategy set", () => {
  // Manifest-driven (A2): iterate the framework's authoritative strategy catalog
  // rather than a hand-maintained list, so a NEW strategy registered in the
  // framework fails HERE if it isn't launchable through Cortex — the whole
  // anti-drift point. Every canonical strategy name + alias must POST cleanly.
  it("accepts every manifest strategy through POST /api/runs (no UI-only enum drift)", async () => {
    const manifest = getCapabilityManifest();
    const names = manifest.strategies.flatMap((s) => [s.name, ...(s.aliases ?? [])]);
    expect(names.length).toBeGreaterThanOrEqual(8);
    // blueprint/code-action/direct were the historically-dropped ones — pin them.
    expect(names).toContain("blueprint");
    expect(names).toContain("code-action");
    expect(names).toContain("direct");

    for (const strategy of names) {
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
          body: JSON.stringify({ ...FULL_CONFIG_BODY, strategy }),
        }),
      );
      expect(res.status, `strategy ${strategy} rejected`).toBe(200);
      expect(captured.params?.strategy).toBe(strategy);
    }
  });
});
