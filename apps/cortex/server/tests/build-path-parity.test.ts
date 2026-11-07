// Run: bun run repo test apps/cortex/server/tests/build-path-parity.test.ts
//
// Three-path build parity. Cortex builds agents on three paths:
//   - runner  (Lab / POST /api/runs)       -> launchParamsToBuildParams
//   - chat    (POST /api/chat/sessions)    -> ChatSessionService.buildChatAgentParams
//   - gateway (saved agent fire)           -> gatewayConfigToBuildParams
// One MAXIMAL agent config goes through all three (through the HTTP body schemas where a
// path has one) and every path must yield the same BuildCortexAgentParams keys, except the
// commented PATH_SPECIFIC keys below. A field added to BuildCortexAgentParams fails
// typecheck here until it is listed in PARAM_KEYS, then fails this test until every path
// wires it (or it gets a justified PATH_SPECIFIC entry). config-parity.test.ts pins the
// HTTP -> LaunchParams hop; this pins params -> builder on all three paths.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Effect, Layer } from "effect";
import { Elysia } from "elysia";
import { getCapabilityManifest } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { getMcpServersByIds, insertMcpServer, parseMcpConfig } from "../db/mcp-queries.js";
import { chatRouter } from "../api/chat.js";
import { runsRouter } from "../api/runs.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { CortexRunnerService, launchParamsToBuildParams, type LaunchParams } from "../services/runner-service.js";
import { gatewayConfigToBuildParams } from "../services/gateway-process-manager.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { shellExecuteRequested, type BuildCortexAgentParams } from "../services/build-cortex-agent.js";

type Path = "runner" | "chat" | "gateway";
const ALL_PATHS: readonly Path[] = ["runner", "chat", "gateway"];

/** Every BuildCortexAgentParams key. `Record<keyof ...>` makes a new interface field a type error here. */
const PARAM_KEYS: Record<keyof BuildCortexAgentParams, true> = {
  agentName: true, agentId: true, provider: true, model: true, temperature: true, maxTokens: true,
  numCtx: true, thinking: true, strategy: true, maxIterations: true, minIterations: true,
  systemPrompt: true, taskContext: true, healthCheck: true, skills: true, mcpConfigs: true,
  tools: true, extraTools: true, additionalToolNames: true, agentTools: true, dynamicSubAgents: true,
  metaTools: true, observability: true, timeout: true, retryPolicy: true, fallbacks: true,
  verificationStep: true, runtimeVerification: true, terminalTools: true,
  terminalShellAdditionalCommands: true, terminalShellAllowedCommands: true, terminalShellOptions: true,
  workspace: true, tracing: true, observabilityVerbosity: true, strategySwitching: true, harness: true,
  auditRationale: true, memory: true, contextSynthesis: true, guardrails: true, persona: true,
  testScenario: true, streaming: true, outputSchema: true, outputSchemaOnParseFail: true,
  documents: true, budget: true, grounding: true, fabricationGuard: true, modelRouting: true,
  rawConfig: true, durableRuns: true,
};

/**
 * Deliberate differences: the paths that set each key on the maximal fixture, and why.
 * Every key NOT listed here must be set by all three paths.
 */
const PATH_SPECIFIC: Partial<Record<keyof BuildCortexAgentParams, { readonly paths: readonly Path[]; readonly why: string }>> = {
  agentId: {
    paths: ["chat", "gateway"],
    why: "chat pins the session's stable id and gateway the saved agent's id; a desk run is ad hoc and gets a fresh framework id",
  },
  streaming: {
    paths: ["chat"],
    why: "chat turns stream (runStream); desk runs and gateway fires are one-shot agent.run()",
  },
  tracing: {
    paths: ["chat"],
    why: "chat writes each turn's trace to traceDirs()[0] and honours traceRuns:false; desk runs and gateway fires keep the framework tracer default",
  },
  extraTools: {
    paths: [],
    why: "only the chat session-control tool (agentControl + a SessionControlPort); not part of the shared config",
  },
  testScenario: {
    paths: ["chat"],
    why: "chat seeds a scripted reply for provider 'test'; the runner takes one only from test code, gateway never",
  },
};

let dir: string;
let db: Database;
let svc: ChatSessionService;

/** Maximal agent config in the wire shape every surface accepts (cortexRunsPostBody output). */
const fixture = (): Record<string, unknown> => ({
  provider: "test",
  model: "test-model",
  systemPrompt: "You are helpful",
  temperature: 0.4,
  maxTokens: 900,
  numCtx: 8192,
  thinking: true,
  timeout: 30_000,
  tools: ["web-search"],
  additionalToolNames: "http-get",
  mcpServerIds: ["mcp-parity"],
  agentTools: [{ kind: "local", toolName: "researcher", agent: { name: "Research", tools: ["web-search"], maxIterations: 4 } }],
  dynamicSubAgents: { enabled: true, maxIterations: 3 },
  strategy: "plan-execute-reflect",
  maxIterations: 7,
  minIterations: 2,
  strategySwitching: true,
  verificationStep: "reflect",
  runtimeVerification: true,
  auditRationale: true,
  retryPolicy: { enabled: true, maxRetries: 2, backoffMs: 400 },
  fallbacks: { enabled: true, providers: ["openai"] },
  metaTools: { enabled: true, brief: true, find: true, pulse: false, recall: true, harnessSkill: false, todo: true },
  observability: { checklist: false },
  observabilityVerbosity: "normal",
  terminalTools: true,
  terminalShellAdditionalCommands: "bun, gh",
  terminalShellAllowedCommands: "ls, cat",
  terminalShellOptions: { cwd: "sub", timeoutMs: 9000, maxOutputChars: 800, commandAccess: ["github"], sandbox: "docker" },
  workspace: dir,
  taskContext: { project: "acme" },
  healthCheck: true,
  memory: { working: true, episodic: false, semantic: false },
  contextSynthesis: "auto",
  guardrails: { enabled: true, injection: true, pii: false, customBlocklist: ["secret"] },
  persona: { enabled: true, role: "Analyst", tone: "dry" },
  skills: { paths: ["./skills"], activate: ["forced"] },
  outputSchema: { type: "object", properties: { name: { type: "string" } } },
  outputSchemaOnParseFail: "throw",
  harness: { toolIndex: true },
  documents: [{ source: "notes", content: "inline doc" }],
  budget: { tokenLimit: 5000 },
  grounding: { mode: "warn" },
  fabricationGuard: "warn",
  modelRouting: { enabled: true, minTier: "haiku" },
  rawConfig: { profile: "lean" },
  durableRuns: { enabled: true, approvalPolicy: { tools: ["file-write"], mode: "block" } },
});

function captureRunnerLayer(captured: { params: LaunchParams | null }) {
  return Layer.succeed(CortexRunnerService, {
    start: (params) => {
      captured.params = params;
      return Effect.succeed({ agentId: "x", runId: "y" });
    },
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

const post = (app: { handle: (r: Request) => Promise<Response> }, url: string, body: unknown) =>
  app.handle(new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

const mcpConfigsFor = (cfg: Record<string, unknown>) =>
  getMcpServersByIds(db, (cfg.mcpServerIds as string[] | undefined) ?? []).map(parseMcpConfig);

async function runnerParams(cfg: Record<string, unknown>): Promise<BuildCortexAgentParams> {
  const captured = { params: null as LaunchParams | null };
  const app = new Elysia().use(runsRouter(CortexStoreServiceLive(db), captureRunnerLayer(captured)));
  const res = await post(app, "http://localhost/api/runs", { prompt: "go", agentName: "parity", ...cfg });
  expect(res.status).toBe(200);
  const p = captured.params!;
  return launchParamsToBuildParams(p, p.provider ?? "test", mcpConfigsFor(cfg));
}

type ChatParamsOf = (sessionId: string, cfg: Record<string, unknown>, stableAgentId: string | undefined) => BuildCortexAgentParams;

async function chatParams(cfg: Record<string, unknown>): Promise<BuildCortexAgentParams> {
  const app = new Elysia().use(chatRouter(svc));
  const res = await post(app, "http://localhost/api/chat/sessions", { name: "parity", ...cfg });
  expect(res.status).toBe(200);
  const { sessionId } = (await res.json()) as { sessionId: string };
  const row = getChatSession(db, sessionId)!;
  return (svc as unknown as { buildChatAgentParams: ChatParamsOf }).buildChatAgentParams(sessionId, row.agentConfig, row.stableAgentId);
}

function gatewayParams(cfg: Record<string, unknown>): BuildCortexAgentParams {
  // Saved agents store the config as JSON; fireAgent normalises it before building.
  const config = normalizeCortexAgentConfig(JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>);
  return gatewayConfigToBuildParams({ agentId: "gateway-parity", name: "parity", config, mcpConfigs: mcpConfigsFor(config) });
}

const setKeys = (p: BuildCortexAgentParams): Set<string> =>
  new Set(Object.entries(p).filter(([, v]) => v !== undefined).map(([k]) => k));

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-parity-"));
  db = new Database(":memory:");
  applySchema(db);
  insertMcpServer(db, "mcp-parity", { name: "parity-mcp", transport: "stdio", command: "echo" });
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("three-path build parity (runner / chat / gateway)", () => {
  it("one maximal config yields the same BuildCortexAgentParams keys on every path", async () => {
    const cfg = fixture();
    const byPath: Record<Path, Set<string>> = {
      runner: setKeys(await runnerParams(cfg)),
      chat: setKeys(await chatParams(cfg)),
      gateway: setKeys(gatewayParams(cfg)),
    };
    const drift: string[] = [];
    for (const key of Object.keys(PARAM_KEYS) as (keyof BuildCortexAgentParams)[]) {
      const expected = PATH_SPECIFIC[key]?.paths ?? ALL_PATHS;
      const actual = ALL_PATHS.filter((p) => byPath[p].has(key));
      if (actual.join(",") !== [...expected].sort((a, b) => ALL_PATHS.indexOf(a) - ALL_PATHS.indexOf(b)).join(",")) {
        drift.push(`${key}: set on [${actual.join(", ")}], expected [${expected.join(", ")}]`);
      }
    }
    expect(drift).toEqual([]);
  });

  it("the fields that drifted carry the same value on every path", async () => {
    const cfg = fixture();
    const all = [await runnerParams(cfg), await chatParams(cfg), gatewayParams(cfg)];
    for (const p of all) {
      expect(p.outputSchemaOnParseFail).toBe("throw");
      expect(p.strategy).toBe("plan-execute-reflect");
      expect(p.maxIterations).toBe(7);
      expect(p.terminalTools).toBe(true);
      expect(p.documents).toEqual([{ source: "notes", content: "inline doc" }]);
    }
  });
});

describe("chat path fixes", () => {
  it("a tools-off chat never gets shell-execute, even with terminalTools stored", async () => {
    const p = await chatParams({ provider: "test", enableTools: false, terminalTools: true, terminalShellAdditionalCommands: "gh" });
    expect(p.terminalTools).toBeUndefined();
    expect(p.tools).toBeUndefined();
    expect(shellExecuteRequested(p)).toBe(false);
  });

  it("a tools-off chat keeps a configured strategy and iteration cap", async () => {
    const p = await chatParams({ provider: "test", enableTools: false, strategy: "reflexion", maxIterations: 5 });
    expect(p.strategy).toBe("reflexion");
    expect(p.maxIterations).toBe(5);
  });

  it("a tools-off chat with no strategy / cap leaves both to the framework", async () => {
    const p = await chatParams({ provider: "test", enableTools: false });
    expect(p.strategy).toBeUndefined();
    expect(p.maxIterations).toBeUndefined();
  });

  it("accepts every manifest strategy name and alias (e.g. rewoo), not just a hand list", async () => {
    const names = getCapabilityManifest().strategies.flatMap((s) => [s.name, ...(s.aliases ?? [])]);
    expect(names).toContain("rewoo");
    for (const strategy of names) {
      const p = await chatParams({ provider: "test", enableTools: true, tools: ["web-search"], strategy });
      // normalizeCortexAgentConfig maps the legacy `react` alias to the registry key.
      expect(p.strategy, `chat dropped strategy ${strategy}`).toBe(strategy === "react" ? "reactive" : strategy);
    }
  });

  it("forwards outputSchemaOnParseFail only with an outputSchema", async () => {
    const without = await chatParams({ provider: "test", outputSchemaOnParseFail: "throw" });
    expect(without.outputSchemaOnParseFail).toBeUndefined();
  });
});
