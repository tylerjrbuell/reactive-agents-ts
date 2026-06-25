---
type: decision
status: draft (for review)
created: 2026-06-24
tags: [roadmap, leverage-ranking, self-improvement, orchestration, replay, eval, security, post-v0.12]
related:
  - "[[2026-06-17-agentic-orchestration-strategies]]"
  - "wiki/Research/Audit-Reports-2026-06-17/subagent-system-audit.md"
  - "[[2026-06-10-roadmap-realignment-v0.12-v1.0]]"
  - "[[05-DESIGN-NORTH-STAR]]"
  - "[[01-RESEARCH-DISCIPLINE]]"
---

# High-Leverage Roadmap Ranking (post-v0.12)

> **One line:** RA's defensible moat is **deterministic replay + local-first reliability + honesty/control**. The highest-leverage work left is *not more engine* — it is **productizing those moats into surfaces competitors structurally cannot ship** (a debugger, an eval harness, verifiable self-improvement), then layering observable teams on top. This doc ranks every candidate (A/B/C + L1–L5) by a single rule and commits to a sequence.

## 1. Context

v0.12 "Durable & Honest" shipped: durable execution + HITL, structured output, memory default-off, effect-free hooks. The internals are independently graded structurally healthy. Two design artifacts opened the question of "what next":

- The **orchestration-strategies spec** (2026-06-17) — swappable team coordination over a shared substrate.
- The **subagent-system audit** (2026-06-17) — current multi-agent primitives are a fan-out executor, not a command structure; 10 gaps (G1–G10).

Plus external pull: the 2026 self-improvement / self-introspection wave (arXiv:2606.09498 and the broader MAST / orchestrator-worker literature already cited in the orchestration spec).

The roadmap's own stated gaps: **no public third-party benchmark, no production case studies, no named users.** That is the survival constraint, and it shapes the ranking: a strong engine that nobody can prove or adopt loses to a weaker engine with receipts.

## 2. Ranking rule (one rule, applied uniformly)

Leverage `=` **uniqueness × demand × existing-asset-reuse ÷ falsification-risk**, subject to the project lift rule (≥2 model tiers, ≥3pp lift AND ≤15% token overhead → default-on; else opt-in; else remove — `01-RESEARCH-DISCIPLINE` Rule 11 / ablation-warden).

Two hard priors from project history:
1. **Cleverness is falsified by default here.** Heavy strategies (reflexion/ToT/plan-execute) = *zero* lift. The escalation controller, dual-compression, and 6 observability levers were all falsified. Any candidate in that risk class must ship behind a bench, never as a headline.
2. **The moats are under-exploited as *product*.** Replay, the lift-gate, and per-model calibration are currently *internal discipline*. Their leverage is unlocked by exposing them to users — that is mostly low-risk plumbing, not new cleverness.

## 3. Candidates (folded: A/B/C from the specs + L1–L5)

| ID | Candidate | Reuses (shipped) | Unlocks | Falsification risk |
|---|---|---|---|---|
| **L2** | **BYO eval harness + honest receipts** — user declares tasks → RA runs the model×strategy×config matrix → receipt (accuracy/tokens/cost, winner, what's *below gate*). | ablation-warden logic, lift rule, replay, rax-diagnose | The public-bench/proof gap (roadmap); the infra **B** is built on; honesty-as-a-feature | **Low** (measurement infra) |
| **L1** | **Replay-as-debugger** — behavior **bisect** (which config change regressed), trace **diff** (where two runs diverged), **time-travel** (pause/fork/mutate at iter N). | `@reactive-agents/replay`, Snapshot, rax-diagnose | A category-defining DX no competitor has; the inspection layer for L2/A/B | **Low** (tooling) |
| **A** | **Observable structured sub-unit substrate** — worker events propagate to parent bus (tagged); `UpwardReport` superset of `SubAgentResult`; per-worker model/budget override. | sub-agent-executor, A2A `TaskState`, EventBus, entropy/verifier | Debuggable teams in cortex; prerequisite for **B** *and* **C** | **Low** (plumbing) |
| **B** | **Verifiable self-improvement** — trace → diagnose → propose harness mutation (`.compose()` override) → **replay-validate vs held-out traces** → adopt only if lift-gate passes → persist. | replay, rax-diagnose, lift rule, compose+killswitches, ExperienceSummary/skill-persistence, memory, entropy/verifier, synthesizeDebrief, durable+HITL | The hottest 2026 category, in the **only credible (measured) form**; converts the replay+honesty moat into the flagship feature | **High** — *de-risked entirely by L2/replay being the validator*. Build the validator first; if mutations don't pass, you've proven it honestly and lost nothing. |
| **L3** | **Capability security — wire `authorize()`** — per-tool/per-worker capability grants; `denied-by-authority` upward report; audit log; real sandbox on shell/file tools. | IdentityService (`authorize()` *declared, never called*), tools layer, observability, durable+HITL | The 2026 enterprise gate; makes the "control" pillar credible | **Low** (wires a declared seam) |
| **C** | **Orchestration strategy catalog** — team-ownership (SEAL chain-of-command) + orchestrator-workers/map-reduce/pipeline/debate/moa over the substrate. | A (substrate), approvalGate, verifier, memory-blackboard, synthesizeDebrief | Breadth of coordination patterns; entropy-driven adaptive orchestration | **Medium-High** — Anthropic: multi-agent only wins on *decomposable, independent* tasks; spec §6 marks mission-intent + adaptivity *empirically unproven*. **Must ship behind M8 bench (GH #42).** |
| **L5** | **Tool reliability scoring + result caching** — score tools by observed success; cache deterministic tool-results across runs; feed scores to B's tool-gate mutations. | tools layer (`delegatedToolsUsed`), replay snapshots | Efficiency lever; multiplies B | **Low-Med** |
| **L4** | **Context as a first-class managed resource** — explicit context-budget object; retrieval-on-demand from memory; context **provenance** (why each chunk is present). | context-curator, tier-adaptive context, memory v2 (drafted, stalled) | The 2026 context frontier; a real consumer that could *un-stall* Memory v2 (§9 anti-scaffold) | **Medium-High** — context levers have a falsification history here (dual-compression). **Gate behind L2.** |

### Explicitly not pursued (with reason)
- **Tool synthesis** (agent writes its own tools) — on-trend, but high falsification risk + security surface. Revisit only after L3 (sandbox) exists.
- **A 7th reasoning strategy** — heavy strategies proved zero lift. Adding more burns the falsified budget.
- **Learned / self-evolving topologies** (MetaGen-style) — orchestration spec §9 already a non-goal for v1. Concur.

## 4. The thesis (why this ranking, in one frame)

The three moats and their un-shipped product surface:

| Moat (have, internal) | Un-exploited product (build) |
|---|---|
| Deterministic **replay** | **L1** debugger · **L2** eval harness · **B** self-improvement — all replay-powered |
| **Local-first** reliability | **L5** cost/reliability economy · the "provably improves on small models" story |
| **Honesty / control** | **L2** receipts · **L3** capability governance |

Every Tier-1 item rides the **same replay engine** and reuses already-shipped systems; the only net-new code is the orchestrators that wire them into loops. That is the definition of high leverage: maximum new capability per line, and each existing system becomes *more valuable* by being in the loop (replay stops being niche; calibration stops being static; debrief stops being write-only).

The **one substrate, three surfaces** property is the load-bearing reuse claim: the `UpwardReport` + `signal` (entropy/confidence/loop/budget) substrate from spec §2 serves observable teams (**A**), the self-improvement loop's diagnosis/confidence input (**B**), and orchestration coordination (**C**) — built once.

## 5. Decision — ranked sequence

**Phase 0 — Productize the replay moat (Tier 1, low-risk, highest unique leverage):**
1. **L2 — BYO eval harness + receipts.** Highest *business* leverage: fixes the proof/adoption gap and is the substrate B needs. Ship as the v0.13 "Receipts" headline.
2. **L1 — Replay-as-debugger.** Cheapest category-defining DX; the inspection layer for everything after.
3. **A — Observable structured substrate** (orchestration spec Phase 1 / audit G1–G2/G4). Ships value alone (debuggable teams) and is the shared prerequisite for B and C.

**Phase 1 — The flagship bet:**
4. **B — Verifiable self-improvement.** Built directly on L2 (validator) + L1 (inspection) + A (structured reports). The revolutionary, defensible, on-trend play — in the only honest form. Gate default-on behind its own bench; opt-in until it clears.

**Phase 2 — Enterprise + breadth:**
5. **L3 — Capability security.** Parallelizable with B; unblocks enterprise; pure seam-wiring.
6. **C — Orchestration catalog** (spec Phases 2–4), behind the **M8 bench (GH #42)**. team-ownership first; its AAR (`synthesizeDebrief`) feeds B → the loop learns the team's own coordination weak spots.
7. **L5 — Tool reliability/caching.** Folds into B as a mutation target + efficiency lever.

**Phase 3 — Gated frontier:**
8. **L4 — Context-as-resource.** Only after L2 exists to measure it; candidate consumer to un-stall Memory v2. Hard-gated by lift rule.

### Sequencing rationale
- Each item reuses the prior; the chain is monotonic in dependencies (L2→B validator; L1→B/A inspection; A→B reports→C coordination).
- The two lowest-risk, most-unique items (L1, L2) come first and *de-risk B* — B's only real risk (unverifiable improvement) is dissolved by building its validator (L2/replay) before its loop.
- C is sequenced last among the "build" items despite being the most-developed spec, because it carries the highest falsification risk and least uniqueness (every framework has multi-agent; only RA has the validated-self-improvement + replay angle).

## 6. Gates / guardrails (carried, do not re-discover)
1. **Lift rule on every default-on flip** (≥2 tiers, ≥3pp & ≤15% tok). B, C, L4 are opt-in until they clear; L1/L2/L3/A are infra (no quality claim → no gate, but no quality *claim* may be made without a receipt).
2. **B's adopt step is a deterministic FSM** on the structured replay result — **never** a parent-side LLM re-verify (recreates the killed M3 verify-retry / double-rejection loop; same constraint as orchestration `ownFailure`).
3. **No new packages / no new builder method / net type count flat** where avoidable — route through shipped seams (the orchestration spec §5/§6 reuse map governs A/C; same spirit for B/L1/L2).
4. **No headline without a receipt** — `01-RESEARCH-DISCIPLINE` Rule 11. "Self-improving" ships *with* the replay proof or it does not ship as a claim.

## 7. Open questions (for review)
- **L2 surface:** CLI (`rax bench`), config file, or builder API (`.withEval(suite)`)? Lean CLI-first (matches rax-diagnose).
- **B mutation taxonomy:** which `.compose()` primitives are safe to auto-mutate (prompt / tool-gate / context-budget / calibration) vs. require approval (strategy switch, tool *grants*)? Needs an explicit allow-list.
- **B held-out set:** how are validation traces selected/rotated to avoid overfitting the loop to its own corpus?
- **L1 bisect axis:** over config space only, or over code/commit (git-bisect-style) too?
- **Confidence source of truth** (shared with spec §8): entropy vs verifier vs blend — one ablation answers it for A, B, and C at once.
- **L3 vs C ordering:** does observable-teams (A) need capability grants (L3) *before* C ships, or can C ship ungoverned behind the bench and L3 follow?

## 8. Non-goals (this cycle)
- Visual team builder in cortex (separate Workflow Studio track).
- Tool synthesis; self-evolving topologies (deferred per §3).
- Any default-on flip of B/C/L4 ahead of its bench.
