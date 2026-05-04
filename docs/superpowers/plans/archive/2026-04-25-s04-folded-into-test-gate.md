# Phase 0 S0.4 — Folded into the North Star Test Gate

> **Status:** CLOSED 2026-04-24. Closure note in lieu of separate implementation.
> **Original plan:** `docs/superpowers/plans/2026-04-23-north-star-phase-0.md` Tasks 5-7
> **Folded into:** `docs/superpowers/specs/2026-04-25-north-star-test-gate.md`

---

## Why folded, not implemented separately

S0.4 was scoped before the Test Gate spec existed. It would have shipped:
- A `Probe` / `ProbeResult` type
- A `run-probes.ts` CLI registry
- 4 scaffolded probes (`error-swallowed-wiring`, `num-ctx-sanity`, `semantic-memory-population`, `capability-probe-on-boot`)
- A GitHub Actions workflow gating PR merges

**Every one of those concerns is now served by the Test Gate** (commits `0d5f1904` → `abf023b7`):

| S0.4 deliverable | Test Gate equivalent | Evidence |
|---|---|---|
| `Probe` / `ProbeResult` type | `ScenarioModule` / `Tier1ScenarioOutcome` | `packages/testing/src/gate/types.ts` |
| `run-probes.ts` CLI registry | `discoverScenarios()` auto-discovery + `runGate()` | `packages/testing/src/gate/{registry,runner}.ts` |
| `error-swallowed-wiring` probe (real) | `cf-10-error-swallowed-event-emitted` scenario | `packages/testing/src/gate/scenarios/cf-10-*.ts` |
| `num-ctx-sanity` probe (scaffolded) | DEFERRED — see §1 below |
| `semantic-memory-population` probe (scaffolded) | DEFERRED — see §1 below |
| `capability-probe-on-boot` probe (scaffolded) | DEFERRED — see §1 below |
| GitHub Actions gate | `.github/workflows/ci.yml` "North Star Test Gate (Tier 1)" step | committed in `abf023b7` |

Maintaining two parallel CI probe systems would duplicate scaffolding without adding signal. The Test Gate's auto-discovery + scenario-health + propose-mode primitives subsume what S0.4 was meant to enable.

---

## §1 — The 3 deferred scaffolds

The remaining S0.4 probes were always scaffolded ("enabled in P1"). They depend on infrastructure that lands in Phase 1, not Phase 0:

| Probe | Blocking dependency | Becomes scenario when |
|---|---|---|
| `num-ctx-sanity` | Capability port (P1 Sprint 2) — needs `capability.recommendedNumCtx` to compare against the Ollama request | A Phase 1 commit lands the Capability port; create `cf-NN-num-ctx-from-capability.ts` |
| `semantic-memory-population` | Already implementable today (G-3 closed in `72c322bd`) but requires real Ollama for end-to-end signal | Tier 2 scenario `b-NN-semantic-memory-cross-session.ts` after Tier 2 lands |
| `capability-probe-on-boot` | Capability port (P1 Sprint 2) — the boot-time probe doesn't exist yet | A Phase 1 commit lands the Capability service; create `cf-NN-capability-resolved-before-llm.ts` |

These are Phase 1 work by their own logic; folding into the Test Gate doesn't change when they land.

---

## §2 — What changed in the rollout (vs original S0.4 plan)

| Original plan | Test Gate reality |
|---|---|
| `bun run probes` script | `bun run gate:check` (also runs via `bun test`) |
| `harness-reports/ci-probes-baseline-2026-04-23.jsonl` artifact | `harness-reports/integration-control-flow-baseline.json` — same purpose, structured better |
| Per-probe `pass: boolean` + `reason: string` | Per-scenario `Tier1ScenarioOutcome` with deep-equality diff and weakness/commit attribution |
| `PROBE_SUITE_MAX_MINUTES=10` budget | Test Gate cap: 60s wall clock (much tighter — reflects scaffold-only baseline) |
| `PROBE_SUITE_MAX_USD=0.50` budget | Tier 1 = $0 (mocked LLM); Tier 2 = local Ollama, $0 |
| Manual GitHub UI step to mark `probes` required | Same — once Tier 1 has 10+ scenarios, mark `North Star Test Gate (Tier 1)` required |

Test Gate is a strict superset of what S0.4 would have produced.

---

## §3 — Phase 0 close-out checklist

| Story | Status |
|---|---|
| S0.1 — Typed framework error taxonomy | ✅ DONE (`93ff6793`) |
| S0.2 — `ErrorSwallowed` event + 36-file migration + wiring test | ✅ DONE (`4c3b4e29`) |
| S0.3 — Default log redactor (interface + wiring + builder option) | ✅ DONE (`f95c8ac1` + `d42a1f78` + `ed29cb28`) |
| S0.4 — CI probe suite | ✅ DONE — folded into Test Gate (`0d5f1904` + `abf023b7`); this doc |
| S0.5 — Microbench baseline harness | ✅ DONE (`122a4ea0`) |
| S0.6 — MEMORY.md / code reconciliation | ✅ DONE (`c2f74803`) |
| S0.7 — Debrief quality spike | ✅ DONE (`38fa7550`) |

**Phase 0 is closed. Phase 1 begins next session.**

---

## §4 — Phase 1 hand-off — what closing Phase 0 unlocks

The Test Gate ships with:
- 4 live failure-mode scenarios (cf-04, cf-10, cf-11, cf-13)
- 3 auto-scaffolded TODO scenarios (cf-TODO-w2/w4/w5)
- A gate:propose script that cross-references `loop-state.json` weaknesses to find more uncovered failure modes
- Per-scenario health tracking with stale/high-churn flagging

Phase 1 work — Capability port, Invariant pattern, AgentMemory wiring extension, Task primitive, ContextCurator unification — naturally produces several new gate scenarios:

| Phase 1 sprint | New gate scenarios it should produce |
|---|---|
| Capability port + `num_ctx` resolution | `cf-NN-num-ctx-from-capability` (replaces num-ctx-sanity scaffold) |
| `CapabilityService.resolve` boot order | `cf-NN-capability-resolved-before-llm` (replaces capability-probe-on-boot scaffold) |
| Unified `ModelTier` derivation | `cf-NN-tier-derived-from-capability` |
| `AgentMemory.store` from tool-execution (deeper end-to-end test) | Tier 2 `b-NN-semantic-memory-cross-session` |
| `Task` primitive round-trip | `cf-NN-task-string-roundtrip` |
| `ContextCurator` sole prompt author | `cf-NN-no-prompt-construction-outside-curator` |
| Phase 4a passive Skill capture | `cf-NN-skill-stored-on-success` |
| `AgentDebrief` extension (3 new fields per S0.7) | `cf-NN-debrief-has-intent-classification` |

Every Phase 1 commit is expected to either add a new `cf-*` scenario for what it shipped OR update existing scenarios to reflect intentional behavior changes (with the `BASELINE-UPDATE:` trailer convention). The gate co-evolves with Phase 1 — this is the "perfectly tuned powerful improvement loop" working as designed.
