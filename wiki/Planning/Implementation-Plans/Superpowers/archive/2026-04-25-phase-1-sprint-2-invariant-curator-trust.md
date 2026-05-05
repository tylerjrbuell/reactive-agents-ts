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

**Status:** PARTIALLY SHIPPED (`e139b7ee`). User feedback during a real-world `scratch.ts` run on `gemma4:e4b` exposed that the static-table approach didn't scale; lifted the probe forward into the same session.

**What shipped (`e139b7ee`):**
- `packages/llm-provider/src/providers/local-probe.ts` — `probeOllamaCapability(model, baseUrl)` translates Ollama's `/api/show` response (capabilities array, family, parameter size, `model_info.<family>.context_length`) into a Capability descriptor.
- `local.ts` integrates the probe inline in all 3 request paths (complete / stream / structured-output) with module-scope caching so probes happen at most once per (baseUrl, model) per process.
- Static table pruned back to "tested baseline" models only (cogito:14b, qwen3:14b for Ollama); probe handles the long tail.
- 6 fixture-based tests pinning the translation logic + cache behavior + error handling.
- Verified end-to-end: `scratch.ts` that failed before now succeeds (gemma4:e4b correctly identified as 128K context, native-fc tools support → produced full markdown HN summary in 37s).

**What still needs to ship (small follow-up, ~30 LOC):**
- Cross-process persistence via `CalibrationStore.saveCapability` write-through. Currently the probe cache lives in module scope (lost on process restart). The follow-up wires:
  1. Builder calls `probeOllamaCapability` once at `build()` time when the configured provider is `ollama`
  2. On success, write through to CalibrationStore via `saveCapability`
  3. Subsequent builds in fresh processes hit the SQLite cache via `loadCapability`, skipping the network probe entirely
- Slot this after S2.5 (ContextCurator) lands, or pick up as opportunistic cleanup.

### S2.5 — ContextCurator becomes sole prompt author + absorbs compression

**Status (2026-04-25):** SHIPPED (sliced) — port + section authorship + production wiring landed across commits `aa52eafa` (Slice A), `d506e868` (Slice B), and Slice C (this commit). Compression-system deletion (G-4 full closure) deferred to Sprint 3 — see "Deferred" subsection below.

**Why now:** the Phase 1 marquee deliverable. North Star §4 says ContextCurator is the single author of every per-iteration prompt; Sprint 2's other stories (Invariant, tier, trustLevel) are prerequisites for it to ship cleanly.

**What shipped (Slice A → C):**

*Slice A — port + render primitive (commit `aa52eafa`)*
- New `packages/reasoning/src/context/context-curator.ts` defines `Prompt`, `ContextCurator`, `defaultContextCurator` (byte-identical wrapper over `ContextManager.build`), and `renderObservationForPrompt(obs)` (untrusted → `<tool_output tool="...">` wrapping; trusted → plain).
- `think.ts` swaps `ContextManager.build(...)` call for `defaultContextCurator.curate(...)` — three-line indirection, no behavior change.
- Gate `cf-19-untrusted-observation-rendered` pins port presence + render contract (6 assertions).

*Slice B — curator authors its own section (commit `d506e868`)*
- `CuratorOptions extends ContextManagerOptions` with `includeRecentObservations?: number`.
- `buildRecentObservationsSection(steps, limit)` — pure functional pipeline (typed predicate filter → `slice(-N)` → map render → join).
- Curator becomes first author of "Recent tool observations:" tail section. Off-by-default preserves Slice A byte-identity.
- Gate `cf-20-curator-renders-untrusted-section` pins the section contract (8 assertions).

*Slice C — production wiring (this commit)*
- `ContextProfile.recentObservationsLimit?: number` added to schema.
- All tier defaults remain 0/undefined — opt-in per agent via `profileOverrides`, never auto-on globally (turning it on globally would change every prompt's token budget unilaterally — that's an agent decision).
- `think.ts` reads `profile.recentObservationsLimit ?? 0` and threads it into the curator option.
- Three new tests in `context-curator.test.ts` pin the convention: tier defaults are off, override threads through, undefined → off.

**Acceptance — what landed:**
- ✅ ContextCurator is the only producer of per-iteration kernel prompts (think.ts → curator → ContextManager). Reflexion strategy keeps its own local `buildSystemPrompt` (unrelated, its own loop).
- ✅ Untrusted observations render in `<tool_output>` blocks (prompt-injection defense) when the section is enabled.
- ✅ Two new gate scenarios pin both the port and the section contract.
- ✅ Production wiring lands behind opt-in profile field — no surprise prompt changes for existing agents.

**Deferred to Sprint 3 (G-4 full closure):**
- Migration of the 3 existing compression sites (`tool-formatting.ts` always-on, `context-compressor.ts` advisory, `patch-applier.ts` message-slicing) into the curator.
- Per-tier compression budget derived from `capability.maxContextTokens / recommendedNumCtx`.
- Deletion of the 3 old compression paths once the new path is verified.
- Reason for deferral: per advisor guidance (2026-04-25), tool-formatting compression has a different lifecycle (per-tool inside `act`, not per-iteration inside `think`); folding it into the curator requires lifecycle alignment work that fits cleanly inside Sprint 3 alongside Task primitive work. Slicing S2.5 protects against the marquee story becoming a long-running branch.

---

## Sprint 2 success gates

Per North Star §14 Phase 1 success criteria — Sprint 2 lands the subset:

- [x] `Capability` is the sole driver for `num_ctx` (already true from S1.3) AND for tier-derived behavior (new in S2.2)
- [x] G-2 structurally closed: one ModelTier source, two consumer schemas
- [~] G-4 PARTIALLY closed: ContextCurator IS the sole prompt author (Slices A-C); 3 compression systems still present — deletion deferred to Sprint 3 with curator integration
- [x] Internal meta-tools carry `trustLevel: "trusted"` + grandfather justification (8 names in `KNOWN_TRUSTED_TOOL_NAMES`)
- [ ] Capability cache write-through end-to-end (build → probe → cache → next build skips probe) — S2.4 follow-up
- [x] New gate scenarios committed with `BASELINE-UPDATE:` trailer: cf-15 (num_ctx), cf-16 (cache roundtrip), cf-17 (tier identity), cf-18 (meta-tools trusted), cf-19 (curator port + render primitive), cf-20 (curator section authorship)

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
