---
tags: [architecture, design-spec, dx, api, builder, agent-config, codegen, dual-api, self-maintaining]
date: 2026-07-11
status: ratified
ratified: "2026-07-11 (owner: yes to all Q1-Q8). Q1 withCortex/withTracing keep standalone + as observability aliases (one state slot). Q2 withCostTracking folds into withObservability({costs}) as canonical home. Q3 fold withFabricationGuard/withStallPolicy into withGrounding without changing its opt-in defaults. Q5 ship inferred AgentConfig type. Q6 add profile to AgentConfigSchema. Q7 wave-1 folds = memory/budget/verification/observability. Q8 docs generated into apps/docs from deriveCorrespondence, CI fails on hand-edit drift."
builds-on:
  - "[[2026-07-11-harness-north-star-architecture]] §5 (profiles-first + wither ratchet, RATIFIED 2026-07-11)"
  - "wiki/Research/Audit-Reports-2026-07-11/wither-surface-consolidation.md (11-cluster map + 20-row fold table)"
  - "[[08-AGENTIC-OS-NORTH-STAR]] §5 (last-mile wiring), §9 (lift rule)"
supersedes: none
refines: "2026-07-11-harness-north-star-architecture.md §5 (adds the declarative projection the §5 5-line quickstart assumes but never specifies)"
---

# Self-Maintaining Dual API — one source, two projections

**Owner question (quoted):** "Keep withers only where they open ONE canonical domain
surface (like `withCortex`) or are the dominant common-case shortcut (like `withTracing`);
don't force users to chain 20+ methods; offer a traditional SDK-style config-object API
that the market grasps instantly; BOTH styles in docs but **GENERATED FROM ONE SOURCE, no
drift, self-maintaining**."

**Owner's standing law (quoted, wither-surface-consolidation.md:5):** "Consolidation is
ADDITIVE. No `@deprecated`, no removal of working documented methods to shrink a count.
Actual removals are owner decisions." Codified as a live test:
`tests/builder-wither-discipline.test.ts` asserts documented capability methods EXIST and
are NOT `@deprecated` (audit line 18). This spec never proposes an implicit removal; every
`[OWNER-REMOVAL]` is tagged and deferred to an explicit owner decision.

**The one-sentence answer:** `AgentConfigSchema` (Effect Schema,
`packages/runtime/src/agent-config.ts:265`) is already the single source of truth — the
builder round-trips through it today (`toConfig()` at `builder.ts:2244` → `serializeBuilder`
at `builder/to-config.ts:116`; `fromConfig` at `builder.ts:275` → `agentConfigToBuilder` at
`agent-config.ts:425`). This spec adds the missing third projection — a declarative
`createAgent(config)` front door — and a **generator + drift-gate** that emits BOTH the SDK
input type and the reference docs from that one schema, so the two styles cannot diverge.

Every position is tagged **[RATIFY]** (needs owner sign-off — changes public surface,
defaults, or a removal) or **[BUILD]** (executable under already-ratified north-star §5
direction). Claims not verified in-repo are **[UNVERIFIED]**.

---

## 0. Developer-first principles — the design contract

**Owner steering (evaluation lens for the WHOLE spec):** every proposed shape — `createAgent`
config keys, surviving withers, config-shape fixes — is judged by one question: *"Would a
working developer guess this correctly WITHOUT reading docs, and have it typecheck?"* When two
designs tie on correctness, pick the one a developer guesses right.

The seven principles (cited as **DP1–DP7** throughout §2, §5, §6, §6.5):

- **DP1 First-5-minutes.** A useful agent in ≤5 lines, copy-pasteable, no ceremony. The
  minimal config must Just Work — `createAgent({ name, provider, model })` returns a running
  agent on sensible defaults; nothing else is required. (Ties north-star §5's 5-line target.)
- **DP2 Familiar idioms.** Match what JS/TS devs already know — Vercel AI SDK / OpenAI SDK
  config-object conventions, ecosystem-standard option names. Don't invent vocabulary where a
  standard term exists (`model`, `tools`, `temperature`, `maxTokens` are already ecosystem
  words — keep them; §5.2).
- **DP3 Autocomplete-driven discovery.** The config object is explorable by typing `.` —
  grouped by domain so IntelliSense reads like a menu. Discoverability via TYPES > via docs.
  This is the primary argument for domain-grouped keys (§5.2) and DOMAIN-opener withers (§6).
- **DP4 Inference that just works.** No required generics, no `as` casts in normal use;
  literal types flow through (model names, strategy names autocomplete; `withOutputSchema`
  infers to `result.object`). Friction points called out where they exist (§5.6).
- **DP5 Progressive disclosure.** Trivial things trivial, advanced things possible — profile
  for the 90%, keys to override, builder/compose for the long tail (`profile ⊂ withers ⊂
  compose`, north-star §5). A dev never pays for complexity they don't use.
- **DP6 Errors that teach.** Invalid/unknown/conflicting config fails loudly at build with a
  message naming the FIX (builder-never-lies, north-star §5.2b). See §5.5 error UX.
- **DP7 Symmetry.** Declarative and fluent are the SAME API in two syntaxes — same names, same
  nesting — so a dev fluent in one reads the other instantly. This is the single-source
  invariant (§1) experienced as DX: `createAgent({ tools: { allowedTools } })` ≡
  `.withTools({ allowedTools })`, identical key.

These are not aspirational — they are the tie-breaker and the review rubric. The config-shape
keystone (§6.5 G13) exists to enforce DP7 mechanically (option names == config keys by
construction); the drift-gate (§4) exists to keep DP7 true over time.

---

## 1. Single-source architecture

### 1.1 The invariant

```
                        ┌──────────────────────────────────────┐
                        │  AgentConfigSchema   (CANONICAL)       │
                        │  agent-config.ts:265 — Effect Schema   │
                        │  AgentConfig type    agent-config.ts:382│
                        └───────────────┬──────────────────────┘
                                        │  ONE shape. Two projections.
                 ┌──────────────────────┴───────────────────────┐
                 ▼                                                ▼
   ┌──────────────────────────┐                    ┌────────────────────────────┐
   │  DECLARATIVE (proposed)   │                    │  FLUENT (exists today)      │
   │  createAgent(config)      │                    │  ReactiveAgents.create()    │
   │  = validate + fromConfig  │                    │    .withX().withY()...       │
   │    + .build()             │                    │                              │
   │  thin wrapper — §5        │                    │  89 withers set state slices │
   └───────────┬──────────────┘                    └───────────────┬─────────────┘
               │                                                    │
               │  agentConfigToBuilder()                            │  toConfig()
               │  agent-config.ts:425                               │  builder.ts:2244
               ▼                                                    ▼
        ┌──────────────────────────────────────────────────────────────┐
        │  ReactiveAgentBuilder internal state (_name, _toolsOptions…)    │
        │  → build() → ReactiveAgent                                       │
        └──────────────────────────────────────────────────────────────┘

               DOCS-GEN (proposed §3):  AgentConfigSchema
                 ├─ Effect JSONSchema.make → config reference tables
                 │    (seam EXISTS: capability/config-fields.ts:67 deriveConfigFields())
                 └─ builder-methods.ts descriptors + configKey → wither reference tables
                      (seam EXISTS: capability/builder-methods.ts:86 deriveBuilderMethods())
```

**The invariant (stated):** *Anything expressible in the declarative API is expressible in
the fluent API and vice-versa, because both are the same `AgentConfig`.* The declarative
side IS `AgentConfig`; the fluent side serializes to and reconstructs from `AgentConfig`.
The drift-gate (§4) makes this invariant a test, not a promise.

### 1.2 The round-trip already exists (verified)

- **builder → config:** `ReactiveAgentBuilder.toConfig()` (`builder.ts:2244`) delegates to
  `serializeBuilder(state)` (`builder/to-config.ts:116`), which reads the builder's
  `_`-prefixed state and emits a plain `AgentConfig` (lines 116–351).
- **config → builder:** `ReactiveAgents.fromConfig` (`builder.ts:275`) →
  `reactiveAgentsFromConfig` (`builder/api-surface.ts:24`) → `agentConfigToBuilder(config)`
  (`agent-config.ts:425`), which applies every field to a fresh builder (lines 430–692).
- **config ↔ JSON:** `agentConfigToJSON` / `agentConfigFromJSON` (`agent-config.ts:395`,
  `:409`) validate with `Schema.decodeUnknownSync(AgentConfigSchema)`.

**What does NOT exist yet:** a top-level `createAgent(config)`. `grep createAgent` finds
only `createAgentTool` (`build-effect/local-agent-tools.ts:57`) and `createAgentEndpoint`
(`server/endpoints.ts:155`). The declarative *builder factory* exists (`fromConfig`) but it
returns a builder, not a built agent, and it is not the marketed front door. `createAgent`
is the thin, market-legible wrapper this spec proposes (§5).

---

## 2. Full surface inventory — all 89 withers

**Authoritative count: 89** via prototype reflection
(`Object.getOwnPropertyNames(ReactiveAgentBuilder.prototype)` filtered `^with(out)?[A-Z]`).
This matches the frozen ratchet `WITHER_CEILING = 89`
(`tests/builder-wither-ratchet.test.ts:18`) exactly.

> **Doc-drift flagged:** wither-surface-consolidation.md:13 states "92 unique names / 94
> signatures." That audit predates the fold wave the ratchet test records
> (`builder-wither-ratchet.test.ts:15-17`): `withTerminalTools`, `withTelemetry`,
> `withoutTracing` were already removed. The live prototype is **89**. Where this table and
> the audit disagree on a count, the prototype wins. (Gap table §9, row G1.)

Legend for **canonical-surface verdict**:
`DOMAIN` = KEEP, opens one canonical domain surface (owner rule) ·
`SHORTCUT` = KEEP, dominant common-case shortcut ·
`FOLD→X` = additive fold into X exists or is proposed (audit row #); standalone becomes an
`[OWNER-REMOVAL]` candidate only after the additive side bakes ·
`PLUMBING` = keep, plumbing (no fold) ·
`ESCAPE` = keep, code-only escape hatch/test rig.

`featureClass` column is verbatim from `feature-matrix.ts` (cap = capability, plumb =
plumbing, **⚠ = absent from FEATURE_MATRIX** = real drift, see G2).

**Developer-first read of the verdicts:** `DOMAIN`/`SHORTCUT` keeps serve **DP3**
(autocomplete menu — one entry per concept the dev reasons about) and **DP7** (each is a
config key of the same name); `FOLD→` verdicts serve **DP3 + DP5** (collapse N methods into
one domain object with options, so IntelliSense shows "one memory concept," not five). No
verdict trades away correctness for guessability — where they tie, guessability decides.

| # | wither | AgentConfig key(s) | class | verdict |
|---|--------|--------------------|-------|---------|
| 1 | withA2A | *(none — multi-agent transport)* | cap | DOMAIN (topology primitive) |
| 2 | withAdaptiveHarness | `adaptiveHarness` | cap | DOMAIN (reasoning posture) |
| 3 | withAgentId | `agentId` | plumb | PLUMBING (identity fine-grained) |
| 4 | withAgentTool | *(none — code registry)* | cap | DOMAIN (topology primitive) |
| 5 | withApprovalPolicy | *(none — carries predicate)* | cap | DOMAIN (HITL durability rail) |
| 6 | withAudit | `features.audit` | plumb | FOLD→withObservability({audit}) (audit #7 SHIPPED) |
| 7 | withBehavioralContracts | *(none — overlay)* | cap | FOLD→withContract (audit #20) |
| 8 | withBudget | `budget` | cap | DOMAIN (budget; audit #9 target) |
| 9 | withCacheTimeout | `execution.cacheTimeoutMs` | plumb | FOLD→withProvider (audit #19) |
| 10 | withCalibration | *(none — runtime-probed)* | cap | ESCAPE / DOMAIN |
| 11 | withChannels | *(none — transport)* | plumb | PLUMBING (topology) |
| 12 | withCircuitBreaker | `circuitBreaker` | plumb | DOMAIN (folds withoutCircuitBreaker, audit #11) |
| 13 | withContextProfile | *(none — cross-field side effects)* | plumb | ESCAPE |
| 14 | withContract | *(none — overlay)* | cap | DOMAIN (contract; folds behavioral #20) |
| 15 | withCortex | *(none — integration)* | plumb | **DOMAIN (owner-cited)** — ⚠ conflicts with audit #7 fold; see [RATIFY] Q1 |
| 16 | withCostTracking | `costTracking`, `features.costTracking` | plumb | FOLD→withObservability({costs}) (audit #7) — ⚠ dual home, see [RATIFY] Q2 |
| 17 | withCustomTermination | *(none — function)* | cap | FOLD→withReasoning (audit #17) |
| 18 | withDocuments | *(none — ingestion side-effect)* | cap | FOLD→withTools({documents}) (audit #3) |
| 19 | withDurableRuns | `durableRuns` | cap | DOMAIN (durability rail) |
| 20 | withDynamicPricing | *(none — overlay)* | plumb | FOLD→withCostTracking (audit #13) |
| 21 | withDynamicSubAgents | *(none — code registry)* | cap | DOMAIN (topology primitive) |
| 22 | withEnvironment | *(none — secrets)* | plumb | ESCAPE |
| 23 | withErrorHandler | *(none — function)* | plumb | ESCAPE |
| 24 | withEvents | *(none — overlay)* | plumb | FOLD→withObservability({events}) (audit #8) |
| 25 | withExperienceLearning | `memory.experienceLearning` | cap | FOLD→withMemory (audit #5) |
| 26 | withFabricationGuard | `fabricationGuard` | cap | FOLD→withGrounding (audit #18) — [RATIFY] Q3 |
| 27 | withFallbacks | `fallbacks` | plumb | DOMAIN (provider fallbacks) |
| 28 | withGateway | `gateway` | plumb | DOMAIN (gateway) |
| 29 | withGrounding | `grounding` | cap | DOMAIN (honesty-rails umbrella; audit #18 target) |
| 30 | withGuardrails | `guardrails`, `features.guardrails` | cap | DOMAIN (input safety) |
| 31 | withHarness | *(none — compose injection)* | cap | ESCAPE (compose power tier) |
| 32 | withHealthCheck | `features.healthCheck` | plumb | FOLD→withObservability({health}) (audit #7 SHIPPED) |
| 33 | withHook | *(none — function)* | cap | ESCAPE |
| 34 | withIdentity | `features.identity` | plumb | PLUMBING (topology) |
| 35 | withInteraction | `features.interaction` | cap | DOMAIN (folds withUserInteraction, audit #16) |
| 36 | withKillSwitch | `features.killSwitch` | cap | DOMAIN (control) |
| 37 | withLayers | *(none — DI escape hatch)* | plumb | ESCAPE |
| 38 | withLazyValidation | *(none — no schema field)* | plumb | FOLD→withVerification({timing:'lazy'}) (audit #10) |
| 39 | withLeanHarness | *(none — cross-field profile)* | cap | FOLD→withProfile(lean()) (audit #14) [OWNER-REMOVAL] |
| 40 | withLearning | *(partial — memory/self-improve umbrella)* | cap | DOMAIN (compounding-intelligence umbrella; audit #6 target) |
| 41 | withLlmTimeout | *(none — `_ollamaTimeoutMs`, no schema field)* | plumb | FOLD→withBudget (audit #9) — ⚠ gap G3 |
| 42 | withLogging | `logging` | plumb | FOLD→withObservability({logging}) (audit #7 SHIPPED) |
| 43 | withLongHorizon | `horizonProfile:"long"` | cap | DOMAIN (posture) |
| 44 | withMaxIterations | `execution.maxIterations` | plumb | FOLD→withBudget (audit #9) |
| 45 | withMCP | `mcpServers` | cap | FOLD→withTools({mcp}) (audit #4) |
| 46 | withMemory | `memory`, `features.memory` | cap | DOMAIN (memory; audit #5 target) |
| 47 | withMemoryConsolidation | `memory.memoryConsolidation` | cap | FOLD→withMemory (audit #5) |
| 48 | withMetaTools | *(none — code registry)* | cap | DOMAIN (one concept) |
| 49 | withMinIterations | `execution.minIterations` | cap | FOLD→withBudget (audit #9) |
| 50 | withModel | `model`,`thinking`,`temperature`,`maxTokens`,`numCtx` | plumb | DOMAIN (model; audit #12 target) |
| 51 | withModelPricing | `pricingRegistry` | plumb | FOLD→withCostTracking (audit #13) |
| 52 | withModelRouting | *(none — overlay)* | cap | DOMAIN (routing) — ⚠ capability-without-config, gap G4 |
| 53 | withName | `name` | plumb | SHORTCUT (required field) |
| 54 | withObservability | `observability`, `features.observability` | plumb | DOMAIN (observability umbrella; audit #7/#8 target) |
| 55 | withOrchestration | `features.orchestration` | cap | DOMAIN (topology) |
| 56 | withOutputSchema | `outputSchemaOptions` *(schema obj not JSON)* | **⚠** | DOMAIN (typed-output rail) — **absent from FEATURE_MATRIX, gap G2** |
| 57 | withOutputValidator | *(none — function)* | cap | FOLD→withVerification({outputValidator}) (audit #10) |
| 58 | withPersona | `persona` | plumb | PLUMBING (identity fine-grained) |
| 59 | withProfile | *(none — cross-field patch)* | plumb | **DOMAIN (PRIMARY API — north-star §5)** |
| 60 | withProgressCheckpoint | *(none — cadence/fn)* | cap | FOLD→withReasoning (audit #17) |
| 61 | withPrompts | `features.prompts` | cap | DOMAIN (prompt-pack) |
| 62 | withProvider | `provider` | plumb | DOMAIN (required; audit #19 target) |
| 63 | withRateLimiting | `rateLimiting` | plumb | FOLD→withProvider (audit #19) |
| 64 | withReactiveIntelligence | `reactiveIntelligence`, `features.reactiveIntelligence` | cap | DOMAIN (posture) |
| 65 | withReasoning | `reasoning`, `features.reasoning` | cap | DOMAIN (reasoning; audit #17 target) |
| 66 | withReceiptSigning | *(none — overlay)* | plumb | PLUMBING |
| 67 | withRemoteAgent | *(none — code registry)* | cap | DOMAIN (topology primitive) |
| 68 | withReplayLLM | *(none — test rig)* | plumb | ESCAPE |
| 69 | withRequiredTools | `requiredTools` | cap | FOLD→withTools({required}) (audit #1 **SHIPPED**) [OWNER-REMOVAL] |
| 70 | withRetryPolicy | `execution.retryPolicy` | cap | FOLD→withProvider (audit #19) |
| 71 | withSelfImprovement | `features.selfImprovement` | cap | FOLD→withLearning (audit #6) |
| 72 | withSkillPersistence | `skillPersistence` | cap | FOLD→withMemory (audit #5) |
| 73 | withSkills | *(none — code registry)* | cap | DOMAIN (one concept) |
| 74 | withStallPolicy | `stallPolicy` | cap | FOLD→withGrounding (audit #18) — [RATIFY] Q3 |
| 75 | withStreaming | `features.streaming` *(via `_streamDensity`)* | cap | FOLD→withObservability({streaming}) (audit #8) |
| 76 | withStrictValidation | `execution.strictValidation` | cap | FOLD→withVerification({timing:'strict'}) (audit #10) |
| 77 | withSystemPrompt | `systemPrompt` | cap | SHORTCUT (identity fine-grained) |
| 78 | withTaskContext | `taskContext` | cap | **SHORTCUT (owner-cited common case)** |
| 79 | withTestScenario | *(none — test rig)* | cap | ESCAPE |
| 80 | withThinking | `thinking` *(via withModel)* | cap | FOLD→withModel({thinking}) (audit #12 **SHIPPED**) [OWNER-REMOVAL — likely keep, popular] |
| 81 | withTimeout | `execution.timeoutMs` | plumb | FOLD→withBudget (audit #9) |
| 82 | withTools | `tools`, `features.tools` | cap | DOMAIN (tools; audit #1–4 target) |
| 83 | withTracing | *(none — documented not-data)* | plumb | **SHORTCUT (owner-cited)** — also FOLD→withObservability({tracing}) (audit #7/#15) — [RATIFY] Q1 |
| 84 | withUserInteraction | *(none — durable ask)* | cap | FOLD→withInteraction (audit #16) |
| 85 | withVerification | `verification`, `features.verification` | cap | DOMAIN (verification; audit #10 target) |
| 86 | withVerificationStep | *(none — function)* | cap | FOLD→withVerification (audit #10) |
| 87 | withoutCircuitBreaker | `circuitBreaker:false` | plumb | FOLD→withCircuitBreaker(false) (audit #11) |
| 88 | withoutMemory | `memory`/`features.memory` off | cap | FOLD→withMemory({enabled:false}) (audit #5) |
| 89 | withoutObservability | `features.observability` off | plumb | FOLD→withObservability({enabled:false}) (audit #8) |

### 2.1 Coverage stat

- **53 of 89 withers map to an `AgentConfig` key** (the "config" projection is total for
  these — they round-trip through `serializeBuilder` + `agentConfigToBuilder`).
- **36 of 89 are code-only overlays** — functions/predicates (`withHook`,
  `withErrorHandler`, `withOutputValidator`, `withVerificationStep`,
  `withProgressCheckpoint`, `withCustomTermination`, `withHarness`, `withLayers`,
  `withEvents`), the schema OBJECT (`withOutputSchema` — options DO serialize), cross-field
  profile switches (`withLeanHarness`, `withProfile`, `withContextProfile`), secrets/
  integrations/registries (`withEnvironment`, `withChannels`, `withCortex`, `withTracing`,
  `withApprovalPolicy`, `withCalibration`, `withDocuments`, `withRemoteAgent`,
  `withDynamicSubAgents`, `withMetaTools`, `withSkills`, `withAgentTool`, `withA2A`,
  `withReceiptSigning`, `withModelRouting`), test rigs (`withReplayLLM`, `withTestScenario`).
  **These are NOT drift** — they are the reviewed "deliberately not data" seam documented in
  `config-serialization-drift.test.ts:48-65`. The generator marks them `configKey: null`
  with the recorded reason.
- **Genuine gaps flagged (4):** G2 `withOutputSchema` (on prototype, absent from
  FEATURE_MATRIX); G3 `withLlmTimeout` (sets a timeout with no schema field); G4
  `withModelRouting` (a *capability* that cannot round-trip through config); plus the
  `withCortex`/`withObservability({cortex})` fan-out sets state with no `observability.cortex`
  schema field. Detailed in §9.

---

## 3. The generator — self-maintenance mechanism

**Key finding: the two generator seams already exist and are already tested.** The spec's
job is to JOIN them, not to build a code-gen toolchain from scratch.

### 3.1 The `AgentConfig` public input type

- **Source:** `AgentConfigSchema` (`agent-config.ts:265`). `AgentConfig` is already the
  inferred type: `type AgentConfig = Schema.Schema.Type<typeof AgentConfigSchema>`
  (`agent-config.ts:382`).
- **[BUILD]** `createAgent(config)` takes exactly `AgentConfig`. No new type is needed —
  the schema-inferred type is already exported and already the round-trip currency.
- **[RATIFY] Q5 — curated re-export vs raw inferred.** The raw inferred type is legible
  (all-optional structs, no branded transforms in the root) — a curated re-export is likely
  unnecessary. If review finds the `Schema.optional(...)` unions read poorly in editor
  tooltips, the fallback is a hand-written `interface CreateAgentConfig` pinned equal to
  `AgentConfig` by a `type _assert = AgentConfig extends CreateAgentConfig ? … : never`
  compile check (so the curated view cannot drift from the schema). Default recommendation:
  ship the inferred type; add the curated view only if DX review demands it.

### 3.2 Docs generation

- **Config reference tables** — the seam EXISTS: `deriveConfigFields()`
  (`capability/config-fields.ts:67`) runs `JSONSchema.make(AgentConfigSchema)` (Effect
  3.10.0 `JSONSchema` module confirmed present: `node_modules/effect/dist/dts/JSONSchema.d.ts`)
  and flattens it to `{ path, type, enumValues, optional, description }` descriptors
  (`config-fields.ts:15-22`). This already powers Cortex's config manifest. **[BUILD]** emit
  the config reference table (one row per dotted path) directly from `deriveConfigFields()`.
  The schema's JSDoc comments (e.g. `agent-config.ts:266` "Agent display name. Required.")
  already flow through as `description`.
- **Builder reference tables** — the seam EXISTS: `deriveBuilderMethods()`
  (`capability/builder-methods.ts:86`) reflects the prototype and enriches with
  `{ kind, configPath, description }` (`builder-methods.ts:12-22`). **[BUILD]** emit the
  wither reference table from this descriptor list.

### 3.3 The correspondence map (the new work)

Today `BUILDER_METHOD_ANNOTATIONS` (`builder-methods.ts:35`) carries `configPath` for only
~15 well-known methods; the other 74 default to `overlay` with no path
(`builder-methods.ts:103-108`). **[BUILD]** extend every `config`-kind descriptor with its
`configKey(s)` (already columned in §2 of this spec — 53 mappings), and mark the 36 overlays
`configKey: null` with the reason string from `config-serialization-drift.test.ts:48-65`.

Then a single reflection step emits the **wither ↔ config-key correspondence table** used by
BOTH doc surfaces:

```ts
// proposed: capability/api-correspondence.ts
export function deriveCorrespondence() {
  const withers = deriveBuilderMethods();        // builder-methods.ts:86 (exists)
  const configFields = deriveConfigFields();     // config-fields.ts:67  (exists)
  const configPaths = new Set(configFields.map(f => f.path));
  return withers.map(w => ({
    wither: w.name,
    configKey: w.configKey ?? null,              // NEW descriptor field
    // drift signal (§4a): a declared configKey that the schema does not contain
    orphan: w.configKey != null && !hasPath(configPaths, w.configKey),
    reason: w.configKey == null ? w.overlayReason : undefined,
  }));
}
```

Both the "declarative config reference" and the "fluent builder reference" doc pages render
from `deriveCorrespondence()` + `deriveConfigFields()`. One source, two renderings — the
literal answer to "BOTH styles in docs but generated from one source."

---

## 4. The drift-gate — the "maintains itself" guarantee

Four tests make drift impossible to merge. Two exist and are extended; two are new.

**(a) Every declared `configKey` exists in `AgentConfigSchema`.** [BUILD] New assertion in
`test/builder-methods.test.ts` (extends the existing suite): for every descriptor with
`kind: "config"`, `configKey` must resolve against `deriveConfigFields()` paths. A wither
that claims a schema key the schema dropped fails here. *Cutting the wiring test:* rename a
schema field without updating the descriptor → red.

**(b) Every non-plumbing `AgentConfig` key has ≥1 wither OR is marked config-only.** [BUILD]
New assertion: invert the correspondence — every `deriveConfigFields()` path must be either
(i) targeted by some wither's `configKey`, or (ii) in an explicit `CONFIG_ONLY_KEYS` set with
a justification (the declarative-only escape valve, e.g. a future field with no fluent
sugar). A schema field reachable by neither surface = a key the fluent user can never set =
fail. *This is the gate that keeps the two APIs equipotent.*

**(c) Round-trip idempotence for a representative matrix.** EXISTS and is authoritative:
`tests/config-serialization-drift.test.ts` enumerates every schema leaf at runtime
(`leafPaths(AgentConfigSchema.ast)`, `:255`), asserts a `MAXIMAL_CONFIG` fixture sets every
leaf (COVERAGE, `:254`), and asserts `config → agentConfigToBuilder → toConfig()` drops no
leaf (ROUNDTRIP, `:264`). **[BUILD]** extend it one hop to prove the DECLARATIVE projection
is idempotent too: `createAgent(config)` internally builds; assert
`(await createAgent(cfg)).toConfig?()` — or, if `ReactiveAgent` does not re-expose
`toConfig`, assert `serializeBuilder(await agentConfigToBuilder(cfg)) ≡ serializeBuilder(await
agentConfigToBuilder(serializeBuilder(await agentConfigToBuilder(cfg))))` (double round-trip
equal to single). The `NON_BUILDER_ROUNDTRIP` set (`:38-46`) already documents the 3
`outputSchemaOptions.*` leaves that partial-round-trip by design.

**(d) The ratchet stays monotone.** EXISTS: `tests/builder-wither-ratchet.test.ts:18`
(`WITHER_CEILING = 89`, may only shrink) + it also pins the 3 removed methods stay removed
(`:31-36`). The benchmarks `feature-matrix.ts` ratchet
(`UNCOVERED_CAPABILITY_CEILING = 37`, `:155`) and `builder-wither-discipline.test.ts` (no
`@deprecated` on documented methods, audit :18) round out the ratchet family.

**Existing drift-gate already green (verified):** `builder-methods.test.ts:9` asserts
`deriveBuilderMethods()` equals the live prototype set (no method escapes the manifest);
`builder-methods.test.ts:32` asserts no stale annotation names.

---

## 5. `createAgent` API design

### 5.1 Signature [BUILD]

```ts
// proposed: packages/runtime/src/create-agent.ts, re-exported from index.ts
export async function createAgent<TOut = string>(
  config: AgentConfig,                    // agent-config.ts:382 — the canonical type
): Promise<ReactiveAgent<TOut>> {
  const validated = Schema.decodeUnknownSync(AgentConfigSchema)(config); // loud reject §5.4
  const builder = await agentConfigToBuilder(validated);                 // agent-config.ts:425
  return builder.build();                                                // builder.ts build()
}
```

Thin by construction: validate (which the schema does — `agent-config.ts:396`) + `fromConfig`
+ `build()`. Zero new mapping logic; it reuses the round-trip that the drift-gate already
guards.

### 5.2 Input shape — grouped by canonical domain

`AgentConfig` is already domain-grouped (`agent-config.ts:265-378`). The declarative doc
surface presents it under these headings, each aligning to a DOMAIN wither in §2:

| Domain group | AgentConfig keys | fluent domain-opener |
|---|---|---|
| identity | `name`, `agentId`, `persona`, `systemPrompt` | withName/withPersona/withSystemPrompt |
| model | `provider`, `model`, `thinking`, `temperature`, `maxTokens`, `numCtx` | withModel/withProvider |
| tools | `tools`, `mcpServers`, `requiredTools` | withTools |
| reasoning | `reasoning` | withReasoning |
| memory | `memory`, `skillPersistence` | withMemory/withLearning |
| observability | `observability`, `logging`, `costTracking` | withObservability |
| budget/execution | `budget`, `execution`, `rateLimiting`, `circuitBreaker` | withBudget |
| verification/guards | `verification`, `guardrails`, `grounding`, `fabricationGuard`, `stallPolicy` | withVerification/withGrounding/withGuardrails |
| durability/lifecycle | `durableRuns`, `gateway` | withDurableRuns/withGateway |
| posture | `horizonProfile`, `adaptiveHarness`, `reactiveIntelligence` | withProfile + posture withers |
| pricing/misc | `pricingRegistry`, `taskContext`, `fallbacks`, `features` | withCostTracking etc. |

**Profile as a config key [RATIFY] Q6.** North-star §5's 5-line quickstart shows
`createAgent({ model, profile: "balanced", tools })`. `AgentConfigSchema` has NO `profile`
key today (verified — no `profile` field in `agent-config.ts:265-378`; profiles apply via
`.withProfile()` which is a cross-field patch, `capabilities/profile.ts:49`). To honor the
north-star quickstart, **add `profile?: "lean" | "balanced" | "intelligent"` to the schema**
and have `agentConfigToBuilder` apply it FIRST (baseline) so subsequent explicit keys
override — matching `profile.ts:22-24` ("later calls override earlier patches"). This is the
one schema addition the declarative front door requires.

### 5.3 Three-tier examples

```ts
// TIER 1 — declarative, 5 lines (the market-legible front door)
const agent = await createAgent({
  name: "researcher", provider: "anthropic", model: "claude-opus-4-8",
  profile: "balanced", tools: { allowedTools: ["web-search", "file-write"] },
});
const result = await agent.run(goal);
if (!result.receipt?.grounded) { /* ... */ }         // north-star §5 receipt DX

// TIER 2 — fluent, conditional composition (withers earn their keep here)
let b = ReactiveAgents.create().withName("researcher").withProvider("anthropic")
  .withModel("claude-opus-4-8").withProfile(HarnessProfile.balanced());
if (needsGrounding) b = b.withGrounding({ mode: "block" });   // conditional — awkward as data
const agent2 = await b.withTools({ allowedTools: ["web-search"] }).build();

// TIER 3 — compose power tier (library authors; north-star §5 "profile ⊂ withers ⊂ compose")
// harness-level phases/policies via withHarness(...) — out of scope for this spec.
```

Both Tier-1 and Tier-2 produce byte-identical `AgentConfig` for the same inputs (the §4c
round-trip guarantee). Tier-2 is where the owner's "don't force 20+ chained methods" tension
resolves: withers are for *conditional/imperative* construction; the config object is for
*declared/static* definition. Neither is deprecated.

### 5.4 Profile + override interaction [RATIFY] Q6

`profile` sets the baseline; explicit sibling keys override. Applied in
`agentConfigToBuilder` as `withProfile(...)` FIRST, then the existing field-application order
(`agent-config.ts:430-692`) runs after, so `{ profile: "lean", memory: { tier: "enhanced" }}`
= lean baseline + memory re-enabled (mirrors `profile.ts:24`
`.withProfile(lean()).withMemory()`).

### 5.5 Validation / error behavior (builder-never-lies, north-star §5.2b)

- Unknown keys: `Schema.decodeUnknownSync` REJECTS unknown properties loudly (Effect Schema
  structs are exact by default) — the declarative surface inherits north-star §5's
  "unknown options rejected loudly at build()" for free. This is stronger than the fluent
  surface, where a typo is a TS error at author time.
- Inert combinations: `build()` already throws/warns on known-inert combos —
  `.withApprovalPolicy({mode:'detach'})` without `.withDurableRuns()` throws
  (`builder.ts` build(), the approval guard); `.withUserInteraction()` without durable throws;
  `.withDurableRuns()` without `.withReasoning()` warns (verified in build() body). Declarative
  configs hit the same guards because `createAgent` calls `build()`.

**Error UX standard (DP6) — the message names the fix.** Three tiers, all present today or
proposed: (1) **unknown key** → `Schema.decodeUnknownSync` reports the offending path (Effect
ParseError) — but the raw ParseError is terse; [BUILD] wrap it in `createAgent` to prepend
"Unknown config key `x.y` — did you mean `x.z`? See <domain> keys." (2) **inert combo** → the
existing `build()` guards already name the fix verbatim ("`.withApprovalPolicy({mode:'detach'})`
requires `.withDurableRuns()` — detached approval pauses need a durable store", builder.ts
build()). Keep this style for every new guard. (3) **conflicting keys** (`profile` baseline vs
explicit override) → not an error; §5.4 defines override precedence, and the receipt records
which won (north-star §5 interventions). A dev never sees a silent swallow (DP6 = the
builder-never-lies law applied to the declarative surface).

### 5.6 Inference that just works (DP4) — friction points called out

- **Model / strategy literals autocomplete.** `provider: ProviderNameSchema` (agent-config.ts:14)
  is a `Schema.Literal` union → the 6 provider strings autocomplete with no generic. `reasoning.
  defaultStrategy` is `ReasoningStrategy` from core (agent-config.ts:41) → all 8 strategy names
  autocomplete. **Keep model as `string`** (open set across providers) but [BUILD] offer a
  `KnownModel` template-literal helper for the common ids so `model:` suggests without closing
  the type — DP2/DP4 balance (ecosystem SDKs keep `model: string`).
- **Output schema → result type (the one real friction).** `withOutputSchema(schema)` should
  make `result.object` infer to the schema's type. Today `AgentResult.object` is typed `unknown`
  (builder/types.ts:973) — the dev must cast. [BUILD] thread the schema generic so
  `createAgent<T>({ outputSchema })` / `.withOutputSchema<T>()` flows `T` to `result.object`.
  This is the highest-value DP4 fix; called out as G14. (Note: `outputSchema` cannot live in
  the declarative `AgentConfig` as data — schema objects are not JSON, agent-config.ts:206 — so
  the declarative form takes it as a live value in a separate `createAgent(config, { schema })`
  overload, or the fluent `.withOutputSchema()`. [RATIFY] Q9.)
- **No required generics in the common path.** `createAgent(config)` defaults `TOut = string`
  (§5.1) — DP1: the 5-line path needs zero type arguments and produces `AgentResult` with a
  `string` output. Generics appear only when a dev opts into typed output.
- **No `as` in normal use.** The one internal cast (`this as unknown as
  BuilderStateForSerialization`, builder.ts:2245) is a hidden-from-user impl detail the
  drift-gate (§4c) exists to keep honest; user code needs no cast.

---

## 6. Canonical-surface wither rule

**The rule (crisp):** *A wither earns standalone existence iff it (a) opens ONE canonical
domain surface a user reasons about as a single concept (`withTools`, `withMemory`,
`withReasoning`, `withVerification`, `withObservability`, `withModel`, `withGrounding`,
`withBudget`, `withProfile`, `withCortex`) OR (b) is the dominant common-case shortcut
(`withName`, `withSystemPrompt`, `withThinking`, `withTracing`, `withTaskContext`) OR (c) is a
code-only escape hatch that cannot be data (functions, secrets, registries, test rigs). Every
other wither is a config OPTION on a domain-opener, reachable additively — the standalone
method keeps working until an explicit owner removal.*

*Why this rule is developer-first:* a domain-opener is exactly what **DP3** wants —
`config.tools.` autocompletes the whole tools menu; a dev never hunts for `withRequiredTools`
vs `withTerminalTools` vs `withDocuments` because they are all `tools.{required,terminal,
documents}`. **DP5** (progressive disclosure): the domain object's common fields are shallow
(`tools.allowedTools`), advanced ones nested (`tools.required.maxRetries`). **DP7**: the same
`tools` object is what both `createAgent({tools})` and `.withTools(tools)` take.

Applied to §2:
- **DOMAIN openers (keep):** ~24 — the 11 domain headings of §5.2 plus topology primitives
  (`withA2A`, `withAgentTool`, `withDynamicSubAgents`, `withRemoteAgent`), posture flags
  (`withAdaptiveHarness`, `withLongHorizon`, `withReactiveIntelligence`), `withContract`,
  `withLearning`, `withGateway`, `withFallbacks`, `withKillSwitch`, `withOrchestration`,
  `withPrompts`, `withMetaTools`, `withSkills`, `withDurableRuns`.
- **SHORTCUTs (keep):** `withName`, `withSystemPrompt`, `withThinking`, `withTracing`,
  `withTaskContext`.
- **ESCAPE hatches (keep):** `withHook`, `withErrorHandler`, `withHarness`, `withLayers`,
  `withReplayLLM`, `withTestScenario`, `withEnvironment`, `withCalibration`,
  `withContextProfile`, `withApprovalPolicy`, `withOutputSchema`, `withReceiptSigning`.
- **FOLD candidates (additive now; standalone → owner-removal later):** the ~30 rows tagged
  `FOLD→` in §2, matching the audit's 20-row fold table.

**Target reduced surface:** the audit computes end-state **≈56 methods** if every
`[OWNER-REMOVAL]` executes, or **~65–70** keeping popular conveniences
(wither-surface-consolidation.md:109-110). This spec does NOT set a new ratchet number —
the ratchet only moves when an owner executes a removal (§7). **[ADDITIVE-NOW] work changes
the count by 0** (audit line 98): it adds config options, which is what makes the two APIs
equipotent without any removal.

### 6.1 The fold list

- **[SHIPPED] additive folds** (config option exists today): `withTools({required})` (#1),
  `withTools({terminal})` (#2), `withObservability({cortex,telemetry,logging,tracing,audit,
  health,costs})` (#7), `withModel({thinking})` (#12), `withCircuitBreaker(false)` state (#11).
- **[ADDITIVE-NOW]** (safe to implement, audit rows #3,#4,#5,#6,#8,#9,#10,#13,#15,#16,#17,#18,
  #19): fold `withDocuments`/`withMCP`→withTools; `withoutMemory`/`withSkillPersistence`/
  `withExperienceLearning`/`withMemoryConsolidation`→withMemory; `withSelfImprovement`→
  withLearning; `withEvents`/`withStreaming`/`withoutObservability`→withObservability;
  `withMaxIterations`/`withMinIterations`/`withTimeout`/`withLlmTimeout`→withBudget;
  `withVerificationStep`/`withOutputValidator`/`withStrictValidation`/`withLazyValidation`→
  withVerification; `withModelPricing`/`withDynamicPricing`→withCostTracking;
  `withRetryPolicy`/`withRateLimiting`/`withCacheTimeout`→withProvider; `withUserInteraction`→
  withInteraction; `withCustomTermination`/`withProgressCheckpoint`→withReasoning;
  `withFabricationGuard`/`withStallPolicy`→withGrounding.
- **[OWNER-REMOVAL]** (only after additive bakes, explicit owner decision): the standalone
  methods above, plus `withLeanHarness`→withProfile(lean()) (#14), `withThinking` (popular —
  likely kept). Removals stage the ratchet DOWN from 89.

---

## 6.5 Config-surface problems + simplifications (owner add-on)

§2 proves the mapping is *total* (every wither is accounted for). This section audits the
config SHAPE — the option OBJECT each wither takes — for DX problems. The governing
principle ties straight to the single-source rule: **a wither's option-object type should
equal its `AgentConfig` sub-schema shape**, so `deriveCorrespondence()` (§3.3) is 1:1 and the
generator emits one table, not two that must be reconciled.

**Root disease (verified):** the builder's `XOptions` interfaces
(`builder/types.ts`) have drifted into **supersets** of their `XConfigSchema` sub-schemas
(`agent-config.ts`). The extra option fields silently do NOT serialize through
`serializeBuilder` — they are invisible to the round-trip drift-gate because that gate walks
*schema* leaves (`config-serialization-drift.test.ts:255`), and a field absent from the
schema is never checked. This is precisely the drift the dual-API generator must catch, and
the fix is uniform: **derive/pin each option type to its schema.**

| # | wither | problem (file:line) | proposed shape (TS) | tag | drift / back-compat note |
|---|--------|---------------------|---------------------|-----|--------------------------|
| P1 | withTools | `ToolsOptions` (builder/types.ts:106-255) has 8 fields; `ToolsConfigSchema` (agent-config.ts:49-54) has 4 (`allowedTools`, `focusedTools`, `adaptive`, `terminal`). `builtins` (:184), `resultCompression` (:115), custom `tools[]` (:108), `required` (:254) do NOT round-trip through config. | Add `builtins?: boolean \| readonly string[]` and `required?: RequiredToolsOptions` to `ToolsConfigSchema` (the JSON-safe ones). `tools[]`/`resultCompression` (fns/compressors) stay code-only, marked `overlay`. | ADDITIVE-NOW | `terminal` already round-trips as `boolean` (to-config.ts:152 collapses `ShellExecuteConfig`→`true`, **LOSSY** — the object form silently degrades). Fix: schema `terminal?: boolean \| ShellExecuteConfigLite`. |
| P2 | withVerification | `VerificationOptions.useLLMTier` (types.ts:535) and `.onReject` (:542) are absent from `VerificationConfigSchema` (agent-config.ts:186-196). `serializeBuilder` EMITS `useLLMTier` anyway (to-config.ts:222) → a config field the schema rejects on re-decode; `onReject` silently dropped. | Add `useLLMTier?: boolean` and `onReject?: "block"\|"annotate"\|"proceed"` to `VerificationConfigSchema`. | ADDITIVE-NOW | **Live drift bug:** toConfig() output currently carries `verification.useLLMTier`, which `agentConfigFromJSON` would reject (exact-struct decode). Fixing the schema resolves it. Gap G10. |
| P3 | withObservability | The fan-out sub-options `cortex`/`telemetry`/`logging`/`tracing`/`health`/`audit`/`costs` (types.ts:632-652) have NO representation in `ObservabilityConfigSchema` (agent-config.ts:77-84 = only `verbosity`/`live`/`file`/`logModelIO`). The entire audit-#7 "shipped" fan-out does not serialize. | Extend `ObservabilityConfigSchema` with the JSON-safe fan-out keys (`cortex?: boolean\|{url?}`, `tracing?: boolean\|{dir?}`, `health?`, `audit?`, `logging?`, `costs?`). `redactors`/`WritableStream` output stay code-only. | ADDITIVE-NOW | Makes `withObservability({cortex})` (audit #7) actually round-trip — today it sets builder state that `toConfig()` drops. Gaps G8 + G11. |
| P4 | withGateway | `GatewayOptions.accessControl` (types.ts:733-748, 8 sub-fields) is absent from `GatewayConfigSchema` (agent-config.ts:125-152). Gateway is also applied `as any` (agent-config.ts:613) — no field-level validation. | Add `accessControl` struct to `GatewayConfigSchema`; drop the `as any` at agent-config.ts:613. | ADDITIVE-NOW | `gateway` is a PASSTHROUGH_SUBTREE (config-serialization-drift.test.ts:73), so field drift inside it is invisible today (deep-object equality only). Tightening the schema restores field-level protection. Gap G12. |
| P5 | inconsistent path-key vocabulary | Five different keys name a filesystem location across siblings: `observability.file` (types.ts:592), `logging.filePath` (:643), `durableRuns.dir` (:468), `memory.dbPath` (types.ts:307), `logging.output` (:640). No convention. | Adopt ONE vocabulary: `dir` for directories, `path` for files. Apply to NEW keys immediately; keep existing keys (back-compat) but document the convention so the next field follows it. | ADDITIVE-NOW (new keys) / OWNER-REMOVAL (renames) | Renaming existing keys is breaking — defer to owner. The point is to stop the bleed: the generated config reference surfaces the inconsistency to users, so freeze the convention now. |
| P6 | `boolean \| Object` union consistency | The union convention (`terminal`, `builtins`, `required`, `circuitBreaker`, `cortex`, `tracing`, `costs`) is fine — but applied unevenly and the schema mirrors only ONE: `CircuitBreakerConfigSchema` is `Union(Literal(false), Struct)` (agent-config.ts:241) while `tracing`/`cortex`/`costs` have no schema union at all (P3). | Standardize: every `boolean\|Object` builder option gets the matching `Schema.Union(Schema.Boolean, Struct)` (or `Union(Literal(false), Struct)` for disable-only) in its schema, so option shape == config shape. | ADDITIVE-NOW | Zero runtime change; makes the union round-trip. Feeds the 1:1 generator directly. |
| P7 | withMemory tier triple-representation | `MemoryOptions.tier` is `'standard'\|'enhanced'` (types.ts:305); internal state is `_memoryTier: "1"\|"2"` (to-config.ts:53); schema is `'standard'\|'enhanced'` (agent-config.ts:64). The `"1"/"2"↔standard/enhanced` map lives at to-config.ts:174 + agent-config decode. | Keep the public/schema vocabulary (`standard`/`enhanced`); the `"1"/"2"` internal is an impl detail — fine, but document it as the ONLY such indirection so it doesn't spread. | no-op (document) | Not a bug (handled correctly), but a footgun magnet — pin it in the drift test's reviewed-seam list. |
| P8 | negative-twin inconsistency | `withoutMemory`/`withoutObservability`/`withoutCircuitBreaker` disable via THREE mechanisms: circuitBreaker→`false` union (round-trips), observability→`features.observability` flag, memory→`_memoryExplicitlyDisabled` (a state `toConfig()` cannot fully express — "off" vs "absent" is lossy). | Fold all three into the `enabled: false` convention on the domain wither (audit #5/#8/#11) so "off" is one uniform, serializable shape. | ADDITIVE-NOW (folds) / OWNER-REMOVAL (the `without*` methods) | `withMemory({enabled:false})` must replay `withoutMemory` EXACTLY incl. `_memoryExplicitlyDisabled` (audit #5 risk note, wither-surface-consolidation.md:74) — test-pin it. |
| P9 | withGuardrails default-surprise | "All detectors default to `true` when enabled" (types.ts:352) — but the schema is all-optional booleans with no defaults (agent-config.ts:56-61). A user reading the config JSON sees `{}` and cannot tell injection is ON. | Encode the enable-time defaults in the schema via `Schema.optionalWith(..., { default: () => true })` so serialized config is explicit and self-documenting. | ADDITIVE-NOW | Changes serialized output (adds explicit `true`s) — verify against MAXIMAL_CONFIG roundtrip; behavior identical. |

**Which principle each fix serves:** P1/P3 (extra fields serialize) → **DP7** (option name ==
config key, symmetry) + **DP3** (the field shows in autocomplete of the config object). P2 →
**DP6** (the current silent emit-then-reject becomes a caught error) + DP7. P4 → **DP6**
(field-level validation replaces `as any`). P5 (`dir`/`path` vocabulary) → **DP2** (ecosystem-
familiar naming) + **DP3** (consistent keys are guessable). P6 (union consistency) → **DP4**
(the `boolean | Object` shape infers uniformly) + DP7. P8 (`enabled:false` twin) → **DP2/DP7**
(one disable idiom, guessable). P9 (explicit defaults) → **DP6** (self-documenting serialized
config, no hidden ON). Every P advances DP7 because the keystone below makes option shape ==
config shape by construction.

**Cross-cutting fix (the keystone) [BUILD].** Every finding above is one disease: the option
interface and the schema are maintained by hand, separately, and drift. The durable fix makes
the schema the SOLE author of each option type — e.g.
`type ToolsConfig = Schema.Schema.Type<typeof ToolsConfigSchema>` with `ToolsOptions extends
ToolsConfig` (plus code-only fields explicitly appended and descriptor-marked `overlay`).
Then P1–P4 become compile errors, not silent drops, and the generator's 1:1 guarantee holds
by construction. This is the config-shape analogue of the wither ratchet: the schema is
upstream of the option type, never a parallel copy.

---

## 7. Back-compat + migration

1. **Additive-first, both surfaces ship.** `createAgent(config)` is NET-NEW; every existing
   wither keeps working and keeps writing the same state slice. No `@deprecated` — the
   discipline test forbids it (`builder-wither-discipline.test.ts`, audit :18).
2. **Old withers keep working.** The fold work adds config OPTIONS; the standalone method
   delegates to the same state slot via a shared merge helper (the exemplar:
   `mergeRequiredToolsConfig` behind BOTH `withRequiredTools` and `withTools({required})`,
   audit :123). Serialization uses ONE state slot, one `toConfig` path.
3. **Removals are staged owner decisions.** Each `[OWNER-REMOVAL]` ships only after its
   additive side has baked, and is a CHANGELOG "BREAKING" entry that lowers `WITHER_CEILING`
   in the same commit (ratchet test :10-11). Never implicit.
4. **Codemod possibility [BUILD].** Because the correspondence map (§3.3) is machine-readable,
   a `withX(args) → config.key = args` codemod (and its inverse) is generable from
   `deriveCorrespondence()` — a jscodeshift transform driven by the same table the docs use.
   Offered, not forced.

---

## 8. Open [RATIFY] decisions

- **Q1 — `withCortex`/`withTracing` domain-vs-fold conflict.** The owner cites `withCortex`
  as the archetypal KEEP domain-opener and `withTracing` as the archetypal KEEP shortcut —
  yet audit #7/#15 fold BOTH into `withObservability`. Decision: keep them standalone AND as
  observability options (both spellings, one state slot), or pick one home? Recommendation:
  keep standalone per owner intent; the observability fan-out is a convenience alias, not a
  replacement.
- **Q2 — `withCostTracking` canonical home.** It is both a fold TARGET (pricing folds into it,
  #13) and a fold-AWAY (into `withObservability({costs})`, #7 shipped). Owner picks one
  canonical home; the §6 end-state math assumes it folds away (audit :108).
- **Q3 — honesty-rails umbrella.** Fold `withFabricationGuard` + `withStallPolicy` into
  `withGrounding` (#18)? Grounding is default-OFF opt-in with its own consent semantics; the
  fold must not change those defaults. Owner review flagged in audit :87.
- **Q5 — curated vs inferred `AgentConfig` type** (§3.1). Recommendation: ship inferred.
- **Q6 — add `profile` to `AgentConfigSchema`** (§5.2). Required for the north-star §5
  5-line quickstart to be literally true. Recommendation: YES, apply-first baseline.
- **Q7 — which folds execute in wave 1.** Recommendation: the [ADDITIVE-NOW] memory (#5),
  budget (#9), verification (#10), observability (#8) clusters first — highest DX win, lowest
  risk, all last-call-wins scalar merges.
- **Q8 — docs-gen toolchain host.** `deriveCorrespondence()` + `deriveConfigFields()` emit
  markdown into `apps/docs`? Confirm the docs build consumes generated tables (CI must fail if
  a hand-edited table drifts from the generated one — same wire-and-pin law).
- **Q9 — output-schema entry in the declarative API** (§5.6, G14). Schema objects are not JSON
  (agent-config.ts:206), so `outputSchema` can't be a data key. Options: (a)
  `createAgent(config, { schema })` second-arg overload; (b) declarative stays schema-less and
  typed output is fluent-only via `.withOutputSchema<T>()`. Recommendation: (a) — keeps DP7
  symmetry (both forms can express typed output) and DP4 inference through the second arg.

---

## 9. Gap table

| # | Position | Current state (file:line) | Delta | Test that proves it |
|---|----------|---------------------------|-------|---------------------|
| G1 | Authoritative wither count | Audit says 92/94 (wither-surface-consolidation.md:13); prototype = 89; ratchet frozen 89 (builder-wither-ratchet.test.ts:18) | Correct the audit's count reference to 89 | `builder-wither-ratchet.test.ts` green at 89 (already passing) |
| G2 | Every wither classified in FEATURE_MATRIX | `withOutputSchema` on prototype but ABSENT from FEATURE_MATRIX (88 entries vs 89 methods, feature-matrix.ts:47-141) — **verified drift** | Add `withOutputSchema` entry (capability); investigate why `feature-coverage.test.ts` did not catch it [UNVERIFIED if test currently red or excludes it] | `benchmarks/tests/feature-coverage.test.ts` DRIFT assertion |
| G3 | Every timeout wither has a schema key | `withLlmTimeout` sets `_ollamaTimeoutMs`; no `execution.llmTimeoutMs` in schema (agent-config.ts:93-105) | Add `execution.llmTimeoutMs` OR mark overlay-only w/ reason | Drift-gate (a): declared configKey must resolve |
| G4 | Capabilities round-trip through config | `withModelRouting` is `featureClass: capability` (feature-matrix.ts:86) with NO config key (overlay, builder-methods.ts:53) — a capability the declarative user cannot express | Owner decision: make routing data (add schema field) OR accept code-only capability with recorded reason | Drift-gate (b): every capability reachable by ≥1 surface |
| G5 | `createAgent` exists | No `createAgent(config)` (grep: only createAgentTool/createAgentEndpoint) | Add `create-agent.ts` (§5.1) + index export | New unit: `createAgent(MAXIMAL_CONFIG)` builds; round-trip idempotent (§4c extension) |
| G6 | `profile` expressible as data | No `profile` key in AgentConfigSchema (agent-config.ts:265-378); north-star §5 quickstart assumes it | Add `profile?` to schema, apply-first in agentConfigToBuilder | Drift-gate (c): `{profile:"lean"}` round-trips; unit: profile baseline + override |
| G7 | Descriptors carry configKey | builder-methods.ts:35 annotates configPath for ~15/89 only | Add `configKey` to all config-kind descriptors + `overlayReason` to 36 overlays | Drift-gate (a) + (b) |
| G8 | `observability.cortex` schema field | `withObservability({cortex})` fan-out (audit #7) sets state; no `observability.cortex` in schema (agent-config.ts:77-84) — fan-out doesn't serialize | Add schema field OR keep withCortex the canonical (Q1) | Drift-gate (c): cortex config round-trips |
| G9 | Docs generated, not hand-written | config-fields.ts:67 + builder-methods.ts:86 exist; not wired to `apps/docs` tables | Emit tables from deriveCorrespondence(); CI diff-gate | Docs CI: generated table ≡ committed table |
| G10 | Option type == schema shape (verification) | `serializeBuilder` emits `verification.useLLMTier` (to-config.ts:222) but `VerificationConfigSchema` lacks it (agent-config.ts:186) — toConfig() output fails re-decode; `onReject` (types.ts:542) dropped | Add both to schema (P2) | Roundtrip test: `verification.useLLMTier`/`onReject` survive; re-decode of toConfig() output does not throw |
| G11 | Observability fan-out serializes | `cortex/tracing/health/audit/logging/costs` (types.ts:632-652) absent from `ObservabilityConfigSchema` (agent-config.ts:77) | Extend schema (P3) | Roundtrip: `withObservability({cortex,tracing})` → toConfig() → back, no drop |
| G12 | Gateway field-level validation | `gateway` applied `as any` (agent-config.ts:613); `accessControl` (types.ts:733) not in schema | Add accessControl struct; drop `as any` (P4) | Drift test removes `gateway` from PASSTHROUGH_SUBTREES; field-level roundtrip holds |
| G13 | Option interfaces upstream of schema | `XOptions` interfaces hand-maintained parallel to `XConfigSchema`; drift silent (P1–P4) | Keystone: `XOptions extends Schema.Type<XConfigSchema>` + appended overlay fields | Compile error when an option field has no schema home (except explicit overlay list) |
| G14 | Output-schema type infers to result (DP4) | `AgentResult.object` typed `unknown` (builder/types.ts:973) — dev must cast | Thread schema generic: `createAgent<T>`/`.withOutputSchema<T>()` flow `T` → `result.object` | Type test: `.withOutputSchema(Z).run()` → `result.object` typed as `Z`'s type, no cast |

---

## Executive summary

The dual API is **already half-built and already drift-tested** — the spec's contribution is
to name the third projection and close the correspondence loop.

0. **Developer-first is the evaluation lens (§0, owner steering).** Every shape is judged
   "would a dev guess this right without docs, and typecheck?" Seven principles (DP1–DP7) are
   the tie-breaker: 5-line first-run, ecosystem-familiar names, autocomplete-as-menu,
   zero-ceremony inference, progressive disclosure, errors that name the fix, and
   declarative≡fluent symmetry. The single-source architecture is what makes DP7 mechanical;
   the drift-gate keeps it true. One live DP4 friction flagged: `result.object` is `unknown`
   (G14) — thread the schema generic.
1. **Single source is real, not aspirational.** `AgentConfigSchema` (agent-config.ts:265) is
   the canonical shape; the builder round-trips through it today via `toConfig()`
   (builder.ts:2244 → to-config.ts:116) and `fromConfig` (builder.ts:275 → agent-config.ts:425).
2. **89 withers, fully mapped.** Prototype reflection = 89 (matches ratchet
   `WITHER_CEILING=89`). **53 map to an AgentConfig key; 36 are reviewed code-only overlays**
   (functions/secrets/registries/test-rigs, documented in config-serialization-drift.test.ts:48).
   The mapping is TOTAL — every wither is accounted for.
3. **Generator seams EXIST.** `deriveConfigFields()` (config-fields.ts:67, Effect
   `JSONSchema.make`, v3.10 confirmed) and `deriveBuilderMethods()` (builder-methods.ts:86,
   prototype reflection) already emit descriptor lists. The new work is one JOIN
   (`deriveCorrespondence()`) plus a `configKey` field on each descriptor.
4. **Drift-gate is 2 existing + 2 new tests.** Round-trip idempotence
   (config-serialization-drift.test.ts) and the monotone ratchet
   (builder-wither-ratchet.test.ts) exist; add configKey-resolves and every-key-has-a-surface.
5. **`createAgent(config)` is thin:** validate + fromConfig + build() (§5.1). It does NOT
   exist yet (G5) — the only genuinely new user-facing code.
6. **Consolidation is additive, per owner law.** Zero methods removed by this spec; folds add
   config options (audit's 20-row table). Removals are staged, explicit, CHANGELOG-breaking
   owner decisions that lower the ratchet.
7. **Coverage stat: 89 of 89 withers mapped** (53 → config key, 36 → documented overlay).
   **Zero unexplained withers.** Genuine drifts flagged: **G2** (`withOutputSchema` missing
   from FEATURE_MATRIX — verified), **G3** (`withLlmTimeout` no schema field), **G4**
   (`withModelRouting` capability un-serializable), **G8** (`observability.cortex` fan-out
   doesn't serialize).
8. **Config-shape audit (§6.5, owner add-on):** the `XOptions` interfaces have drifted into
   supersets of their `XConfigSchema` sub-schemas — extra fields (ToolsOptions `builtins`/
   `required`, VerificationOptions `useLLMTier`/`onReject`, the whole ObservabilityOptions
   fan-out, GatewayOptions `accessControl`) silently do not serialize. P2 is a live bug:
   toConfig() emits `verification.useLLMTier` which the schema rejects on re-decode. Nine
   findings (P1–P9) with exact fixes; keystone (G13) makes the schema the sole author of each
   option type (`XOptions extends Schema.Type<XConfigSchema>`), turning silent drops into
   compile errors and holding the generator's 1:1 guarantee by construction.
9. **Top open [RATIFY] questions:** Q1 (withCortex/withTracing — owner-cited keepers vs audit
   folds), Q2 (withCostTracking canonical home), Q6 (add `profile` to schema — needed for the
   north-star 5-line quickstart to be literally true), Q7 (which folds ship in wave 1).

*Proposed 2026-07-11 (Mission W-L). Refines north-star §5. [RATIFY] items await owner
sign-off; [BUILD] items are executable. Standing discipline applies: additive only, no
implicit removals, every mechanism wired to a test that goes red when cut.*
