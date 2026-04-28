# Reactive Agents — Roadmap

> **Last updated:** 2026-04-28 (refactor/overhaul)
> **The open-source agent framework built for control, not magic.**

This roadmap describes what's shipping, what's `_unstable_*`, and what's deferred. The detailed execution plan for the current overhaul lives in `docs/spec/docs/AUDIT-overhaul-2026.md` §15 (Stage 5 Wave sequencing).

---

## Current state

- **v0.9.0** is published on npm (most workspace packages).
- **`refactor/overhaul`** branch is the working trunk. 100+ commits since `main`. Audit complete (28 packages + 13 mechanisms + 44-item FIX backlog).
- **v0.10.0** is the next release — a clean-break overhaul targeting verified quality gates. Detailed plan in `AUDIT-overhaul-2026.md`.

---

## v0.10.0 — Overhaul Release (in progress)

**Goal:** stable foundation that future work can build on. Verified quality gates, no half-broken systems.

### P0 release blockers (must ship)

1. Publish umbrella `reactive-agents` to npm (currently `npm install reactive-agents` returns 404).
2. Publish `@reactive-agents/diagnose` to npm.
3. Fix qwen3 thinking-mode auto-enable at `llm-provider/src/providers/local.ts:226-251` (empties output on qwen3 today).
4. **Collapse 9 termination paths to single-owner via the Arbitrator.** NS §2.5 architectural blocker — the corpus-failure root cause. CHANGE A wired the oracle into 1 of 9; the other 8 bypass it.
5. Fix eval Rule 4 frozen-judge — separate `JudgeLLMService` Tag, `judge.model !== sut.model` guard, code-SHA pinning. Required for any benchmark claim.

### P1 (high — strongly degrades release quality)

- Pick canonical compression system (curator); delete or hard-disable parallel `tool-execution.ts` compression
- ToT outer loop honors early-stop (mirror `plan-execute.ts` perRIEarlyStop pattern)
- Wire 3 missing skill-hook subscribers (`onSkillActivated` / `onSkillRefined` / `onSkillConflict`)
- Make `MAX_RECURSION_DEPTH` configurable; remove silent `Math.min(value, 3)` cap on sub-agent `maxIterations`
- Mark `_unstable_*` per Rule 10 across multiple packages (llm-provider has 14+ surfaces missing markers)
- SHRINK `execution-engine.ts` (4,476 LOC → ~1,500) and `builder.ts` (5,877 LOC → ~2,500) per NS §6
- Thread RI budget counters through dispatch context (suppression gates currently unreachable)
- Resolve duplicate `AgentConfigSchema` (rename core's to `AgentDefinitionSchema`)

### P2 (medium — quality-of-life)

- Default observability ON (currently OFF at `runtime.ts:1349`)
- TTY-conditional `Logger.none` only (currently silences all `Effect.log*` unconditionally)
- Add `engines: { bun: ">=1.1" }` + Node fallback for `bun:sqlite` consumers
- Delete `FRAMEWORK_INDEX.md` (done — paths were broken)
- Calibrate `RESULTS-p01.md` + `RESULTS-p02.md` overclaim language per Rule 11
- Fix or delete eval `runSuite` placeholder
- Fix telemetry-collector defects (token estimate, `cacheHits` unwired, strategy attribution biased, MetricsCollector silent fallback)
- Cost router calibration coupling + model SHA refresh
- Define `AgentMemory` port in `core` and wire reasoning to it

### P3 (low — cleanup, can defer to v0.10.1 if scope creeps)

- `rax demo` authenticity (currently scripted)
- `rax init` provider neutrality (currently hardcodes Anthropic)
- Async memory DB layer (currently sync `Effect.sync` blocks event loop)
- Delete 4 dead RI handler files; delete dead `recommendStrategyForTier`; resolve `ProviderCapabilities` deprecation
- `_unstable_gate_*` / `_unstable_*` markers on testing/gate, prompts/ExperimentService, react/svelte/vue
- Wire identity service into tool execution (currently dormant — `IdentityService`, `PermissionManager`, `AuditLogger`, `CertificateAuth` all merged into runtime layer but no consumer reads it)

---

## v0.11.0 — Post-Overhaul Validation (next)

After v0.10.0 ships clean, the work shifts from structural fixes to spike-driven validation per `00-RESEARCH-DISCIPLINE.md`.

- Spike-validate the healing pipeline (4 stages × per-tier matrix). Currently unvalidated — claims exceed evidence.
- Spike-validate the verifier-driven retry mechanism on a frontier model (claude-haiku) — currently single-model evidence.
- Re-run AUC corpus probe after RI dispatcher fix; report dispatched/skipped per skip-reason.
- Spike-validate FM-C1 (shallow reasoning / red herring) — currently `UNMITIGATED`. Top priority in `01-FAILURE-MODES.md` queue.
- Spike-validate FM-D1 (premature termination) — claimed mitigation, never empirically tested.
- Cross-provider expansion: add claude-haiku to spike matrix as one frontier reference.
- Strengthen UI integrations: validate react/svelte/vue against runtime SSE contract.

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
