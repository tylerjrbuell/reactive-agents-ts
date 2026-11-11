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
  agentConfigFromJSON,
  type AgentConfig,
} from "../src/agent-config.js";
import { HarnessConfigSchema } from "../src/harness-schema.js";
import type { HarnessConfig } from "@reactive-agents/reasoning";
import { MAXIMAL_CONFIG } from "./fixtures/maximal-agent-config.js";

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
  // `profile` (Q6) is a cross-field baseline patch, not orthogonal data: it
  // mutates memory/RI/verifier/strategy-switching/skill-persistence toggles via
  // `.withProfile()`. `toConfig()` re-emits the fields it changed, never
  // `profile` itself — so it round-trips as its effects, not as a literal key.
  "profile",
]);

// Builder methods deliberately NOT represented as data, and why. Documented so
// "should this be config?" is a conscious, reviewed decision rather than drift:
//   - Functions/callbacks: withHook, withErrorHandler, withOutputValidator,
//     withVerificationStep, withCustomTermination, withLayers, withEvents —
//     not JSON-expressible.
//   - withHarness has TWO overloads: `(fn: Harness => void)` (pipeline
//     composition, not JSON-expressible — the alias `compose()` is the same
//     path) and `(config: HarnessConfig)` (plain data — merges into
//     `reasoning.harness` and IS covered by this drift guard below).
//   - withOutputSchema: the SCHEMA OBJECT is not JSON (options DO serialize; see
//     NON_BUILDER_ROUNDTRIP above).
//   - Profile switches with cross-field side effects: withLeanHarness (force-
//     disables memory + strategy switching), withProfile, withContextProfile —
//     not orthogonal data; serializing them alongside the fields they mutate
//     would produce contradictory configs.
//   - Runtime/secrets/integration: withEnvironment (secrets), withChannels,
//     withCortex, withTracing, withTelemetry, withCalibration (runtime-probed).
//   - Partly code-only: withApprovalPolicy (requireFor/onApprove), withDocuments
//     (shared `store`), withAgentTool (`agent.parameters`), withTools terminal
//     (blockedPatterns/onAudit/dockerEscalation). Their data halves ARE covered.
// When promoting one of these to data: add it to the schema + MAXIMAL_CONFIG +
// serializeBuilder + agentConfigToBuilder, and this guard will verify it.

// ─── Top-level subtrees the serializer stores/emits as opaque objects (whole-
//     object passthrough, no field-by-field mapping). Field-level drift inside
//     them is impossible by construction, so the leaf walker treats them as a
//     single leaf and the roundtrip checks them by deep object equality.
const PASSTHROUGH_SUBTREES = new Set<string>([
  "persona",
  // gateway is NO LONGER a passthrough (P4/G12): accessControl is now in the
  // schema, so gateway is walked field-by-field for drift protection.
  "logging",
  "fallbacks",
  "mcpServers",
  "pricingRegistry",
  "taskContext",
  "reactiveIntelligence",
  // Observability fan-out (P3/G8/G11): the serializer emits these as opaque
  // objects copied verbatim from the raw ObservabilityOptions, so field drift
  // inside them is impossible by construction — check by deep object equality.
  "observability.cortex",
  "observability.tracing",
  "observability.telemetry",
  "observability.logging",
  "observability.costs",
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

// MAXIMAL fixture (every schema leaf set to a non-default sentinel) lives in
// fixtures/maximal-agent-config.ts, shared with config-to-source.test.ts. The
// COVERAGE test fails loudly if a schema field is missing there.

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

// ─── Focused round-trip pins (Mission W-M) ───────────────────────────────────
// Each pin was RED before its schema fix: the field was set on the builder and
// EMITTED by serializeBuilder (or would be), but the schema lacked the key, so
// `agentConfigToBuilder` dropped it on the config->builder leg (and, for P2,
// re-decoding toConfig() output threw). Each is now green.
describe("dual-API schema-completeness round-trip pins", () => {
  it("P2/G10: verification.useLLMTier + onReject round-trip AND toConfig() re-decodes", async () => {
    const cfg: AgentConfig = {
      name: "vpin",
      provider: "anthropic",
      verification: { useLLMTier: true, onReject: "block" },
    };
    const builder = await agentConfigToBuilder(cfg);
    const out = builder.toConfig();
    expect(out.verification?.useLLMTier).toBe(true);
    expect(out.verification?.onReject).toBe("block");
    // Live bug (G10): toConfig() output must survive re-decode. Before the fix
    // the emitted `useLLMTier` was an unknown key and this threw.
    expect(() => agentConfigToJSON(out)).not.toThrow();
  });

  it("P3/G8/G11: withObservability({cortex,tracing,costs}) round-trips through config", async () => {
    const cfg: AgentConfig = {
      name: "opin",
      provider: "anthropic",
      observability: {
        cortex: { url: "http://cortex.local:4321" },
        tracing: { dir: "/tmp/pin-traces" },
        costs: true,
      },
    };
    const builder = await agentConfigToBuilder(cfg);
    const out = builder.toConfig();
    expect(out.observability?.cortex).toEqual({ url: "http://cortex.local:4321" });
    expect(out.observability?.tracing).toEqual({ dir: "/tmp/pin-traces" });
    expect(out.observability?.costs).toBe(true);
    expect(() => agentConfigToJSON(out)).not.toThrow();
  });

  it("withReactiveIntelligence controller options survive builder -> config -> builder", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const builder = ReactiveAgents.create()
      .withName("ripin")
      .withProvider("anthropic")
      .withReactiveIntelligence({
        controller: { earlyStop: false, strategySwitch: true },
        notice: false,
        onControllerDecision: () => {},
      });
    const cfg = builder.toConfig();
    // Hooks are code-only; the data options serialize.
    expect(cfg.reactiveIntelligence).toEqual({
      enabled: true,
      controller: { earlyStop: false, strategySwitch: true },
      notice: false,
    });
    expect(() => agentConfigToJSON(cfg)).not.toThrow();
    const again = (await agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(cfg)))).toConfig();
    expect(again.reactiveIntelligence).toEqual(cfg.reactiveIntelligence);
  });

  it("reactiveIntelligence options without `enabled` still apply", async () => {
    const out = (
      await agentConfigToBuilder({
        name: "ri-noflag",
        provider: "anthropic",
        reactiveIntelligence: { controller: { earlyStop: false } },
      })
    ).toConfig();
    expect(out.reactiveIntelligence?.controller).toEqual({ earlyStop: false });
  });

  it("P4/G12: gateway.accessControl survives JSON decode AND builder round-trip", () => {
    const accessControl = {
      accessPolicy: "allowlist" as const,
      allowedSenders: ["+15550001111"],
      mode: "task" as const,
    };
    // RED before the fix: the schema lacked `accessControl`, so Effect's
    // excess-property stripping silently DROPPED it on decode — a user's config
    // was quietly lost. Post-fix the schema carries it, so it survives.
    const decoded = agentConfigFromJSON(
      JSON.stringify({ name: "gpin", provider: "anthropic", gateway: { accessControl } }),
    );
    expect(decoded.gateway?.accessControl).toEqual(accessControl);
    // And it survives a full config -> builder -> toConfig round-trip.
    const cfg: AgentConfig = { name: "gpin", provider: "anthropic", gateway: { accessControl } };
    return agentConfigToBuilder(cfg).then((builder) => {
      const out = builder.toConfig();
      expect(out.gateway?.accessControl).toEqual(accessControl);
      expect(() => agentConfigToJSON(out)).not.toThrow();
    });
  });

  it("numCtxPolicy survives agentConfigToJSON -> agentConfigFromJSON", () => {
    // RED before the Fix-1 schema addition: numCtxPolicy exists on HarnessConfig
    // (packages/reasoning/src/harness-config.ts) but was absent from
    // HarnessConfigSchema, so Effect's excess-property stripping silently
    // dropped it on JSON decode even though a live `.withHarness()` call works
    // (plain object spread doesn't strip unknown keys).
    const cfg: AgentConfig = {
      name: "numctx-pin",
      provider: "anthropic",
      reasoning: { harness: { numCtxPolicy: "demand" } },
    };
    const json = agentConfigToJSON(cfg);
    const decoded = agentConfigFromJSON(json);
    expect(decoded.reasoning?.harness?.numCtxPolicy).toBe("demand");
  });

  it("withThinking({ effort }) survives toConfig() -> JSON -> agentConfigToBuilder", async () => {
    // RED before the fix: serializeBuilder emitted `thinkingOptions`, a key the
    // schema lacks, so decoding stripped it and the effort was lost.
    const { ReactiveAgents } = await import("../src/builder.js");
    const src = ReactiveAgents.create()
      .withName("think-pin")
      .withProvider("anthropic")
      .withThinking({ effort: "high", budgetTokens: 8_000 });
    const decoded = agentConfigFromJSON(agentConfigToJSON(src.toConfig()));
    expect(decoded.thinking).toEqual({ enabled: true, effort: "high", budgetTokens: 8_000 });
    const rebuilt = (await agentConfigToBuilder(decoded)).toConfig();
    expect(rebuilt.thinking).toEqual({ enabled: true, effort: "high", budgetTokens: 8_000 });
  });

  it("a plain thinking boolean still serializes as a boolean", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const out = ReactiveAgents.create().withName("t").withProvider("anthropic").withThinking().toConfig();
    expect(out.thinking).toBe(true);
  });

  it("data-like builder options round-trip through toConfig() and agentConfigToBuilder", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const src = ReactiveAgents.create()
      .withName("data-pin")
      .withProvider("anthropic")
      .withSkills({ paths: ["./skills"], activate: ["review"], global: true })
      .withMetaTools({ brief: true, recall: true, harnessSkill: { frontier: true, local: "lite" } })
      .withAgentTool("researcher", { name: "Researcher", tools: ["web-search"], maxIterations: 4 })
      .withRemoteAgent("remote", "http://localhost:8000")
      .withDynamicSubAgents({ maxRecursionDepth: 2 })
      .withVerificationStep({ prompt: "Check the answer." })
      .withReasoning({ synthesis: "deep", synthesisModel: "claude-haiku-4-5" })
      .withDocuments([{ source: "notes.md", content: "# Notes" }])
      .withModelRouting({ minTier: "sonnet" })
      .withLlmTimeout(600_000);
    const cfg = agentConfigFromJSON(agentConfigToJSON(src.toConfig()));
    expect(cfg.skills).toEqual({ paths: ["./skills"], activate: ["review"], global: true });
    expect(cfg.metaTools).toEqual({ brief: true, recall: true, harnessSkill: { frontier: true, local: "lite" } });
    expect(cfg.agentTools).toEqual([
      { name: "researcher", agent: { name: "Researcher", tools: ["web-search"], maxIterations: 4 } },
      { name: "remote", remoteUrl: "http://localhost:8000" },
    ]);
    expect(cfg.dynamicSubAgents).toEqual({ maxRecursionDepth: 2 });
    expect(cfg.verificationStep).toEqual({ mode: "reflect", prompt: "Check the answer." });
    expect(cfg.reasoning?.synthesis).toBe("deep");
    expect(cfg.reasoning?.synthesisModel).toBe("claude-haiku-4-5");
    expect(cfg.documents).toEqual([{ source: "notes.md", content: "# Notes" }]);
    expect(cfg.modelRouting).toEqual({ minTier: "sonnet" });
    expect(cfg.execution?.llmTimeoutMs).toBe(600_000);
    const rebuilt = (await agentConfigToBuilder(cfg)).toConfig();
    expect(rebuilt).toEqual(cfg);
  });

  it("withTools({ terminal: {...} }) keeps the shell data options", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const terminal = {
      additionalCommands: ["gh"],
      timeoutMs: 10_000,
      cwd: "/tmp/shell-pin",
      sandbox: "docker" as const,
    };
    const out = ReactiveAgents.create().withName("s").withProvider("anthropic").withTools({ terminal }).toConfig();
    expect(out.tools?.terminal).toEqual(terminal);
    const rebuilt = (await agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(out)))).toConfig();
    expect(rebuilt.tools?.terminal).toEqual(terminal);
  });

  it("reasoning data options (strategies, adaptive, parallelToolCalls, observationSummary) round-trip", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const reasoning = {
      strategies: { reflexion: { maxRetries: 2, selfCritiqueDepth: "shallow" as const } },
      adaptive: { enabled: true, learning: false },
      parallelToolCalls: false,
      observationSummary: "auto" as const,
    };
    const out = ReactiveAgents.create().withName("r").withProvider("anthropic").withReasoning(reasoning).toConfig();
    expect(out.reasoning).toEqual(reasoning);
    const rebuilt = (await agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(out)))).toConfig();
    expect(rebuilt).toEqual(out);
  });
});

// ─── Whole-config round trip, `features` included ────────────────────────────
// toConfig() -> agentConfigToBuilder() -> toConfig() must be the identity. RED
// before the fix: a bare builder serialized its default observability options
// (`{ verbosity: "minimal" }`) while observability was off, and re-applying them
// called .withObservability(), so the reloaded agent gained
// features.observability: true. Disabled reactive intelligence also came back on.
describe("builder -> config -> builder round trip is the identity", () => {
  const roundTrip = async (cfg: AgentConfig): Promise<AgentConfig> =>
    (await agentConfigToBuilder(agentConfigFromJSON(agentConfigToJSON(cfg)))).toConfig();

  it("minimal builder", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const cfg = ReactiveAgents.create().withName("min").withProvider("anthropic").toConfig();
    expect(cfg.observability).toBeUndefined();
    expect(cfg.features?.observability).toBeUndefined();
    expect(await roundTrip(cfg)).toEqual(cfg);
  });

  it("builder with reactive intelligence disabled", async () => {
    const { ReactiveAgents } = await import("../src/builder.js");
    const cfg = ReactiveAgents.create()
      .withName("no-ri")
      .withProvider("anthropic")
      .withReactiveIntelligence(false)
      .toConfig();
    expect(cfg.features?.reactiveIntelligence).toBe(false);
    expect(await roundTrip(cfg)).toEqual(cfg);
  });

  it("maximal builder (built from MAXIMAL_CONFIG)", async () => {
    const cfg = (await agentConfigToBuilder(MAXIMAL_CONFIG)).toConfig();
    expect(cfg.features?.observability).toBe(true);
    expect(await roundTrip(cfg)).toEqual(cfg);
  }, 15000);
});

// ─── Bidirectional drift guard for HarnessConfigSchema <-> HarnessConfig ────
// The COVERAGE/ROUNDTRIP tests above only catch a schema leaf that the fixture
// forgot to set (schema -> fixture, one direction). They CANNOT catch:
//   (a) a HarnessConfigSchema field whose backing HarnessConfig field was
//       deleted (schema is stale, points at nothing) — this is exactly how
//       thoughtContinuity/toolObserveSymmetry survived removal from
//       HarnessConfig while staying in the schema and the fixture.
//   (b) a HarnessConfig field with no HarnessConfigSchema counterpart — this is
//       exactly how numCtxPolicy shipped without surviving the JSON roundtrip.
// This guard compares the two field sets directly, in both directions, so
// either kind of drift fails loudly instead of silently.
describe("HarnessConfigSchema <-> HarnessConfig bidirectional drift guard", () => {
  it("HarnessConfigSchema's leaves are exactly HarnessConfig's fields", () => {
    // Compile-time half of the guard: this object literal must `satisfies
    // Record<keyof HarnessConfig, true>` — TypeScript rejects it (excess
    // property or missing property) the moment HarnessConfig gains or loses a
    // field without this list being updated to match.
    const harnessConfigFields = {
      lazyDisclosure: true,
      toolDiscovery: true,
      toolIndex: true,
      toolIndexMaxEntries: true,
      verboseRules: true,
      recencyBudgetChars: true,
      toolResultBudgetChars: true,
      auditRationale: true,
      treeOfThoughtExploreBudgetMs: true,
      assemblyDebug: true,
      promptDumpPathPrefix: true,
      numCtxPolicy: true,
      actOrAnswer: true,
      inputCoverage: true,
      writeCoverage: true,
      stableToolList: true,
      compactCallConstraints: true,
      budgetAnswerTurn: true,
      llmRecoveryBudget: true,
      // disclosureMode is set only by `.withTools({ disclosure })`, never by
      // `.withHarness`, so it has no HarnessConfigSchema leaf.
    } satisfies Record<Exclude<keyof HarnessConfig, "disclosureMode">, true>;

    // Runtime half of the guard: HarnessConfigSchema's own field keys (it's a
    // flat Schema.Struct, no nesting) must equal that same set exactly — no
    // schema leaf missing a HarnessConfig field, and no HarnessConfig field
    // missing a schema leaf.
    const schemaKeys = Object.keys(HarnessConfigSchema.fields).sort();
    const configKeys = Object.keys(harnessConfigFields).sort();
    expect(schemaKeys).toEqual(configKeys);
  });
});
