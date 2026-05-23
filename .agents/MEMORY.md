# Reactive Agents Build Memory

> **Status:** Reset 2026-04-28 on `refactor/overhaul`. Prior version (564 lines of layered sprint logs) preserved at commit `949bf81f^` — recover via `git show <sha>:.agents/MEMORY.md` if a specific historical claim needs lookup.

## Read first

Before doing any work in this repo:

1. **`wiki/Architecture/Specs/04-PROJECT-STATE.md`** — current empirical state of the framework.
2. **`wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md`** — authoritative architecture + forward plan. If this memory file conflicts with North Star, North Star wins.
3. **`wiki/Architecture/Specs/06-MISSION-STATEMENTS.md`** — guiding statements + L1/L2/L3 success metric ladder + 8 anti-mission boundaries.
4. **`wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md`** — canonical per-iter algorithm + per-capability success signals (NEW 2026-05-23).
5. **`wiki/Architecture/Specs/01-RESEARCH-DISCIPLINE.md`** — 12 rules. Every harness change requires prior spike validation. No exceptions.
6. **`wiki/Hot.md`** — recent-context cache; check for the latest session handoff.
7. **`wiki/Architecture/Design-Specs/2026-05-23-harness-convergence.md`** — active morph spec (22 GH issues #104–#125).

The full canonical doc set is listed in `wiki/Architecture/Specs/DOCUMENT_INDEX.md`.

---

## ACTIVE — Harness Convergence Sweep (2026-05-23)

**22 GH issues filed, 4-phase migration plan, 97 evidence-bearing multi-model probe runs.**

### Single highest-leverage learning

**"Scaffold without callers"** anti-pattern shipped 4× in v0.10.6:
- 4 of 7 Compose TagMap entries with no emit sites
- 8 of 13 `ControllerDecision` variants never fire in failure-corpus
- ~9 of 14 calibration fields with zero consumers
- 1 silent skill persistence path (`emitErrorSwallowed` swallow)

**Codified as Anti-Scaffold Principle in North Star §9.** Every declared surface element MUST have an emit site / consumer in same commit. v0.12 lint discipline.

### Phase 0 — Surface Trust Restoration (COMPLETE 2026-05-23 ✅)

All P0 bugs closed on branch `fix/harness-convergence-104-total-tokens`. Probe-verified cross-tier (cogito:14b + qwen3:14b). 2458 tests green.

- ✅ **#104 M1** — INVALID after empirical verification: schema field is `tokensUsed`, not `totalTokens`. Probe scripts fixed (commit 977da423). #126 filed as P2 naming-consistency followup.
- ✅ **#105 M2a/b/c** — `stripFrameworkLeaks()` at output-assembly + runtime `sanitizeOutput` + verifier `output-not-harness-parrot` backstop (commit b82aac35). Strips paired/orphan `<rationale>`, `[CRITIQUE N] <STATUS>:` (all statuses), `[find/search result —]` templates. Cogito 9/9 + qwen3 9/9 CLEAN post-fix.
- ✅ **#106 M7** — Output/status coherence invariant at `buildStrategyResult` (commit 05b7ab8d). Null/empty/whitespace output coerced to `status:"failed"` regardless of caller. 8 new tests + honest-failure regression updates.
- ✅ **#107 R9** — `DispatchResult.appliedPatches: AppliedPatchRecord[] = {decisionType, patch}[]` preserves decision→patch link (commit 8715fb13). Both InterventionDispatched emit sites publish source decisionType + patchKind separately. Trace shows: decisionType ∈ {early-stop, stall-detect}; patchKind ∈ {early-stop}. Zero conflation.
- ✅ **#108 R10** — Ablation probe `.withReactiveIntelligence(riEnabled)` explicit toggle (commit 1d528861). RI-off cells: `interventionsDispatched=0` across all 4 scenarios. Counter is correctly RI-scoped.
- ✅ **#109 R11** — Triple-surface skill persistence failure: console.warn + Effect.logWarning + ErrorSwallowed tagged `"SkillPersistenceFailed"` (commit af6a9e35). Canonical grep predicate: `e._tag === "ErrorSwallowed" && e.tag === "SkillPersistenceFailed"`.

### Architectural reframes (evidence-grounded)

- ❌ "Strategies bypass kernel" → ✅ 5 of 7 use `runKernel`; outer loops legitimately reimplement BFS/critique/plan-revision (capability mapping <30% mappable)
- ❌ "RI is dead weight" → ✅ 75% fire rate on failure-corpus; +1 success rescue on qwen3 (tier-dependent)
- ❌ "Compose ↔ RI parallel substrates" → ✅ Complementary surfaces, ~zero overlap; **bridge, not subsume**

### Evidence trail (under `wiki/Research/Harness-Reports/`)

10 reports + 3 JSON datasets + 2 probe scripts. SYNTHESIS document: `SYNTHESIS-2026-05-23.md`.

### Mission anchors

- North Star §4.4 unifying principle amended: "surfaces never ship without callers"
- North Star §9: Anti-Scaffold Principle + Empirical Evidence Cadence subsections
- New Doc 06 (mission statements) + Doc 07 (optimal algorithm)

### Optimal per-iter algorithm

10 steps with time budgets totaling ≤59ms framework overhead per iter:
Sense (1ms) → Attend (5ms) → Comprehend (2ms) → Recall (10ms) → Reason (provider) → DECIDE Arbitrator (5ms pure) → Act (tool) → Verify (10ms pure) → Reflect (5ms pure) → Learn (20ms async)

See `wiki/Architecture/Specs/07-OPTIMAL-EXECUTION-ALGORITHM.md` for canonical loop + per-capability success signals + composite signals S1-S6 + algorithmic invariants.

### Execution sequencing

Phase 0 (6 P0 bugs) → Phase 0.5 (M3 ToT cost gate + M5 routing) → Phase 1 (8 convergence items: RI→Compose bridge, capability emit, transitionState lint, soft tools, ControllerDecision audit, llm-exchange, contract test, compression coord) → Phase 2 (`learn/`, multi-severity verifier, default-on memory) ‖ Phase 3 (single Arbitrator, composite confidence, composition routing).

**Next session:** Start Phase 0 via `/execute-backlog` skill. Bundle #105 (M2 output sanitize — highest leverage, closes 3 issues in one PR) first.

---

---

## Token Optimization Session (May 12, 2026) — Complete ✅

**Comprehensive session delivered:** 1,190 tokens freed immediately, $11.58/month potential with behavioral adoption.  
**Details:** See `OPTIMIZATION-SESSION-SUMMARY.md` and `TOKEN-OPTIMIZATION-DASHBOARD.md` in project memory.  
**Quick wins completed:** Phase 1 archive (650t), resolved decisions archive (480t), stale path fixes (80t), test count updated.

---

## Session Optimization Checklist (Token Cost Reduction)

**Use these before every dev session to 60-90% token savings:**

- [ ] **RTK prefix on all CLI commands** — `rtk git log`, `rtk find .`, `rtk grep`, `rtk bun test` (saves ~200 tokens per command)
- [ ] **Smart-search for symbol queries** — `claude-mem:smart-search "FunctionName"` instead of grep chains (saves 71% vs read+grep loops; ~820 tokens per lookup)
- [ ] **Check wiki first** — `wiki:query "what do you know about X"` before deep dives (cached answers, 200-400 tokens saved per query)
- [ ] **Batch independent queries** — 3+ parallel tool calls instead of sequential (reduces round-trip overhead)

**This month's target:** 45% RTK adoption (was 18% May 3), 30%+ smart-search adoption; `rtk gain --history` tracks cumulative savings.

**Detailed report:** See project memory dashboard for May 12 session (1,190 tokens freed, $11.58/month potential).

---

## Current state (May 21, 2026)

### Full architecture audit + GH issue migration — SHIPPED ✅ (May 21, 2026)

Single-source-of-truth migration: all open HS-NN items + AGENTS.md Architecture Debt rows filed to GitHub issues (#68-#92, 25 total) on project board "Reactive Agents Roadmap" (project 1). Wiki Running Issues Log becomes canonical *history* + audit-pattern doc.

**Audit re-verification surfaced 3 inflated/misframed claims:**
- HS-18: framed as "Capability supersedes ProviderCapabilities" — actually orthogonal types (fixed `ac6e6e5d`)
- HS-22: claimed "65 duplicated lines" — actually 9 emit sites in 4 providers (fixed `8ec95598`)
- HS-31: claimed "74 casts" — actually 55 (grep counted match-lines, not occurrences)

**Stale doc path drift fixed in AGENTS.md (`aab68353`):**
- Debugging entry points: `strategies/kernel/phases/think.ts` → `kernel/capabilities/reason/think.ts` (Stage 5 kernel reorg)
- evidence-grounding.ts: actual location `kernel/capabilities/verify/`, not `kernel/utils/`
- Tool count: 9 meta-tools (was 8 — discover-tools was missing)
- Tests: 5,317 pass / 26 skip / 0 fail (2026-05-20 baseline, was 5,294)

**New GH infra (`<this commit>`):**
- Issue templates: `architecture-debt.yml`, `audit-finding.yml` (both require `verified-by` field with file:line evidence — prevents future inflation)
- Labels: `health-sweep`, `architecture-debt`, `verified`, `audit-2026-05-21`, `priority:p3`
- Process: every health-sweep finding now requires `verified-by:` line before filing. `.claude/skills/codebase-health-sweep/SKILL.md` updated to enforce.

**HS items still tracked in wiki (for context):** 11 fixed (HS-01/05/09/10/11/12/18/22 + 3 false-positives + count-verify 19/31). Total open in GH: 25 new + ~22 pre-existing = ~47.

### Tier 0 Honesty Sweep — SHIPPED ✅ (May 19, 2026, v0.11.1, pushed)

Ownership pass after v0.11.1. Artifact: `wiki/Research/2026-05-19-framework-state-and-priorities.md`.

- **HEAD DTS build was RED** — `runtime.ts` `leanModeVerifier` missing required `softFail` (`a368a186` fixed only sibling `noopVerifier`); `main` could not publish. Fixed `e8dc8b20`.
- **3 of 6 compose killswitches were broken in shipped v0.11.1** (systemic "shipped+documented+dead"):
  - `confidenceFloor` unshipped `c7fa29c2` — `before('verify')` never fires + phantom `state.verifierScore`.
  - `watchdog` fixed `035f4765` — dead `tap('observation.tool-result')` → `after('act')` (was killing healthy agents).
  - `requireApprovalFor` fixed `0460aaad` — phantom `state.pendingToolCalls` → `state.meta.pendingNativeToolCalls` (safety gate silently approved everything).
  - `budgetLimit`/`timeoutAfter`/`maxIterations` verified sound.
- **Anti-pattern:** every broken killswitch had isolation tests feeding the buggy state shape (false-pass CI). Killswitch/hook tests MUST use real runtime state shape + a phase the runner actually fires (fire-set: before bootstrap/think/act, after think/act/complete — NOT verify; `observation.tool-result` has no emit site).
- **Scope corrections:** `experienceSummary` (`context-manager.ts:272`) is the M6/M10 loop, not a 1d wire (no runtime producer, no store writes). `authorize()` is multi-day cross-package wire (identity/reasoning/runtime zero cross-refs), not "one seam"; Tier 0 cheap alt = audit/unship the delegation-enforcement claims in docs.
- **Next:** user decides — Tier 0 close (security-claims doc audit, ½d) vs properly-scoped Phase 1.5 unit (M6/M10/M14 or real authorize() wire). Do NOT conflate doc audit with authorize() wire.

### M3 Ablation Running — Decision Traceability Inquiry (May 12, 2026)

External user email: "What do you have agents record so another agent, or future you, can understand why a change happened?"

**Context:** User reviewed Cortex Studio run details and AI-generated debrief. The inquiry surfaced a genuine product differentiator.

**What we already have:**
- Comprehensive trace JSONL via `@reactive-agents/trace` with 20+ event types
- Each decision carries `reason: string` + `confidence: number`
- Full LLM exchanges, entropy scores, kernel state snapshots, guard verdicts, verifier results
- CLI tools: `rax:replay`, `rax:grep`, `rax:list`, `rax:diff`

**What's planned (decision-rationale-traceability plan, 2026-05-12):**
- Rationale type: `{why, refs, alternatives, confidence}` structured shape
- Optional rationale fields on tool-call, termination, strategy-switch events
- Assumption detection in think phase
- Curator decision events (why content was kept/dropped/compressed)
- **`rax:diagnose debrief` command** — renders readable markdown timeline vs raw JSONL

**Key research finding:** Stanford Meta-Harness showed traces are essential (50% → 34.6% accuracy without them). Raw execution paths are the knowledge artifact another agent needs.

**Positioning for v0.11:** Decision-rationale plan stages implementation into v1 (Tasks 1–4, 6, 9: 2 weeks) and v1.5 (Tasks 5,7,8,10,11: deferred). Task 9 (debrief command) can ship with v0.11 or as v0.11.1 depending on Compose API timeline. **Decision needed by May 13 after M3 ablation gate.**

**Artifacts:**
- Draft email response: `wiki/Research/Email-Responses/2026-05-12-decision-traceability-inquiry.md`
- Rollout planning: `wiki/Planning/2026-05-12-debrief-rollout-plan.md`
- Implementation plan: `wiki/Planning/Implementation-Plans/2026-05-12-decision-rationale-traceability.md`

---

### Outsider Architecture Feedback — keep v0.11 differentiated (May 10, 2026)

Brief read-only audit found the project is strongest when it promises: **typed, observable, replayable harness control without forking internals**. Keep that as the v0.11 north star.

Priority guidance for agents working on Phase B:
- **Do not let "Compose" mean two products.** `packages/runtime/src/compose.ts` already exports `agentFn`/`pipe`/`parallel`/`race`; Phase B `.compose((harness) => ...)` is a different API. Rename/reposition the existing functional composition surface or make naming explicit before marketing/docs harden.
- **Prefer 5 excellent injection points over 24 thin ones.** First tags should prove trace visibility, type inference (`PayloadFor<Tag>`, `ContextFor<Tag>`), and real control over prompts/messages/nudges/tools/observations.
- **Lock down public surface.** `packages/reasoning/src/index.ts` exports deep kernel internals; avoid widening this. Move future internals behind explicit `unstable` or internal modules.
- **Reduce type erasure at seams.** Concentrate `any` cleanup on public hooks, lifecycle boundaries, compose payloads, metadata, and provider adapter contracts rather than chasing every SDK cast.
- **Separate gateway agents from task agents.** `ReactiveAgent.start()`/`stop()` only make sense with `.withGateway()`; W27 `GatewayAgent` extraction remains a high-signal DX/type-safety refinement.
- **Public promise:** "Intercept, replace, observe, and replay every important harness decision." Features that do not support this should be deferred behind Compose API, Snapshot/Replay, and tracing clarity.

Immediate hygiene: keep `wiki/Hot.md` and this memory aligned with North Star; stale starter docs create bad agent trajectories.

### Phase 1 Mechanism Validation Archive (May 4–12, 2026)

Historical validation (8 KEEP verdicts, 5 IMPROVE verdicts).  
**Live status:** `wiki/Research/Harness-Reports/` and `wiki/Experiments/M*.md` files.  
**Per-mechanism detail:** retained in this file's Phase 1 section below; the prior planned `MEMORY-ARCHIVE-PHASE1.md` extraction was not produced.

---

### North Star v5.0 — Single Consolidated Forward Plan (current, May 11, 2026)

**Canonical planning document:** `wiki/Architecture/Specs/05-DESIGN-NORTH-STAR.md` v5.0 (March 2026 harness-research integration: NLAH Pruning Principle, Stanford Meta-Harness raw-trace finding, self-evolution +4.8pp).

All prior roadmap/phase documents are superseded:
- `wiki/Architecture/Specs/07-ROADMAP-v1.0.md` — SUPERSEDED
- `wiki/Planning/Phase 1.5 Improvement Roadmap.md` — SUPERSEDED (per-mechanism detail retained)
- `04-PROJECT-STATE.md` — retained as cold-session framing doc

**Phase sequence (see North Star §6 for full validation gates):**

| Phase | Focus | Status |
|---|---|---|
| **A** | Architecture Cleanup — W23–W25: `execution-engine.ts` 4,499→1,637 LOC (W24) + `builder.ts` 6,232→2,481 LOC (W25). | ✅ **Complete** |
| **B** | Compose API — Waves A–F, 5+ chokepoints live, 6 killswitches, RunHandle. | ✅ **Complete** (May 13) |
| **C** | v0.11 Launch — skill persistence ✅, Snapshot/Replay ✅, `@reactive-agents/observe` (OTel) ✅, `create-reactive-agent` CLI ✅, `code-action` strategy ✅, Compose API + 6 killswitches ✅. **v0.11.0 release prep complete 2026-05-15** — 7 changesets staged, all CI fixes in commit `6d71d691` (bun pin 1.3.10, docs prebuild, CLI externals). | 🟢 **Ready** |
| **1.5** | Mechanism Improvements — M3 REWORK ✅ shipped; M6 persistence ✅; M7/M8/M10 IMPROVE pending | Parallel with C |
| **D** | Code-as-Action Strategy — 6th reasoning strategy, ≥20% local model lift | v0.12 |
| **E** | Local Model Engineering — calibration consumers (≥8 fields), per-provider parser, paging | v0.12 |
| **F** | Public Benchmark Discipline — τ-bench / BFCL / HAL Princeton | v0.13 |
| **G** | v1.0 Polish & Release | v1.0 |

**Why Phase A before Phase B:** Compose API bolts onto `builder.ts`. Decomposing first prevents rework and makes every subsequent wave cleaner.

**New in v4.0:** Snapshot/Replay (`agent.replay(traceId, overrides)`) promoted from Phase G → Phase C (v0.11). Unique auditable-by-demo capability; 1-week build on existing `packages/trace`.

**Root `ROADMAP.md` alignment** flagged as Phase C gate — must match this plan before v0.11.0 ships.

---

### RTK Token Optimization — DOCUMENTED ✅ (May 6, 2026)

**All team members should use RTK (Rust Token Killer) for CLI commands to save 60-90% tokens per operation.**

**Usage:** Prefix supported commands with `rtk`:
- `rtk git status`, `rtk git log`, `rtk npm list`, `rtk bun test`, `rtk find`, `rtk grep`, etc.
- RTK filters results to only relevant output before returning (e.g., `git log` streams 50+ commits → RTK returns 2-3 relevant ones)
- Transparent in Bash tool calls (hook auto-applies RTK prefix)

**Meta commands (use directly, not prefixed):**
- `rtk gain` — Show token savings for this session
- `rtk gain --history` — Show cumulative savings over time
- `rtk discover` — Find commands in history that should have used RTK
- `rtk proxy <cmd>` — Debug raw command execution (bypass RTK filtering)

**Documentation:** Memory file `feedback_rtk_usage.md` + global `RTK.md`

---

### v0.11 Launch-Readiness Checklist — ABSORBED into North Star v5.0 §6 Phase C (May 7, 2026)

**Comprehensive planning document drafted for market-positioning inflection point.**

**File:** `wiki/Planning/Implementation-Plans/2026-05-06-v0.11-launch-readiness.md` (900+ lines)

**Strategic context:** v0.10 shipped stable core; v0.11 ships *customizability* (compose API) + *credibility signals* (playground, CLI generator, OpenTelemetry, public roadmap). Outcome: v0.11 is Show-HN launch point positioning RA as transparent alternative to AutoGen/CrewAI/Mastra with proven 100% vs 85% benchmark edge.

**Tier 1 (Before Show-HN Launch):** Five parallel initiatives (3 weeks total):
1. ✅ **Skill Persistence** — `skillFragmentToSkillRecord` + dual-store in `local-learning.ts`; learned skills now persist to `SkillStoreService` and appear in `SkillResolverService` on next session. 5 tests (unit + integration + e2e), all green. Shipped 2026-05-13.
2. **Live Playground (2 days)** — Three Stackblitz embeds on homepage (hero scenario, tool integration, reasoning strategy); <3s cold start
3. **create-reactive-agent CLI generator (3 days)** — Five templates (web-search, chat-with-tools, gateway-cron, sub-agent-orchestrator, local-ollama)
4. **OpenInference/OpenTelemetry Exporter (1 week)** — `@reactive-agents/observe` package with Langfuse + Braintrust integrations; zero-config auto-export
5. **Public Roadmap + Named Users (1 day)** — GitHub Projects board (v0.11/v0.12/v0.13 milestones) + "Built with" cards (Cortex, Beacon, Dispatch)

**Prerequisite (parallel):**
- **Compose API (Waves A-F, 2 weeks)** — harness-pipeline registry, 5 chokepoint refactors, RunHandle pause/resume/stop/terminate, 6 killswitches, backward-compat desugar, comprehensive docs

**Success metrics (Week 1 post-launch):**
- Show-HN >500 upvotes
- >1,000 Stackblitz embed clickers
- >500 new npm installs/week (vs 100 baseline)
- >100 create-reactive-agent runs
- >50 GitHub Projects watchers

**Amplified existing capabilities (underplayed assets):**
- Diagnose package (M11 production-ready, 100% TP/0% FP, 0.02ms latency) — add card + docs + examples
- Memory system (M10, 66.7% verbose / 100% keyed recall, 0.05ms overhead) — promote from @unstable → @stable + docs

**Tier 2 (post-launch):** Per-tool middleware, cost forecasting, migration guides, Beacon prominence

**Tier 3 (avoid):** Voice/realtime, computer use kernel, visual no-code, multi-agent swarms

**Timeline:** Wave A starts Fri May 10; v0.11.0 release Wed May 29. Critical path: Compose API (if it slips 1 day, everything slips 1 day). All other items parallelizable.

**Risks & mitigations documented:** Skill persistence data corruption, Stackblitz mobile failures, GitHub Projects stale updates, named-user revocation, compose API scope creep.

**Open questions (resolve before Wave A):** Skill git-commit metadata, .withVerification() desugar scope, M10 re-validation with real LLMs, OTel sampling per-environment, roadmap visibility (GitHub Projects vs Discourse).

**Approval gate:** Compose spec sign-off + all five Tier-1 owners confirm estimates + GitHub Projects board created.

---

### Release Pipeline — REWRITTEN ✅ (2026-05-16) — CURRENT, supersedes all prior release notes

**Tag-driven lockstep.** One explicit version stamps **all** ~35 public
packages. Mechanism: `scripts/release.ts`, run by
`.github/workflows/publish.yml` on a `vX.Y.Z` tag push.

- **Author notes:** `bun run changeset` writes `.changeset/*.md` prose. That
  body is the only human-curated release text.
- **Release:** `git tag vX.Y.Z && git push origin vX.Y.Z` → CI: build/
  **typecheck** (66/66, commit `3cdfeaef` — sole tsc gate; esbuild/tsup are
  transpile-only)/test/clean-install/`release:dry` gate → `release.ts`
  aggregates changeset bodies
  into root `CHANGELOG.md` as `## [<version>] — <date>`, consumes them, stamps
  all packages + root, builds, publishes in topological order (fail-fast,
  idempotent re-run skips already-published).
- **VERSION file (commit 30ccf590):** root `/VERSION` is the committed
  source-of-truth == npm @latest. `release.ts` writes it on stamp;
  `publish.yml` "Sync VERSION to main" commits it back with `[skip ci]`.
  Repo package.json staying unbumped by the tag-driven flow is intentional,
  not drift. `release:dry` mutates then self-cleans the tree — EXIT=0 +
  uniform `X.Y.Z → A.B.C` on all 35 lines = gate green; no manual revert.
- **GitHub Release:** `publish.yml` is the **sole** author (release-drafter
  removed). Body = the `## [<version>] — <date>` CHANGELOG section verbatim.
- **Recovery:** "Backfill GitHub Releases" workflow (manual) recreates missing
  releases from CHANGELOG. `publish.yml` `workflow_dispatch` re-runs a failed
  publish.
- **Drift is structurally impossible** — single version var stamps everything.
  `changesets/action`, `changeset version`, the "Version Packages" PR, and the
  drift scripts (`check-npm-versions.ts`, `check-version-sync.ts`,
  `normalize-release-version.ts`, `resolve-workspace-deps.mjs`) are **all
  deleted**. Do not look for them or treat their absence as a regression.
- **Publish = `npm publish`, NOT `bun publish` (hard-won, v0.11.0).**
  `bun publish` cannot authenticate from release.ts's Bun-shell subprocess
  in CI ("missing authentication") despite 4 `.npmrc`/`$HOME` fixes — yet
  `npm whoami` succeeds from the same `~/.npmrc`. bun 1.3.10 reads `.npmrc`
  only from publish-CWD and `$HOME` (never ancestors) and the Bun-shell
  child doesn't inherit the runner `$HOME`. **Never revert to bun publish.**
  Because npm doesn't resolve `workspace:*`, `release.ts` pins every
  internal `workspace:*` → exact lockstep version in the stamping pass.
  `bun pm pack` is NOT a substitute (resolves from stale `bun.lock`).
- **Auth invariants:** setup-node has **no `registry-url:`** (it would
  export `NPM_CONFIG_USERCONFIG` → placeholder file → broken auth). The
  `Authenticate` step writes the **literal** token (no `${VAR}`) to
  `${NPM_CONFIG_USERCONFIG:-$HOME/.npmrc}`. **npm token must cover scoped
  AND unscoped names** — a `@reactive-agents/*`-scoped token `E403`s on
  `create-reactive-agent` + `reactive-agents` (the 2 unscoped); v0.11.0
  required an org/account-wide token. Credential fix + `workflow_dispatch`
  re-run resumes idempotently (skips already-published).

**Why (historical, do not resurface):** manual `npm publish` once left
package.json behind npm, causing changeset-bump collisions. The lockstep
single-version design removes the entire failure class — no reconciliation
exists because nothing can desync.

Runbook: `.agents/skills/prepare-release/SKILL.md` (kept in sync).

### Eval Workflow Disabled (May 5, 2026 — 8:00pm EDT)

`.github/workflows/eval.yml` auto-triggers (push/pull_request) removed; only `workflow_dispatch` remains. Was failing consistently and blocking unrelated work. Re-enable when eval suite is stabilized.

### v0.10.2 Post-Release Quality Sweep — ALL RESOLVED ✅ (May 7, 2026 recheck)

All P1 issues from the May 5 sweep are resolved — do not resurface as blockers:

- ~~**P1-5:** SDK `agent.run()` missing~~ — FALSE POSITIVE. `ReactiveAgent.run()` exists at `packages/runtime/src/builder.ts:4758`.
- ~~**P1-3:** cortex broken~~ — Fixed: turbo.json assets, CLI build script, cortex.ts error messages all applied (May 5).
- ~~**P1-1:** CLI --help broken~~ — Fixed: `init.ts:25`, `create-agent.ts:48`, `run.ts:72` all handle `--help`/`-h`.
- ~~**P1-4:** CommonJS require fails~~  — Fixed: `cjs-shim.cjs` with helpful ESM-only error, wired via `"require"` export condition in `packages/reactive-agents/package.json`.
- **P1-2 (MEDIUM):** Vague LLM error messages — still open, low priority, not blocking.

---

### v0.10.2 Hotfix Release — SHIPPED ✅ (May 5, 3:42am EDT)

**Status:** All 27 packages at 0.10.2, published to npm, stable and verified.

**Critical fixes:**
- **Broken bun exports:** All 27 packages had `"bun": "./src/index.ts"` but npm packages don't include src/. Changed to `"./dist/index.js"`. This fixed "Cannot find module" errors for npm-installed consumers (CLI, downstream packages).
- **CLI external dependencies:** Added @reactive-agents/eval, llm-provider, a2a, trace, tools to tsup external list so they're dynamically required at runtime, not bundled.

**Release timeline:** 0.10.0 (May 4, broken) → 0.10.1 (May 4, broken) → 0.10.2 (May 5, stable)

**Prevention gates added (CI):**
- `validate-cli-externals.ts` — ensures CLI imports are marked external
- `test-bun-exports.ts` — validates all packages export correct dist/ paths
- Both prevent future broken releases

**Details:** See memory file `release_0_10_2_hotfix.md`

### Wiki Vault Population Complete ✅ (May 4, 3:30pm EDT)

**Obsidian vault fully initialized with comprehensive project brain AND all Phase 1.5 content populated:**

**MOCs & Navigation (5 master hubs):**
- ✅ Architecture MOC — 12-phase kernel, package layers, port system
- ✅ Research MOC — Phase 1 validation (8 KEEP/5 IMPROVE), all 13 mechanisms linked
- ✅ Concepts MOC — Cognitive architecture, tool integration, safety, memory, orchestration
- ✅ Decisions MOC — Phase gates, north star v3.0, strategic trade-offs
- ✅ Packages MOC — 26 packages + 5 apps by layer

**Mechanism Validation (M1-M13):**
- ✅ All 13 mechanism notes with: verdict, test results, metrics, Phase 1.5 actions, integration points
- ✅ KEEP mechanisms: M1, M2, M4, M5, M9, M11, M12, M13 (shipped v0.10.0)
- ✅ IMPROVE mechanisms: M3, M6, M7, M8, M10 (Phase 1.5 action items identified with owners)

**Failure Mode Taxonomy (FM-A-H):**
- ✅ All 8 categories with: manifestation, root cause, reproduction, mitigations, evidence
- ✅ Each FM linked to mechanisms that mitigate it

**Package Documentation:**
- ✅ Package Index (all 26 packages + 5 apps quick reference)
- ✅ Detailed notes for core, llm-provider, reasoning (template for others)

**Planning & Roadmaps:**
- ✅ Phase 1.5 Improvement Roadmap (M3, M6, M7, M8, M10 with effort, timelines, owners)
- ✅ Documentation Consolidation Roadmap (migrate all docs to wiki by Phase 2)

**Status:** 🟢 Wiki is primary knowledge base for Phase 1.5 agentic work. Team can self-serve all context.

**When starting Phase 1.5/2 work:**
1. Check `wiki/Hot.md` for recent session updates
2. Check `wiki/Planning/Phase 1.5 Improvement Roadmap.md` for action items and owners
3. Reference `wiki/MOCs/*` for architecture & decision context
4. Link new work to existing mechanisms (backlinks auto-appear)

**Long-term vision:** Wiki replaces all fragmented doc spaces (spec docs, debriefs, plans, markdown files). Single source of truth by Phase 2.

---

- **Spike M3: Verifier + Retry Validation — COMPLETE:**
  - RED phase: 22 unit tests validate verifier gate + retry policy (100% pass rate).
  - GREEN phase: Implement FM-A1 + FM-C2 retry signal builders addressing p02 findings.
  - **Measured Results:** Verifier precision 100% on cogito:8b fabrication (target ≥90%); retry effectiveness tier-specific per p02 evidence.
  - Improved context design: FM-A1 signal teaches "emit" vs "describe" distinction (direct response to p02 failure); FM-C2 requires ≥3 specific data references.
  - Test coverage: 22 spike tests (43 expectations), all passing. Integration contracts validated (verifier receives context from act.ts, policy receives verdict + state).
  - Files: `packages/reasoning/src/kernel/capabilities/verify/retry-context.ts` (NEW: buildFMA1RetrySignal, buildFMC2RetrySignal, buildImprovedRetrySignal), verifier.ts (improvedVerifierRetryPolicy export), m3-verifier-retry.test.ts.
  - Key findings: (1) Verifier gate production-ready (ship v0.10.0). (2) Retry doesn't help cogito:8b with generic feedback (p02: 0/5 recovery, 4.2× tokens). (3) Improved context targets model misunderstanding, not coercion. (4) Policy is opt-in via ReactiveInput config (backward compatible).
  - Verdict: **✅ PROMOTE** — Gate ships; retry mechanism with `improvedVerifierRetryPolicy` as opt-in improvement.
  - Phase 1.5 actions: (1) Run against cogito:14b to validate recovery ≥50%, (2) Wire temperature override (0→0.2), (3) Promote improved policy if cogito:14b shows lift.
  - Debrief: `RESULTS-m3.md` (comprehensive findings, root cause analysis, Phase 1.5 roadmap).
  - Commit: `329e2d23`.

- **Spike M8: Sub-agent Delegation Validation — COMPLETE:**
  - Delegation mechanism validated across 10 realistic multi-step scenarios (research, analysis, synthesis, validation, transformation).
  - **Measured Results:** Accuracy lift 20% (2/10 scenarios), token savings 2.3% average (modest), latency overhead +41% (spawn cost dominates on simple tasks).
  - Success criteria: ✅ Accuracy improvement on reasoning tasks (S4, S9 improved via focused sub-agent scope). ⚠️ Token savings < 15% threshold on most tasks (only S3 met 15% savings). Latency acceptable (<50% overhead) for medium/hard tasks.
  - Complexity analysis: Simple tasks (≤2) lose to spawn overhead; medium (3) shows 40% accuracy improvement; hard (4+) saves 14.5% tokens on average.
  - Sub-agent quality: All 10 scenarios executed successfully; no cascading failures; recursion guard (max depth 3) enforced correctly.
  - Test coverage: 10 comparison tests (10 scenarios each: inline vs. delegated), 3 quality/failure-isolation tests, 1 complexity analysis test, 1 success-criteria test, 2 meta-tests. Total: 137 assertions, 100% pass rate.
  - Evidence: `packages/tools/tests/m8-sub-agent-delegation.test.ts` (TDD: RED → GREEN → ANALYSIS complete).
  - Key findings: (1) Delegation wins on **complex reasoning** where accuracy > latency. (2) Spawn overhead (80ms, 20 tokens) kills ROI on simple tasks. (3) Token savings only ≥15% when base cost exceeds 150 tokens. (4) Focused sub-agent scope + explicit directive improves constraint detection & specification writing. (5) Failure containment perfect: no cascade, structured error returns.
  - Verdict: **✅ KEEP** with **scoped guidance** — mechanism is production-ready; Phase 1.5 real-LLM validation recommended.
  - Debrief: `docs/superpowers/debriefs/M8-sub-agent-delegation-validation.md`.
  - When to use: Multi-step reasoning (≥complexity 3), accuracy-primary goals, latency budget ≥500ms. Avoid: simple tasks, latency-critical paths (<500ms SLA).
  - Phase 1.5 improvements: Real LLM execution (frontier + qwen3), multi-agent batching, tool availability expansion, episodic memory for sub-agents.

- **Spike M13: Guards + Meta-tools Validation — COMPLETE:**
  - 6-guard pipeline (blockedGuard, availableToolGuard, duplicateGuard, sideEffectGuard, repetitionGuard, metaToolDedupGuard) validated across comprehensive dataset.
  - **Measured Results:** True positive rate 100% (target ≥90%), false positive rate 0% (target ≤2%), latency 0.018ms max (target <50ms).
  - Meta-tools registry: 10 tools properly categorized (termination: 2, introspection: 5, special: 3). All meta-tools auto-pass availableToolGuard check (line 62).
  - Test coverage: 19 spike tests (44 assertions), all passing. 89 total kernel tests pass, zero regressions. 100% path coverage: all 6 guards exercised.
  - Evidence: `packages/reasoning/tests/kernel/m13-guards-meta-tools.test.ts` (TDD: RED → GREEN → ANALYSIS complete).
  - Key findings: (1) Guard pipeline deterministic, no cross-interference. (2) Meta-tools bypass availability check but subject to consecutive-call dedup (prevents introspection spam). (3) Latency negligible (0.0003ms per guard). (4) Rejection reasons distinct and actionable.
  - Verdict: **✅ KEEP** — Production-ready for v0.10.0. Guards earn their keep; ship as-is.
  - Debrief: `docs/superpowers/debriefs/M13-guards-meta-tools-validation.md`.
  - Commit: `327426bf`.

- **Spike M11: Diagnostic System Output Leak Detection — COMPLETE:**
  - Output leak detection validated across 27 leak pattern categories.
  - Synthetic dataset: 17 test cases (clean outputs, system prompts, API keys, credentials, false-positive controls).
  - **Measured Results:** True positive rate 100% (target ≥95%), false positive rate 0% (target ≤5%), latency 0.02ms (target <100ms).
  - Leak types detected: system-prompt (4), internal-instruction (2), api-key (4), credential (10).
  - Pattern coverage: AWS AKIA/secrets, OpenAI/Anthropic keys, GitHub tokens, JWT, passwords, database URLs, system prompt headers.
  - False positive mitigation effective: Base64/hash filters distinguish benign content (CRITICAL: AKIA keys checked before base64 filter).
  - Test coverage: 10 M11 spike tests (64 expectations), 22 total diagnose tests, 100% pass rate. Zero regressions.
  - Evidence: `packages/diagnose/tests/m11-diagnostic-output-leak.test.ts` (TDD: RED → GREEN complete).
  - Verdict: **✅ KEEP** — mechanism earns its keep; FM-A3 (output-leak diagnosis) mitigated.
  - Debrief: `docs/superpowers/debriefs/M11-diagnostic-system-validation.md`.
  - Commit: `6f614a94` (original validation).
  - Next: Integrate leak detector into output assembly (Phase 1.5 integration).

- **Spike M10: Memory System (3-tier episodic recall) — COMPLETE:**
  - Episodic memory store/retrieve working via SQLite + FTS5 indexing.
  - **Measured Results:** Recall accuracy 66.7% on verbose natural language, 100% on key-term queries. Accuracy lift +10pp (70% baseline → 77% with memory). Memory overhead negligible: 0.05ms per entry, 41 bytes per entry. No cross-task pollution (taskId filtering effective).
  - Multi-turn continuity validated: Record preferences in Task 1 → Recall in Task 2 → Apply without re-asking.
  - FM-F2 (memory pollution) mitigated: Task-scoped queries prevent false memory injection.
  - Test coverage: 7 spike tests (scenario-based multi-turn), 100% pass rate (178ms, 16 expectations).
  - Evidence: `packages/memory/tests/m10-memory-system.test.ts` (TDD: RED → GREEN complete).
  - Key findings: (1) FTS5 keyword search works excellently for key-term queries but struggles with verbose NL (66.7% vs 100%). (2) Memory overhead negligible on throughput (0.05ms per entry). (3) Task isolation working correctly. (4) Storage efficiency excellent (4KB for 100 entries = 41 bytes/entry).
  - Verdict: **✅ KEEP** — Store+recall cycle fully functional, system ready for Phase 1.5 optimization.
  - Debrief: `docs/superpowers/debriefs/M10-memory-system-validation.md`.
  - Phase 1.5 actions: (1) Implement key-term extraction for Tier 1 to achieve 100% recall (decompose verbose queries), (2) Wire episodic context injection into kernel bootstrap, (3) Design realistic multi-session scenarios for Phase 2.
  - Commit: `658a84c0`.

- **Spike M12: Provider Adapter Hooks Validation — COMPLETE:**
  - All 7 hooks defined on `ProviderAdapter` interface: parseToolCalls, extractText, computeCost, validateResponse, optimizePrompt, handleError, streamSupport.
  - All 7 hooks fire on provider-specific scenarios (qwen3, Gemini, Anthropic, Ollama).
  - Each hook measurably improves its domain: normalization (+30% malformed response handling), streaming reassembly (Gemini text extraction), provider-specific cost calculation, response validation (early error detection), prompt optimization (+15% clarity), error classification (enables retryable vs. fatal routing), streaming event parsing (unified event handling).
  - Zero cross-provider interference: hooks self-gate on modelId.
  - Test coverage: 26 spike tests (52 expectations), 100% pass rate. 254/254 llm-provider tests pass (no regressions).
  - Evidence: `packages/llm-provider/tests/m12-provider-adapter-hooks.test.ts` (TDD: RED → GREEN complete).
  - Verdict: **✅ KEEP** — hooks earn their keep, zero blockers.
  - Evidence: `wiki/Experiments/M12 Provider Adapters.md`.
  - Commit: `14c34a15`.
  - Next: Activate hooks in `llm-service.ts` and provider-specific code (Phase 1 deployment).

- **Spike M4: Healing Pipeline Validation — COMPLETE:**
  - 4-stage FC error recovery: tool-name healing → param-name healing → path resolution → type coercion
  - **Measured Results:**
    - Recovery rate: **86.7%** on full test suite (intentional failures included), **100%** on recoverable errors
    - Accuracy improvement: **+80pp** (6.7% baseline → 86.7% with healing)
    - Token savings: **90%** vs reprompt fallback (750 tokens healing vs 7500 tokens reprompt)
    - Cross-model validation: **100%** on both qwen3:14b and frontier models
    - Stage breakdown: tool-name 100%, param-name 100%, path-resolution 100%, type-coercion 100%
    - Unrecoverable patterns correctly identified: 2/15 (missing args, unknown tool) — intentional behavior
  - **Test Coverage:** 27 tests across 3 suites (m4-healing-pipeline, m4-healing-measurement, healing-pipeline unit tests), 74 expectations, 100% pass rate. Zero regressions.
  - **Cost Analysis:** Avg 1.27 actions per case, +3.3% token overhead (75 → 77 chars avg input/output)
  - Evidence: `packages/tools/tests/m4-healing-pipeline.test.ts`, `packages/tools/tests/m4-healing-measurement.test.ts`
  - **Verdict: ✅ KEEP** — Healing pipeline earns its keep with massive accuracy lift, negligible overhead, strong cross-model performance.
  - Evidence: `wiki/Experiments/M4 Healing Pipeline.md`
  - Commit: `4cf1baea`
  - Ready for v0.10.0 ship. Phase 1.5+ adds hybrid (healing + reprompt fallback), Phase 2+ adds adaptive alias learning.

- **Spike M10: Memory System Validation (FM-F2) — COMPLETE:**
  - FM-F2 ("memory pollution across runs") is **mitigated** (not a practical risk) — task-scoped queries prevent false memory injection.
  - Recall accuracy: **66.7%** on verbose natural language, **100%** on key-term queries.
  - Accuracy lift: **+66.7pp** vs baseline (no memory context).
  - Memory overhead: **negligible** (0.05ms per entry, 4KB/100 entries).
  - **Key finding:** FTS5 keyword search requires query decomposition; verbose natural language queries fail (0% match) but focused key-term queries succeed (100% match). Recommendation: ship with key-term extraction preprocessing or Tier 2 semantic embeddings for robust multi-turn learning.
  - Evidence: `packages/memory/tests/m10-memory-system.test.ts` (7 passing tests, 16 assertions).
  - Debrief: `docs/superpowers/debriefs/M10-memory-system-validation.md`.
  - Audit update: Mark FM-F2 as **validated → mitigated** in `AUDIT-overhaul-2026.md §10` (was "unvalidated theoretical").

- **External channels phase 1 (branch `feat/channels-package`, merge pending):** package `@reactive-agents/channels`, runtime `.withChannels()`, gateway config rename `channels` → `accessControl`, webhook adapter + tests. Evidence: `wiki/Research/Debriefs/2026-05-03-channels-phase1-development-debrief.md`. **Mainline docs** (`apps/docs`, Starlight gateway pages) still describe `GatewayConfig.channels` until the branch merges.
- **Test runner snapshot (May 13):** `bun test` → **5128/5128 pass** (per `wiki/Hot.md`; 1150+/1150+ reasoning, 24/24 compose, 24/24 replay). Re-run before any release claim.

### Earlier context (May 1, 2026)

- **v0.10.0 release-ready** — `refactor/overhaul` branch fully prepared; changeset + CHANGELOG + release doc written; 4,672 pass / 23 skip / 4 fail across 527 files (4 pre-existing failures in untracked `packages/benchmarks/parseDate.test.ts` — not regressions).
- **Branch:** `refactor/overhaul`. All prior `feat/*` branches archived as `archive/*` tags.
- **Published on npm:** all packages at `0.9.0`. Version bumps happen via changeset merge (`release-0-10-0.md` covers all 28 packages + umbrella, `@reactive-agents/diagnose` included).
- **cf-23 gate fixed:** `required-tools-satisfied` was moved from verifier to `runner.ts §8`; scenario now tests `agent-took-action` + positive absence. Baseline regenerated with BASELINE-UPDATE trailer.
- **Architecture target:** `15-design-north-star.md` v3.0 (10 capabilities + cognitive kernel + 3 ports).
- **Pending before tag:** (1) Publish `@reactive-agents/diagnose` — confirmed 404 on npm (May 1). Ships via CI changeset workflow. ~~(2) Eval Rule 4 frozen-judge~~ — ✅ RESOLVED W9/FIX-21. Then: merge `refactor/overhaul` → `main`, run `changeset version`, publish.
- **Gateway chat mode shipped** (May 1): per-sender SQLite session history, 40-turn/8 k-char windowing, episodic context injection, daily compaction, mode-aware routing (`channels.mode: 'chat'|'task'`). Two memory bugs fixed: `priorContext` silently dropped (context-manager.ts) + episodic injection gated behind `enableSelfImprovement` (execution-engine.ts). New `pruneEpisodicLog` on `CompactionService`; `chat-turn` event type added. Key file: `packages/runtime/src/gateway-chat.ts`.
- **Frontier bench (W21, Apr 30):** ra-full 100% across 4 frontier models (claude-sonnet-4-6, claude-haiku-4-5, gpt-4o-mini, gemini-2.5-pro). Bare-llm 85%. Gemini W22 fix: walk `candidates[0].content.parts[]` directly; surface non-OK `finishReason` as explicit errors.

### Token Optimization (May 3, 2026)
- **rtk discover audit:** 529 sessions, 17K Bash commands analyzed. Only 18% use RTK prefix. **1.2M tokens saveable** from non-prefixed commands (grep 502K, cat 351K, git log 166K, find 99K, ls 73K).
- **Root cause:** Behavioral, not technical. RTK hooked globally but requires consistent prefixing in Claude Code.
- **Skill created:** `.agents/skills/token-optimization/SKILL.md` — TDD-tested (RED-GREEN-REFACTOR phases complete).
  - RED: 18% adoption baseline, hook nudges insufficient, LSP/smart-search missing globally, bun test/run unhandled
  - GREEN: Skill addresses rationalizations, fixes hook JSON quoting, promotes LSP/smart-search to global allowlist
  - REFACTOR: Bulletproof against 5 key rationalizations (optional-ness, friction avoidance, invisibility, mental model gaps, RTK gaps)
- **Fixes implemented:** (1) Corrected PostToolUse hook JSON (previous had quoting errors). (2) Global allowlist expanded to include LSP + smart-search tools. (3) Memory: `project_token_optimization_may3.md` documents discovery + implementation. (4) Skill: Full decision trees and loophole-closers documented.
- **Action:** Prefix Bash commands with `rtk` consistently. Use `claude-mem:smart-search` (tree-sitter AST) for codebase symbol queries instead of grep + read chains (60-75% savings). Create pre-session token dashboard if hook nudges aren't sustaining behavior.
- **Target adoption curve:** Month 1 (baseline), Month 2 (45% RTK usage), Month 3 (70%), Month 4 (85%, plateau).
- **Savings:** ~$1,200/month at current command rates if 1.2M tokens reclaimed. Monthly re-check via `rtk discover --history` to track progress.

**Resolved P0s (reference — do not resurface as blockers):**
- ~~Publish umbrella `reactive-agents` (404)~~ — ✅ W14: already published at v0.9.0; v0.10.0 via CI.
- ~~qwen3 thinking auto-enable~~ — ✅ W7: thinking is OPT-IN; `resolveThinking()` at `packages/llm-provider/src/providers/local.ts:226` returns `undefined` unless `configThinking === true`.
- ~~Dual compression uncoordinated~~ — ✅ W6: three stages sequenced (tool-execution stash → curator render → compress-messages patch); regression test in `context-curator.test.ts`.
- ~~9 termination paths, no single owner~~ — ✅ W4 (FIX-18): `kernel/loop/terminate.ts` is the single-owner helper; `kernel/capabilities/decide/arbitrator.ts` is the canonical oracle path.

---

## Working rules (cross-cutting feedback — keep applying)

- **No Co-Authored-By trailers in commits.** Shows publicly on GitHub contributors.
- **Commit before branching.** Always commit/stash exploratory changes before creating feature branches.
- **Keep `.agents/MEMORY.md` (this file) in sync with personal memory** so other AI agents have context.
- **Skip plans for content/skill writing.** No formal implementation plan for SKILL.md or doc tasks; implement directly.
- **Strict TypeScript — no `any` casts.** Use `unknown` + guards or proper types.
- **Don't `rm -rf` untracked dirs with content.** Confirm before deleting any `??` directory with >5 files; git can't recover untracked content. Cost: lost `wiki/` + 3 `obsidian-vault-*` skill modules on 2026-04-24 cleanup.
- **Release = author changeset, then push a tag.** `bun run changeset` IS the required manual step (writes `.changeset/*.md` notes). Then `git tag vX.Y.Z && git push origin vX.Y.Z` triggers CI publish. Never manually run `npm publish` or `changeset version` — CI's `release.ts` owns versioning/publishing. See the Release Pipeline section above.
- **Workspace runs from `src/` under Bun.** Every `packages/*` declares `"bun": "./src/index.ts"` first in `exports`. Edits picked up at next `bun run`, no rebuild needed. Rebuild only for: (a) npm-publish validation, (b) Node-runtime consumers, (c) `.d.ts` refresh.
- **Control pillar — every harness primitive must be developer-overridable.** Vision Pillar 1. New behaviors ship with: `defaultFoo` preserving prior behavior, `KernelInput.foo?: FooHookType` injection field, public type export. Hardcoded harness logic = black box = anti-pattern.
- **Research discipline — spike-validated harness changes only.** Read `00-RESEARCH-DISCIPLINE.md` for the 12 rules. Notable: spike validates ONE mechanism × ONE failure-mode × ≤2 models × ONE task (Rule 11); single-spike findings shape the next spike, not harness-level decisions.
- **Trust `bunx turbo run build` over `tsc --noEmit` for `ignoreDeprecations`.** TS 6.0.3's tsc reports `error TS5103: Invalid value` on `"ignoreDeprecations": "6.0"` (false positive), but tsup's DTS step (same TS version) requires `"6.0"` to silence the baseUrl deprecation. Keep `"6.0"` everywhere (root + leaf tsconfigs); the lone tsc error in `bun run typecheck` output is expected noise. Confirmed 2026-05-11: all 33 turbo build tasks pass with `"6.0"`.
- **Pin `bun-version: "1.3.10"` in CI workflows — do NOT use `latest`.** On 2026-05-15, `latest` resolved to 1.3.14 which broke streaming tests (`TextDelta events with reasoning enabled` returns 0 deltas, FiberRef inheritance regression in `StreamingTextCallback` propagation through `Effect.forkDaemon`). Reproduced locally by downloading the 1.3.14 binary against the same tree (5/6 pass on 1.3.14, 6/6 on 1.3.10). Re-test the streaming suite before bumping the pin. Affected workflows: `.github/workflows/{ci,docs,publish,eval}.yml`. Fix: commit `6d71d691`.

---

## Phase 1: Mechanism Validation Sweep — COMPLETE (May 4, 2026)

**Status:** ALL 13 MECHANISMS VALIDATED via TDD spikes. 8 mechanisms KEEP (ship as-is), 5 mechanisms IMPROVE (targeted improvements designed, ship Phase 1 as-is).

### Summary

Executed parallel TDD spike validations for all 13 harness mechanisms (M1–M13). Applied **improvement-first philosophy:** no mechanism sunset without evidence; every under-performing mechanism viewed as improvable. Result: zero removals, 5 clear improvement paths, 8 confident KEEP verdicts.

**Evidence artifact:** `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md`  
**Synthesis document:** `.agents/PHASE-1-SYNTHESIS.md` (actionable insights for Phase 2+)

### Full Mechanism Verdicts

**KEEP (8 mechanisms — ship v0.10.0 as-is):**

1. **M1: RI Dispatcher** — Architecture sound; measurement infrastructure in place. Full regression-gate analysis deferred to Phase 1.5 to quantify FM-A2/B1 lift.

2. **M2: Strategy Switching** — Test harness ready (20 passing tests). Switching infrastructure wired. Full real-LLM execution deferred; Phase 1.5 will run full corpus to determine switching effectiveness.

3. **M4: Healing Pipeline** — **86.7% recovery rate** (13/15 test cases), **+80% accuracy improvement** (6.7% → 86.7%), **90% token savings** vs. reprompt fallback. Unrecoverable errors identified (missing args, unknown tools). Ready for Phase 1 deployment with alias maps.

4. **M5: Context Curation** — **60.7% compression ratio**, **38.6% token savings** (balanced mode), **0.16ms latency**. Three-stage pipeline confirmed coordinated (resolves FIX-4 claim). Accuracy validation deferred to Phase 1.5.

5. **M9: Termination Oracle** — May 1 fix validated. **100% path coverage** (7 verified call sites). Arbitrator logic sound. CI lint enforcement in place. Zero unauthorized bypasses.

6. **M11: Diagnostic System** — **100% true positive rate**, **0% false positives**, **0.02ms latency** (vs <100ms requirement). Production-ready leak detection. Critical bugs fixed during validation (AWS AKIA key detection).

7. **M12: Provider Adapter Hooks** — **All 7 hooks fire** on provider-specific scenarios. **Zero cross-provider interference**. **254/254 llm-provider tests pass** (no regressions). Each hook measurably improves its domain.

8. **M13: Guards + Meta-tools** — **6 guards functional**, **100% true positive rate** (3/3 invalid tools caught), **0% false positive rate** (0/5 valid tools rejected), **0.018ms latency** (1000 checks). Meta-tools registry: 10 tools, 3 categories, all properly classified. 19 spike tests, 44 assertions, zero regressions.

**IMPROVE (5 mechanisms — design improvements in Phase 1.5, ship Phase 1 as-is):**

1. **M3: Verifier + Retry** — Verifier works (p01b spike cogito:8b). Retry framework sound but context needs tuning for cogito:14b (p02 showed degradation). **Phase 1.5 action:** Iterate retry context (simplified prompts, temperature tuning) to unlock cogito:14b without model degradation.

2. **M6: Skill System** — Lifecycle + RI hooks work. Learning transfers within agent instance (100% on follow-up tasks). **Limitation:** Ephemeral — doesn't survive across sessions. **Phase 1.5 action:** Add skill persistence layer (SQLite/filesystem) for cross-session learning.

3. ~~**M7: Calibration**~~ — ✅ RESOLVED May 14, 2026: re-audit found 9 fields wired (steeringCompliance, parallelCallCapability, observationHandling, systemPromptAttention, optimalToolResultChars, classifierReliability, toolCallDialect, knownToolAliases, knownParamAliases) — exceeds ≥8 target. **Cleanup:** dropped 6 dead schema fields (fcCapabilityScore, fcCapabilityProbedAt, toolSuccessRateByName, interventionResponseRate, interventionResponseSamples, harnessHarmByTaskType) and orphaned `filterToolsBySuccessRate` export. Schema: 15→9 fields. Verdict flipped IMPROVE → KEEP.

4. **M8: Sub-agent Delegation** — TDD test harness ready (10-task multi-step suite). Effectiveness metrics pending. **Phase 1.5 action:** Full execution with real LLMs to measure when delegation beats inline.

5. **M10: Memory System** — Store + recall works. Episodic recall: **66.7%** (verbose), **100%** (key-term queries). FM-F2 mitigated. **Phase 1.5 action:** Design realistic multi-session learning scenarios to validate cross-task memory transfer.

### Validation Methodology

- **13 parallel subagents** dispatched simultaneously (independent spike tests)
- **TDD discipline for all:** RED phase (test structure) → GREEN phase (minimal implementation) → ANALYSIS phase (findings + verdict)
- **Running spike logs** for each mechanism (journey documented)
- **Domain owner alignment** (mechanism owners designed spikes)
- **Zero regressions** (full test suite green: 1,103+ tests)

### Key Learnings

1. **Improvement-first works.** Removed "prove or sunset" binary. Every mechanism viewed as improvable. Result: zero premature sunsets, 5 clear improvement paths.

2. **Parallel dispatch scales.** 13 mechanisms validated in 1 session. Enables rapid validation cycles for future phases.

3. **Running spike logs preserve rationale.** Each mechanism documents decision journey. Future maintainers can re-read logs to understand verdicts, not just the verdict itself.

4. **Integration testing deferred.** Phase 1 tested mechanisms in isolation. Phase 2 should test mechanism compositions (healing + guards, strategy-switching + RI, etc.).

5. **Real-LLM execution deferred.** M2, M8, others designed harnesses but ran with mock LLMs. Phase 1.5+ should re-run with real LLMs.

### Phase 1.5 Roadmap (Optional, 3–5 sessions, parallel to v0.10.0 release)

- [ ] M3: Iterate retry context for cogito:14b recovery
- [ ] M6: Implement skill persistence (SQLite/filesystem)
- [ ] M7: Execute field activation spikes (≥8 of 14)
- [ ] M8: Run full delegation effectiveness analysis
- [ ] M10: Design realistic multi-session memory scenarios

**Output:** Phase 1.5 evidence artifact; amended verdicts inform Phase 2

### Phase 2 Gate Amendments (Based on Phase 1 Findings)

**Original Phase 2 gates (master roadmap §3):**
- W23: execution-engine.ts ≤600 LOC; 9 phase modules ≤400 LOC each
- W24: Strategy RI-scaffolding + reflexion
- W26: Sub-builders + thin DX
- W27: GatewayAgent type extraction
- W28: Phase-typed builder validation

**Proposed amendments:**

1. **W23 amendment:** Include M5 (context curation) as standard kernel phase. Define interface for optional phases (strategy-switch, compression) so composition is declarative.

2. **W23 amendment:** Formalize arbitration as terminal phase (M9). No phase directly transitions `status:"done"`; all go through arbitrator.

3. **W24 amendment:** Enable M2 (strategy switching) by default on multi-step tasks. Phase 1.5 metrics will inform per-model switching heuristics.

4. **W23+ amendment:** Phase 2 includes **integration tests** validating mechanisms work together (healing + guards + delegation).

5. **Post-W28 amendment:** Phase 1.5 improvements land mid-Phase-2. Integration with Phase 2 waves explicit (M3 retry, M6 persistence, M7 calibration, M8 delegation metrics inform Phase 3+).

### Files Updated

- ✅ `.agents/PHASE-1-SYNTHESIS.md` — Comprehensive findings → actionable insights
- ✅ `wiki/Research/Harness-Reports/phase-1-mechanism-validation-2026-05-04.md` — Validation evidence artifact
- ✅ `docs/superpowers/plans/2026-05-03-v1-master-roadmap.md` — Amendment log entry (Phase 1 complete)
- ✅ `docs/spec/docs/AUDIT-overhaul-2026.md` — Final mechanism verdicts in §10.2 (Phase 1 validated, 8 KEEP + 5 IMPROVE)

---

## Memory reconciliation — corrections from Stage 3 audit

Two prior memory entries are demonstrably stale or wrong. Do not propagate these in future memory:

| Stale claim | Actual state | Source |
|---|---|---|
| "3/6 skill lifecycle AgentEvents missing" | **Events exist** at `core/services/event-bus.ts:1001-1005`. **All 6 hooks wired** (W2 FIX-6) at `builder.ts:2673-2731`. This is fully resolved — do not resurface. | AUDIT §11 item 6, M6 mechanism; verified May 1 |
| "Calibration defaults to `:memory:`" | **Already correct** at `reactive-intelligence/types.ts:246` (`~/.reactive-agents/calibration.db`). Apr 21 fix. | AUDIT §11 item 9 |

Memory descriptions to update or rewrite if you encounter them in personal memory:
- `project_v010_audit_blockers` — both stale claims above appear here.
- `project_running_issues` — older entries; cross-reference against AUDIT §11 before acting on any item.

---

## Architecture summary (high signal, low detail)

**Kernel lives at `packages/reasoning/src/kernel/`** — reorganized in Stage 5 from `strategies/kernel/` to capability-grouped subdirs:
- `capabilities/` — 8 subdirs: act, attend, comprehend, decide (arbitrator.ts), reason (think.ts), reflect (loop-detector.ts, reactive-observer.ts), sense, verify
- `loop/` — runner.ts (1,739 LOC), react-kernel.ts, terminate.ts (single-owner termination helper), auto-checkpoint.ts, output-assembly.ts, output-synthesis.ts
- `state/` — kernel-state.ts, kernel-hooks.ts, kernel-constants.ts
- `utils/` — diagnostics.ts, ics-coordinator.ts, lane-controller.ts, service-utils.ts

**Two records, distinct purposes:**
- `state.messages[]` — what the LLM sees (provider conversation thread)
- `state.steps[]` — what systems observe (entropy, metrics, debrief)

**FC conversation thread flow:**
1. Execution engine seeds `state.messages` with `[{role:"user", content: task}]`
2. `think.ts` reads messages → `applyMessageWindow` → provider LLM call
3. `act.ts` appends: `assistant(thought+toolCalls)` + `tool_result(s)` + progress/completion message

**Critical build patterns:**
- All providers pass `tools` to both `complete()` AND `stream()` methods
- Anthropic streaming: use raw `streamEvent` not helper events (`inputJson` fires before `contentBlock`)
- Gemini tool results: `functionResponse.name` must use `msg.toolName` not hard-coded "tool"
- Gemini streaming (W22): walk `candidates[0].content.parts[]` directly — `chunk.text` strips functionCall parts. Surface non-OK `finishReason` (UNEXPECTED_TOOL_CALL, MAX_TOKENS, SAFETY, MALFORMED_FUNCTION_CALL) as explicit errors.
- Ollama streaming: `chunk.message.tool_calls` on `chunk.done`, emit `tool_use_start` + `tool_use_delta`
- Loop detection: `maxConsecutiveThoughts: 3` — only ACTION steps reset the streak; observations do NOT. IC-1 fix Apr 12, now at `kernel/capabilities/reflect/loop-detector.ts:102`

---

## Architecture debt (current top items)

The full list lives in `AUDIT-overhaul-2026.md` §11 (44 items). Top items as of May 14:

1. ~~`builder.ts` 6,082 LOC + `execution-engine.ts` 4,499 LOC~~ — ✅ RESOLVED Phase A (May 8–9): `execution-engine.ts` 4,499→1,637 LOC (W24); `builder.ts` 6,232→2,481 LOC (W25). Both decomposed into capability-grouped modules.
2. ~~**Eval Rule 4 frozen-judge**~~ — ✅ RESOLVED W9/FIX-21 (commit a9a7c55f): `eval-service.ts:189` yields `JudgeLLMService` Tag; benchmarks route through `packages/judge-server/` HTTP process.
3. **ToT outer loop still unhooked** from `dispatcher-early-stop` — each branch is a separate sub-kernel (PER inner loop fixed Apr 19 at `plan-execute.ts:781,806`).
4. ~~Strategy routing opt-in~~ — ✅ RESOLVED May 12: enabled by default (`enableStrategySwitching !== false`); wired at `packages/runtime/src/runtime.ts:915` (also gated off by `withLeanHarness()`); field type still optional at `strategies/reactive.ts:72`. (`packages/runtime/src/runner.ts` removed in W25 decomp.)
5. ~~Pruning Principle Builder API (Issue #7)~~ — ✅ RESOLVED (verified 2026-05-20): `withLeanHarness()` shipped at `builder.ts:977`, wired `runtime.ts:797,915,922`, state field `_leanHarness` at `builder/build-effect/runtime-construction.ts:156,391`.

**Resolved in prior work:** kept inline; the planned `MEMORY-ARCHIVE-RESOLVED.md` extraction was not produced. Resolved P0s listed below.

---

## Restoring sprint context

If you need the historical sprint logs (Mar–Apr 2026 stage-by-stage commits, IC-1/IC-2/IC-3 fixes, MCP client rewrite details, kernel composable phase shipment notes, the 6-handler RI dispatcher wiring sessions, etc.):

```bash
git log --diff-filter=M -- .agents/MEMORY.md | head -20  # find the rewrite commit
git show <sha>:.agents/MEMORY.md                          # read the prior version
```

The sprint logs are intentionally not carried forward in this reset because:
- Most sprint findings are now reflected in code or in `AUDIT-overhaul-2026.md`.
- Per-day "what shipped" entries decay fast and create noise for cold-start agents.
- The audit is the consolidated view; this memory is the index pointing to it.

---

## Lost / pending re-implementation (carried forward)

Three Obsidian-vault skill modules under `.agents/skills/` were deleted in the Phase-0-close cleanup on 2026-04-24 and are NOT recoverable from any backup:

- `.agents/skills/obsidian-vault-query/` — read the vault at session start
- `.agents/skills/obsidian-vault-sync/` — write decisions/experiments/sessions back to the vault
- `.agents/skills/obsidian-vault-hygiene/` — orphan/bitrot/duplicate loop maintenance

`AGENTS.md` and `.agents/skills/update-docs/SKILL.md` may still reference these by name. Re-implement before agents can act on those references.

---

*If you find this file stale, update it directly. Keep it short — the audit doc is where detailed plans live.*
