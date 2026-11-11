// Run: bun run repo test apps/cortex/server/tests/cortex-built-config.test.ts
//
// One config path: every data-like Cortex setting rides the AgentConfig
// (`cortexParamsToAgentConfig`), so the builder Cortex runs serializes to exactly
// the config a saved agent, an export or the CLI sees. The overlay in
// `cortexAgentBuilder` holds only values with no AgentConfig form (host tool code,
// test scenario, trace dir, output schema object, saved key, user-interaction rail).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { Static } from "elysia";
import { agentConfigToBuilder } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { getChatSession, createChatSession } from "../db/chat-queries.js";
import { RunConfigBody, runBodyToLaunchParams } from "../api/runs.js";
import { launchParamsToBuildParams } from "../services/runner-service.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { cortexAgentBuilder, type BuildCortexAgentParams } from "../services/build-cortex-agent.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { FULL_CONFIG_BODY } from "./fixtures/full-config-body.js";

let dir: string;
let db: Database;
let svc: ChatSessionService;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-built-config-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** toConfig() of the builder Cortex runs vs. toConfig() of the mapped AgentConfig alone. */
async function builtVsMapped(params: BuildCortexAgentParams) {
  const built = (await cortexAgentBuilder(params)).toConfig();
  const mapped = (await agentConfigToBuilder(cortexParamsToAgentConfig(params))).toConfig();
  return { built, mapped };
}

const runnerParams = (body: Record<string, unknown>): BuildCortexAgentParams =>
  launchParamsToBuildParams(
    // Route-validated shape; the fixture literals are wider than the schema unions.
    runBodyToLaunchParams(body as Static<typeof RunConfigBody>, body.workspace as string | undefined),
    (body.provider as string | undefined) ?? "test",
    [],
  );

/** Every data-like setting at once, in the stored-config shape all paths read. */
const maximal = (): Record<string, unknown> => ({
  provider: "test",
  model: "test-model",
  agentName: "maximal",
  tools: ["web-search"],
  additionalToolNames: "http-get",
  agentTools: [
    { kind: "local", toolName: "researcher", agent: { name: "Research", tools: ["web-search"], maxIterations: 4 } },
    { kind: "remote", toolName: "far", remoteUrl: "http://far.example" },
  ],
  dynamicSubAgents: { enabled: true, maxIterations: 3 },
  strategy: "plan-execute-reflect",
  minIterations: 2,
  verificationStep: "reflect",
  runtimeVerification: true,
  metaTools: { enabled: true, brief: true, find: false, pulse: true, recall: true, harnessSkill: false, todo: true, todoGuidance: { reminder: true } },
  terminalTools: true,
  terminalShellAdditionalCommands: "bun",
  terminalShellOptions: { cwd: "sub", timeoutMs: 9000, sandbox: "docker" },
  workspace: tmpdir(),
  taskContext: { project: "acme" },
  contextSynthesis: "llm",
  skills: { paths: ["./skills"], activate: ["forced"], global: true },
  harness: { toolIndex: true },
  documents: [{ source: "notes", content: "inline doc" }],
  budget: { tokenLimit: 5000, costLimit: 0 },
  grounding: { mode: "warn", tolerance: 0.1 },
  fabricationGuard: "warn",
  modelRouting: { enabled: true, minTier: "haiku", tierModels: { haiku: "h" } },
  durableRuns: { enabled: true, checkpointEvery: 3 },
});

describe("built agent config = mapped AgentConfig (no hidden overlay)", () => {
  it("FULL_CONFIG_BODY: the builder Cortex runs serializes to the mapped AgentConfig", async () => {
    const { built, mapped } = await builtVsMapped(runnerParams(FULL_CONFIG_BODY));
    expect(built).toEqual(mapped);
  });

  it("desk run, gateway agent and chat session: same equality on every build path", async () => {
    const cfg = maximal();
    const gateway = gatewayConfigToBuildParams({
      agentId: "gw-1",
      name: "maximal",
      config: normalizeCortexAgentConfig(JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>),
      mcpConfigs: [],
    });
    const sessionId = createChatSession(db, { name: "maximal", agentConfig: cfg });
    const row = getChatSession(db, sessionId)!;
    type ChatParamsOf = (id: string, c: Record<string, unknown>, stable: string | undefined) => BuildCortexAgentParams;
    const chat = (svc as unknown as { buildChatAgentParams: ChatParamsOf }).buildChatAgentParams(sessionId, row.agentConfig, "chat-stable-id");
    for (const params of [runnerParams({ prompt: "go", ...cfg }), gateway, chat]) {
      const { built, mapped } = await builtVsMapped(params);
      expect(built).toEqual(mapped);
    }
  });

  it("a bare config: Cortex defaults (memory, meta tools, kill switch) are in the config", async () => {
    const config = cortexParamsToAgentConfig({ provider: "test", agentName: "bare" });
    expect(config.features?.memory).toBe(true);
    expect(config.features?.killSwitch).toBe(true);
    expect(config.metaTools).toEqual({ brief: true, find: true, pulse: false, recall: true, harnessSkill: false, todo: false });
    const { built, mapped } = await builtVsMapped({ provider: "test", agentName: "bare" });
    expect(built).toEqual(mapped);
  });
});

describe("each former overlay maps onto its AgentConfig path", () => {
  const cfg = () => cortexParamsToAgentConfig(runnerParams({ prompt: "go", ...maximal() }));

  it("context synthesis: template → fast, llm → deep, none → unset", () => {
    expect(cfg().reasoning?.synthesis).toBe("deep");
    expect(cortexParamsToAgentConfig({ provider: "test", contextSynthesis: "template" }).reasoning?.synthesis).toBe("fast");
    expect(cortexParamsToAgentConfig({ provider: "test", contextSynthesis: "auto" }).reasoning?.synthesis).toBe("auto");
    expect(cortexParamsToAgentConfig({ provider: "test", contextSynthesis: "none" }).reasoning?.synthesis).toBeUndefined();
  });

  it("harness switches → reasoning.harness, merged with rawConfig's", () => {
    expect(cfg().reasoning?.harness).toEqual({ toolIndex: true });
    const merged = cortexParamsToAgentConfig({
      provider: "test",
      harness: { toolIndex: true },
      rawConfig: { reasoning: { harness: { verboseRules: true } } },
    });
    expect(merged.reasoning?.harness).toEqual({ verboseRules: true, toolIndex: true });
  });

  it("agent tools (local + remote) and dynamic sub-agents", () => {
    expect(cfg().agentTools).toEqual([
      { name: "researcher", agent: { name: "Research", tools: ["web-search"], maxIterations: 4 } },
      { name: "far", remoteUrl: "http://far.example" },
    ]);
    expect(cfg().dynamicSubAgents).toEqual({ maxIterations: 3 });
    expect(cortexParamsToAgentConfig({ provider: "test", dynamicSubAgents: { enabled: true } }).dynamicSubAgents).toEqual({});
    expect(cortexParamsToAgentConfig({ provider: "test", dynamicSubAgents: { enabled: false } }).dynamicSubAgents).toBeUndefined();
  });

  it("tools: merged allow-list, workspace and the shell's options object", () => {
    const t = cfg().tools;
    expect(t?.allowedTools).toEqual([
      "web-search", "http-get", "shell-execute", "final-answer", "task-complete", "context-status",
      "brief", "pulse", "recall", "todo", "spawn-agent", "researcher", "far",
    ]);
    expect(t?.workspace).toBe(tmpdir());
    expect(t?.terminal).toEqual({ additionalCommands: ["bun"], cwd: "sub", timeoutMs: 9000, sandbox: "docker" });
    expect(cortexParamsToAgentConfig({ provider: "test", terminalTools: true }).tools?.terminal).toBe(true);
    expect(cortexParamsToAgentConfig({ provider: "test" }).tools).toBeUndefined();
  });

  it("host tool names join the allow-list; their code stays an overlay", () => {
    const extra = { definition: { name: "session-control" } } as unknown as NonNullable<BuildCortexAgentParams["extraTools"]>[number];
    const t = cortexParamsToAgentConfig({ provider: "test", extraTools: [extra] }).tools;
    expect(t?.allowedTools).toContain("session-control");
  });

  it("skills, verification step, verification, min iterations, task context", () => {
    const c = cfg();
    expect(c.skills).toEqual({ paths: ["./skills"], activate: ["forced"], global: true });
    expect(cortexParamsToAgentConfig({ provider: "test", skills: { paths: [] } }).skills).toEqual({});
    expect(c.verificationStep).toEqual({ mode: "reflect" });
    expect(c.features?.verification).toBe(true);
    expect(c.execution?.minIterations).toBe(2);
    expect(c.taskContext).toEqual({ project: "acme" });
  });

  it("meta-tools: Cortex default on, explicit flags kept, todoGuidance only when on; enabled:false → no key", () => {
    expect(cfg().metaTools).toEqual({
      brief: true, find: false, pulse: true, recall: true, harnessSkill: false, todo: true,
      todoGuidance: { reminder: true, systemLine: false },
    });
    expect(cortexParamsToAgentConfig({ provider: "test", metaTools: { enabled: false } }).metaTools).toBeUndefined();
  });

  it("documents, model routing, budget (0 = no cap), grounding, fabrication guard", () => {
    const c = cfg();
    expect(c.documents).toEqual([{ source: "notes", content: "inline doc" }]);
    expect(c.modelRouting).toEqual({ minTier: "haiku", tierModels: { haiku: "h" } });
    expect(c.budget).toEqual({ tokenLimit: 5000 });
    expect(cortexParamsToAgentConfig({ provider: "test", budget: { tokenLimit: 0, costLimit: 0 } }).budget).toBeUndefined();
    expect(c.grounding).toEqual({ mode: "warn", tolerance: 0.1 });
    expect(c.fabricationGuard).toBe("warn");
    expect(cortexParamsToAgentConfig({ provider: "test", modelRouting: { enabled: false, minTier: "opus" } }).modelRouting).toBeUndefined();
  });

  it("durable runs: opted in, or forced by a detach approval policy", () => {
    expect(cfg().durableRuns).toEqual({ checkpointEvery: 3 });
    expect(cortexParamsToAgentConfig({ provider: "test", approvalPolicy: { mode: "detach", tools: ["file-write"] } }).durableRuns).toEqual({});
    expect(cortexParamsToAgentConfig({ provider: "test" }).durableRuns).toBeUndefined();
  });

  it("agent id, streaming and tracing off", () => {
    const c = cortexParamsToAgentConfig({ provider: "test", agentId: "stable-1", streaming: true, tracing: false, observability: { checklist: true } });
    expect(c.agentId).toBe("stable-1");
    expect(c.features?.streaming).toBe(true);
    expect(c.observability).toEqual({ checklist: true, tracing: false });
  });

  it("memory default: on with no choice, off for an explicit all-off choice or a raw memory block", () => {
    expect(cortexParamsToAgentConfig({ provider: "test" }).features?.memory).toBe(true);
    expect(cortexParamsToAgentConfig({ provider: "test", memory: { working: false } }).features?.memory).toBeUndefined();
    expect(cortexParamsToAgentConfig({ provider: "test", memory: { working: true } }).features?.memory).toBeUndefined();
  });
});
