// Run: bun run repo test apps/cortex/server/tests/chat-builder-controls.test.ts
//
// Cortex exposes the builder's workspace / shell / guardrail controls, and chat
// sessions forward the same agent config the Lab run path does. These pin:
//  - chat sessions forward rawConfig + durableRuns (were silently dropped),
//  - workspace + shell options reach the agent only when the chat has tools on,
//  - the Cortex → AgentConfig mapping for workspace and guardrail detectors,
//  - one ShellExecuteConfig carries every shell option,
//  - the API refuses a workspace that is not an existing absolute directory.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { Elysia } from "elysia";
import { applySchema } from "../db/schema.js";
import { getChatSession } from "../db/chat-queries.js";
import { ChatSessionService } from "../services/chat-session-service.js";
import { chatRouter } from "../api/chat.js";
import { workspaceRouter } from "../api/workspace.js";
import { toolsRouter } from "../api/tools.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { BUILTIN_TOOLSET_ALIASES } from "@reactive-agents/tools";
import { buildCortexAgent, shellTerminalOption, type BuildCortexAgentParams } from "../services/build-cortex-agent.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import { normalizeCortexAgentConfig } from "../services/cortex-agent-config.js";
import { checkWorkspaceDir } from "../services/workspace-dir.js";

type ParamsOf = (sessionId: string, cfg: Record<string, unknown>, stableAgentId: string | undefined) => BuildCortexAgentParams;

let dir: string;
let db: Database;
let svc: ChatSessionService;
const paramsOf = (sessionId: string): BuildCortexAgentParams => {
  const row = getChatSession(db, sessionId)!;
  return (svc as unknown as { buildChatAgentParams: ParamsOf }).buildChatAgentParams(sessionId, row.agentConfig, row.stableAgentId);
};

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-ws-"));
  db = new Database(":memory:");
  applySchema(db);
  svc = new ChatSessionService(db);
});
afterAll(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("chat session → agent params", () => {
  it("forwards rawConfig and durableRuns (approval mode included)", async () => {
    const id = await svc.createSession({
      agentConfig: {
        provider: "test",
        rawConfig: { profile: "lean", tools: { maxCallsPerTool: { "web-search": 2 } } },
        durableRuns: { enabled: true, approvalTools: ["file-write"], approvalMode: "block" },
      },
    });
    const p = paramsOf(id);
    expect(p.rawConfig).toEqual({ profile: "lean", tools: { maxCallsPerTool: { "web-search": 2 } } });
    expect(p.durableRuns).toEqual({ enabled: true, approvalPolicy: { tools: ["file-write"], mode: "block" } });
  });

  it("forwards workspace + shell options when tools are on", async () => {
    const id = await svc.createSession({
      agentConfig: {
        provider: "test",
        terminalTools: true,
        workspace: dir,
        terminalShellOptions: { cwd: "sub", timeoutMs: 5000, commandAccess: ["github", "bogus"], sandbox: "docker" },
      },
    });
    const p = paramsOf(id);
    expect(p.workspace).toBe(dir);
    expect(p.terminalShellOptions).toEqual({ cwd: "sub", timeoutMs: 5000, commandAccess: ["github"], sandbox: "docker" });
  });

  it("omits workspace + shell options for a tools-off chat (no tool layer)", async () => {
    const id = await svc.createSession({
      agentConfig: { provider: "test", enableTools: false, workspace: dir, terminalShellOptions: { timeoutMs: 5000 } },
    });
    const p = paramsOf(id);
    expect(p.workspace).toBeUndefined();
    expect(p.terminalShellOptions).toBeUndefined();
  });

  it("forwards guardrail detector switches and the custom blocklist", async () => {
    const id = await svc.createSession({
      agentConfig: { provider: "test", guardrails: { enabled: true, pii: false, customBlocklist: ["secret"] } },
    });
    expect(paramsOf(id).guardrails).toEqual({ enabled: true, pii: false, customBlocklist: ["secret"] });
  });
});

describe("chat shell runs in the workspace", () => {
  it("shell-execute `ls` lists the workspace (no unsafe-cwd refusal)", async () => {
    writeFileSync(join(dir, "workspace-marker.txt"), "here");
    const id = await svc.createSession({
      agentConfig: {
        provider: "test",
        strategy: "reactive",
        maxIterations: 4,
        terminalTools: true,
        workspace: dir,
        testScenario: [{ toolCall: { name: "shell-execute", args: { command: "ls" } } }, { text: "done" }],
      },
    });
    const seen: string[] = [];
    for await (const ev of svc.chatStream(id, "list the files")) seen.push(JSON.stringify(ev));
    await svc.deleteSession(id);
    const all = seen.join("\n");
    expect(all).toContain("workspace-marker.txt");
    expect(all).not.toContain("allowUnsafeCwd");
  }, 30_000);
});

describe("Cortex params → AgentConfig", () => {
  it("maps workspace to tools.workspace, with or without a tool pick", () => {
    expect(cortexParamsToAgentConfig({ provider: "test", workspace: dir }).tools).toEqual({ workspace: dir });
    expect(cortexParamsToAgentConfig({ provider: "test", tools: ["file-read"], workspace: dir }).tools).toEqual({
      allowedTools: ["file-read"],
      workspace: dir,
    });
  });

  it("guardrail switch wins over the legacy threshold; blocklist passes through", () => {
    const cfg = cortexParamsToAgentConfig({
      provider: "test",
      guardrails: { enabled: true, injection: false, injectionThreshold: 0.8, piiThreshold: 0, customBlocklist: ["x"] },
    });
    expect(cfg.guardrails).toEqual({ injection: false, pii: false, toxicity: true, customBlocklist: ["x"] });
  });

  it("rawConfig fields the curated draft does not set reach the AgentConfig", () => {
    const cfg = cortexParamsToAgentConfig({
      provider: "test",
      tools: ["web-search"],
      rawConfig: { profile: "lean", tools: { builtins: ["research"], maxCallsPerTool: { "web-search": 3 } }, requiredTools: { tools: ["web-search"] } },
    });
    expect(cfg.profile).toBe("lean");
    expect(cfg.tools).toEqual({ builtins: ["research"], maxCallsPerTool: { "web-search": 3 }, allowedTools: ["web-search"] });
    expect(cfg.requiredTools).toEqual({ tools: ["web-search"] });
  });
});

describe("shellTerminalOption", () => {
  it("is plain `true` with nothing customised", () => {
    expect(shellTerminalOption({})).toBe(true);
  });
  it("carries command lists and every shell option in one config", () => {
    expect(
      shellTerminalOption({
        terminalShellAdditionalCommands: "gh, node",
        terminalShellOptions: { cwd: "src", allowUnsafeCwd: true, timeoutMs: 9000, maxOutputChars: 800, commandAccess: ["python"], sandbox: "host" },
      }),
    ).toEqual({
      additionalCommands: ["gh", "node"],
      cwd: "src",
      allowUnsafeCwd: true,
      timeoutMs: 9000,
      maxOutputChars: 800,
      commandAccess: { capabilities: ["python"] },
      sandbox: "host",
    });
  });
});

describe("normalizeCortexAgentConfig", () => {
  it("keeps workspace / shell options / rawConfig; drops empty ones", () => {
    const out = normalizeCortexAgentConfig({ workspace: `  ${dir} `, terminalShellOptions: { timeoutMs: "0" }, rawConfig: {} });
    expect(out.workspace).toBe(dir);
    expect(out.terminalShellOptions).toBeUndefined();
    expect(out.rawConfig).toBeUndefined();
  });
});

describe("workspace validation", () => {
  it("accepts an existing absolute directory, refuses the rest", () => {
    const file = join(dir, "f.txt");
    writeFileSync(file, "x");
    expect(checkWorkspaceDir(dir)).toEqual({ ok: true, path: dir });
    expect(checkWorkspaceDir("relative/dir").ok).toBe(false);
    expect(checkWorkspaceDir(join(dir, "missing")).ok).toBe(false);
    expect(checkWorkspaceDir(file).ok).toBe(false);
  });

  it("the framework also refuses a missing workspace at build", async () => {
    await expect(buildCortexAgent({ provider: "test", tools: ["file-read"], workspace: join(dir, "missing") })).rejects.toThrow();
  }, 15000);

  it("PATCH config: 400 on a bad workspace, stored when valid, cleared by empty string", async () => {
    const id = await svc.createSession({ agentConfig: { provider: "test" } });
    const app = new Elysia().use(chatRouter(svc));
    const patch = (body: unknown) =>
      app.handle(
        new Request(`http://localhost/api/chat/sessions/${id}/config`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        }),
      );
    const bad = await patch({ workspace: join(dir, "missing") });
    expect(bad.status).toBe(400);
    expect(getChatSession(db, id)!.agentConfig.workspace).toBeUndefined();

    expect((await patch({ workspace: `${dir}/` })).status).toBe(200);
    expect(getChatSession(db, id)!.agentConfig.workspace).toBe(dir);

    expect((await patch({ terminalShellOptions: { sandbox: "docker" }, rawConfig: { profile: "lean" } })).status).toBe(200);
    const cfg = getChatSession(db, id)!.agentConfig;
    expect(cfg.terminalShellOptions).toEqual({ sandbox: "docker" });
    expect(cfg.rawConfig).toEqual({ profile: "lean" });

    expect((await patch({ workspace: "" })).status).toBe(200);
    expect(getChatSession(db, id)!.agentConfig.workspace).toBeUndefined();
  });

  it("GET /api/tools/toolsets serves the framework's built-in toolset shortcuts", async () => {
    const app = new Elysia().use(toolsRouter(CortexStoreServiceLive(db), db));
    const body = (await (await app.handle(new Request("http://localhost/api/tools/toolsets"))).json()) as Record<string, string[]>;
    expect(body).toEqual({ ...BUILTIN_TOOLSET_ALIASES } as Record<string, string[]>);
    expect(body.research).toContain("web-search");
  });

  it("GET /api/workspace/check and /recent", async () => {
    const app = new Elysia().use(workspaceRouter(db));
    const ok = await app.handle(new Request(`http://localhost/api/workspace/check?path=${encodeURIComponent(dir)}`));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ ok: true, path: dir });
    const bad = await app.handle(new Request(`http://localhost/api/workspace/check?path=nope`));
    expect(bad.status).toBe(400);
    const recent = (await (await app.handle(new Request("http://localhost/api/workspace/recent"))).json()) as { workspaces: string[] };
    expect(recent.workspaces).toContain(dir);
  });
});
