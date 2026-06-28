// Run: bun test packages/runtime/tests/config-serialization-drift.test.ts --timeout 15000
//
// DYNAMIC ANTI-DRIFT GUARD for the "agent as data" serialization roundtrip.
//
// The serializable AgentConfig must stay in sync across THREE places:
//   1. AgentConfigSchema          (src/agent-config.ts)     — the data shape
//   2. serializeBuilder()         (src/builder/to-config.ts) — builder -> config
//   3. agentConfigToBuilder()     (src/agent-config.ts)     — config -> builder
//
// Historically these drifted: schema + deserializer gained fields (grounding,
// fabricationGuard, stallPolicy, taskContext, focusedTools, auditRationale,
// outputSchemaOptions) but serializeBuilder() was never updated, so toConfig()
// silently dropped them. The `this as unknown as ...` cast in builder.toConfig()
// hid the gap from the type-checker.
//
// This test makes that drift IMPOSSIBLE to merge silently. It reads the schema
// at runtime, enumerates every leaf field, and:
//   - COVERAGE: asserts a MAXIMAL_CONFIG fixture sets every schema leaf. Adding
//     a field to the schema fails this test until the fixture is updated.
//   - ROUNDTRIP: asserts config -> builder -> toConfig() drops no leaf. A missing
//     serializer or deserializer branch fails this test.
//
// To add a new config field in the future: add it to the schema, set it in
// MAXIMAL_CONFIG, and wire serializeBuilder + agentConfigToBuilder. The test
// tells you exactly which step you forgot.
import { SchemaAST } from "effect";
import { describe, it, expect } from "bun:test";
import {
  AgentConfigSchema,
  agentConfigToBuilder,
  agentConfigToJSON,
  type AgentConfig,
} from "../src/agent-config.js";

// ─── Leaf paths that intentionally do NOT survive a full config->builder->config
//     roundtrip. Every entry MUST carry a documented reason. This set is the
//     single reviewed seam where "this field can't be pure data" is declared.
const NON_BUILDER_ROUNDTRIP = new Set<string>([
  // The schema OBJECT cannot be expressed as JSON; `.withOutputSchema(schema)`
  // must be called in code. These behavioural options serialize OUT (toConfig
  // preserves them) but cannot be re-applied to a builder without the schema
  // object, so they drop on the config->builder leg. Partial-roundtrip by design.
  "outputSchemaOptions.mode",
  "outputSchemaOptions.onParseFail",
  "outputSchemaOptions.abstainBelow",
]);

// Builder methods deliberately NOT represented as data, and why. Documented so
// "should this be config?" is a conscious, reviewed decision rather than drift:
//   - Functions/callbacks: withHook, withErrorHandler, withOutputValidator,
//     withVerificationStep, withProgressCheckpoint, withCustomTermination,
//     withHarness, withLayers, withEvents — not JSON-expressible.
//   - withOutputSchema: the SCHEMA OBJECT is not JSON (options DO serialize; see
//     NON_BUILDER_ROUNDTRIP above).
//   - Profile switches with cross-field side effects: withLeanHarness (force-
//     disables memory + strategy switching), withProfile, withContextProfile —
//     not orthogonal data; serializing them alongside the fields they mutate
//     would produce contradictory configs.
//   - Runtime/secrets/integration: withEnvironment (secrets), withChannels,
//     withCortex, withTracing, withTelemetry, withApprovalPolicy (carries a
//     predicate), withCalibration (runtime-probed), withDocuments (ingestion
//     side-effect), withRemoteAgent, withDynamicSubAgents, withMetaTools,
//     withSkills (code-only registries).
// When promoting one of these to data: add it to the schema + MAXIMAL_CONFIG +
// serializeBuilder + agentConfigToBuilder, and this guard will verify it.

// ─── Top-level subtrees the serializer stores/emits as opaque objects (whole-
//     object passthrough, no field-by-field mapping). Field-level drift inside
//     them is impossible by construction, so the leaf walker treats them as a
//     single leaf and the roundtrip checks them by deep object equality.
const PASSTHROUGH_SUBTREES = new Set<string>([
  "persona",
  "gateway",
  "logging",
  "fallbacks",
  "mcpServers",
  "pricingRegistry",
  "taskContext",
  "reactiveIntelligence",
]);

// ─── AST helpers ───────────────────────────────────────────────────────────

function unwrap(ast: SchemaAST.AST): SchemaAST.AST {
  let cur = ast;
  for (;;) {
    if (cur._tag === "Refinement") cur = cur.from;
    else if (cur._tag === "Transformation") cur = cur.to;
    else if (cur._tag === "Suspend") cur = cur.f();
    else return cur;
  }
}

/** Enumerate every leaf key-path of a Schema struct AST (dot-delimited). */
function leafPaths(ast: SchemaAST.AST, prefix = ""): string[] {
  const node = unwrap(ast);

  if (node._tag === "TypeLiteral" && !PASSTHROUGH_SUBTREES.has(prefix)) {
    return node.propertySignatures.flatMap((p) =>
      leafPaths(p.type, prefix ? `${prefix}.${String(p.name)}` : String(p.name)),
    );
  }

  if (node._tag === "Union" && !PASSTHROUGH_SUBTREES.has(prefix)) {
    const structs = node.types
      .map(unwrap)
      .filter((t): t is SchemaAST.TypeLiteral => t._tag === "TypeLiteral");
    if (structs.length === 1) return leafPaths(structs[0], prefix);
  }

  return [prefix];
}

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

// ─── MAXIMAL fixture: every schema leaf set to a non-default sentinel value ──
//     Keep this in sync with AgentConfigSchema. The COVERAGE test fails loudly
//     if a schema field is missing here.
const MAXIMAL_CONFIG: AgentConfig = {
  name: "drift-guard-agent",
  agentId: "drift-guard-stable-id",
  provider: "anthropic",
  model: "claude-opus-4-8",
  systemPrompt: "You are a serialization drift sentinel.",
  persona: {
    name: "Sentinel",
    role: "auditor",
    background: "config integrity",
    instructions: "drop nothing",
    tone: "terse",
  },
  reasoning: {
    defaultStrategy: "plan-execute-reflect",
    enableStrategySwitching: true,
    maxStrategySwitches: 3,
    fallbackStrategy: "reactive",
    auditRationale: true,
  },
  tools: {
    allowedTools: ["file-read", "file-write"],
    focusedTools: ["file-read"],
    adaptive: true,
    terminal: true,
  },
  guardrails: {
    injection: true,
    pii: true,
    toxicity: true,
    customBlocklist: ["forbidden-term"],
  },
  memory: {
    tier: "enhanced",
    dbPath: "/tmp/drift-guard.db",
    maxEntries: 500,
    capacity: 1000,
    evictionPolicy: "importance",
    retainDays: 30,
    importanceThreshold: 0.7,
    experienceLearning: true,
    memoryConsolidation: true,
  },
  observability: {
    verbosity: "verbose",
    live: true,
    file: "/tmp/drift-guard.log",
    logModelIO: true,
  },
  costTracking: {
    perRequest: 0.5,
    perSession: 5,
    daily: 50,
    monthly: 500,
  },
  execution: {
    maxIterations: 12,
    minIterations: 2,
    timeoutMs: 60_000,
    retryPolicy: { maxRetries: 3, backoffMs: 250 },
    cacheTimeoutMs: 30_000,
    strictValidation: true,
  },
  gateway: {
    timezone: "UTC",
    crons: [{ schedule: "0 9 * * *", instruction: "daily check" }],
    persistMemoryAcrossRuns: true,
    port: 8787,
  },
  mcpServers: [
    { name: "fs", transport: "stdio", command: "mcp-fs", args: ["--root", "/"] },
  ],
  reactiveIntelligence: { enabled: true },
  logging: { level: "info", format: "json", output: "console" },
  fallbacks: {
    providers: ["openai"],
    models: ["gpt-4o"],
    errorThreshold: 3,
  },
  verification: {
    semanticEntropy: true,
    factDecomposition: true,
    multiSource: true,
    selfConsistency: true,
    nli: true,
    hallucinationDetection: true,
    hallucinationThreshold: 0.8,
    passThreshold: 0.9,
    riskThreshold: 0.3,
  },
  grounding: { mode: "warn", tolerance: 0.05, maxRetries: 2 },
  fabricationGuard: "warn",
  stallPolicy: { ignoredNudgeTolerance: 1, escalateNudgeContent: true },
  outputSchemaOptions: { mode: "grounded", onParseFail: "throw", abstainBelow: 0.4 },
  requiredTools: { tools: ["file-write"], adaptive: true, maxRetries: 2 },
  budget: { tokenLimit: 100_000, costLimit: 5, warningRatio: 0.75 },
  circuitBreaker: { failureThreshold: 4, cooldownMs: 20_000, halfOpenRequests: 2 },
  rateLimiting: { requestsPerMinute: 30, tokensPerMinute: 50_000, maxConcurrent: 5 },
  skillPersistence: true,
  durableRuns: { dir: "/tmp/drift-guard-runs", checkpointEvery: 2 },
  thinking: true,
  temperature: 0.2,
  maxTokens: 4096,
  numCtx: 32_768,
  features: {
    guardrails: true,
    verification: true,
    costTracking: true,
    reasoning: true,
    tools: true,
    memory: true,
    observability: true,
    identity: true,
    interaction: true,
    prompts: true,
    orchestration: true,
    killSwitch: true,
    audit: true,
    selfImprovement: true,
    healthCheck: true,
    reactiveIntelligence: true,
    streaming: true,
  },
  pricingRegistry: { "claude-opus-4-8": { input: 15, output: 75 } },
  taskContext: { project: "acme", environment: "staging" },
};

describe("config serialization drift guard", () => {
  it("MAXIMAL_CONFIG sets every schema leaf (coverage)", () => {
    const paths = leafPaths(AgentConfigSchema.ast);
    const missing = paths.filter((p) => getPath(MAXIMAL_CONFIG, p) === undefined);
    expect(missing).toEqual([]);
  });

  it("MAXIMAL_CONFIG validates against the schema", () => {
    expect(() => agentConfigToJSON(MAXIMAL_CONFIG)).not.toThrow();
  });

  it("config -> builder -> toConfig() drops no leaf (roundtrip)", async () => {
    const builder = await agentConfigToBuilder(MAXIMAL_CONFIG);
    const out = builder.toConfig();

    const paths = leafPaths(AgentConfigSchema.ast);
    const dropped: Array<{ path: string; want: unknown; got: unknown }> = [];
    for (const path of paths) {
      if (NON_BUILDER_ROUNDTRIP.has(path)) continue;
      const want = getPath(MAXIMAL_CONFIG, path);
      if (want === undefined) continue;
      const got = getPath(out, path);
      try {
        expect(got).toEqual(want as never);
      } catch {
        dropped.push({ path, want, got });
      }
    }
    expect(dropped).toEqual([]);
  }, 15000);
});
