# Reactive Agents v1.0 Master Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan phase-by-phase. Each phase produces its own detailed implementation plan (following superpowers:writing-plans discipline) just before execution. **This master plan defines phases and validation gates; it does not specify bite-sized implementation steps.** That is intentional — strategic plans sequence phases, tactical plans sequence steps.
>
> **Companion plans (write as needed before each phase):**
> - `2026-05-03-phase-0-frozen-judge.md` (written; ready to execute)
> - `2026-MM-DD-phase-N-<focus>.md` (write before starting Phase N)

**Goal:** Take Reactive Agents from v0.10.0 release-ready to v1.0 by closing the empirical, structural, and capability gaps surfaced in `wiki/Architecture/Specs/06-AUDIT-v0.10.0.md` §16, while remaining true to the eight pillars of `wiki/Architecture/Specs/00-VISION.md` and adapting to AI-community research as it lands.

**Architecture:** Eight sequenced phases (Phase 0–7), each with measurable validation gates that gate the next phase. Cross-cutting disciplines (TDD, subagent-driven execution, verified improvement loops, quarterly research re-evaluation) apply uniformly. **No phase ships without its validation gate passing.**

**Tech Stack:** TypeScript + Bun + Effect-TS (existing); Docker (frozen judge containerization); HAL Princeton harness (third-party benchmark); E2B or Bun.spawn for code-action sandbox.

---

## 0. Reading order and authority

| Doc | Authority | When to consult |
|---|---|---|
| `wiki/Architecture/Specs/00-VISION.md` v3.0 | **Stable anchor** — the only document this plan does not amend | Every phase: confirm work serves a vision pillar |
| `wiki/Architecture/Specs/06-AUDIT-v0.10.0.md` §16 | **Authoritative gap inventory** | Phase definitions inherit gaps from §16.2–§16.6 |
| `wiki/Architecture/Specs/02-FAILURE-MODES.md` | **Living failure-mode catalog** | Phase 1 mechanism validation maps each mechanism to a FM it claims to address |
| `wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md` (Rules 1–12) | **Methodology contract** | Especially Rule 4 (frozen judge — Phase 0) and Rule 11 (calibrate claims to evidence — every phase gate) |
| `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v3.0 | **Architecture target** | Phase 2 decomposition conformance |
| `ROADMAP.md` (root) | **Public-facing milestone tracker** | Updated at each phase completion |
| This file | **Sequencing authority** for v0.10.0 → v1.0 | Single source of truth for phase order |

If any doc conflicts with this plan, the conflict is resolved by amendment to the lower-authority doc — **never silent drift**.

---

## 1. Vision pillar mapping

Every phase serves at least one of the eight pillars from `00-VISION.md`. This table is the contract: a phase that doesn't move at least one pillar gets cut.

| Phase | Pillars served | Anti-pillars guarded against |
|---|---|---|
| **0. Empirical Foundation** (frozen judge) | Observability, Reliability | "Magic numbers, unverifiable claims" |
| **1. Mechanism Validation Sweep** | Control, Efficiency | "Bloat without proof" — kills mechanisms that don't earn keep |
| **2. Orchestration Decomposition** (Stage 7 W23–W28) | Composition, Control, DX | "Black-box god-class" — the original vision-anti-pattern §17–33 |
| **3. Code-as-Action Strategy** | Flexibility, Local-First, Efficiency | "Frontier-only" — closes the SLM agentic gap |
| **4. Local Model Engineering** | Model-Adaptive Intelligence, Local-First | "Same prompt for every model" |
| **5. Public Benchmark Discipline** | Reliability, Trustworthiness | "Self-graded marketing" |
| **6. First-Class Skills + Snapshot/Replay** | Composition, Observability, Flexibility | "Custom standards in a multi-vendor world" |
| **7. v1.0 Polish & Release** | All eight | "Premature 1.0 with hidden debt" |

**Pillar-1 doctrine (Control):** every new mechanism MUST be controllable (enable/disable), observable (events fire), and auditable (deterministic given pinned inputs). No phase ships a feature that fails this triad.

**Pillar-8 doctrine (Local-First):** every new mechanism MUST work on Ollama qwen3:14B at parity with frontier where the task is FC-bound. If it requires frontier-only capability, it's marked `_frontier_only_*` and gated.

---

## 2. Cross-cutting disciplines

These apply to every phase. Skipping any of them breaks the plan.

### 2.1 TDD discipline

Every implementation task in every phase follows superpowers:test-driven-development:
1. Write the failing test FIRST (red phase).
2. Confirm it fails for the right reason.
3. Implement minimal code to make it pass (green phase).
4. Refactor only after green.
5. Commit per task (frequent commits — Kent Beck "make it work, make it right, make it fast").

**No phase ships untested code.** No phase ships a "validation gate" that is not itself a test.

### 2.2 Subagent-driven execution

Per superpowers:subagent-driven-development:
- Each task in a phase's detailed plan dispatches to a fresh subagent.
- Two-stage review per task: subagent reports → main agent verifies (read diff, run tests, check artifact) → commit.
- Independent tasks dispatch in parallel (single message, multiple Agent tool blocks).
- Sequential tasks wait for prior task's verification to complete.

### 2.3 Verified improvement loop

Each phase has:
- **Baseline measurement** taken before phase work begins (commit the numbers).
- **Validation gate** with a quantitative threshold (e.g., "qwen3 τ-bench retail ≥30% of frontier").
- **Stop-the-line condition** — if the gate fails after phase implementation, the phase work is reverted or revised; we do not advance.
- **Evidence artifact** — every phase produces a dated report under `harness-reports/phase-N-<focus>-YYYY-MM-DD.md` with raw data, methodology, and the gate result.

### 2.4 Verification-before-completion

Per superpowers:verification-before-completion: no task is complete until:
- Its tests pass.
- The relevant typecheck is clean (`bunx tsc --noEmit` in the affected packages).
- The change is reviewed (subagent-driven review or main-agent verification).
- The commit is made.

### 2.5 Code review at phase boundaries

Per superpowers:code-reviewer: at the end of each phase, a code-review subagent reads:
- The phase's detailed plan
- The diff of all commits in the phase
- The validation evidence artifact
- The vision pillar(s) the phase claimed to serve

…and produces a review verdict. Phase advancement requires a passing review verdict.

---

## 3. The eight phases

### Phase 0 — Empirical Foundation (frozen judge)

- **Goal:** Containerize a separately-versioned, model-pinned, code-SHA-pinned judge service that the bench harness consumes via RPC. Resolves Rule 4 violation.
- **Vision pillars:** Observability (eval), Reliability (reproducibility).
- **Why first:** Every other phase's validation gate requires reproducible benchmarks. Without a frozen judge, "before/after" comparisons are confounded by judge drift. **Phase 0 is the keystone of the entire plan.**
- **Validation gate (concrete + measurable):**
  1. The same task suite + same SUT model run twice 24 hours apart produces identical bench scores within ±0.5%.
  2. A bench publish call is rejected with `Rule4Violation` if `judge.model === sut.model`.
  3. Every published bench report includes: judge model SHA, judge code SHA, run ID, replay command.
  4. The frozen-judge container can be rebuilt from a Dockerfile in the repo (no missing dependencies).
- **Detailed plan:** `2026-05-03-phase-0-frozen-judge.md` (written; ready to execute).
- **Estimated effort:** 1–2 sessions (8–16 hours).
- **Dependencies:** None.
- **Stop-the-line:** if the gate fails, no other phase can begin — we cannot generate evidence.

### Phase 1 — Mechanism Validation Sweep

- **Goal:** Walk every harness mechanism (M1–M13 from §6 of the audit + every `_unstable_*` surface). For each, either produce a spike that demonstrates measurable lift on a documented failure mode, OR mark the mechanism `_unstable_sunset_v0_11_*` with documented removal date.
- **Vision pillars:** Control (only ship validated capabilities), Efficiency (smaller is better).
- **Validation gate:**
  1. Every mechanism has either: spike evidence with a quantified lift (% improvement on a tracked failure mode at a given model tier), OR a `_unstable_sunset_*` marker with a sunset date.
  2. Mechanisms with no evidence and no sunset marker fail CI lint after Phase 1.
  3. Aggregate harness LOC drops by at least 5% (sunset mechanisms removed).
- **Detailed plan:** Write `2026-MM-DD-phase-1-mechanism-validation-sweep.md` immediately before Phase 1 begins. The detailed plan dispatches one subagent per mechanism (M1, M2, …, M13), each running an isolated spike per the discipline in `01-RESEARCH-DISCIPLINE.md` Rule 5.
- **Estimated effort:** 5–10 sessions over 2–3 months (one mechanism per session if validating; one batch session if sunsetting unproven ones).
- **Dependencies:** Phase 0 (need frozen judge to generate per-mechanism evidence).
- **Stop-the-line:** if a mechanism's spike shows neutral or negative lift, we sunset it — do not retry the spike with different conditions to "find" a positive result. Rule 11.

### Phase 2 — Orchestration Decomposition (Stage 7 W23–W28)

- **Goal:** Decompose the orchestration trio (`builder.ts` 6,082 LOC, `execution-engine.ts` 4,499 LOC, `runner.ts` 1,706 LOC) into composable units per `06-AUDIT-v0.10.0.md` §16.2.
- **Vision pillars:** Composition (Pillar 6), Control, DX.
- **Validation gate (per Stage 7 wave):**
  - **W23 (Phase-as-data execution-engine):** `execution-engine.ts` ≤ 600 LOC; 9 phase modules ≤ 400 LOC each; every existing test passes unchanged.
  - **W24 (Strategy RI-scaffolding helper):** `runStrategyRiScan` helper extracted; `plan-execute.ts` and `tree-of-thought.ts` shrink by ≥75 LOC each; reflexion + adaptive gain RI integration with one-line call; all strategy tests pass; new test confirms RI fires on reflexion + adaptive.
  - **W26 (Sub-builders + thin DX surface):** `builder.ts` ≤ 500 LOC; 7 sub-builders ≤ 400 LOC each; `ExecutionEngine.fromConfig()` does service wiring; codemod handles every example + CLI generator; all integration tests pass.
  - **W27 (`GatewayAgent` type extraction):** `ReactiveAgent.start()` removed; `GatewayAgent extends ReactiveAgent` with `start()`/`stop()`; `withGateway()` returns `GatewayAgentBuilder`; type-level distinction enforced; gateway-mode tests pass.
  - **W28 (Phase-typed builder validation, optional):** `withTools()` requires prior `withReasoning()` enforced at compile time; one TS error appears in a deliberately-broken example in CI.
- **Detailed plans:** Write one plan per Stage 7 wave (`2026-MM-DD-phase-2-w23-execution-engine-decomposition.md`, etc.) immediately before each wave begins. Each plan follows writing-plans discipline strictly.
- **Estimated effort:** 4–6 sessions across 5 waves.
- **Dependencies:** None at Phase 2 entry, but order matters within: W23 → W26 → W27 (W26 depends on W23's clean engine boundary; W27 depends on W26's clean builder).
- **Stop-the-line:** if any wave's validation gate fails (e.g., test breaks, LOC target missed), revert the wave and revise the plan. We do not ship a half-decomposed orchestrator.

### Phase 3 — Code-as-Action Strategy

- **Goal:** Add `CodeAgentStrategy` as a 6th reasoning strategy. The strategy emits Python code blocks (sandboxed via Bun.spawn or E2B) that compose existing tools as function calls — `tool_x(); tool_y(); return final_answer(...)` — closing the smolagents/OpenHands code-action gap.
- **Vision pillars:** Local-First (Pillar 8) — closes the 7-14B agentic gap; Flexibility (Pillar 3); Efficiency (Pillar 6) — fewer LLM round-trips for multi-step tasks.
- **Validation gate:**
  1. `CodeAgentStrategy` exists in `packages/reasoning/src/strategies/code-action.ts` and integrates with the existing strategy registry.
  2. On a 10-task multi-step suite (sequential tool calls), `CodeAgentStrategy` on qwen3:14B beats `reactive` on qwen3:14B by ≥20% accuracy.
  3. Token usage on the same suite drops by ≥25% with code-action vs reactive.
  4. Sandbox safety: code execution cannot access host filesystem outside the sandbox dir; cannot make network calls outside whitelisted hosts; timeout enforced.
  5. Frontier model parity: code-action does NOT regress claude-haiku or gemini-flash on the same suite (within ±5%).
- **Detailed plan:** Write `2026-MM-DD-phase-3-code-as-action.md` before execution.
- **Estimated effort:** 2–3 sessions.
- **Dependencies:** Phase 0 (bench), Phase 2 W23 (cleaner phase boundaries make integration easier).
- **Stop-the-line:** if the local-tier lift is <20% or frontier regresses >5%, the strategy is marked `_unstable_*` and shipped as opt-in only.

### Phase 4 — Local Model Engineering

- **Goal:** Close the per-provider FC-parsing gap and activate the dormant calibration consumer surface.
- **Vision pillars:** Model-Adaptive Intelligence (Pillar 4 of vision diagram), Local-First (Pillar 8).
- **Concrete sub-goals:**
  1. **Per-provider tool-call parser:** `ProviderAdapter.parseToolCalls(rawResponse, modelId, runtimeVersion)` resolves the qwen3 + Ollama + thinking-mode + tool_calls coexistence (LiteLLM #18922 documented bug).
  2. **Calibration consumer activation:** wire `parallelCallCapability` to gate batch tool calls; wire `interventionResponseRate` to gate dispatcher firing for non-compliant models; wire `knownToolAliases` into the proactive prompt-injection layer.
  3. **Tool-result paging:** 50KB per-tool / 200KB per-message caps with disk spill — implement at `kernel/capabilities/attend/context-utils.ts`.
- **Validation gate:**
  1. qwen3:14B on a τ-bench-derived retail subset achieves ≥30% of frontier (claude-sonnet) score.
  2. Thinking-mode + tool_calls coexistence works on Ollama qwen3:14B without dropped tool calls (regression test).
  3. At least 8 of the 14 currently-unused calibration fields have active consumers (audit at `harness-reports/phase-4-calibration-consumption-YYYY-MM-DD.md`).
  4. Tool-result paging caps observed in production traces (no message exceeds 200KB; spill artifacts on disk for oversized results).
- **Detailed plan:** Write `2026-MM-DD-phase-4-local-model-engineering.md` before execution. Three subagent-dispatchable tracks: per-provider parser, calibration consumers, tool-result paging.
- **Estimated effort:** 4–6 sessions.
- **Dependencies:** Phase 0 (bench), Phase 1 (informs which calibration fields actually matter).
- **Stop-the-line:** if τ-bench retail subset score is <30% of frontier after all three sub-goals land, escalate to Phase 4.5 (additional local-model investigation) before advancing.

### Phase 5 — Public Benchmark Discipline

- **Goal:** Submit to or replicate at least one third-party agent benchmark with reproducible methodology, per `01-RESEARCH-DISCIPLINE.md` Rule 11.
- **Vision pillars:** Reliability, Trustworthiness, Local-First (third-party validates the local-tier story).
- **Validation gate:**
  1. At least one of {τ²-bench, BFCL V4, HAL Princeton harness} integration in `packages/benchmarks/src/sessions/` with a reproducible run command.
  2. A run is published to `harness-reports/public-bench-<name>-YYYY-MM-DD.md` with: model + provider + date pinned; cost reported alongside accuracy; ≥3 seed variance reported (mean ± stdev or P50/P95); raw traces released as JSONL.
  3. The framework's positioning doc (`README.md`) contains exactly one external benchmark claim with full methodology disclosure.
- **Detailed plan:** Write `2026-MM-DD-phase-5-public-benchmark.md` before execution. Pick ONE benchmark first (recommend τ²-bench-retail — clearest reproducibility story); add others later.
- **Estimated effort:** 2–3 sessions per benchmark.
- **Dependencies:** Phase 0 (frozen judge), Phase 1 (mechanisms validated to know what's actually shipping).
- **Stop-the-line:** if the run produces results inconsistent with internal bench (>15% delta), investigate the harness, not the result. Honest reporting wins over publishable scores.

### Phase 6 — First-Class Skills + Snapshot/Replay

- **Goal:** Two adjacent capability additions that compound: file-system-discoverable Skills (Anthropic-pattern progressive disclosure) and a snapshot/replay primitive.
- **Vision pillars:** Composition, Observability, Flexibility, Cross-vendor compatibility.
- **Validation gate:**
  1. **Skills:** every existing skill in `packages/tools/src/skills/` is convertible to file-system pattern (`.claude/skills/<name>/SKILL.md` + bundled files). One example app uses the new pattern end-to-end.
  2. **Skills cross-vendor:** the framework can load skills written for Anthropic Claude Code (i.e., Anthropic's standard SKILL.md schema) without adaptation.
  3. **Snapshot/replay:** `agent.replay(traceId, { overrides })` works; replays a recorded run against modified prompts/models holding tool results constant; produces a diff report.
  4. **Replay determinism:** the same trace replayed twice with identical overrides produces identical bench scores (modulo provider nondeterminism, which is logged).
- **Detailed plan:** Write `2026-MM-DD-phase-6-skills-and-replay.md` before execution. Two subagent-dispatchable tracks (skills format, replay primitive) — can run in parallel.
- **Estimated effort:** 3–4 sessions.
- **Dependencies:** Phase 2 (cleaner orchestration), Phase 0 (replay needs deterministic bench infrastructure).
- **Stop-the-line:** if skills format diverges from Anthropic's standard, document the divergence explicitly and offer a converter; do not silently fork the standard.

### Phase 7 — v1.0 Polish & Release

- **Goal:** Tag v1.0. Ship with all anchors validated, all gaps closed, public benchmark numbers, reproducible methodology, and a story aligned to the vision.
- **Vision pillars:** All eight.
- **Validation gate:**
  1. Every prior phase's gate passes (run the gates again on the integrated codebase).
  2. CHANGELOG comprehensive: every Stage 7 wave, every mechanism sunset, every new strategy, every benchmark publication documented.
  3. README rewritten to reflect the validated state (no aspirational claims).
  4. ROADMAP.md rewritten: what shipped, what's deferred to v1.1+, what was killed and why.
  5. The 8-pillar table from §1 of this plan revisited: each pillar has a concrete artifact (file path, bench number, doc) that demonstrates fulfillment.
  6. Test suite green: `bun test` across the whole workspace; typecheck clean across all 28 packages.
- **Detailed plan:** Write `2026-MM-DD-phase-7-v1-release.md` before execution.
- **Estimated effort:** 2–3 sessions.
- **Dependencies:** All prior phases.
- **Stop-the-line:** if any prior phase gate fails on re-run, do not tag v1.0. Fix-forward only.

---

## 4. The improvement loop (self-improving discipline)

Each phase produces evidence that informs the next. This is the dogfooding discipline — the framework uses its own observability and eval to guide its own development.

### 4.1 Per-phase evidence flow

```
Phase N
  ├─ Baseline measurement (committed to harness-reports/phase-N-baseline.json)
  ├─ Implementation (TDD, subagent-driven, frequent commits)
  ├─ Post-impl measurement (committed to harness-reports/phase-N-postimpl.json)
  ├─ Evidence artifact (harness-reports/phase-N-<focus>-YYYY-MM-DD.md)
  ├─ Code review (superpowers:code-reviewer subagent)
  ├─ Validation gate check (numerical comparison baseline → postimpl)
  └─ Verdict: PASS → next phase | FAIL → revert/revise
```

### 4.2 Evidence informs Phase N+1

After each phase, before defining the detailed plan for Phase N+1:
1. Read `harness-reports/phase-N-<focus>-YYYY-MM-DD.md`.
2. Identify any unexpected findings (e.g., Phase 1 might find that the healing pipeline only matters for one model — Phase 4 plan should reflect that).
3. Amend Phase N+1's validation gates if the evidence justifies it (loosen if too strict, tighten if too loose).
4. Document the amendment in this master roadmap (§9 amendment log).

### 4.3 Quarterly research re-evaluation

Every 90 days from this plan's start date (2026-05-03):
1. Read framework changelogs (LangGraph, OpenAI Agents SDK, Anthropic Agent SDK, smolagents, Mastra, Pydantic AI).
2. Read the agentic-track papers from arxiv (search "agent harness", "agent benchmark", "function calling", date range last 90 days).
3. Read updates to public benchmarks (τ-bench, BFCL, HAL).
4. Produce a research-amendment artifact: `harness-reports/research-amendment-YYYY-Q.md`.
5. If amendments justify it: update this master roadmap's phase order, add new phases, or kill obsolete phases.

**The vision document (`00-VISION.md`) is the only stable anchor — all other docs (including this plan) adapt.**

---

## 5. Adaptability mechanism

Reactive Agents commits to the vision but not to any specific phase ordering or set. The plan is amendable. The discipline is:

- **Vision drift is forbidden.** Adding a phase that violates a pillar requires a vision amendment first (a separate, durable proposal — not a unilateral plan edit).
- **Phase reorderings are permitted** at quarterly review, with the amendment log entry recording the reasoning.
- **New phases may be inserted** for genuinely new opportunities (e.g., if Anthropic ships a new SDK pattern that subsumes Phase 6, that's a Phase 6.5 amendment, not a vision change).
- **Phases may be killed** if their validation gate becomes provably unmeetable AND the vision pillar can be served another way.

---

## 6. Governance — when to deviate

### 6.1 When to skip a phase
Never. Phases are sequenced because their validation gates depend on prior gates. Skipping a phase invalidates the next phase's evidence.

### 6.2 When to abandon a phase mid-execution
If three consecutive sub-tasks within a phase fail their TDD gates AND the failure analysis points to a structural reason (the underlying assumption is wrong), abandon the phase. Document the abandonment in §9 with the structural reason. Re-write the phase definition before re-attempting.

### 6.3 When to deviate from TDD discipline
Never. TDD discipline is non-negotiable per `superpowers:test-driven-development`. If a task seems untestable, the task is decomposed wrong. Re-decompose.

### 6.4 When to deviate from subagent-driven execution
For tasks whose context is genuinely smaller than the dispatch overhead (single-file 10-line change). In these cases, execute inline with the same TDD discipline. Document in commit message: "inline execution, scope justifies."

### 6.5 When to ship without all gates passing
Never for v1.0. v0.10.x patch releases may ship with smaller scope (a single phase, not the v1.0 cumulative gate set), with each release's release notes explicitly listing which gates the release's scope passes.

---

## 7. Estimated total effort

Conservative bottom-up estimate, assuming one focused session per item plus 30% slack for unexpected findings:

| Phase | Sessions (focused) | Calendar (assuming 2 sessions/week) |
|---|---|---|
| 0. Frozen judge | 2 | 1 week |
| 1. Mechanism validation sweep | 10 | 5 weeks |
| 2. Orchestration decomposition (5 waves) | 6 | 3 weeks |
| 3. Code-as-action strategy | 3 | 1.5 weeks |
| 4. Local model engineering | 6 | 3 weeks |
| 5. Public benchmark | 3 | 1.5 weeks |
| 6. Skills + snapshot/replay | 4 | 2 weeks |
| 7. v1.0 polish & release | 3 | 1.5 weeks |
| **Total** | **37** | **~18 weeks (4 months)** |

**Realistic calendar with reality:** 6–9 months. Quarterly research re-evaluations may add or reorder phases.

---

## 8. Vision pillar artifact checklist (Phase 7 acceptance criterion)

At v1.0 release, each pillar must have a concrete artifact demonstrating fulfillment. Phase 7 verifies this table is complete.

| Pillar | Required artifact | Verification command |
|---|---|---|
| **1. Control** | Every mechanism has enable/disable + observable events + audit trail | `grep -L "enable[A-Z]" packages/*/src/index.ts` returns no false negatives |
| **2. Observability** | EventBus 15+ event types fire on every run; replay primitive works | `bun test packages/runtime/tests/replay-determinism.test.ts` passes |
| **3. Flexibility** | 6 reasoning strategies (incl. CodeAgentStrategy); ≥6 providers | `ls packages/reasoning/src/strategies/` ≥ 6 files |
| **4. Scalability** | Concurrent execution + persistent gateway + A2A all wired and tested | `bun test packages/orchestration packages/gateway packages/a2a` all green |
| **5. Reliability** | Frozen judge + reproducible bench + Effect-TS typed errors + circuit breakers | `harness-reports/phase-0-frozen-judge-final.md` shows ≤±0.5% reproducibility |
| **6. Efficiency** | Code-as-action shows ≥25% token reduction on multi-step suite; semantic cache live; tool-result paging caps observed | `harness-reports/phase-3-code-as-action-validation.md` |
| **7. Security** | Sandboxed code execution; guardrails wired and tested; Ed25519 identity has at least one production consumer | `bun test packages/guardrails packages/identity packages/tools/src/skills/code-execution` green; example using identity in `apps/examples/` |
| **8. Speed** | Bun-native; AgentStream.toSSE works in one line; parallel tool execution gated by `parallelCallCapability` calibration field | `bun test packages/runtime/tests/streaming.test.ts`, demo in `apps/examples/` |

---

## 9. Amendment log

Every amendment to this master roadmap (phase reordering, gate revision, phase addition/deletion) gets logged here with date, reason, and authority.

| Date | Amendment | Reason | Authority |
|---|---|---|---|
| 2026-05-03 | Plan created | v0.10.0 release-pending; audit §16 surfaced gaps | tylerjrbuell |
| 2026-05-04 | Phase 1 complete: 8 KEEP + 5 IMPROVE verdicts; 0 removals | All 13 mechanisms validated via TDD spikes. Improvement-first posture confirmed effective. 5 mechanisms have Phase 1.5 action items; 8 earn their keep with zero regressions. Phase 2 gates amended per synthesis findings. See `.agents/PHASE-1-SYNTHESIS.md` for detailed implications. | Phase 1 validation evidence |
| _(future amendments append here)_ | | | |

---

## 10. Dispatch protocol — how to start

When ready to begin Phase N:

1. **Read** `harness-reports/phase-(N-1)-<focus>-YYYY-MM-DD.md` (skip if N=0).
2. **Amend** Phase N's validation gates in this doc if the prior phase's evidence justifies it; log amendment in §9.
3. **Write** `wiki/Planning/Implementation-Plans/2026-MM-DD-phase-N-<focus>.md` following superpowers:writing-plans discipline strictly (bite-sized TDD tasks, exact commands, no placeholders).
4. **Execute** the detailed plan via superpowers:subagent-driven-development.
5. **Verify** the validation gate. Pass → advance. Fail → stop the line.
6. **Code review** the phase via superpowers:code-reviewer.
7. **Commit** the evidence artifact (`harness-reports/phase-N-<focus>-YYYY-MM-DD.md`).
8. **Update** ROADMAP.md (root) with phase completion.
9. **Begin** Phase N+1 dispatch protocol.

---

*This plan is the framework's public commitment to its vision. It is amendable in detail, immovable in spirit. The vision is the constitution; this plan is the legislative agenda.*

*Last updated: 2026-05-03 (initial creation).*
