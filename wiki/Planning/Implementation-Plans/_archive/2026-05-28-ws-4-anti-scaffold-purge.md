---
title: WS-4 — Anti-Scaffold Purge (declared-surface emit/consumer reconciliation)
date: 2026-05-28
status: 🟡 PARTIAL (code-verified 2026-06-02) — convergence Phase 1 wired the Compose tags; @reactive-agents/observe + compose still dead (1 caller each)
master-plan: 2026-05-28-canonical-refactor.md (§4 RC-3 + §6.2 WS-4 summary)
architecture-model: 2026-05-28-canonical-architecture-model.md (§9 emit/consume contract)
root-cause-closed: RC-3 (declared surface elements without paired emit + consumer)
gh-issues-closed: [#112 (RI→Compose bridge), #116 (ControllerDecision prune), #119 (triple compression coordination), #120 (learn/ wiring verify), #121 (multi-severity verifier), #122 (cross-session default-on), #160 (confidenceFloor disposition), #170 (observe + M12 hooks dead-surface)]
authoritative-anchor: master-plan §4 RC-3 + architecture-model §9 emit/consume law + canonical anti-mission #6
owner: cross-cutting (compose-warden + ablation-warden + kernel-warden depending on phase)
session-budget: ~1 week (5 phases, each ~1 session)
risk: MEDIUM (per-phase isolated; coordination required across packages for some phases)
prerequisite: PR #172 merged + WS-2 shipped (HarnessProfile generalization depends on WS-2 typed seam)
---

# WS-4 — Anti-Scaffold Purge

## Goal (one sentence)

For every declared surface element without a paired live emit + consumer, ship the wiring AND the consumer in the same commit OR delete the declaration — eliminating the "scaffold without callers" anti-pattern (architecture model §9, anti-mission #6) and unblocking the CI lint that enforces it forward.

## Anchor

- **Architecture model §9** — the emit/consume contract: every TagMap entry, ControllerDecision variant, CapabilityRegistry entry, calibration field, public service method has an emit site + a consumer site shipped in the same commit
- **Anti-mission #6** — "NOT an advertised-surface-without-callers framework"
- **Master plan §3.4 RC-3** — concrete violation inventory (observe pkg 0 callers; 5 of 6 M12 hooks unused; 4 dead Compose tags; confidenceFloor docs lie; etc.)
- **Master plan §3.6 F7** — HarnessProfilePatch has growth risk (hard-coded fields will inflate as registry grows)

## Phase Inventory

### Phase 1 — Compose tag emit wiring (closes #112)

**Symptom:** 4 declared TagMap entries have no `pipeline.transform(...)` consumer site emitting them. Tags shipped + tested but the RI→Compose bridge that should light them is unwired.

**Files touched:** `packages/reactive-intelligence/src/controller/dispatcher-compose-bridge.ts` (or whichever bridge file already partially exists per #112)

**Scope:**
- Audit: confirm the 4 dead tags via `grep -rE "pipeline.transform.*<tag-name>" packages/`
- Wire each tag to its corresponding RI controller decision: when RI's dispatcher decides X, it calls `pipeline.transform("X", payload, ctx)` so consumers see the event
- Verify each newly-lit tag has at least one downstream consumer (test or production); if not, delete the tag declaration

**Done:**
- [ ] All 4 previously-dead Compose tags have `pipeline.transform(...)` emit sites
- [ ] At least one downstream consumer per tag (test or production)
- [ ] No new tag declarations introduced without paired wiring

### Phase 2 — ControllerDecision union prune (closes #116)

**Symptom:** Per audit, 8 of 13 `ControllerDecision` variants have zero emit/consumer pairs. Type union is wide; logic is narrow.

**Files touched:** `packages/reactive-intelligence/src/types.ts` (or wherever ControllerDecision is defined), `packages/reactive-intelligence/src/controller/handlers/` (handlers that map variants to actions)

**Scope:**
- Enumerate all 13 ControllerDecision variants via `grep -E "decision: \"" packages/reactive-intelligence/`
- For each variant: confirm (a) ≥1 emit site in code, (b) ≥1 handler/consumer
- Prune variants failing both checks (delete from union)
- Update tests to drop references to pruned variants
- Document the pruned variants in `wiki/Decisions/2026-05-28-controller-decision-prune.md`

**Done:**
- [ ] ControllerDecision union has ≤8 variants (or document rationale for each kept variant with null consumers)
- [ ] No dispatcher handler dispatches to a pruned variant
- [ ] All tests pass post-prune

### Phase 3 — `observe` package disposition (closes #170 part 1)

**Symptom:** `@reactive-agents/observe` has 0 internal callers despite shipping 301 LOC + 3 files (tracer, otlp, index). Either wire it OR delete it.

**Files touched:** `packages/observe/` (entire package), `packages/reactive-agents/src/index.ts` (umbrella facade), `apps/examples/` (demo if wiring)

**Two paths:**

**(a) Wire it:** Add an `examples/observability-otel-export.ts` (or equivalent) that consumes `OpenInferenceTracerLayer` against the EventBus, plus include `observe` in the umbrella `reactive-agents` re-exports so consumers can `import { setupOpenInferenceExporter } from "reactive-agents"`. Then it has callers.

**(b) Delete it:** Move the 3 files to `wiki/Prototypes/` as reference. Remove `packages/observe/` from `packages/*` tree. Remove from AGENTS.md package list. Update docs to remove the `observe.mdx` page or mark as "future work."

**Recommendation:** (a). The OpenInference exporter solves a real production need (observability bridge); 301 LOC is small. Wire it with one demo.

**Done (option (a)):**
- [ ] `apps/examples/src/observe/otel-export.ts` exists and runs cleanly
- [ ] `reactive-agents` umbrella re-exports `setupOpenInferenceExporter`, `autoConfigureExporter`, `OpenInferenceTracerLayer`
- [ ] `grep -r "from \"@reactive-agents/observe\"" packages apps` returns ≥1 caller outside the package itself
- [ ] Docs page `apps/docs/.../observe.mdx` updated with the working example

### Phase 4 — M12 LocalProviderAdapter hooks disposition (closes #170 part 2)

**Symptom:** Per #170 / K-08, 5 of 6 M12 LocalProviderAdapter hooks ship ~270 LOC with zero call sites.

**Files touched:** `packages/llm-provider/src/providers/local/` (or wherever the LocalProviderAdapter lives)

**Scope:**
- Identify each of the 6 hooks; confirm which 5 are unused
- For each unused hook: (i) wire it OR (ii) remove it
- The 1 wired hook (per memory: "default-on circuit breaker" or similar) stays
- Document rationale in `wiki/Decisions/2026-05-28-m12-hooks-disposition.md`

**Done:**
- [ ] All M12 hooks have either ≥1 call site OR are removed
- [ ] LLM-provider tests pass (254/254 baseline maintained)

### Phase 5 — confidenceFloor + HarnessProfilePatch generalization (closes #160 + #122 partial)

**Symptom A:** `confidenceFloor` killswitch documented + tested but unshipped per 2026-05-19 audit (#160).

**Symptom B:** `HarnessProfilePatch` (`packages/runtime/src/capabilities/profile.ts`) hard-codes 5 boolean fields; will inflate as CapabilityRegistry grows (architecture model §10.2).

**Files touched:**
- `packages/compose/src/killswitches/confidence-floor.ts` — ship the implementation
- `packages/compose/src/killswitches/registry.ts` — register the killswitch
- `apps/docs/.../killswitches.mdx` — sync docs
- `packages/runtime/src/capabilities/profile.ts` — generalize `HarnessProfilePatch`

**Confidence floor scope (Symptom A):**
- Wire the existing impl per the docs
- Add at least one test that asserts the killswitch fires at the configured threshold
- Update memory `project_killswitch_honesty_2026_05_19` after ship

**HarnessProfilePatch generalization (Symptom B):**

```typescript
// Before (hard-coded)
interface HarnessProfilePatch {
  readonly name: HarnessProfileName;
  readonly enableMemory?: boolean;
  readonly enableReactiveIntelligence?: boolean;
  readonly enableVerifier?: boolean;
  readonly enableStrategySwitching?: boolean;
  readonly enableSkillPersistence?: boolean;
}

// After (registry-derived)
type RegisteredCapabilityName = (typeof bootstrapEntries[number])["name"];
type HarnessProfilePatch = {
  readonly name: HarnessProfileName;
} & Partial<Record<RegisteredCapabilityName, boolean>>;
```

Adding a new registry entry no longer requires touching profile.ts.

**Done:**
- [ ] `confidenceFloor` killswitch shipped + tested + docs match reality
- [ ] `HarnessProfilePatch` derives from CapabilityRegistry; type inference still works
- [ ] All HarnessProfile tests pass

### Phase 6 — CI lint for emit/consume invariant

**Symptom:** No structural enforcement preventing the next "scaffold without caller" merge.

**Files touched:** `.github/workflows/` (CI), new file `scripts/lint-anti-scaffold.ts`

**Scope:**
- Walk the type graph at PR time:
  - For every TagMap entry: confirm ≥1 `pipeline.transform("X", ...)` call site
  - For every TagMap entry: confirm ≥1 `harness.on/tap("X", ...)` consumer site
  - For every CapabilityRegistry entry: confirm the registered name is referenced by ≥1 consumer
  - For every ControllerDecision variant: confirm ≥1 handler dispatches
- Fail the CI run on any violation
- Allow deliberate exceptions via `// anti-scaffold-exception: <reason>` inline comment (with rationale required)

**Done:**
- [ ] `scripts/lint-anti-scaffold.ts` exists and runs
- [ ] CI workflow invokes it on every PR
- [ ] Lint exits 0 against current main (post Phase 1-5)
- [ ] Deliberately-bad example fails the lint

---

## Phase 7 — Triple compression coordination (closes #119)

**Symptom:** Per #119, three compression stages (stash, curator, patch) operate independently with no central coordinator. Risk: redundant compression or missed signals.

**Files touched:** TBD per investigation; likely `packages/reasoning/src/context/`

**Scope:**
- Audit the three stages' inputs/outputs
- Introduce a CompressionCoordinator service that sequences stages + tracks output state
- Ensure each stage emits structured trace events (compression amount, signal class, time spent)

**Done:**
- [ ] One coordinator owns the 3-stage sequence
- [ ] Each stage emits a structured trace event
- [ ] No redundant compression in N=1 probe runs

### Phase 8 — Cross-session default-on verify (closes #122)

**Symptom:** `enableSkillPersistence` shipped May 22 + graduated to KEEP per #122; verify the wiring is actually present + working via cross-session test.

**Files touched:** Tests only (no production change unless wiring proves broken)

**Scope:**
- Cross-session probe: run agent N times across sessions; verify skill persistence works
- If broken, file new issue + scope to next workstream

**Done:**
- [ ] Cross-session skill persistence verified empirically
- [ ] If broken, follow-up issue filed (out of WS-4 scope to fix)

### Phase 9 — Multi-severity verifier ladder (closes #121)

**Symptom:** Per architecture model §13.1, VerifierVerdict should ship per-check severity ladder (pass/warn/reject/escalate), not boolean. Audit may have shipped partially.

**Files touched:** `packages/reasoning/src/kernel/capabilities/verify/verifier.ts`

**Scope:**
- Verify current VerifierVerdict shape supports severity
- If only boolean: ship the severity ladder per architecture model §13
- Arbitrator interprets severity per architecture model §13.1

**Done:**
- [ ] VerifierVerdict shape has per-check severity field
- [ ] Arbitrator routes severity per the model
- [ ] Test gate scenarios assert severity-aware behavior

---

## Scope OUT (non-goals)

- Adding new declared surfaces (TagMap entries, ControllerDecision variants, CapabilityRegistry entries) without paired wiring
- Refactoring the Compose API itself (Wave A-F shipped; this WS uses it, doesn't change it)
- Touching kernel mesh structure (WS-3 territory)
- Memory v2 design (separate track)
- Adding HarnessProfile presets beyond the canonical 3 (architecture model §11 caps at 3-4)

## Pre-Conditions

- PR #172 merged
- WS-2 shipped (HarnessProfile generalization in Phase 5 depends on WS-2 typed seam stability)
- Build green, tests green, typecheck clean at HEAD

## Tests (RED → GREEN per phase)

Each phase ships its own RED test asserting the surface element is wired (or its declaration is gone). See per-phase Done criteria above.

## Verification Protocol

```bash
# Pre-WS-4 baseline
echo "Compose tags with zero emit sites:"
# walk TagMap definitions + grep for emit sites
echo "ControllerDecision variants with zero handler dispatch:"
# walk union variants + grep
echo "observe pkg callers:"
grep -r "from \"@reactive-agents/observe\"" packages apps | grep -v /observe/ | grep -v test | wc -l   # expect: 0
echo "confidenceFloor shipped?"
grep -rE "registerKillswitch.*confidence" packages/compose/ | wc -l   # expect: 0 today

# Per-phase verification (see per-phase Done sections)

# Final WS-4 gate
bunx turbo run build && bun test && bun run typecheck
bun scripts/lint-anti-scaffold.ts   # Phase 6 — exits 0
```

## Done Criteria (falsifiable)

- [ ] All Compose tags have paired emit + consumer (Phase 1)
- [ ] ControllerDecision union pruned to wired variants (Phase 2)
- [ ] `observe` pkg has ≥1 caller OR is removed (Phase 3)
- [ ] M12 hooks all wired or removed (Phase 4)
- [ ] `confidenceFloor` shipped + HarnessProfilePatch generalized (Phase 5)
- [ ] CI anti-scaffold lint live + green (Phase 6)
- [ ] Triple-compression coordinator landed (Phase 7)
- [ ] Cross-session skill persistence verified (Phase 8)
- [ ] Verifier severity ladder shipped per architecture model §13 (Phase 9)
- [ ] No new `as any` introduced; tests pass; build green; typecheck clean

## Rollback Plan

Per-phase atomic commits. Phase 3 (observe disposition) and Phase 5 (confidenceFloor + HarnessProfilePatch) are largest rollback exposure — separate commits per file.

## Evidence Artifact

`wiki/Research/Refactor-Reports/2026-05-28-ws-4-final.md` containing per-phase before/after counts + closed-issue confirmation.

## Owner + Handoff

Cross-cutting WS. Each phase has its own warden:

- Phase 1: compose-warden (TagMap wiring)
- Phase 2: kernel-warden + RI maintainer (union prune)
- Phase 3: runtime-warden + docs (observe disposition)
- Phase 4: provider-warden (M12 hooks)
- Phase 5: compose-warden + runtime-warden (confidenceFloor + HarnessProfilePatch)
- Phase 6: cross-cutting (CI lint)
- Phase 7-9: kernel-warden + memory-warden

## Cross-Reference

- Master plan: §4 RC-3, §3.4, §3.5, §3.6 F7, §6.2 WS-4 summary, §10 issue routing
- Architecture model: §9 emit/consume law, §10 CapabilityRegistry+HarnessProfile, §13 verifier severity ladder
- Closed issues: #112, #116, #119, #120, #121, #122, #160, #170
