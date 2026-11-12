/**
 * "Export as code": `POST /api/agent-config/source` prints the framework's
 * `agentConfigToSource` over the AgentConfig `buildCortexAgent` builds from, and
 * lists the Cortex overlay settings the code leaves out.
 *
 * Run: bun test apps/cortex/server/tests/cortex-agent-source.test.ts --timeout 15000
 */
import { afterAll, afterEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import { Database } from "bun:sqlite";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { agentConfigToBuilder, type ReactiveAgentBuilder } from "@reactive-agents/runtime";
import { applySchema } from "../db/schema.js";
import { insertMcpServer } from "../db/mcp-queries.js";
import { CortexStoreServiceLive } from "../services/store-service.js";
import { agentConfigSourceRouter } from "../api/agent-config-source.js";
import { RunConfigBody, runBodyToLaunchParams } from "../api/runs.js";
import type { Static } from "elysia";
import { launchParamsToBuildParams } from "../services/runner-service.js";
import { cortexParamsToAgentConfig } from "../services/cortex-to-agent-config.js";
import {
  CORTEX_OVERLAY_CALLS,
  cortexAgentSource,
  cortexOnlySettings,
  type CortexAgentSource,
} from "../services/cortex-agent-source.js";
import { installProviderKeyStore, ProviderKeyStore } from "../services/provider-key-store.js";
import { FULL_CONFIG_BODY } from "./fixtures/full-config-body.js";

const tempDir = mkdtempSync(join(tmpdir(), "cortex-agent-source-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));
afterEach(() => installProviderKeyStore(null));

const RUNTIME_ENTRY = Bun.resolveSync("@reactive-agents/runtime", import.meta.dir);

function makeApp(db: Database = new Database(":memory:")) {
  applySchema(db);
  return new Elysia().use(agentConfigSourceRouter(CortexStoreServiceLive(db)));
}

async function postSource(app: ReturnType<typeof makeApp>, body: unknown): Promise<{ status: number; json: CortexAgentSource }> {
  const res = await app.handle(
    new Request("http://localhost/api/agent-config/source", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: (await res.json()) as CortexAgentSource };
}

/** Evaluate exported source as a module (builder only, no `.build()`). */
let moduleCount = 0;
async function evaluate(source: string): Promise<ReactiveAgentBuilder> {
  const asBuilder = source
    .replace(`from "reactive-agents"`, `from ${JSON.stringify(RUNTIME_ENTRY)}`)
    .replace("export const agent = await ", "export const builder = ")
    .replace(/\n {2}\.build\(\);\n$/, ";\n");
  const file = join(tempDir, `agent-${moduleCount++}.ts`);
  writeFileSync(file, asBuilder);
  const mod: { builder: ReactiveAgentBuilder } = await import(pathToFileURL(file).href);
  return mod.builder;
}

describe("Export as code", () => {
  it("FULL_CONFIG_BODY round trips: exported code builds the same AgentConfig the live build starts from", async () => {
    const { status, json } = await postSource(makeApp(), FULL_CONFIG_BODY);
    expect(status).toBe(200);
    expect(json.source).toStartWith("import { HarnessProfile, ReactiveAgents } from \"reactive-agents\";");
    expect(json.source).toContain(".withProfile(HarnessProfile.lean())"); // rawConfig rides the export
    expect(json.source).toContain('.withName("parity-agent")');

    const params = launchParamsToBuildParams(
      // The route validated this body; the fixture's literals are wider than the schema's unions.
      runBodyToLaunchParams(FULL_CONFIG_BODY as Static<typeof RunConfigBody>, FULL_CONFIG_BODY.workspace),
      FULL_CONFIG_BODY.provider,
      [],
    );
    const live = cortexParamsToAgentConfig(params);
    const exported = await evaluate(json.source);
    expect(exported.toConfig()).toEqual((await agentConfigToBuilder(live)).toConfig());
  }, 15000);

  it("FULL_CONFIG_BODY: only the true overlays are listed; every data setting is in the code", async () => {
    const { json } = await postSource(makeApp(), FULL_CONFIG_BODY);
    // FULL_CONFIG_BODY sets durable runs (the user-question rail is now in the code
    // as `.withUserInteraction()`) and no host tools, scenario, trace dir, output schema or saved key.
    expect(json.notInCode.map((s) => s.call)).toEqual([]);
    for (const call of [
      ".withAgentTool(", ".withDynamicSubAgents(", ".withTaskContext(", ".withSkills(",
      ".withMinIterations(", ".withVerificationStep(", ".withVerification(", ".withMetaTools(",
      ".withFabricationGuard(", ".withModelRouting(", ".withDurableRuns(", ".withKillSwitch(",
      ".withMemory(",
    ]) {
      expect(json.source).toContain(call);
    }
    expect(json.source).toContain('"http-get"'); // extra tool names ride the allow-list
    expect(json.source).toMatch(/sandbox"?: "docker"/); // shell options object
  });

  it("lists each true overlay when set", () => {
    const extra = { definition: { name: "session-control" } } as unknown as NonNullable<Parameters<typeof cortexOnlySettings>[0]["extraTools"]>[number];
    const notes = cortexOnlySettings({
      provider: "test",
      testScenario: [{ text: "hi" }],
      extraTools: [extra],
      tracing: { dir: "/tmp/traces" },
      outputSchema: { type: "object" },
      approvalPolicy: { mode: "detach", tools: ["file-write"] },
    });
    // The output schema is JSON Schema in the AgentConfig now: exported in the code, no overlay.
    expect(notes.map((n) => n.call)).toEqual(["withTestScenario", "withTools", "withTracing"]);
    expect(notes.find((n) => n.call === "withTools")?.detail).toBe("session-control");
  });

  it("a saved provider key and MCP secrets never reach the exported code", async () => {
    const dir = mkdtempSync(join(tempDir, "keys-"));
    const store = new ProviderKeyStore({ dir, env: {} });
    const KEY = "sk-ant-saved-key-value-0001";
    expect(store.set("anthropic", KEY).ok).toBe(true);
    installProviderKeyStore(store);

    const db = new Database(":memory:");
    const app = makeApp(db);
    const TOKEN = "ghp_mcp_token_value_0002";
    const BEARER = "Bearer header_value_0003";
    insertMcpServer(db, "mcp-1", { name: "gh", transport: "stdio", command: "gh-mcp", env: { GITHUB_TOKEN: TOKEN } });
    insertMcpServer(db, "mcp-2", { name: "remote", transport: "streamable-http", endpoint: "https://mcp.example.com", headers: { Authorization: BEARER } });

    const { status, json } = await postSource(app, {
      provider: "anthropic",
      agentName: "keyed",
      mcpServerIds: ["mcp-1", "mcp-2"],
    });
    expect(status).toBe(200);
    for (const secret of [KEY, TOKEN, BEARER]) expect(json.source).not.toContain(secret);
    expect(json.source).toContain("process.env.GITHUB_TOKEN");
    expect(json.source).toContain("process.env.MCP_REMOTE_AUTHORIZATION");
    const keyNote = json.notInCode.find((s) => s.setting === "API key saved in Settings");
    expect(keyNote?.detail).toContain("ANTHROPIC_API_KEY");
    expect(JSON.stringify(json.notInCode)).not.toContain(KEY);
  });

  it("an invalid config is a 400, not a crash", async () => {
    const { status } = await postSource(makeApp(), { provider: "anthropic", rawConfig: { execution: { maxIterations: "many" } } });
    expect(status).toBe(400);
  });

  it("a bare config notes nothing: Cortex's defaults (memory, meta tools, desk stop) are in the code", () => {
    expect(cortexOnlySettings({ provider: "test" })).toEqual([]);
    const source = cortexAgentSource({ provider: "test" }, "bare").source;
    expect(source).toContain('.withName("bare")');
    for (const call of [".withMemory()", ".withMetaTools(", ".withKillSwitch()"]) expect(source).toContain(call);
  });

  it("the overlay calls buildCortexAgent applies are exactly CORTEX_OVERLAY_CALLS", () => {
    const text = readFileSync(join(import.meta.dir, "../services/build-cortex-agent.ts"), "utf8");
    const overlay = text.slice(text.indexOf("let b = await agentConfigToBuilder"));
    const used = new Set([...overlay.matchAll(/\bb\s*\.\s*(with[A-Za-z]+)\(/g)].map((m) => m[1]!));
    expect([...used].sort()).toEqual([...CORTEX_OVERLAY_CALLS].sort());
  });
});
