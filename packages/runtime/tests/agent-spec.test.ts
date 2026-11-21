/**
 * Portable agent file: AgentConfig <-> Open Agent Spec Agent document.
 *
 * Pins the mapping in src/agent-spec.ts: round-trip identity for every mapped
 * field, the exact document shape (fixtures), secret redaction, and the typed
 * refusals (Flow root, unknown versions, unmapped components).
 */
import { describe, test, expect } from "bun:test";
import { Effect, Either } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  agentConfigToAgentSpec,
  agentConfigFromAgentSpec,
  loadAgentFile,
  AgentSpecError,
  type AgentSpecImport,
  type AgentSpecImportOptions,
  type AgentSpecExportOptions,
} from "../src/agent-spec.js";
import { agentConfigToJSON, type AgentConfig } from "../src/agent-config.js";
import { MAXIMAL_CONFIG } from "./fixtures/maximal-agent-config.js";

const FIXTURES = join(import.meta.dir, "fixtures", "agent-spec");
const readFixture = (file: string): unknown => JSON.parse(readFileSync(join(FIXTURES, file), "utf8"));

const importDoc = (doc: unknown, options?: AgentSpecImportOptions): AgentSpecImport =>
  Effect.runSync(agentConfigFromAgentSpec(doc, options));

const importError = (doc: unknown, options?: AgentSpecImportOptions): AgentSpecError => {
  const result = Effect.runSync(Effect.either(agentConfigFromAgentSpec(doc, options)));
  if (Either.isRight(result)) return expect.unreachable("expected the import to fail");
  return result.left;
};

/** Export, serialize to JSON text (as a file would), parse and import. */
const roundTrip = (
  config: AgentConfig,
  env: AgentSpecImportOptions["env"] = {},
  options?: AgentSpecExportOptions,
): AgentSpecImport => importDoc(JSON.parse(JSON.stringify(agentConfigToAgentSpec(config, options))), { env });

const OLLAMA_CONFIG: AgentConfig = {
  name: "local-helper",
  agentId: "local-helper",
  provider: "ollama",
  model: "qwen3:4b",
  systemPrompt: "You help with files.",
  temperature: 0.2,
  maxTokens: 2048,
  mcpServers: [
    {
      name: "filesystem",
      transport: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
      env: { FS_TOKEN: "secret-fs-token" },
    },
  ],
  reasoning: { defaultStrategy: "reactive" },
  execution: { maxIterations: 8 },
};

const ANTHROPIC_CONFIG: AgentConfig = {
  name: "Release Assistant",
  provider: "anthropic",
  model: "claude-sonnet-4-5",
  systemPrompt: "You prepare release notes.",
  persona: { role: "release engineer", tone: "concise" },
  mcpServers: [
    {
      name: "github",
      transport: "streamable-http",
      endpoint: "https://api.example.com/mcp",
      headers: { Authorization: "Bearer ghp_secret_value" },
    },
  ],
  approvalPolicy: { mode: "block", tools: ["publish_release"] },
  gateway: { webhooks: [{ path: "/hook", adapter: "github", secret: "whsec_secret_value" }] },
  userInteraction: { timeoutMs: 60000 },
};
const ANTHROPIC_ENV = { MCP_GITHUB_AUTHORIZATION: "Bearer ghp_secret_value", GATEWAY_HOOK_SECRET: "whsec_secret_value" };
const PUBLISH_TOOL = { name: "publish_release", description: "Publish a GitHub release", inputs: [{ title: "tag", type: "string" }] };

describe("agentConfigToAgentSpec — document shape (fixtures)", () => {
  test("Ollama + stdio MCP config writes exactly the ollama-stdio fixture", () => {
    const doc = agentConfigToAgentSpec(OLLAMA_CONFIG, { llmUrl: "http://gpu-box:11434" });
    expect(JSON.parse(JSON.stringify(doc))).toEqual(readFixture("ollama-stdio.agent.json"));
  });

  test("Anthropic + HTTP MCP + code tool writes exactly the anthropic-http-tool fixture", () => {
    const doc = agentConfigToAgentSpec(ANTHROPIC_CONFIG, { tools: [PUBLISH_TOOL] });
    expect(JSON.parse(JSON.stringify(doc))).toEqual(readFixture("anthropic-http-tool.agent.json"));
  });
});

describe("agentConfigFromAgentSpec — round trip", () => {
  test("ollama fixture imports back to the original config, url and all", () => {
    const loaded = importDoc(readFixture("ollama-stdio.agent.json"), { env: { FS_TOKEN: "secret-fs-token" } });
    expect(loaded.config).toEqual(OLLAMA_CONFIG);
    expect(loaded.llmUrl).toBe("http://gpu-box:11434");
    expect(loaded.format).toBe("agent-spec");
    expect(loaded.missingSecrets).toEqual([]);
    expect(loaded.ignored).toEqual([]);
  });

  test("anthropic fixture imports back; the ServerTool is a required tool", () => {
    const loaded = importDoc(readFixture("anthropic-http-tool.agent.json"), { env: ANTHROPIC_ENV });
    expect(loaded.config).toEqual(ANTHROPIC_CONFIG);
    expect(loaded.requiredTools).toEqual(["publish_release"]);
    expect(loaded.missingSecrets).toEqual([]);
  });

  const providerCases: ReadonlyArray<readonly [AgentConfig["provider"], string]> = [
    ["openai", "OpenAiConfig"],
    ["gemini", "GeminiConfig"],
    ["anthropic", "LlmConfig"],
    ["groq", "LlmConfig"],
    ["test", "LlmConfig"],
    ["ollama", "OllamaConfig"],
  ];
  for (const [provider, componentType] of providerCases) {
    test(`${provider} maps to ${componentType} and round-trips`, () => {
      const config: AgentConfig = { name: `p-${provider}`, agentId: `id-${provider}`, provider, model: "m-1", temperature: 0.5, maxTokens: 99 };
      const doc = agentConfigToAgentSpec(config);
      expect(doc.llm_config.component_type).toBe(componentType);
      expect(roundTrip(config).config).toEqual(config);
    });
  }

  test("a provider with a key writes a sensitive reference, never a value; keyless ones write none", () => {
    expect(agentConfigToAgentSpec({ name: "a", provider: "openai" }).llm_config.api_key).toEqual({ $component_ref: "a-llm.api_key" });
    const gemini = agentConfigToAgentSpec({ name: "g", provider: "gemini" }).llm_config;
    expect(gemini.auth?.api_key).toEqual({ $component_ref: "g-llm-auth.api_key" });
    expect(agentConfigToAgentSpec({ name: "o", provider: "ollama" }).llm_config.api_key).toBeUndefined();
  });

  test("the llm url round-trips for any provider; Ollama defaults it", () => {
    expect(roundTrip({ name: "o", provider: "ollama" }).llmUrl).toBe("http://localhost:11434");
    expect(roundTrip({ name: "x", provider: "openai" }, {}, { llmUrl: "https://proxy.example/v1" }).llmUrl).toBe("https://proxy.example/v1");
  });

  test("sse, inferred stdio and websocket MCP servers all round-trip", () => {
    const config: AgentConfig = {
      name: "mcp-mix",
      agentId: "mcp-mix",
      provider: "anthropic",
      mcpServers: [
        { name: "legacy", transport: "sse", endpoint: "https://legacy.example/sse", readOnly: true, trustAnnotations: true },
        { name: "inferred", command: "mcp-tool", cwd: "/work", readOnly: ["read"] },
        { name: "ws", transport: "websocket", endpoint: "wss://ws.example" },
      ],
    };
    const doc = agentConfigToAgentSpec(config);
    expect(doc.toolboxes?.map((b) => b.client_transport.component_type)).toEqual(["SSETransport", "StdioTransport"]);
    expect(roundTrip(config).config).toEqual(config);
  });

  test("the maximal config (every AgentConfig leaf) round-trips through the metadata", () => {
    expect(roundTrip(MAXIMAL_CONFIG).config).toEqual(MAXIMAL_CONFIG);
  });

  test("a config with no agentId keeps none; one with no model or prompt stays without them", () => {
    const config: AgentConfig = { name: "Bare Agent", provider: "anthropic" };
    expect(agentConfigToAgentSpec(config).id).toBe("bare-agent");
    expect(roundTrip(config).config).toEqual(config);
  });

  test("userInteraction true and false round-trip", () => {
    for (const userInteraction of [true, false] as const) {
      const config: AgentConfig = { name: "ui", agentId: "ui", provider: "test", userInteraction };
      expect(roundTrip(config).config).toEqual(config);
    }
  });
});

describe("secrets", () => {
  test("no API key, env value, header value or webhook secret appears in the document", () => {
    const text = JSON.stringify([
      agentConfigToAgentSpec(OLLAMA_CONFIG),
      agentConfigToAgentSpec(ANTHROPIC_CONFIG, { tools: [PUBLISH_TOOL] }),
      agentConfigToAgentSpec({ ...ANTHROPIC_CONFIG, mcpServers: [{ name: "ws", transport: "websocket", endpoint: "wss://x", headers: { "X-Key": "ws-header-secret" }, env: { K: "ws-env-secret" } }] }),
    ]);
    for (const secret of ["secret-fs-token", "ghp_secret_value", "whsec_secret_value", "ws-header-secret", "ws-env-secret"]) {
      expect(text).not.toContain(secret);
    }
  });

  test("unresolved secrets are listed and their fields left out", () => {
    const loaded = importDoc(readFixture("anthropic-http-tool.agent.json"), { env: {} });
    expect([...loaded.missingSecrets].sort()).toEqual(["GATEWAY_HOOK_SECRET", "MCP_GITHUB_AUTHORIZATION"]);
    expect(loaded.config.mcpServers?.[0]?.headers).toBeUndefined();
    expect(loaded.config.gateway?.webhooks?.[0]).toEqual({ path: "/hook", adapter: "github" });
  });
});

describe("standard fields win", () => {
  test("an edited system_prompt, model and human_in_the_loop override the metadata", () => {
    const doc = JSON.parse(JSON.stringify(agentConfigToAgentSpec(ANTHROPIC_CONFIG)));
    doc.system_prompt = "Edited prompt.";
    doc.llm_config.model_id = "claude-opus-4-5";
    doc.human_in_the_loop = false;
    const { config } = importDoc(doc, { env: ANTHROPIC_ENV });
    expect(config.systemPrompt).toBe("Edited prompt.");
    expect(config.model).toBe("claude-opus-4-5");
    expect(config.userInteraction).toBeUndefined();
    expect(config.persona).toEqual(ANTHROPIC_CONFIG.persona);
  });

  test("requires_confirmation on a declared tool adds it to the approval policy", () => {
    const doc = JSON.parse(JSON.stringify(agentConfigToAgentSpec({ name: "a", provider: "test" }, { tools: [{ name: "deploy" }] })));
    doc.tools[0].requires_confirmation = true;
    expect(importDoc(doc).config.approvalPolicy).toEqual({ tools: ["deploy"] });
  });
});

describe("foreign Agent Spec documents", () => {
  test("a document with $referenced_components, a ClientTool and literal headers imports", () => {
    const doc = {
      component_type: "Agent",
      id: "agent1",
      name: "Funny agent",
      description: "tells jokes",
      metadata: {},
      inputs: [],
      outputs: [],
      system_prompt: "Make a joke instead.",
      llm_config: { component_type: "LlmConfig", id: "llm1", name: "llm1", provider: "openai", model_id: "gpt-4o", api_key: "sk-literal" },
      tools: [{ component_type: "ClientTool", id: "t1", name: "get_weather", inputs: [{ title: "city", type: "string" }] }],
      toolboxes: [{ component_type: "MCPToolBox", id: "box", name: "remote", client_transport: { $component_ref: "mcp_transport" }, tool_filter: null }],
      $referenced_components: {
        mcp_transport: {
          component_type: "SSETransport",
          id: "mcp_transport",
          name: "mcp_transport",
          url: "https://some.where/sse",
          headers: { "X-Team": "jokes" },
          sensitive_headers: { $component_ref: "mcp_transport.sensitive_headers" },
        },
      },
      agentspec_version: "26.1.2",
    };
    const loaded = importDoc(doc);
    expect(loaded.config).toEqual({
      name: "Funny agent",
      agentId: "agent1",
      provider: "openai",
      model: "gpt-4o",
      systemPrompt: "Make a joke instead.",
      mcpServers: [{ name: "remote", transport: "sse", endpoint: "https://some.where/sse", headers: { "X-Team": "jokes" } }],
      userInteraction: true,
    });
    expect(loaded.requiredTools).toEqual(["get_weather"]);
    expect(loaded.missingSecrets).toEqual(["mcp_transport.sensitive_headers"]);
    expect(loaded.ignored).toEqual(["llm_config.api_key (literal key not imported)", "description"]);
    expect(JSON.stringify(loaded.config)).not.toContain("sk-literal");
  });
});

describe("typed refusals", () => {
  const minimalAgent = () => JSON.parse(JSON.stringify(agentConfigToAgentSpec({ name: "a", provider: "test" })));

  test("a Flow root fails as unsupported-component, naming Flow", () => {
    const err = importError({ component_type: "Flow", id: "f", name: "flow", agentspec_version: "26.1.2" });
    expect(err.reason).toBe("unsupported-component");
    expect(err.message).toContain("Flow");
  });

  test("an unknown metadata schemaVersion fails as unsupported-version", () => {
    const doc = minimalAgent();
    doc.metadata["reactive-agents"].schemaVersion = 2;
    expect(importError(doc).reason).toBe("unsupported-version");
  });

  test("an agentspec_version newer than the reader fails as unsupported-version", () => {
    const doc = minimalAgent();
    doc.agentspec_version = "27.1.0";
    expect(importError(doc).reason).toBe("unsupported-version");
  });

  test("an unmapped tool type, LLM config or tool_filter fails as unsupported-component", () => {
    const remoteTool = minimalAgent();
    remoteTool.tools = [{ component_type: "RemoteTool", id: "r", name: "remote" }];
    expect(importError(remoteTool).message).toContain("RemoteTool");
    const vllm = minimalAgent();
    vllm.llm_config.component_type = "VllmConfig";
    expect(importError(vllm).reason).toBe("unsupported-component");
    const filtered = JSON.parse(JSON.stringify(agentConfigToAgentSpec(OLLAMA_CONFIG)));
    filtered.toolboxes[0].tool_filter = ["read_file"];
    expect(importError(filtered).message).toContain("tool_filter");
  });

  test("a non-object document fails as invalid-document", () => {
    expect(importError("nope").reason).toBe("invalid-document");
  });
});

describe("loadAgentFile", () => {
  test("reads an Agent Spec JSON document, resolving secrets from the given env", async () => {
    const loaded = await Effect.runPromise(loadAgentFile(join(FIXTURES, "ollama-stdio.agent.json"), { env: { FS_TOKEN: "secret-fs-token" } }));
    expect(loaded.format).toBe("agent-spec");
    expect(loaded.config).toEqual(OLLAMA_CONFIG);
  });

  test("reads a plain AgentConfig JSON file (agentConfigToJSON output)", async () => {
    const path = join(FIXTURES, "legacy-agent-config.json");
    const loaded = await Effect.runPromise(loadAgentFile(path));
    expect(loaded.format).toBe("agent-config");
    expect(agentConfigToJSON(loaded.config)).toBe(agentConfigToJSON(JSON.parse(readFileSync(path, "utf8"))));
    expect(loaded.requiredTools).toEqual([]);
  });

  test("a YAML path fails as unsupported-format; a missing file as AgentFileReadError", async () => {
    const yaml = await Effect.runPromise(Effect.either(loadAgentFile(join(FIXTURES, "agent.yaml"))));
    expect(Either.isLeft(yaml) && yaml.left._tag === "AgentSpecError" && yaml.left.reason).toBe("unsupported-format");
    const missing = await Effect.runPromise(Effect.either(loadAgentFile(join(FIXTURES, "does-not-exist.json"))));
    expect(Either.isLeft(missing) && missing.left._tag).toBe("AgentFileReadError");
  });
});
