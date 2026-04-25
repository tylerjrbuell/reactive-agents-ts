# Phase 1 Sprint 2 — Invariant Signature + Tier Unification + ContextCurator + trustLevel

> **Branch (after Sprint 1 merge):** `feat/phase-1-sprint-2-invariant-curator` (cut from `feat/phase-1-capability-port` HEAD).
> **Spec:** `docs/spec/docs/15-design-north-star.md` §2 (Invariant), §4 (AgentMemory + ContextCurator), §3 (Tier unification), §14 Phase 1.
> **Status:** PLAN. Sprint 2 of 3 estimated weeks for Phase 1.
> **Sprint 1 outputs this sprint depends on:** Capability port (`d90641c5`), CalibrationStore persistence (`bb55fc26`), capability resolver (`0601ba8c`), W4 regression test (`9dbf57a0`), 7 live gate scenarios.

---

## Sprint goal

Land four interconnected pieces that finish Phase 1's "Capability + Invariant + Curator" theme:
1. **Invariant signature** — `createRuntime(config: AgentConfig, capability: Capability)` becomes the sole composer (deferred from Sprint 1)
2. **Tier unified** — both `context-profile.ts` and `telemetry-schema.ts` derive from `Capability.tier` (G-2 structurally closed)
3. **`trustLevel`** on `ObservationResultSchema` — internal meta-tools grandfather to `"trusted"` per Q5
4. **ContextCurator unification** — becomes sole author of per-iteration prompts; absorbs the 3 compression systems; renders untrusted observations in `<tool_output>` blocks

Three sprints will close all of Phase 1; this is the middle one. Sprint 3 picks up Task primitive + embedding batching + Phase 4a passive Skill capture.

This sprint **does not** cover: Task primitive, embedding batching in AgentMemory adapter, Phase 4a passive Skill capture. Those need the AgentDebrief extension (S0.7 prereq) which lands in Sprint 3.

---

## Stories (5 stories, ~6-9 atomic commits)

### S2.1 — `createRuntime(config: AgentConfig, capability: Capability)` Invariant signature

**Why now:** the deferred S1.4 work. Without this, the "builder is a pure config editor; createRuntime is the sole composer" discipline is incomplete and Sprint 3's Task primitive doesn't have a clean composition seam to slot into.

**Files:**
- Modify: `packages/runtime/src/runtime.ts` (~50 option-resolution sites)
- Modify: `packages/runtime/src/builder.ts` `build()` and `_buildSubAgent` paths (~3 createRuntime call sites)
- Modify: `packages/runtime/src/agent-config.ts` if AgentConfig shape needs adjustment
- New: `packages/runtime/tests/invariant-runtime-shape.test.ts`

**Approach (incremental, not big-bang):**
1. Add `capability?: Capability` as additive optional 2nd parameter (keeps existing callers working)
2. Inside `createRuntime`, route capability into wherever it's needed (provider Layers, tier resolution, etc.)
3. Update builder's `build()` to call `resolveCapability(provider, model, { cache: calibrationStore })` and pass the result
4. Once capability is threaded through and tested, mark the parameter as required in a follow-up commit
5. Migrate the 3 internal `createRuntime` call sites in builder.ts to always pass capability
6. (Optional, slip-safe) Convert the flat `RuntimeOptions` into a nested `AgentConfig` shape — only if scope allows

**Acceptance:**
- `createRuntime(options, capability?)` builds with or without the capability parameter
- All 4,456 existing tests still pass
- New test: same `(options, capability)` inputs always yield equivalent Layers (purity)
- New test: capability is reachable inside the resulting agent's runtime (e.g. via a probe scenario)

### S2.2 — Tier unification (G-2 structural close)

**Why now:** with `Capability.tier` shipped (S1.1), both subsystems can drop their independent `ModelTier` definitions and derive from one source. Closes G-2 from "naming collision eliminated" (Phase 0 surgical) to "single source of truth" (this story).

**Files:**
- Modify: `packages/reasoning/src/context/context-profile.ts` — replace local `ModelTier` literal with re-export from `@reactive-agents/llm-provider`
- Modify: `packages/observability/src/telemetry/telemetry-schema.ts` — `TelemetryModelTier` becomes a derived type via a `toTelemetryTier(operationalTier)` mapper (already shipped at `cedf8cc8`); deprecation note becomes a removal once consumers migrate
- New: `packages/reasoning/tests/context/tier-source-of-truth.test.ts`

**Acceptance:**
- `context-profile.ts` ModelTier IS structurally identical to `Capability['tier']` (compile-time check)
- All existing consumers of context-profile's ModelTier compile unchanged
- New gate scenario: `cf-NN-tier-derived-from-capability` pins the structural identity

### S2.3 — `trustLevel` on `ObservationResultSchema`

**Why now:** Q5 grandfather decision is locked (user-confirmed 2026-04-24). ContextCurator (S2.5) needs `trustLevel` to render untrusted observations in `<tool_output>` blocks for prompt-injection defense.

**Files:**
- Modify: `packages/core/src/schemas/observation-result.ts` (find canonical location with grep)
- Modify: every internal meta-tool definition (~15 sites) — add `trustLevel: "trusted"` + `trustJustification: "grandfather-phase-1"`
- New: `packages/core/tests/observation-result-trust-level.test.ts`

**Acceptance:**
- `trustLevel` field is a `Schema.Literal("trusted", "untrusted")` with `"untrusted"` default for user-defined tools
- All 15 internal meta-tools have `trustLevel: "trusted"` + grandfather justification
- New gate scenario: `cf-NN-meta-tools-trusted` pins the trust assignments
- Phase 3 lint TODO captured in `harness-reports/loop-state.json` to enforce real justifications before v1.0

### S2.4 — Builder probe-on-first-use → cache write-through

**Why now:** Sprint 1 shipped the cache (`saveCapability`) and the resolver (reads from cache). The missing piece is the *writer* — the builder must probe a model on first use and persist the result so subsequent runs skip the probe.

**Files:**
- New: `packages/llm-provider/src/probe-capability.ts` — provider-specific probe orchestration
- Modify: `packages/runtime/src/builder.ts` `build()` — wire the probe + cache write before the runtime layer constructs
- New: `packages/llm-provider/tests/probe-capability.test.ts`
- New: `packages/runtime/tests/builder-probe-write-through.test.ts`

**Approach:**
- Probe surface: `probeCapability(provider, model, opts) → Effect<Capability, ProbeError>`. Each provider's adapter implements its own probe (Ollama via `/api/show`, Anthropic via capability discovery, etc.). Conservative initial set: only Ollama + a no-op for cloud providers (their static-table entries are good enough for now).
- Builder calls probe once at `build()` time; on success writes through with `source: "probe"`; on failure swallows the error and lets resolver fall through to static-table.

**Acceptance:**
- Probed capability persists to disk via CalibrationStore (covered by `bb55fc26` tests; this story exercises end-to-end)
- Subsequent `build()` for the same (provider, model) skips re-probing
- Probe failure does not block builder (`CapabilityProbeFailed` event emitted via `onProbeFailed`)

### S2.5 — ContextCurator becomes sole prompt author + absorbs compression

**Why now:** the Phase 1 marquee deliverable. North Star §4 says ContextCurator is the single author of every per-iteration prompt; Sprint 2's other stories (Invariant, tier, trustLevel) are prerequisites for it to ship cleanly.

**Files:**
- Modify: `packages/reasoning/src/strategies/kernel/utils/context-utils.ts` (current prompt-construction site)
- Modify: `packages/reasoning/src/strategies/kernel/utils/tool-formatting.ts` (compression Path A — currently always-on)
- Modify: `packages/reactive-intelligence/src/controller/context-compressor.ts` (compression Path B — advisory)
- Modify: `packages/reactive-intelligence/src/controller/patch-applier.ts` (compression Path C — message-slicing patch)
- New: `packages/reasoning/src/strategies/kernel/utils/context-curator.ts`
- New: `packages/reasoning/tests/kernel/context-curator.test.ts`

**Approach (largest story; budget 1.5-2 days):**
1. Define `ContextCurator` interface that takes `(state, capability, observations) → Prompt`
2. Implement per-tier compression budget derived from `capability.maxContextTokens / recommendedNumCtx`
3. Render observations: trusted ones inline; untrusted ones in `<tool_output>` blocks (defends against prompt injection from tool results)
4. Migrate the 3 existing compression sites to call into the curator
5. The 3 old paths become DEAD CODE — delete them once the new path is verified
6. Add gate scenario `cf-NN-untrusted-observation-rendered` pinning the trust-aware rendering

**Acceptance:**
- ContextCurator is the only producer of per-iteration prompts (grep proves no other site constructs prompts directly)
- The 3 prior compression systems are deleted (G-4 closed)
- Untrusted observations render in `<tool_output>` blocks (prompt-injection defense)
- New gate scenario passes

---

## Sprint 2 success gates

Per North Star §14 Phase 1 success criteria — Sprint 2 lands the subset:

- [ ] `Capability` is the sole driver for `num_ctx` (already true from S1.3) AND for tier-derived behavior (new in S2.2)
- [ ] G-2 structurally closed: one ModelTier source, two consumer schemas
- [ ] G-4 closed: ContextCurator is the sole prompt author, 3 compression systems deleted
- [ ] All 15 internal meta-tools carry `trustLevel: "trusted"` + grandfather justification
- [ ] Capability cache write-through works end-to-end (build → probe → cache → next build skips probe)
- [ ] Three new gate scenarios committed with `BASELINE-UPDATE:` trailer

## Out of scope for Sprint 2 (queued for Sprint 3)

- Task primitive (Sprint 3)
- Embedding batching inside default `AgentMemory` adapter (Sprint 3)
- Phase 4a passive Skill capture — gated on AgentDebrief extension per S0.7 verdict (Sprint 3)
- AgentDebrief extension itself (Sprint 3 prereq for Phase 4a)

## Open questions parked

- **Q5** trust-level grandfather → resolved (apply in S2.3)
- **Q6** capability scope enforcement timing → relevant when Sprint 3's Task primitive lands
- **Q11** Task.requireVerification default → Phase 2 Verification port concern, not Phase 1
- **Q13** Default invariant enforcement levels → Phase 3 concern

## Pre-flight before Sprint 2 commits start

1. Re-read `docs/spec/docs/15-design-north-star.md` §4 (AgentMemory + ContextCurator detail)
2. `bun run gate:health` — confirm Sprint 1's 7 scenarios are still healthy on the new branch
3. Read `packages/reasoning/src/strategies/kernel/utils/context-utils.ts` to size the ContextCurator extraction before starting S2.5
4. Read `packages/runtime/src/runtime.ts` lines 802-1100 to understand the option resolution chain before attempting S2.1's signature change

Each story above is one or more atomic commits. TDD per `agent-tdd/SKILL.md`. Every commit either adds a `cf-*` scenario or carries `BASELINE-UPDATE:` if it intentionally changes existing scenario outcomes.
