/**
 * Portable agent file: `AgentConfig` <-> Open Agent Spec `Agent` document.
 *
 * Open Agent Spec (oracle/agent-spec, language spec 26.1.2) is an open,
 * declarative and framework-neutral agent format. This module is the single
 * mapping between it and `AgentConfig`, so code, `rax` and Cortex read and
 * write the same file.
 *
 * Field names follow the reference implementation (pyagentspec): the type
 * discriminator is `component_type`, the model block is `llm_config`, a
 * reference is `{ "$component_ref": id }`, and shared components live under
 * `$referenced_components`.
 *
 * Mapping (portable fields sit in standard places; everything else lives under
 * `metadata["reactive-agents"] = { schemaVersion: 1, config }`):
 * - `name` / `agentId` -> `name` / `id`
 * - `systemPrompt` (+ persona text) -> `system_prompt`
 * - `provider`, `model`, `temperature`, `maxTokens` -> `llm_config`
 *   (`OllamaConfig`, `OpenAiConfig`, `GeminiConfig`, or a base `LlmConfig`
 *   with `provider`) and its `default_generation_parameters`
 * - `mcpServers` (stdio, sse, streamable-http) -> `toolboxes` (`MCPToolBox`
 *   with `StdioTransport` / `SSETransport` / `StreamableHTTPTransport`)
 * - `userInteraction` -> `human_in_the_loop`
 * - code tools (passed in as declarations) -> `ServerTool` entries, no code
 *
 * Secrets are never written. API keys and MCP header values become
 * `$component_ref` sensitive-field references (the Agent Spec convention);
 * every secret value sits in the metadata as `{ "$env": "NAME" }`, named the
 * same way `agentConfigToSource` names it, and is read from the environment on
 * import.
 */
import { readFile } from "node:fs/promises";
import { Data, Effect, Either, Schema } from "effect";
import { AgentConfigSchema, ProviderNameSchema, type AgentConfig, type PersonaConfig } from "./agent-config.js";
import { redactSecrets } from "./builder/config-source.js";

// ─── Constants ────────────────────────────────────────────────────────────────

/** The Agent Spec language version this module writes. */
export const AGENT_SPEC_VERSION = "26.1.2";

/**
 * Newest Agent Spec version this module reads (pyagentspec `latest_supported_version`
 * at oracle/agent-spec 9beda2b). A newer document fails with `unsupported-version`.
 */
export const AGENT_SPEC_MAX_READ_VERSION = "26.4.0";

/** Version of the `metadata["reactive-agents"]` block this module writes and reads. */
export const AGENT_SPEC_METADATA_VERSION = 1;

/** Key of the Reactive Agents block inside a component's `metadata`. */
export const AGENT_SPEC_METADATA_KEY = "reactive-agents";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
/** Providers that run without an API key: no `api_key` reference is written for them. */
const KEYLESS_PROVIDERS: ReadonlySet<string> = new Set(["ollama", "test", "litellm"]);
const TRANSPORT_TYPES = {
  stdio: "StdioTransport",
  sse: "SSETransport",
  "streamable-http": "StreamableHTTPTransport",
} as const;

// ─── Errors ───────────────────────────────────────────────────────────────────

/**
 * An Agent Spec document (or agent file) that cannot become an `AgentConfig`.
 *
 * - `unsupported-component`: a root other than `Agent` (for example a `Flow`),
 *   or a tool, toolbox, transport or LLM config type with no mapping.
 * - `unsupported-version`: `agentspec_version` newer than this reader, or a
 *   `metadata["reactive-agents"].schemaVersion` it does not know.
 * - `unsupported-format`: a file format other than JSON (YAML is not read yet).
 * - `invalid-document`: malformed JSON or a document that fails the schema.
 */
export class AgentSpecError extends Data.TaggedError("AgentSpecError")<{
  readonly reason: "unsupported-component" | "unsupported-version" | "unsupported-format" | "invalid-document";
  /** Human-readable description naming the offending field or component. */
  readonly message: string;
  /** Underlying parse failure, when there is one. */
  readonly cause?: unknown;
}> {}

/** The agent file could not be read from disk. */
export class AgentFileReadError extends Data.TaggedError("AgentFileReadError")<{
  readonly message: string;
  /** Path that was read. */
  readonly path: string;
  readonly cause?: unknown;
}> {}

// ─── Agent Spec subset (Schema) ───────────────────────────────────────────────

const MetadataSchema = Schema.Record({ key: Schema.String, value: Schema.Unknown });
const StringRecord = Schema.Record({ key: Schema.String, value: Schema.String });

const componentFields = {
  id: Schema.String,
  name: Schema.String,
  description: Schema.optional(Schema.NullOr(Schema.String)),
  metadata: Schema.optional(Schema.NullOr(MetadataSchema)),
};

/** A reference to another component or to a sensitive field (`"<component id>.<field>"`). */
export const AgentSpecReferenceSchema = Schema.Struct({ $component_ref: Schema.String });

const SecretSchema = Schema.optional(Schema.NullOr(Schema.Union(Schema.String, AgentSpecReferenceSchema)));

/** `LlmGenerationConfig`: default generation parameters of an LLM config. */
export const AgentSpecGenerationParametersSchema = Schema.Struct({
  max_tokens: Schema.optional(Schema.NullOr(Schema.Number)),
  temperature: Schema.optional(Schema.NullOr(Schema.Number)),
  top_p: Schema.optional(Schema.NullOr(Schema.Number)),
});

/** `LlmConfig` and the subtypes this module maps (`OllamaConfig`, `OpenAiConfig`, `GeminiConfig`). */
export const AgentSpecLlmConfigSchema = Schema.Struct({
  component_type: Schema.String,
  ...componentFields,
  model_id: Schema.String,
  provider: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.NullOr(Schema.String)),
  api_key: SecretSchema,
  default_generation_parameters: Schema.optional(Schema.NullOr(AgentSpecGenerationParametersSchema)),
  /** `GeminiConfig.auth` (`GeminiAIStudioAuthConfig` carries the key reference). */
  auth: Schema.optional(
    Schema.NullOr(Schema.Struct({ component_type: Schema.String, ...componentFields, api_key: SecretSchema })),
  ),
  retry_policy: Schema.optional(Schema.Unknown),
});

/** MCP client transport: `StdioTransport`, `SSETransport` or `StreamableHTTPTransport`. */
export const AgentSpecTransportSchema = Schema.Struct({
  component_type: Schema.String,
  ...componentFields,
  command: Schema.optional(Schema.String),
  args: Schema.optional(Schema.Array(Schema.String)),
  env: Schema.optional(Schema.NullOr(StringRecord)),
  cwd: Schema.optional(Schema.NullOr(Schema.String)),
  url: Schema.optional(Schema.String),
  headers: Schema.optional(Schema.NullOr(StringRecord)),
  sensitive_headers: Schema.optional(Schema.NullOr(Schema.Union(StringRecord, AgentSpecReferenceSchema))),
  auth: Schema.optional(Schema.Unknown),
});

/** `MCPToolBox`: every tool of one MCP server. */
export const AgentSpecToolBoxSchema = Schema.Struct({
  component_type: Schema.String,
  ...componentFields,
  client_transport: AgentSpecTransportSchema,
  tool_filter: Schema.optional(Schema.NullOr(Schema.Array(Schema.Unknown))),
  requires_confirmation: Schema.optional(Schema.Boolean),
});

/** A tool declaration (`ServerTool` / `ClientTool`): name and inputs, never code. */
export const AgentSpecToolSchema = Schema.Struct({
  component_type: Schema.String,
  ...componentFields,
  inputs: Schema.optional(Schema.Array(MetadataSchema)),
  outputs: Schema.optional(Schema.Array(MetadataSchema)),
  requires_confirmation: Schema.optional(Schema.Boolean),
});

/** The Agent Spec `Agent` root component, as far as Reactive Agents reads and writes it. */
export const AgentSpecAgentSchema = Schema.Struct({
  component_type: Schema.String,
  ...componentFields,
  agentspec_version: Schema.optional(Schema.String),
  system_prompt: Schema.String,
  llm_config: AgentSpecLlmConfigSchema,
  tools: Schema.optional(Schema.Array(AgentSpecToolSchema)),
  toolboxes: Schema.optional(Schema.Array(AgentSpecToolBoxSchema)),
  human_in_the_loop: Schema.optional(Schema.Boolean),
  inputs: Schema.optional(Schema.Array(Schema.Unknown)),
  outputs: Schema.optional(Schema.Array(Schema.Unknown)),
  transforms: Schema.optional(Schema.Array(Schema.Unknown)),
});

/** An Open Agent Spec `Agent` document. */
export type AgentSpecAgent = Schema.Schema.Type<typeof AgentSpecAgentSchema>;
type LlmConfigDoc = Schema.Schema.Type<typeof AgentSpecLlmConfigSchema>;
type ToolBoxDoc = Schema.Schema.Type<typeof AgentSpecToolBoxSchema>;
type TransportDoc = Schema.Schema.Type<typeof AgentSpecTransportSchema>;
type McpServer = NonNullable<AgentConfig["mcpServers"]>[number];

const RaAgentMetadataSchema = Schema.Struct({
  schemaVersion: Schema.Number,
  config: Schema.optional(MetadataSchema),
  /** `id` was generated from `name` (the config had no `agentId`). */
  generatedId: Schema.optional(Schema.Boolean),
});

const RaToolBoxMetadataSchema = Schema.Struct({
  schemaVersion: Schema.Number,
  /** `MCPServerConfig` fields with no standard home (env/header references, readOnly, ...). */
  server: Schema.optional(MetadataSchema),
  /** The config left `transport` unset (stdio was inferred from `command`). */
  transportOmitted: Schema.optional(Schema.Boolean),
});

// ─── Public option and result types ───────────────────────────────────────────

/** A tool defined in code, declared in the file as a `ServerTool` (name and inputs only). */
export interface AgentSpecToolDeclaration {
  readonly name: string;
  readonly description?: string;
  /** Agent Spec input properties: JSON Schema objects with a `title` (the argument name). */
  readonly inputs?: ReadonlyArray<Record<string, unknown>>;
}

/** Options for {@link agentConfigToAgentSpec}. */
export interface AgentSpecExportOptions {
  /** Code tools (`defineTool`, host tools) to declare as `ServerTool` entries. */
  readonly tools?: ReadonlyArray<AgentSpecToolDeclaration>;
  /**
   * LLM endpoint written to `llm_config.url`. `AgentConfig` has no endpoint
   * field, so pass it here. Ollama defaults to `http://localhost:11434`
   * (the field is required by `OllamaConfig`).
   */
  readonly llmUrl?: string;
}

/** Options for {@link agentConfigFromAgentSpec}. */
export interface AgentSpecImportOptions {
  /**
   * Environment that resolves secret references (MCP env and header values,
   * webhook secrets). Default: empty, so every secret is reported missing.
   * {@link loadAgentFile} passes `process.env`.
   */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Options for {@link loadAgentFile}. */
export interface AgentFileLoadOptions {
  /** Environment for secret references. Default: `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** The result of reading an agent file or an Agent Spec document. */
export interface AgentSpecImport {
  /** The agent, ready for `agentConfigToBuilder` or `createAgent`. */
  readonly config: AgentConfig;
  /** `"agent-spec"` for an Agent Spec document, `"agent-config"` for plain `AgentConfig` JSON. */
  readonly format: "agent-spec" | "agent-config";
  /**
   * Tools the file declares (`ServerTool` / `ClientTool`) but cannot carry:
   * the caller must register an implementation for each name, or fail naming
   * the missing ones.
   */
  readonly requiredTools: ReadonlyArray<string>;
  /** Environment variable names (or `$component_ref` ids) for secrets that did not resolve. Their fields are left out. */
  readonly missingSecrets: ReadonlyArray<string>;
  /** Standard fields that were present but have no `AgentConfig` home, so they had no effect. */
  readonly ignored: ReadonlyArray<string>;
  /** `llm_config.url`, when set. `AgentConfig` has no endpoint field; apply it yourself (for Ollama, `OLLAMA_ENDPOINT`). */
  readonly llmUrl?: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const slug = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "agent";

const envMarker = (name: string): { readonly $env: string } => ({ $env: name });

const invalid = (message: string, cause?: unknown): AgentSpecError =>
  new AgentSpecError({ reason: "invalid-document", message, cause });

const unsupported = (message: string): AgentSpecError =>
  new AgentSpecError({ reason: "unsupported-component", message });

/** Portable persona text appended to `system_prompt`, so other runtimes see it. */
const personaText = (p: PersonaConfig): string =>
  [
    p.name && `Name: ${p.name}`,
    p.role && `Role: ${p.role}`,
    p.background && `Background: ${p.background}`,
    p.instructions && `Instructions: ${p.instructions}`,
    p.tone && `Tone: ${p.tone}`,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");

const composeSystemPrompt = (systemPrompt: string | undefined, persona: PersonaConfig | undefined): string =>
  [systemPrompt, persona ? personaText(persona) : undefined].filter((s): s is string => !!s).join("\n\n");

/** Inverse of {@link composeSystemPrompt}; an edited prompt is taken verbatim. */
const splitSystemPrompt = (prompt: string, persona: PersonaConfig | undefined): string | undefined => {
  const text = persona ? personaText(persona) : "";
  if (text && prompt === text) return undefined;
  if (text && prompt.endsWith(`\n\n${text}`)) return prompt.slice(0, -(text.length + 2));
  return prompt || undefined;
};

/** Redact one top-level config value; the hint names the secret like `agentConfigToSource` does. */
const redactConfigValue = (key: string, value: unknown): unknown =>
  key === "outputSchema" ? value : (redactSecrets({ [key]: value }, [key === "mcpServers" ? "MCP" : key], envMarker) as Record<string, unknown>)[key];

/** Replace `{ $env }` markers from `env`; unresolved ones are dropped and recorded. */
const resolveSecrets = (value: unknown, env: AgentSpecImportOptions["env"], missing: string[]): unknown => {
  if (Array.isArray(value)) return value.map((v) => resolveSecrets(v, env, missing)).filter((v) => v !== undefined);
  if (!isRecord(value)) return value;
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === "$env" && typeof value["$env"] === "string") {
    const resolved = env?.[value["$env"]];
    if (resolved === undefined) missing.push(value["$env"]);
    return resolved;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const r = resolveSecrets(v, env, missing);
    if (r !== undefined) out[k] = r;
  }
  return out;
};

/**
 * Inline `$component_ref` references from every `$referenced_components` map in
 * the document. Unknown ids (sensitive-field references) are left in place.
 */
const inlineReferences = (doc: Record<string, unknown>): unknown => {
  const registry = new Map<string, unknown>();
  const collect = (v: unknown): void => {
    if (Array.isArray(v)) return v.forEach(collect);
    if (!isRecord(v)) return;
    const refs = v["$referenced_components"];
    if (isRecord(refs)) for (const [id, c] of Object.entries(refs)) registry.set(id, c);
    Object.values(v).forEach(collect);
  };
  collect(doc);
  const inline = (v: unknown, seen: ReadonlySet<string>): unknown => {
    if (Array.isArray(v)) return v.map((x) => inline(x, seen));
    if (!isRecord(v)) return v;
    const ref = v["$component_ref"];
    if (typeof ref === "string" && registry.has(ref) && !seen.has(ref)) {
      return inline(registry.get(ref), new Set([...seen, ref]));
    }
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (k !== "$referenced_components") out[k] = inline(x, seen);
    return out;
  };
  return inline(doc, new Set());
};

const parseVersion = (v: string): readonly number[] | undefined =>
  /^\d+\.\d+\.\d+$/.test(v) ? v.split(".").map(Number) : undefined;

const versionNewer = (a: readonly number[], b: readonly number[]): boolean => {
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return false;
};

// ─── Export: AgentConfig -> Agent Spec ────────────────────────────────────────

const llmConfigFor = (config: AgentConfig, agentSpecId: string, url: string | undefined): LlmConfigDoc => {
  const id = `${agentSpecId}-llm`;
  const generation =
    config.temperature !== undefined || config.maxTokens !== undefined
      ? {
          ...(config.maxTokens !== undefined ? { max_tokens: config.maxTokens } : {}),
          ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
        }
      : null;
  const base = {
    id,
    name: config.model ?? config.provider,
    description: null,
    metadata: {},
    model_id: config.model ?? "",
    default_generation_parameters: generation,
    ...(url !== undefined ? { url } : {}),
  };
  const apiKey = KEYLESS_PROVIDERS.has(config.provider) ? null : { $component_ref: `${id}.api_key` };
  switch (config.provider) {
    case "ollama":
      return { component_type: "OllamaConfig", ...base, url: url ?? DEFAULT_OLLAMA_URL };
    case "openai":
      return { component_type: "OpenAiConfig", ...base, api_key: apiKey };
    case "gemini": {
      const authId = `${id}-auth`;
      const auth = { component_type: "GeminiAIStudioAuthConfig", id: authId, name: authId, description: null, metadata: {}, api_key: { $component_ref: `${authId}.api_key` } };
      return { component_type: "GeminiConfig", ...base, auth };
    }
    default:
      return { component_type: "LlmConfig", ...base, provider: config.provider, api_key: apiKey };
  }
};

/** An MCP server as an `MCPToolBox`, or `undefined` when it has no standard transport. */
const toolBoxFor = (server: McpServer): ToolBoxDoc | undefined => {
  const transport = server.transport ?? (server.command ? "stdio" : undefined);
  if (transport !== "stdio" && transport !== "sse" && transport !== "streamable-http") return undefined;
  if (transport === "stdio" ? !server.command : !server.endpoint) return undefined;
  const id = `mcp-${slug(server.name)}`;
  const transportId = `${id}-transport`;
  const redacted = redactSecrets(server, ["MCP"], envMarker) as Record<string, unknown>;
  const { name: _n, transport: _t, command: _c, args: _a, cwd: _w, endpoint: _e, ...extra } = redacted;
  const common = { component_type: TRANSPORT_TYPES[transport], id: transportId, name: transportId, description: null, metadata: {} };
  const clientTransport: TransportDoc =
    transport === "stdio"
      ? { ...common, command: server.command ?? "", args: server.args ?? [], env: null, cwd: server.cwd ?? null }
      : {
          ...common,
          url: server.endpoint ?? "",
          headers: null,
          sensitive_headers: server.headers && Object.keys(server.headers).length > 0 ? { $component_ref: `${transportId}.sensitive_headers` } : null,
        };
  const raBlock = {
    schemaVersion: AGENT_SPEC_METADATA_VERSION,
    ...(Object.keys(extra).length > 0 ? { server: extra } : {}),
    ...(server.transport === undefined ? { transportOmitted: true } : {}),
  };
  return {
    component_type: "MCPToolBox",
    id,
    name: server.name,
    description: null,
    metadata: { [AGENT_SPEC_METADATA_KEY]: raBlock },
    client_transport: clientTransport,
    tool_filter: null,
    requires_confirmation: false,
  };
};

/**
 * Convert an `AgentConfig` to an Open Agent Spec `Agent` document (version 26.1.2).
 *
 * Portable fields go to their standard Agent Spec places, so another Agent Spec
 * runtime can read the core agent. Reactive Agents-only settings go under
 * `metadata["reactive-agents"] = { schemaVersion: 1, config }`.
 * `agentConfigFromAgentSpec` reverses it.
 *
 * Secrets are never written: API keys and MCP header values become
 * `$component_ref` references, and env / header / `apiKey` / `secret` /
 * `password` values become `{ "$env": "NAME" }` markers that the importer
 * resolves from the environment. MCP servers without a standard transport
 * (websocket, or an endpoint with no `transport`) stay in the metadata.
 *
 * @param config - The agent to export.
 * @param options - Code tools to declare and the LLM endpoint; see {@link AgentSpecExportOptions}.
 * @returns The Agent Spec document. Write it with `JSON.stringify(doc, null, 2)`.
 *
 * @example
 * ```typescript
 * const doc = agentConfigToAgentSpec({ name: "helper", provider: "ollama", model: "qwen3:4b" });
 * await Bun.write("helper.agent.json", JSON.stringify(doc, null, 2));
 * ```
 */
export function agentConfigToAgentSpec(config: AgentConfig, options: AgentSpecExportOptions = {}): AgentSpecAgent {
  const { name, agentId, systemPrompt, provider: _p, model: _m, temperature: _t, maxTokens: _k, mcpServers, userInteraction, ...rest } = config;
  const id = agentId ?? slug(name);
  const servers = mcpServers ?? [];
  const toolboxes: ToolBoxDoc[] = [];
  const unmappedServers: McpServer[] = [];
  for (const server of servers) {
    const box = toolBoxFor(server);
    if (box) toolboxes.push(box);
    else unmappedServers.push(server);
  }
  const extra: Record<string, unknown> = { ...rest };
  if (unmappedServers.length > 0) extra["mcpServers"] = unmappedServers;
  if (userInteraction !== undefined && userInteraction !== true) extra["userInteraction"] = userInteraction;
  const raConfig: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) if (v !== undefined) raConfig[k] = redactConfigValue(k, v);

  const confirm = new Set(config.approvalPolicy?.tools ?? []);
  const tools = (options.tools ?? []).map((t) => ({
    component_type: "ServerTool",
    id: `tool-${slug(t.name)}`,
    name: t.name,
    description: t.description ?? null,
    metadata: {},
    inputs: [...(t.inputs ?? [])],
    outputs: [],
    requires_confirmation: confirm.has(t.name),
  }));

  return {
    component_type: "Agent",
    id,
    name,
    description: null,
    metadata: {
      [AGENT_SPEC_METADATA_KEY]: {
        schemaVersion: AGENT_SPEC_METADATA_VERSION,
        config: raConfig,
        ...(agentId === undefined ? { generatedId: true } : {}),
      },
    },
    inputs: [],
    outputs: [],
    system_prompt: composeSystemPrompt(systemPrompt, config.persona),
    llm_config: llmConfigFor(config, id, options.llmUrl),
    tools,
    toolboxes,
    human_in_the_loop: userInteraction !== undefined && userInteraction !== false,
    agentspec_version: AGENT_SPEC_VERSION,
  };
}

// ─── Import: Agent Spec -> AgentConfig ────────────────────────────────────────

const providerFor = (llm: LlmConfigDoc): Either.Either<AgentConfig["provider"], AgentSpecError> => {
  switch (llm.component_type) {
    case "OllamaConfig":
      return Either.right("ollama");
    case "OpenAiConfig":
      return Either.right("openai");
    case "GeminiConfig":
      return Either.right("gemini");
    case "LlmConfig": {
      const p = llm.provider === "google" ? "gemini" : llm.provider;
      return Schema.is(ProviderNameSchema)(p)
        ? Either.right(p)
        : Either.left(unsupported(`llm_config provider "${String(p)}" is not a Reactive Agents provider`));
    }
    default:
      return Either.left(unsupported(`llm_config component_type "${llm.component_type}" is not supported`));
  }
};

const raBlockOf = (metadata: Readonly<Record<string, unknown>> | null | undefined): unknown =>
  metadata?.[AGENT_SPEC_METADATA_KEY];

const decodeRaBlock = <A, I>(
  schema: Schema.Schema<A, I>,
  raw: unknown,
  where: string,
): Either.Either<A | undefined, AgentSpecError> => {
  if (raw === undefined) return Either.right(undefined);
  const decoded = Schema.decodeUnknownEither(schema)(raw);
  if (Either.isLeft(decoded)) return Either.left(invalid(`${where} metadata["${AGENT_SPEC_METADATA_KEY}"] is invalid`, decoded.left));
  const version = (decoded.right as { readonly schemaVersion: number }).schemaVersion;
  if (version !== AGENT_SPEC_METADATA_VERSION) {
    return Either.left(
      new AgentSpecError({
        reason: "unsupported-version",
        message: `${where} metadata["${AGENT_SPEC_METADATA_KEY}"].schemaVersion ${version} is not supported (this reader knows ${AGENT_SPEC_METADATA_VERSION})`,
      }),
    );
  }
  return Either.right(decoded.right);
};

const serverFor = (
  box: ToolBoxDoc,
  env: AgentSpecImportOptions["env"],
  missing: string[],
  ignored: string[],
): Either.Either<Record<string, unknown>, AgentSpecError> =>
  Either.gen(function* () {
    if (box.component_type !== "MCPToolBox") return yield* Either.left(unsupported(`toolbox component_type "${box.component_type}" is not supported`));
    if (box.tool_filter && box.tool_filter.length > 0) {
      return yield* Either.left(unsupported(`toolbox "${box.name}": tool_filter is not supported yet`));
    }
    const t = box.client_transport;
    const transport = (Object.keys(TRANSPORT_TYPES) as Array<keyof typeof TRANSPORT_TYPES>).find((k) => TRANSPORT_TYPES[k] === t.component_type);
    if (!transport) return yield* Either.left(unsupported(`toolbox "${box.name}": transport "${t.component_type}" is not supported`));
    if (t.auth !== undefined && t.auth !== null) ignored.push(`toolboxes[${box.name}].client_transport.auth`);
    const ra = yield* decodeRaBlock(RaToolBoxMetadataSchema, raBlockOf(box.metadata), `toolbox "${box.name}"`);
    const extra = (resolveSecrets(ra?.server ?? {}, env, missing) as Record<string, unknown>);
    const sensitive = t.sensitive_headers;
    if (sensitive && "$component_ref" in sensitive && !isRecord(extra["headers"])) missing.push(String(sensitive.$component_ref));
    const env_ = { ...(isRecord(extra["env"]) ? extra["env"] : {}), ...(t.env ?? {}) };
    const headers = {
      ...(isRecord(extra["headers"]) ? extra["headers"] : {}),
      ...(t.headers ?? {}),
      ...(sensitive && !("$component_ref" in sensitive) ? sensitive : {}),
    };
    const { env: _e, headers: _h, ...rest } = extra;
    return {
      name: box.name,
      ...(ra?.transportOmitted && transport === "stdio" ? {} : { transport }),
      ...(transport === "stdio"
        ? { command: t.command, ...(t.args && t.args.length > 0 ? { args: t.args } : {}), ...(t.cwd ? { cwd: t.cwd } : {}) }
        : { endpoint: t.url }),
      ...(Object.keys(env_).length > 0 ? { env: env_ } : {}),
      ...(Object.keys(headers).length > 0 ? { headers } : {}),
      ...rest,
    };
  });

/**
 * Convert an Open Agent Spec `Agent` document to an `AgentConfig`.
 *
 * Standard fields win: the metadata block only fills fields with no standard
 * home. References in `$referenced_components` are inlined. Secrets resolve
 * from `options.env`; unresolved ones are left out and listed in
 * `missingSecrets`. A literal `api_key` is never copied (Reactive Agents reads
 * provider keys from its own environment variables).
 *
 * Fails with {@link AgentSpecError}: a non-`Agent` root (`Flow`, ...) or an
 * unmapped tool / toolbox / transport / LLM type is `unsupported-component`; an
 * `agentspec_version` newer than {@link AGENT_SPEC_MAX_READ_VERSION} or an
 * unknown metadata `schemaVersion` is `unsupported-version`; anything else that
 * does not decode is `invalid-document`.
 *
 * @param doc - Parsed Agent Spec document (JSON value).
 * @param options - Environment for secret references; see {@link AgentSpecImportOptions}.
 * @returns The config plus the tools the caller must provide and what did not carry over.
 */
export const agentConfigFromAgentSpec = (
  doc: unknown,
  options: AgentSpecImportOptions = {},
): Effect.Effect<AgentSpecImport, AgentSpecError> =>
  Either.gen(function* () {
    if (!isRecord(doc)) return yield* Either.left(invalid("an Agent Spec document must be a JSON object"));
    const root = inlineReferences(doc) as Record<string, unknown>;
    const type = root["component_type"];
    if (type !== "Agent") {
      return yield* Either.left(unsupported(`Agent Spec root component_type "${String(type)}" is not supported yet; only an Agent root loads`));
    }
    const version = root["agentspec_version"];
    if (version !== undefined) {
      const parsed = typeof version === "string" ? parseVersion(version) : undefined;
      if (!parsed) return yield* Either.left(invalid(`agentspec_version "${String(version)}" is not YEAR.QUARTER.PATCH`));
      if (versionNewer(parsed, parseVersion(AGENT_SPEC_MAX_READ_VERSION) ?? [])) {
        return yield* Either.left(
          new AgentSpecError({
            reason: "unsupported-version",
            message: `agentspec_version ${version} is newer than this reader supports (${AGENT_SPEC_MAX_READ_VERSION})`,
          }),
        );
      }
    }
    const decoded = Schema.decodeUnknownEither(AgentSpecAgentSchema)(root);
    if (Either.isLeft(decoded)) return yield* Either.left(invalid("the Agent document does not match Agent Spec", decoded.left));
    const agent = decoded.right;
    const missing: string[] = [];
    const ignored: string[] = [];

    const ra = yield* decodeRaBlock(RaAgentMetadataSchema, raBlockOf(agent.metadata), "Agent");
    const raConfig = resolveSecrets(ra?.config ?? {}, options.env, missing) as Record<string, unknown>;

    const llm = agent.llm_config;
    const provider = yield* providerFor(llm);
    if (typeof llm.api_key === "string" && llm.api_key) ignored.push("llm_config.api_key (literal key not imported)");
    if (llm.retry_policy !== undefined && llm.retry_policy !== null) ignored.push("llm_config.retry_policy");
    const gen = llm.default_generation_parameters;
    if (gen?.top_p !== undefined && gen.top_p !== null) ignored.push("llm_config.default_generation_parameters.top_p");

    const requiredTools: string[] = [];
    const confirm: string[] = [];
    for (const tool of agent.tools ?? []) {
      if (tool.component_type !== "ServerTool" && tool.component_type !== "ClientTool") {
        return yield* Either.left(unsupported(`tool "${tool.name}": component_type "${tool.component_type}" is not supported`));
      }
      requiredTools.push(tool.name);
      if (tool.requires_confirmation) confirm.push(tool.name);
    }

    const servers: Record<string, unknown>[] = [];
    for (const box of agent.toolboxes ?? []) servers.push(yield* serverFor(box, options.env, missing, ignored));
    const metaServers = Array.isArray(raConfig["mcpServers"]) ? raConfig["mcpServers"] : [];
    const allServers = [...servers, ...metaServers];

    for (const field of ["inputs", "outputs", "transforms"] as const) if ((agent[field] ?? []).length > 0) ignored.push(field);
    if (agent.description) ignored.push("description");

    const persona = isRecord(raConfig["persona"]) ? (raConfig["persona"] as PersonaConfig) : undefined;
    const hitl = agent.human_in_the_loop ?? true;
    const metaUi = raConfig["userInteraction"];
    const userInteraction = hitl ? (isRecord(metaUi) ? metaUi : true) : metaUi === false ? false : undefined;
    const approval = isRecord(raConfig["approvalPolicy"]) ? raConfig["approvalPolicy"] : undefined;
    const approvalTools = Array.isArray(approval?.["tools"]) ? (approval["tools"] as unknown[]) : [];
    const mergedApproval =
      confirm.length > 0 ? { ...approval, tools: [...approvalTools, ...confirm.filter((n) => !approvalTools.includes(n))] } : approval;
    const generatedId = ra?.generatedId === true;

    const candidate: Record<string, unknown> = {
      ...raConfig,
      name: agent.name,
      ...(generatedId ? {} : { agentId: agent.id }),
      provider,
      ...(llm.model_id ? { model: llm.model_id } : {}),
      ...(splitSystemPrompt(agent.system_prompt, persona) !== undefined ? { systemPrompt: splitSystemPrompt(agent.system_prompt, persona) } : {}),
      ...(typeof gen?.temperature === "number" ? { temperature: gen.temperature } : {}),
      ...(typeof gen?.max_tokens === "number" ? { maxTokens: gen.max_tokens } : {}),
      ...(allServers.length > 0 ? { mcpServers: allServers } : {}),
      ...(mergedApproval ? { approvalPolicy: mergedApproval } : {}),
      ...(userInteraction !== undefined ? { userInteraction } : {}),
    };
    if (userInteraction === undefined) delete candidate["userInteraction"];
    if (allServers.length === 0) delete candidate["mcpServers"];
    if (!mergedApproval) delete candidate["approvalPolicy"];
    const config = Schema.decodeUnknownEither(AgentConfigSchema)(candidate);
    if (Either.isLeft(config)) return yield* Either.left(invalid("the document does not describe a valid AgentConfig", config.left));
    return {
      config: config.right,
      format: "agent-spec" as const,
      requiredTools,
      missingSecrets: missing,
      ignored,
      ...(llm.url ? { llmUrl: llm.url } : {}),
    };
  });

// ─── File loading ─────────────────────────────────────────────────────────────

/**
 * Read an agent file: an Open Agent Spec `Agent` document or a plain
 * `AgentConfig` JSON (today's `agentConfigToJSON` output). A document with a
 * `component_type` is read as Agent Spec; anything else as `AgentConfig`.
 *
 * JSON only: YAML files fail with `unsupported-format` (no YAML parser is a
 * runtime dependency). Secrets resolve from `options.env`, default
 * `process.env`.
 *
 * @param path - Path of the `.json` agent file.
 * @param options - Environment for secret references; see {@link AgentFileLoadOptions}.
 * @returns The config, the code tools the caller must provide (`requiredTools`), and what did not carry over.
 *
 * @example
 * ```typescript
 * const loaded = await Effect.runPromise(loadAgentFile("./helper.agent.json"));
 * const missing = loaded.requiredTools.filter((n) => !myTools.has(n));
 * if (missing.length > 0) console.error(`agent file needs tools: ${missing.join(", ")}`);
 * const builder = await agentConfigToBuilder(loaded.config);
 * ```
 */
export const loadAgentFile = (
  path: string,
  options: AgentFileLoadOptions = {},
): Effect.Effect<AgentSpecImport, AgentSpecError | AgentFileReadError> =>
  Effect.gen(function* () {
    if (/\.ya?ml$/i.test(path)) {
      return yield* new AgentSpecError({
        reason: "unsupported-format",
        message: `${path}: YAML agent files are not supported yet; save the document as JSON`,
      });
    }
    const text = yield* Effect.tryPromise({
      try: () => readFile(path, "utf8"),
      catch: (cause) => new AgentFileReadError({ message: `cannot read agent file ${path}`, path, cause }),
    });
    const raw = yield* Effect.try({
      try: (): unknown => JSON.parse(text),
      catch: (cause) => invalid(`${path} is not valid JSON`, cause),
    });
    if (isRecord(raw) && "component_type" in raw) {
      return yield* agentConfigFromAgentSpec(raw, { env: options.env ?? process.env });
    }
    const config = Schema.decodeUnknownEither(AgentConfigSchema)(raw);
    if (Either.isLeft(config)) return yield* invalid(`${path} is neither an Agent Spec document nor a valid AgentConfig`, config.left);
    return { config: config.right, format: "agent-config" as const, requiredTools: [], missingSecrets: [], ignored: [] };
  });
