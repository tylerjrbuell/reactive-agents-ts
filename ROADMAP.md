# Reactive Agents — Roadmap

> **Last updated:** 2026-04-30 (refactor/overhaul — Stage 5 closed, Stage 6 in flight: workspace green)
> **The open-source agent framework built for control, not magic.**

This roadmap describes what's shipping, what's `_unstable_*`, and what's deferred. The detailed execution plan for the current overhaul lives in `docs/spec/docs/AUDIT-overhaul-2026.md` §15 (Stage 5 Wave sequencing).

---

## Current state

- **v0.9.0** is published on npm (most workspace packages, including the `reactive-agents` umbrella — the prior "404 today" claim was stale per W14 npm-stats check).
- **`refactor/overhaul`** branch is the working trunk. Audit complete (28 packages + 13 mechanisms + 44-item FIX backlog). Stage 5 closed waves W2–W19 — most backlog items resolved or deferred with rationale.
- **Stage 6 (W20)** complete except for the tag: workspace typecheck green across 55 packages, full test suite green across 52 packages (W20 pinned 23 fixture-level regressions to the new Stage-5 semantics — lazy-tool default opt-out, opt-in claim-grounding, honest failure surfacing, dotted-anchor sites). Version bumps applied (0.9.0 → 0.10.0). Root CHANGELOG gained an "Overhaul" subsection. Bench re-run deferred to post-publish smoke (requires API spend authorization). The v0.10.0 tag is the final step and gated on user confirmation because pushing it triggers `changeset publish` via CI.
- **v0.10.0** is the next release — a clean-break overhaul targeting verified quality gates. Detailed plan in `AUDIT-overhaul-2026.md`. CI release workflow handles publishing.

---

## v0.10.0 — Overhaul Release (Stage 5 → Stage 6)

**Goal:** stable foundation that future work can build on. Verified quality gates, no half-broken systems.

### P0 release blockers — all closed or CI-handled

1. ~~Publish umbrella `reactive-agents`~~ ❌ **stale claim (W14)** — already on npm at v0.9.0; v0.10 update ships via CI release workflow.
2. ~~Publish `@reactive-agents/diagnose`~~ — confirmed absent from registry; ships via CI release workflow at v0.10.0.
3. ~~Fix qwen3 thinking-mode auto-enable~~ ✅ **W7** (`resolveThinking` now opt-in + capability-gated).
4. ~~Collapse 9 termination paths to single-owner via the Arbitrator~~ ✅ **W4** (8 imperative sites in `runner.ts` route through `kernel/loop/terminate.ts`; CI lint at `scripts/check-termination-paths.sh`).
5. ~~Eval Rule 4 frozen-judge~~ ✅ **W9** (separate `JudgeLLMService` Tag, code-path isolation, runtime guard added in W6.5/T10).

### P1 (high) — closed

- ~~Pick canonical compression system~~ ✅ **W6** (resolved-by-discovery; the three mechanisms form a sequenced pipeline, not redundant compressors)
- ~~ToT outer loop honors early-stop~~ ✅ **W5** (BFS frontier + dispatcher; T4 regression test landed)
- ~~Wire 3 missing skill-hook subscribers~~ ✅ **W2**
- ~~Make `MAX_RECURSION_DEPTH` configurable~~ ✅ **W7**
- **#15 Mark `_unstable_*` per Rule 10** ⏸️ deferred to v0.11+ per W14 npm-stats check (~135–400 dl/30d per package; pure consumer-signaling work without a consumer population to discipline)
- **#19/#24 SHRINK ExecutionEngine + builder.ts** ⏸️ deferred (multi-session work; not gating)
- ~~Thread RI budget counters through dispatch context~~ ✅ **W3**
- ~~Resolve duplicate `AgentConfigSchema`~~ ✅ **W2**

### P2 (medium) — closed or deferred with rationale

- ~~Default observability ON~~ ✅ already true at `builder.ts:896` (audit row 10 stale claim)
- **#27 TTY-conditional `Logger.none`** — designed-as-intended trade-off (W8 inspection); v0.11 follow-up if structured-logger wrapping ships
- ~~`engines: { bun: ">=1.1.0" }`~~ ✅ **W12** (8 published packages + umbrella; guard test pins the contract)
- ~~Delete `FRAMEWORK_INDEX.md`~~ ✅ done (Stage 4); ~~AGENTS.md references purged~~ ✅ **W13**
- ~~Calibrate p01/p02 RESULTS overclaim~~ ✅ **W13** (Rule 11 calibration was already in place)
- ~~Fix eval `runSuite` placeholder~~ ✅ **W6.5** (new `SuiteAgentRunner` parameter; T10 frozen-judge guard test)
- ~~Telemetry-collector defects~~ ✅ **W8** (token split, `cacheHits`, strategy attribution); ~~MetricsCollector silent fallback~~ ✅ **W13**
- ~~Cost router calibration coupling + SHA refresh~~ ✅ **W10**
- ~~Define `AgentMemory` port in `core`~~ ✅ **W11** (Phase-2 prep; tool-execution semantic write decoupled, plan-store decoupling deferred to v0.11)
- ~~Add diagnose smoke tests~~ ✅ **W6.6** (12 T11 tests covering resolve / replay / grep / diff)

### P3 (low) — closed or explicitly deferred

- ~~`rax demo` authenticity~~ ✅ **W15** (was already real; freshened to live HN tool call + canonical `defineTool`)
- ~~`rax demo` TUI fidelity~~ ✅ **W15.1** (TerminalReplay rewrite — live-region with panel + status mirrors `StatusRenderer`)
- ~~`rax init` provider neutrality~~ ✅ **W16** (PROVIDER_PROFILES, provider-aware `.env.example` + README, `.withModel` on all templates)
- **#35 Async memory DB layer** ⏸️ deferred to v0.11 (W18 — `bun:sqlite` is sync-by-API; cosmetic `Effect.promise` rejected; trigger conditions in audit row)
- ~~Delete 4 dead RI handler files~~ ❌ **stale (W2)** — 4 names are intentionally retained `controller/evaluators/` files
- ~~Delete dead `recommendStrategyForTier`~~ ✅ **W2**
- ~~Resolve `ProviderCapabilities` deprecation~~ ✅ **W13** (full deprecation block + scheduled v0.11.0 removal target + migration guide)
- **#40-43 `_unstable_*` markers on testing/gate, prompts/ExperimentService, react/svelte/vue** ⏸️ deferred to v0.11+ (same npm-stats rationale as #15)
- **#36 Wire identity into tool execution** ⏸️ deferred to v0.11 (W19 — `AuditLogger` needs durable backing first; `PermissionManager` seed policy unsettled; `CertificateAuth` gated on a2a)
- ~~Re-run AUC after RI dispatcher fix~~ ✅ **W17** (dispatch AUC `0.000 → 1.000` on N=8; entropy AUC `0.500` — bigger corpus is v0.11 follow-up)

---

## v0.11.0 — Post-Overhaul Validation + Deferred Structural Work (next)

After v0.10.0 ships clean, the work shifts from structural fixes to spike-driven validation per `00-RESEARCH-DISCIPLINE.md`, plus the pieces v0.10 explicitly deferred.

### Validation (Rule 6 spike-driven)

- Spike-validate the healing pipeline (4 stages × per-tier matrix). Currently unvalidated — claims exceed evidence.
- Spike-validate the verifier-driven retry mechanism on a frontier model (claude-haiku) — currently single-model evidence.
- Expand AUC corpus from N=8 → ≥30 tasks across diverse failure modes. W17 confirmed dispatch AUC `1.000` on N=8 post-W3 (entropy AUC `0.500` — flat for local models without logprobs); generalization claim needs the bigger corpus.
- Spike-validate FM-C1 (shallow reasoning / red herring) — currently `UNMITIGATED`. Top priority in `01-FAILURE-MODES.md` queue.
- Spike-validate FM-D1 (premature termination) — claimed mitigation, never empirically tested.
- Cross-provider expansion: add claude-haiku to spike matrix as one frontier reference.

### Structural work deferred from v0.10

- **`_unstable_*` markers per Rule 10** (#15, #40-43): re-evaluate when adoption justifies the semver discipline. v0.11 trigger if downloads cross 1k/30d/package or external consumers report API churn.
- **SHRINK ExecutionEngine + builder.ts** (#19/#24): 4,476 + 5,877 LOC respectively. Multi-session work; preserve test green at every commit.
- **Async memory DB layer** (#35, NS G-3): worker-thread architecture — Bun.Worker hosting bun:sqlite, message-passed queries. Triggers logged in audit row.
- **Identity wiring** (#36): start with `AuditLogger` → EventBus subscriber once a durable backing store lands. `PermissionManager` + `CertificateAuth` follow the multi-agent orchestration spec.
- **Plan-store decoupling**: W11 scoped FIX-34 to `tool-execution.storeSemantic`; `plan-execute.ts:21`'s `PlanStoreService` import remains and is the next AgentMemory-port surface.
- **Strengthen UI integrations**: validate react/svelte/vue against runtime SSE contract.

---

## Beyond v0.11.0

These items are deferred until evidence justifies the work.

- **Multi-agent orchestration** (separate spec `16-multi-agent-orchestration.md`) — `@reactive-agents/a2a` and `@reactive-agents/orchestration` capabilities exist but are out of scope for v0.10.0 / v0.11.0. Will land when the use case is concrete and validated.
- **Agent sessions** (separate spec `17-agent-sessions.md`) — multi-turn conversation lifecycle. Current `AgentMemory` port is ~90% of the plumbing needed. Spec lands when sessions become a stated requirement.
- **Phase 4 active skill retrieval** — gated on a passing spike. Per NS v3.0 §6 sprint plan.
- **Evolutionary intelligence** (`@reactive-agents/evolution`) — long-term R&D theme. No active work.

---

## Strategic positioning

The framework's defensible value, per empirical evidence:

- **Trust** — the harness refuses to ship fabrications when verification fails. Spike `p01b` shows verifier `agent-took-action` check converts cogito:8b confident-fabrication → 5/5 honest-fail.
- **Control** — every harness primitive is developer-overridable per Vision Pillar 1 (Control). `VerifierRetryPolicy`, hooks at every kernel phase, no hidden defaults.
- **Observability** — once the default-on fix lands, every run produces traces + metrics + logs without opt-in.

What we don't yet have evidence for: most other harness mechanisms. Per `00-RESEARCH-DISCIPLINE.md` Rule 11, claims must scope to one mechanism × one failure mode × ≤2 models × one task. Single-spike findings shape the next spike, not harness-level marketing claims.

---

## How to track progress

- Audit doc `AUDIT-overhaul-2026.md` is the single source of truth for what's pending.
- Wave commits on `refactor/overhaul` are tagged in commit messages with their wave number (e.g., "audit(stage5/W3): thread RI budget").
- Release tag `v0.10.0` lands when Stage 6 quality gates pass (full test suite green, typecheck 100%, bench re-run with thinking-mode disabled, post-publish smoke test).

*Roadmap is rewritten on major releases. Don't update it for every commit — update it when the strategic picture shifts.*
