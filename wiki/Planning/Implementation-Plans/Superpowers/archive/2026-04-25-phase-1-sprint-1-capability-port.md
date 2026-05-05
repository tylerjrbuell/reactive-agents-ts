# Phase 1 Sprint 1 — Capability Port + Invariant Foundation

> **Branch:** `feat/phase-1-capability-port` (cut from `feat/phase-0-foundations` at `cb12242f`).
> **Spec:** `docs/spec/docs/15-design-north-star.md` §3 (Capability port) + §2 (Invariant) + §14 Phase 1.
> **Status:** PLAN. Sprint 1 of 3 estimated weeks for Phase 1.
> **Phase 0 outputs this sprint depends on:** typed errors (`@reactive-agents/core/errors`), microbench baseline, Test Gate (must add `cf-NN-num-ctx-from-capability` + `cf-NN-capability-resolved-before-llm` scenarios), G-1 surgical wiring (`838fb721` — gets replaced by capability-driven resolution).

---

## Sprint goal

Land the Capability port and the Invariant signature. After this sprint, a single function — `createRuntime(config: AgentConfig, capability: Capability) → ResolvedRuntime` — is the only composer; the builder is a pure config editor; Ollama's `num_ctx` is derived from `capability.recommendedNumCtx` instead of a global default.

This sprint **does not** cover ContextCurator unification, Task primitive, embedding batching, or Phase 4a passive Skill capture. Those are sprints 2 and 3.

---

## Stories

### S1.1 — `Capability` struct (12 fields) + schema

**Files:**
- New: `packages/llm-provider/src/capability.ts`
- New: `packages/llm-provider/tests/capability-schema.test.ts`

The struct per North Star §3:

```typescript
export interface Capability {
  readonly provider: string;                     // "ollama" | "anthropic" | "openai" | ...
  readonly model: string;                        // exact model identifier
  readonly tier: "local" | "mid" | "large" | "frontier";
  readonly maxContextTokens: number;             // hard cap from model spec
  readonly recommendedNumCtx: number;            // suggested working ctx (≤ maxContextTokens)
  readonly maxOutputTokens: number;
  readonly tokenizerFamily: "tiktoken-cl100k" | "claude" | "gemini" | "llama" | "unknown";
  readonly supportsPromptCaching: boolean;
  readonly supportsVision: boolean;
  readonly supportsThinkingMode: boolean;
  readonly supportsStreamingToolCalls: boolean;
  readonly toolCallDialect: "native-fc" | "text-parse" | "none";
  readonly source: "probe" | "static-table" | "fallback";
}
```

**Acceptance:**
- Effect Schema definition with strict typing (no `any`)
- Round-trip JSON test (parse → encode → parse identity)
- Static table covers all 6 marketed providers + at least 2 models per provider
- Existing `ProviderCapabilities` (4-field) marked `@deprecated` — to be removed in Phase 2

### S1.2 — Calibration store extension for `Capability` persistence

**Files:**
- Modify: `packages/reactive-intelligence/src/calibration/calibration-store.ts`
- Modify: `packages/reactive-intelligence/src/calibration/calibration-resolver.ts`

`Capability` becomes a stored kind alongside the existing `CalibrationProfile`. Resolution order:
1. Probed capability (cached at first use, written through to store)
2. Static-table capability (built-in)
3. Fallback capability (conservative defaults — `maxContextTokens=4096`, `recommendedNumCtx=2048`, `tier="local"`)

**Acceptance:**
- Probed capabilities persist across restarts (tested with `:memory:` + on-disk SQLite)
- `CapabilityProbeFailed` event emitted on fallback path
- Resolver test covers all 3 priority levels

### S1.3 — Capability resolver + Ollama `num_ctx` wiring (replaces G-1 surgical fix)

**Files:**
- New: `packages/llm-provider/src/capability-resolver.ts`
- Modify: `packages/llm-provider/src/providers/local.ts` (3 options blocks)
- Modify: `packages/llm-provider/src/llm-config.ts` (deprecate `defaultNumCtx`; capability is now the source)
- Existing: `packages/llm-provider/tests/num-ctx-wiring.test.ts` (rework to assert capability-driven path)

The Phase 0 surgical fix used `request.numCtx ?? config.defaultNumCtx`. Phase 1 makes this `request.numCtx ?? capability.recommendedNumCtx ?? config.defaultNumCtx`. The static table for `cogito:14b` (and similar) should yield `recommendedNumCtx: 8192`.

**Acceptance:**
- `cf-NN-num-ctx-from-capability` Test Gate scenario passes (gate:propose can scaffold)
- The existing `num-ctx-wiring.test.ts` 3 tests still pass without modification (precedence is additive)
- A new test asserts that with no `defaultNumCtx` config, capability still drives `num_ctx`

### S1.4 — Invariant: `createRuntime(config, capability)` signature

**Files:**
- Modify: `packages/runtime/src/runtime.ts` — add required `capability` parameter; today it's implicit
- Modify: `packages/runtime/src/builder.ts` — `build()` resolves capability via `S1.3` resolver, passes to `createRuntime`
- New: `packages/runtime/tests/invariant-runtime-shape.test.ts`

`createRuntime` becomes the single composer. The builder is now a pure config editor (`with*` methods only mutate `_*` fields; no behavior). The `build()` method is the one place that:
1. Snapshots `AgentConfig` from builder fields
2. Resolves `Capability` for the configured provider+model
3. Calls `createRuntime(config, capability)`

**Acceptance:**
- W4 (`withReasoning({ maxIterations })` ignored) is **fixed by construction** — `maxIterations` lives in `AgentConfig`, `createRuntime` reads it, no field-name mismatch is possible
- Existing builder-contracts tests continue to pass
- New test: `createRuntime(config, capability)` is pure (same inputs → same outputs)
- `cf-TODO-w4-withreasoning-maxiterations-ignored.ts` scaffold filled in and lifted to `cf-NN-w4-maxiterations-honored.ts`

### S1.5 — Test Gate co-evolution

**Files:**
- Fill in `packages/testing/src/gate/scenarios/cf-TODO-w4-*.ts` → rename to `cf-NN-w4-maxiterations-honored.ts`
- New: `packages/testing/src/gate/scenarios/cf-NN-num-ctx-from-capability.ts`
- New: `packages/testing/src/gate/scenarios/cf-NN-capability-resolved-before-llm.ts`
- Run `bun run gate:update` with `BASELINE-UPDATE: Phase 1 Sprint 1 Capability port + Invariant`
- Optional: run `bun run gate:propose` to confirm no remaining uncovered weaknesses from this sprint

**Acceptance:** Baseline contains 3 new scenario entries; CI gate green.

---

## Sprint 1 success gates

Per North Star §14 Phase 1 success criteria — only the subset achievable in Sprint 1 (rest land in Sprints 2-3):

- [ ] `num-ctx-sanity` probe passes on a real `cogito:14b` Ollama run (Tier 2 manual)
- [ ] W4 test passes: probe with `maxIterations: 10` runs ≤10 iterations (Tier 1)
- [ ] `Capability` round-trip schema test passes
- [ ] Test Gate has 3 new scenarios; baseline updated with `BASELINE-UPDATE:` trailer

## Out of scope for Sprint 1 (queued)

- Tier unified (`telemetry-schema.ts` consumes `Capability.tier`) — Sprint 2
- ContextCurator unification — Sprint 2
- `trustLevel` on `ObservationResultSchema` — Sprint 2 (uses Q5 grandfather decision)
- `Task` primitive — Sprint 3
- Embedding batching — Sprint 3
- Phase 4a passive Skill capture — Sprint 3 (after `AgentDebrief` extension per S0.7 verdict)

## Open questions parked

- **Q5** trust-level grandfather → resolved (user-confirmed 2026-04-24, stored in user memory). Use in Sprint 2.
- **Q6** capability scope enforcement timing → not yet relevant; revisit when ToolDefinition.capabilities lands in Sprint 2.

## Pre-flight before Sprint 1 commits start

1. Re-read `docs/spec/docs/15-design-north-star.md` §3 (Capability port detail)
2. Re-read `harness-reports/integration-control-flow-baseline.json` for current scenario shape
3. Read `packages/reactive-intelligence/src/calibration/calibration-store.ts` to understand the existing schema before extending it
4. Read `packages/llm-provider/src/llm-config.ts` `defaultNumCtx` field — understand what the surgical Phase 0 fix wired so the Phase 1 replacement is clean

Each story above is one or more atomic commits. TDD per `agent-tdd/SKILL.md`. Every commit either adds a `cf-*` scenario or carries `BASELINE-UPDATE:` if it intentionally changes existing scenario outcomes.
