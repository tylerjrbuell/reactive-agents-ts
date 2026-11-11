// Run: bun test packages/runtime/tests/config-to-source.test.ts --timeout 15000
//
// Pins "config as code": agentConfigToSource() prints the builder chain that
// agentConfigToBuilder() applies, from one shared call list
// (agentConfigToBuilderCalls). The roundtrip test evaluates the printed module
// and checks its toConfig() against the original config.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { agentConfigToBuilder, type AgentConfig } from "../src/agent-config.js";
import { agentConfigToBuilderCalls } from "../src/builder/config-calls.js";
import { agentConfigToSource } from "../src/builder/config-source.js";
import type { ReactiveAgentBuilder } from "../src/builder.js";
import { MAXIMAL_CONFIG } from "./fixtures/maximal-agent-config.js";

const RUNTIME_INDEX = resolve(import.meta.dir, "../src/index.ts");
const tempDir = mkdtempSync(join(tmpdir(), "ra-config-source-"));
afterAll(() => rmSync(tempDir, { recursive: true, force: true }));

/** Write the printed module to a temp file, import it, return its builder. */
let moduleCount = 0;
const evaluateSource = async (config: AgentConfig): Promise<ReactiveAgentBuilder> => {
  const source = agentConfigToSource(config, { importFrom: RUNTIME_INDEX, build: false });
  const file = join(tempDir, `agent-${moduleCount++}.ts`);
  writeFileSync(file, source);
  const mod: { builder: ReactiveAgentBuilder } = await import(pathToFileURL(file).href);
  return mod.builder;
};

/** Leaves that never roundtrip through a builder (see config-serialization-drift.test.ts). */
const withoutNonBuilderLeaves = (config: AgentConfig): Omit<AgentConfig, "profile" | "outputSchemaOptions"> => {
  const { profile: _profile, outputSchemaOptions: _oso, ...rest } = config;
  return rest;
};

const SECRETS = {
  GITHUB_TOKEN: "ghp_secret_value_1",
  MCP_REMOTE_AUTHORIZATION: "Bearer secret_value_2",
  GATEWAY_HOOK_SECRET: "whsec_secret_value_3",
} as const;

/** MAXIMAL_CONFIG plus every secret-bearing field. */
const SECRET_CONFIG: AgentConfig = {
  ...MAXIMAL_CONFIG,
  mcpServers: [
    { name: "fs", transport: "stdio", command: "mcp-fs", args: ["--root", "/"], env: { GITHUB_TOKEN: SECRETS.GITHUB_TOKEN } },
    {
      name: "remote",
      transport: "streamable-http",
      endpoint: "https://mcp.example.com",
      headers: { Authorization: SECRETS.MCP_REMOTE_AUTHORIZATION },
    },
  ],
  gateway: {
    ...MAXIMAL_CONFIG.gateway,
    webhooks: [{ path: "/hook", adapter: "generic", secret: SECRETS.GATEWAY_HOOK_SECRET }],
  },
};

describe("agentConfigToSource", () => {
  it("maximal config roundtrips: printed source -> builder -> toConfig() equals the original", async () => {
    const builder = await evaluateSource(MAXIMAL_CONFIG);
    const out = builder.toConfig();
    // Same result as the live mapper...
    expect(out).toEqual((await agentConfigToBuilder(MAXIMAL_CONFIG)).toConfig());
    // ...and equal to the original, minus the two documented non-builder leaves.
    expect(out).toEqual(withoutNonBuilderLeaves(MAXIMAL_CONFIG));
  }, 15000);

  it("prints secrets as process.env references and never their values", async () => {
    const source = agentConfigToSource(SECRET_CONFIG);
    for (const value of Object.values(SECRETS)) expect(source).not.toContain(value);
    expect(source).toContain('GITHUB_TOKEN: process.env.GITHUB_TOKEN ?? ""');
    expect(source).toContain('Authorization: process.env.MCP_REMOTE_AUTHORIZATION ?? ""');
    expect(source).toContain('secret: process.env.GATEWAY_HOOK_SECRET ?? ""');

    // With the variables set, the printed code rebuilds the same config.
    const saved = Object.keys(SECRETS).map((k) => [k, process.env[k]] as const);
    Object.assign(process.env, SECRETS);
    try {
      const out = (await evaluateSource(SECRET_CONFIG)).toConfig();
      expect(out).toEqual(withoutNonBuilderLeaves(SECRET_CONFIG));
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  }, 15000);

  it("prints one chain line per builder call, in call order", () => {
    const calls = agentConfigToBuilderCalls(MAXIMAL_CONFIG);
    const printed = agentConfigToSource(MAXIMAL_CONFIG, { format: "expression", build: false })
      .split("\n")
      .filter((line) => /^ {2}\.\w+\(/.test(line))
      .map((line) => line.trim().slice(1, line.trim().indexOf("(")));
    expect(printed).toEqual(calls.map((c) => c.method));
  });

  it("is deterministic and prints a minimal config exactly", () => {
    const config: AgentConfig = { name: "helper", provider: "anthropic", execution: { maxIterations: 5 } };
    expect(agentConfigToSource(config)).toBe(agentConfigToSource(config));
    expect(agentConfigToSource(config)).toBe(
      [
        'import { ReactiveAgents } from "reactive-agents";',
        "",
        "export const agent = await ReactiveAgents.create()",
        '  .withName("helper")',
        '  .withProvider("anthropic")',
        "  .withMaxIterations(5)",
        "  .build();",
        "",
      ].join("\n"),
    );
    expect(agentConfigToSource(config, { format: "expression" })).toBe(
      'ReactiveAgents.create()\n  .withName("helper")\n  .withProvider("anthropic")\n  .withMaxIterations(5)\n  .build()',
    );
  });

  it("prints a profile as its HarnessProfile preset and imports it", () => {
    const source = agentConfigToSource({ name: "p", provider: "anthropic", profile: "lean" });
    expect(source).toContain('import { HarnessProfile, ReactiveAgents } from "reactive-agents";');
    expect(source).toContain(".withProfile(HarnessProfile.lean())");
  });
});
