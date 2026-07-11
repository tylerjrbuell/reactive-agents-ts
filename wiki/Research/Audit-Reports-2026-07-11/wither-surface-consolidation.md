# Wither-Surface Consolidation Audit — 2026-07-11

**Mission W-F.** Builder-surface consolidation audit + one exemplar fold (shipped: `withRequiredTools` → `withTools({ required })`).

**Standing law (owner):** consolidation is ADDITIVE. No `@deprecated`, no removal of working documented methods to shrink a count. Every fold below adds a config option on an existing wither; the old wither keeps working and writes the same underlying state. Actual removals are owner decisions — candidates are tagged `[OWNER-REMOVAL]` and listed at the end.

**North-star §5 framing:** profiles-first; wither count only decreases; new capability = config option on an existing wither, not a new method. Judged by USER mental model: one concept = one entry point.

---

## 0. Inventory — the actual count

`packages/runtime/src/builder.ts` declares **92 unique public `with*`/`without*` method names**. The frozen ratchet of **94** counts overload *signatures*: `withModel` (2 declarations) and `withReactiveIntelligence` (2 declarations) each contribute one extra line — 92 names + 2 extra overload signatures = 94.

Wither bodies are split between inline `builder.ts` and `src/builder/withers/` (`tools.ts`, `memory.ts`, `model-budget.ts`, `prompt-reasoning.ts`, `profile-error.ts`, shared state view `_state.ts`). Profiles live in `src/capabilities/profile.ts` (`lean` / `balanced` / `intelligent` patches applied via `.withProfile()`).

Guard rails already in place:
- `tests/builder-wither-discipline.test.ts` — asserts documented capability methods EXIST and are NOT `@deprecated` (the inverse of a count ceiling; codifies the 2026-05-29 anti-metric-gaming correction).
- `tests/config-serialization-drift.test.ts` — every `AgentConfig` schema leaf must roundtrip `config → builder → toConfig()`.

---

## 1. Cluster map (92 methods, 11 clusters)

### A. Identity & plumbing (8)
`withName`, `withAgentId`, `withPersona`, `withSystemPrompt`, `withEnvironment`, `withTaskContext`, `withContextProfile`, `withCalibration`

### B. Model / provider / transport (9)
`withModel`, `withProvider`, `withThinking`, `withModelRouting`, `withFallbacks`, `withReplayLLM`, `withModelPricing`, `withDynamicPricing`, `withCacheTimeout`

### C. Tools (7)
`withTools`, `withTerminalTools`, `withDocuments`, `withRequiredTools`, `withMCP`, `withMetaTools`, `withSkills`

### D. Multi-agent / network (8)
`withAgentTool`, `withDynamicSubAgents`, `withRemoteAgent`, `withA2A`, `withGateway`, `withChannels`, `withIdentity`, `withOrchestration`

### E. Memory / learning (8)
`withMemory`, `withoutMemory`, `withLearning`, `withSkillPersistence`, `withExperienceLearning`, `withMemoryConsolidation`, `withSelfImprovement`, `withEvents`*

\* `withEvents` enables the event-stream layer; arguably observability — counted here once, not twice.

### F. Reasoning / strategy / harness posture (6)
`withReasoning`, `withReactiveIntelligence`, `withAdaptiveHarness`, `withLongHorizon`, `withLeanHarness`, `withProfile`

### G. Guards / validation / honesty rails (14)
`withGuardrails`, `withVerification`, `withVerificationStep`, `withOutputValidator`, `withStrictValidation`, `withLazyValidation`, `withGrounding`, `withFabricationGuard`, `withStallPolicy`, `withOutputSchema`, `withContract`, `withBehavioralContracts`, `withReceiptSigning`, `withCustomTermination`

### H. Budget / termination / resilience (12)
`withBudget`, `withMaxIterations`, `withMinIterations`, `withTimeout`, `withLlmTimeout`, `withRetryPolicy`, `withCircuitBreaker`, `withoutCircuitBreaker`, `withRateLimiting`, `withKillSwitch`, `withErrorHandler`, `withProgressCheckpoint`

### I. Observability / telemetry (10)
`withObservability`, `withoutObservability`, `withCortex`, `withTelemetry`, `withLogging`, `withTracing`, `withoutTracing`, `withAudit`, `withCostTracking`, `withHealthCheck`

### J. Lifecycle / durability / HITL (7)
`withDurableRuns`, `withApprovalPolicy`, `withUserInteraction`, `withInteraction`, `withHook`, `withHarness`, `withStreaming`

### K. Escape hatches / test rig / misc (3)
`withLayers`, `withTestScenario`, `withPrompts`

(8+9+7+8+8+6+14+12+10+7+3 = 92.)

---

## 2. Fold table

Legend: **[ADDITIVE-NOW]** = safe to implement immediately (new config option, old wither delegates/merges into same state). **[OWNER-REMOVAL]** = the additive side exists (or would, after the ADDITIVE-NOW work); retiring the standalone wither is an owner decision. **[SHIPPED]** = fold already exists in code today.

| # | Target wither | Folds into it | Proposed config shape (TS literal) | Back-compat plan | Risk | DX win | Tag |
|---|---|---|---|---|---|---|---|
| 1 | `withTools` | `withRequiredTools` | `withTools({ required: readonly string[] \| { tools?: readonly string[]; adaptive?: boolean; maxRetries?: number } })` | Both spellings write `_requiredToolsConfig` via one merge helper. Conflict rule: tool lists UNION (deduped, first-seen order); `adaptive`/`maxRetries` last-call-wins. **Semantic note:** a non-empty static `tools` list SUPPRESSES the adaptive tool classifier (`classifier.ts` `hasStaticRequiredList` — caller stated their requirements, no LLM inference round-trip). | Low | High — "which tools" and "which tools are mandatory" are one mental model | **[SHIPPED 2026-07-11]** (this session — exemplar) |
| 2 | `withTools` | `withTerminalTools` | `withTools({ terminal: boolean \| ShellExecuteConfig })` | Already wired — `applyWithTerminalTools` writes `_toolsOptions.terminal`; JSDoc already says "Equivalent to `.withTools({ terminal })`". | None | Medium | **[SHIPPED]** → standalone is [OWNER-REMOVAL] |
| 3 | `withTools` | `withDocuments` | `withTools({ documents: DocumentSpec[] })` (accumulating, like today's `withDocuments`) | New option appends to `_documents` + sets `_enableTools`, exactly `applyWithDocuments`. **Doc-drift found:** `withDocuments` JSDoc claims a composable equivalent `.withTools({ rag: { documents } })` that DOES NOT EXIST in `ToolsOptions` — fix the JSDoc when implementing. | Low | Medium | [ADDITIVE-NOW] |
| 4 | `withTools` | `withMCP` | `withTools({ mcp: MCPServerConfig \| MCPServerConfig[] })` (appends to `_mcpServers`) | Same append semantics as `applyWithMCP`; both spellings accumulate. | Low | Medium — MCP servers are just tool sources | [ADDITIVE-NOW] |
| 5 | `withMemory` | `withoutMemory`, `withSkillPersistence`, `withExperienceLearning`, `withMemoryConsolidation` | `withMemory({ enabled?: boolean; tier?: 'standard' \| 'enhanced'; skillPersistence?: boolean; experienceLearning?: boolean; consolidation?: boolean \| { threshold?: number; decayFactor?: number; pruneThreshold?: number }; /* + existing MemoryOptions */ })` | `enabled: false` replays `applyWithoutMemory` (incl. `_memoryExplicitlyDisabled`, session persist off); others map 1:1 to existing flags. Old withers delegate to the same state slots. Conflict rule: last-call-wins per field. | Low-Med (the `enabled:false` full-stack-off semantics must match `withoutMemory` exactly — test-pin it) | High — 5 entry points into one "memory" concept today | [ADDITIVE-NOW] |
| 6 | `withLearning` | `withSelfImprovement` | `withLearning({ tier?, dbPath?, selfImprovement?: boolean })` | `selfImprovement: true` sets the same `_enableSelfImprovement` flag. `withLearning` is the documented compounding-intelligence bundle; keep it as the umbrella. | Low | Medium | [ADDITIVE-NOW] |
| 7 | `withObservability` | `withCortex`, `withTelemetry`, `withLogging`, `withTracing`, `withoutTracing`, `withAudit`, `withHealthCheck`, `withCostTracking` | `withObservability({ cortex?, telemetry?, logging?, tracing?: false \| { dir? }, audit?, health?, costs? })` | **Already wired** (v0.12 DX wave — `withObservability` fans all seven out to the same state the dedicated methods set; last call wins). | None | High | **[SHIPPED]** → 8 standalones are [OWNER-REMOVAL] |
| 8 | `withObservability` | `withoutObservability`, `withEvents`, `withStreaming` | `withObservability({ enabled?: boolean; events?: boolean; streaming?: { density?: StreamDensity } })` | `enabled: false` ≡ `withoutObservability()`; `events`/`streaming` set the same flags as the standalones. | Low | Medium | [ADDITIVE-NOW] |
| 9 | `withBudget` | `withMaxIterations`, `withMinIterations`, `withTimeout`, `withLlmTimeout` | `withBudget({ tokenLimit?, costLimit?, warningRatio?, maxIterations?: number, minIterations?: number, timeoutMs?: number, llmTimeoutMs?: number })` | Each new field writes the exact state the standalone sets (`_maxIterations`, `_minIterations`, `_executionTimeoutMs`, `_ollamaTimeoutMs`). Relax `applyWithBudget`'s "requires tokenLimit or costLimit" throw to "requires at least one field". Note `withReasoning({ maxIterations })` ALREADY propagates to `_maxIterations` — document `withBudget` as the canonical home. | Low-Med (most-restrictive resolution rule in `strategies/reactive.ts` must stay intact) | High — every "how much can this run cost/take" question in one place | [ADDITIVE-NOW] |
| 10 | `withVerification` | `withVerificationStep`, `withOutputValidator`, `withStrictValidation`, `withLazyValidation` | `withVerification({ /* existing VerificationOptions */, step?: { mode?: 'reflect'; prompt?: string }, outputValidator?: (output: string) => boolean \| { valid: boolean; reason?: string }, timing?: 'strict' \| 'lazy' })` | `step` writes `_verificationStep` (same as `applyWithVerificationStep`); `outputValidator` writes `_outputValidator`; `timing` maps to the strict/lazy flags. Old withers keep working; last-call-wins per field. | Low | High — four "check the output" spellings today; `withVerification` is the documented umbrella | [ADDITIVE-NOW] |
| 11 | `withCircuitBreaker` | `withoutCircuitBreaker` | `withCircuitBreaker(false)` (i.e. `config: Partial<CircuitBreakerConfig> \| false`) | `_circuitBreakerConfig` already models disabled as `false` (see `to-config.ts:335`) — the state slot supports it today; only the signature needs the union. | None | Medium — with/without pair collapses to a boolean-capable arg | [ADDITIVE-NOW] |
| 12 | `withModel` | `withThinking` | `withModel({ model?, thinking?: boolean \| ThinkingOptions, temperature?, maxTokens?, numCtx? })` | **Already wired** — `applyWithModel` object form accepts `thinking` and writes the same `_thinking` state. | None | Medium | **[SHIPPED]** → `withThinking` standalone is [OWNER-REMOVAL] (popular; likely keep) |
| 13 | `withCostTracking` | `withModelPricing`, `withDynamicPricing` | `withCostTracking({ /* existing CostTrackingOptions */, pricing?: Record<string, { input: number; output: number }>, dynamicPricing?: boolean \| DynamicPricingOptions })` | Pricing is a cost-tracking concern in the user's mental model; new fields write the same registries the standalones set. | Low | Medium | [ADDITIVE-NOW] |
| 14 | `withProfile` | `withLeanHarness` | `withProfile(HarnessProfile.lean())` | Already the documented replacement — but NOT semantically identical today: `applyWithLeanHarness` sets `_leanHarness` + memory off, while `lean()` additionally disables RI (the historical `.withLeanHarness()` leak, profile.ts:5-13). Fold = document `lean()` as canonical; keep `withLeanHarness` byte-compatible for existing users. | Med (semantic gap is load-bearing history) | Medium | [OWNER-REMOVAL] (decide whether the leak is a bug or a contract) |
| 15 | `withTracing` | `withoutTracing` | `withTracing(false)` (i.e. `opts: false \| { dir?: string }`) — or rely on shipped `withObservability({ tracing: false })` | `_tracingConfig = null` is the existing disabled state. | None | Low-Med | [ADDITIVE-NOW] |
| 16 | `withInteraction` | `withUserInteraction` | `withInteraction({ agentInitiated?: boolean })` — `agentInitiated: true` sets `_userInteraction` (durable `request_user_input` rail; requires `.withDurableRuns()`) | Two near-identical names for adjacent concepts is the worst DX offender in the surface (`withInteraction` = approval/interaction layer; `withUserInteraction` = agent-initiated durable ask). Fold under one entry with a documented option. | Med (different rails: in-process layer vs durable pause — docs must be explicit) | High (naming confusion) | [ADDITIVE-NOW] |
| 17 | `withReasoning` | `withCustomTermination`, `withProgressCheckpoint` | `withReasoning({ /* existing */, customTermination?: (state: { output: string }) => boolean, progressCheckpoint?: { every?: number; prompt?: string } })` | Termination/checkpoint are reasoning-loop concerns; fields write the same state slots. | Low | Low-Med | [ADDITIVE-NOW] |
| 18 | `withGrounding` | `withFabricationGuard`, `withStallPolicy` | `withGrounding({ mode, tolerance?, maxRetries?, fabricationGuard?: FabricationGuardMode, stallPolicy?: StallPolicy })` | All three are "honesty rails on the kernel loop"; one umbrella matches how docs sell them. Standalones stay. | Med (grounding is default-OFF opt-in with its own consent semantics — folding must not change defaults) | Medium | [ADDITIVE-NOW], flag for owner review |
| 19 | `withProvider` | `withRetryPolicy`, `withRateLimiting`, `withCacheTimeout` | `withProvider('ollama', { retry?: { maxRetries; backoffMs }, rateLimit?: RateLimiterConfig, cacheTimeoutMs?: number })` | Transport resilience lives with the transport choice. Second param is additive; string-only form unchanged. | Med (withProvider is the most-called wither; signature must stay drop-in) | Medium | [ADDITIVE-NOW] |
| 20 | `withContract` | `withBehavioralContracts` | `withContract(contract, { behavioral?: BehavioralContract[] })` or `withContract({ task?, behavioral? })` | Both are "declared obligations the run must honor". Needs shape design — behavioral contracts have their own enforcement path. | Med | Low-Med | audit-only; not scheduled |

**Not folded (deliberately, one concept each):** `withName`/`withAgentId`/`withPersona`/`withSystemPrompt` (identity is fine-grained on purpose), `withOutputSchema` (typed-output rail, distinct from verification), `withGuardrails` (input safety ≠ output verification), `withDurableRuns`/`withApprovalPolicy` (durability rails), `withHook`/`withHarness`/`withLayers`/`withReplayLLM`/`withTestScenario` (escape hatches/test rig), `withMetaTools`/`withSkills` (each one concept), multi-agent cluster D (each method is a distinct topology primitive), `withKillSwitch`, `withErrorHandler`, `withFallbacks`, `withModelRouting`, `withAdaptiveHarness`, `withLongHorizon`, `withReactiveIntelligence`, `withCalibration`, `withContextProfile`, `withEnvironment`+`withTaskContext` (adjacent but different consumers — candidate for a future doc-level clarification, not a fold), `withPrompts`, `withOrchestration`, `withIdentity`, `withEvents` (pending #8), `withStreaming` (pending #8).

---

## 3. End-state math

- Today: **92 unique withers** (94 overload signatures — the frozen ratchet).
- **[ADDITIVE-NOW] work changes the count by 0** (by design — no new methods, config options only). It establishes a canonical config path for every cluster: `withTools`, `withMemory`, `withLearning`, `withObservability`, `withBudget`, `withVerification`, `withModel`, `withCostTracking`, `withProvider`, `withGrounding`, `withReasoning`, `withInteraction`, `withCircuitBreaker`, `withTracing`, `withProfile`.
- **If the owner later executes every [OWNER-REMOVAL]** (only after the additive side ships and bakes):
  - Tools: −4 (`withTerminalTools`, `withDocuments`, `withRequiredTools`, `withMCP`)
  - Memory/learning: −5 (`withoutMemory`, `withSkillPersistence`, `withExperienceLearning`, `withMemoryConsolidation`, `withSelfImprovement`)
  - Observability: −10 (`withCortex`, `withTelemetry`, `withLogging`, `withTracing`, `withoutTracing`, `withoutObservability`, `withAudit`, `withHealthCheck`, `withCostTracking`†, `withEvents`)
  - Budget/termination: −4 (`withMaxIterations`, `withMinIterations`, `withTimeout`, `withLlmTimeout`)
  - Verification: −4 (`withVerificationStep`, `withOutputValidator`, `withStrictValidation`, `withLazyValidation`)
  - Model/pricing: −3 (`withThinking`, `withModelPricing`, `withDynamicPricing`)
  - Resilience: −4 (`withoutCircuitBreaker`, `withRetryPolicy`, `withRateLimiting`, `withCacheTimeout`)
  - Posture/HITL: −2 (`withLeanHarness`, `withUserInteraction`)
  - † `withCostTracking` appears as both a fold target (#13) and a fold-away into `withObservability({costs})` (#7, shipped) — owner picks ONE canonical home; the count assumes it folds away.
  - **Total: −36 → end state ≈ 56 methods** (keep ≈ 56, fold-then-owner-decides-removal = 36).
- Realistic near-term target if the owner keeps the most-popular conveniences (`withThinking`, `withMemory` satellites trimmed but `withLearning` kept, etc.): **~65-70**.

## 4. Bugs / drift found during audit

1. **`withDocuments` JSDoc drift** (`builder.ts:1425`): claims composable equivalent `.withTools({ rag: { documents: docs } })` — no `rag` field exists on `ToolsOptions`. Fix alongside fold #3.
2. **`withLeanHarness` vs `HarnessProfile.lean()` semantic gap** is real and documented in `profile.ts` — but `withLeanHarness`'s own JSDoc does not warn that it leaves RI enabled. Worth a one-line doc patch.
3. **Pre-fold `withRequiredTools` had last-write-REPLACE semantics** across repeated calls (silent config loss). The shipped fold upgrades both spellings to union-merge (documented conflict rule) — strictly less surprising.

## 5. Exemplar fold — shipped this session

`withTools({ required })` ≡ `withRequiredTools(config)`:

- `packages/runtime/src/builder/types.ts` — `ToolsOptions.required?: readonly string[] | RequiredToolsOptions` (+ exported `RequiredToolsOptions` interface); shorthand array ≡ `{ tools: [...] }` (matches the `builtins`/`terminal` union convention). Classifier-suppression semantics documented on the option.
- `packages/runtime/src/builder/withers/tools.ts` — single `mergeRequiredToolsConfig` helper behind BOTH spellings (union tools / last-wins scalars); `required` is routed to `_requiredToolsConfig`, NOT stored in `_toolsOptions` (one state slot, one serialization path via `toConfig().requiredTools`).
- `packages/runtime/src/builder.ts` — JSDoc on both methods documents the equivalence + conflict rule; `RequiredToolsOptions` re-exported.
- `packages/runtime/tests/builder-tools-required-option.test.ts` — 7 tests: whole-config equivalence both spellings, shorthand ≡ object form, adaptive opt-out parity, union+last-wins conflict rule (both orders), classifier suppression via the NEW option (LLM layer dies if invoked — mirrors `engine-phases-classifier.test.ts`), old-method back-compat, no leakage into the tools options slot.
- Verified: new file 7/7 pass; full `bun test packages/runtime` 1271 pass / 1 skip / 0 fail (209 files); `bunx tsc --noEmit -p packages/runtime` clean. No new builder method — wither-discipline and serialization-drift gates untouched and green.
