# Reactive Agents — Roadmap

> **Last updated:** 2026-05-14
> **The open-source agent framework built for control, not magic.**

This roadmap is the public-facing milestone tracker. The internal authoritative plan lives in `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` (v5.0). When the two disagree, North Star wins and this doc is out of date — open an issue.

---

## Where we are today (v0.10.6 → v0.11 in flight)

- **v0.10.6** is published on npm. All packages green. Stable foundation.
- **Phase A (Architecture Cleanup)** ✅ complete. `execution-engine.ts` 4,499→1,539 LOC (−66%). `builder.ts` 6,232→2,407 LOC (−61%). 39 new focused modules.
- **Phase B (Compose API)** ✅ complete (Waves A–F).
  - Harness pipeline registry + tag catalog (7 tags) + `.compose()` builder method
  - 7 live chokepoints: `prompt.system`, `nudge.loop-detected`, `nudge.healing-failure`, `message.tool-result`, `observation.tool-result`, `lifecycle.failure`, `control.strategy-evaluated`
  - `RunHandle` / `RunController` with pause/resume/stop/terminate
  - `packages/compose` with 6 killswitches: `maxIterations`, `budgetLimit`, `timeoutAfter`, `watchdog`, `requireApprovalFor`, `confidenceFloor`
  - `.withX()` sugar desugars through harness; backward compatible
  - Docs: `compose-api.mdx`, `harness-tags.mdx`, `composition-recipes.mdx`
- **Phase 1.5 mechanism improvements** in flight (M3 REWORK shipped; M6 skill persistence shipped; M7/M8/M10/M14 ongoing).

**Strategic positioning, empirically validated:**
- 100% on internal frontier bench (claude-sonnet-4-6, haiku-4-5, gpt-4o-mini, gemini-2.5-pro)
- 13-mechanism Phase 1 validation: 8 KEEP, 5 IMPROVE, 0 REMOVE
- Harness pruning principle adopted: full harness is +13.6× tokens and −0.8pp on frontier — opt-in by gate, not by default

---

## v0.11.0 — Show-HN Launch (Phase C, in flight)

**Target:** June 2026. The composable / auditable / transparent alternative to AutoGen / CrewAI / Mastra.

| Item | Status | Effort |
|---|---|---|
| Compose API (`.compose(harness)` — 7 tags, 6 killswitches, full docs) | ✅ Shipped | — |
| Skill Persistence (M6: SQLite-backed, cross-session) | ✅ Shipped | — |
| Live Playground (Stackblitz, 3 scenarios) | ✅ Shipped | — |
| Decision rationale traceability (every milestone) | ✅ Shipped | — |
| `npx create-reactive-agent` + 4 templates × 4 providers | ✅ Shipped | — |
| OpenInference / OTel exporter (`@reactive-agents/observe`) | ✅ Shipped | — |
| Snapshot / Replay (`@reactive-agents/replay`) | ✅ Shipped | — |
| Code-as-Action strategy (`code-action`, experimental, v0.11.1 promote) | ✅ Shipped | — |
| Public roadmap + named users (this doc + GitHub Projects) | 🔄 In progress | 1 day |

**v0.11.0 release gate:**
- [x] All Phase C items shipped (compose, skill persistence, playground, create-reactive-agent, observe, replay)
- [x] Zero regressions on 5,128+ tests
- [ ] Snapshot / Replay deterministic E2E integration test (deferred to v0.11.1)
- [ ] GitHub Projects board live + named users section
- [x] This doc aligned to North Star v5.0 ✅ (May 14, 2026)

---

## Phase 1.5 — Mechanism Improvements (parallel with C → D)

These run alongside Phase C. Different files, no conflicts.

| Mech | Action | Target | Status |
|---|---|---|---|
| **M3** Verifier Retry | Disable terminal retry loop; keep heuristic gate | Ablation REWORK verdict | ✅ Shipped (commit `051c22be`) |
| **M6** Skill Persistence | SQLite-backed; per-agent scope; SKILL.md import/export | >70% cross-session recall | ✅ Shipped |
| **M7** Calibration Consumers | Wire `parallelCallCapability`, `interventionResponseRate`, `tokenEfficiency`, `reasoningDepth`, `knownToolAliases` | ≥8 fields active with measurable lift | 🔲 Open |
| **M8** Sub-agent Delegation | 10 scenarios on frontier + qwen3:14b; route through `control.strategy-evaluated` | ≥20% accuracy lift on ≥3-step tasks | 🔲 Open (post-Wave A unblocked) |
| **M10** Memory Multi-session | 3 multi-session scenarios; Tier-2 semantic search for verbose queries | >80% recall across 3+ sessions | 🔲 Open |
| **M14** Self-Evolution | `composeNarrowRetry(maxBroadenAfter)` via `lifecycle.failure` + `control.strategy-evaluated` | ≥3pp lift on looping gate scenarios | 🔲 Open |

Research basis: arXiv:2603.25723 (NLAH), arXiv:2603.28052 (Stanford Meta-Harness). See `wiki/Architecture/Design-Specs/2026-05-11-harness-research-integration.md`.

---

## v0.12 — Local-First Engineering (Phases D + E)

**Goal:** close the local-model agentic gap. qwen3:14B at ≥30% of frontier on τ-bench retail.

**Phase D — Code-as-Action Strategy**
- 6th reasoning strategy: `CodeAgentStrategy` emits code blocks composing tools as function calls
- Closes round-trip overhead on multi-step tasks
- Sandboxed execution (no host FS, no unwhitelisted network, timeout)
- **Gate:** ≥20% accuracy lift + ≥25% token reduction vs `reactive` on qwen3:14B; ≤5% regression on frontier

**Phase E — Local Model Engineering** (3 parallel tracks)
- **Track 1:** Per-provider tool-call parser — fix qwen3 + Ollama + thinking-mode + `tool_calls` coexistence (LiteLLM #18922)
- **Track 2:** Activate ≥8 calibration consumers (Phase 1.5 M7 expanded)
- **Track 3:** Tool-result paging — 50KB per-tool / 200KB per-message caps with disk spill
- **Gate:** qwen3:14B ≥30% of frontier on τ-bench retail subset

---

## v0.13 — Public Benchmark Discipline (Phase F)

**Goal:** ≥1 third-party benchmark with reproducible methodology. Close the "self-graded marketing" gap.

- **Recommended first:** τ²-bench retail (clearest reproducibility story; validates Phase D/E local-tier claim)
- **Gate:** model + provider + date pinned, cost reported, ≥3 seed variance (mean ± stdev), raw JSONL traces published
- **Stop-the-line:** if external delta >15% from internal, fix the harness — not the result

---

## v1.0 — Polish & Release (Phase G)

- Every Phase A–F gate re-run on integrated codebase
- `README.md` rewritten: no aspirational claims, only validated state
- Vision pillar artifact table complete — each of the 8 pillars cites a file, bench number, or doc
- Snapshot/Replay determinism re-validated
- This doc rewritten: what shipped, what's deferred, what was killed and why

---

## Beyond v1.0

Deferred until evidence justifies the work.

- **Multi-agent orchestration** — `@reactive-agents/a2a` + `@reactive-agents/orchestration` exist as capabilities; full spec at `wiki/Architecture/Specs/16-multi-agent-orchestration.md`
- **Agent sessions** — multi-turn lifecycle; `AgentMemory` port is ~90% of the plumbing
- **Phase 4 active skill retrieval** — gated on a passing spike
- **Evolutionary intelligence** (`@reactive-agents/evolution`) — long-term R&D theme; no active work

---

## Strategic positioning

The framework's defensible value, per empirical evidence:

- **Trust** — verifier refuses to ship fabrications; `agent-took-action` check converts confident-fabrication → honest-fail
- **Control** — every harness primitive is developer-overridable via `.compose(harness)`; 7 live chokepoints, 6 prebuilt killswitches, `RunHandle` pause/resume/stop/terminate
- **Observability** — default-on; every run produces traces + metrics + logs without opt-in; OTel exporter in flight
- **Local-first** — Layer-1 builders + calibration consumers + (Phase D) code-as-action strategy close the local-model gap

What we do **not** yet have:
- Public third-party benchmark (Phase F)
- Production case studies / named users (Phase C item, in flight)
- Phase D code-as-action validation

Per `01-RESEARCH-DISCIPLINE.md` Rule 11, claims scope to one mechanism × one failure mode × ≤2 models × one task. Single-spike findings shape the next spike, not framework-level marketing.

---

## How to track progress

- **North Star v5.0** (`wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`) is the single internal source of truth
- **Hot cache** (`wiki/Hot.md`) tracks the current session's working state
- **Implementation plans** live in `wiki/Planning/Implementation-Plans/YYYY-MM-DD-<feature>.md`
- **Evidence artifacts** live in `wiki/Research/Harness-Reports/`
- **Release tags** are cut by CI from the `main` branch; CHANGELOG entries are authoritative

*Roadmap is rewritten on major releases. Don't update it for every commit — update it when the strategic picture shifts.*
