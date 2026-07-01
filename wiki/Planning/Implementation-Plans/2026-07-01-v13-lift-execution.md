---
type: implementation-plan
status: active
created: 2026-07-01
tags: [v0.13, dx, launch, subagents, parallel-execution, north-star]
source-audit: wiki/Research/Audit-Reports-2026-07-01/comprehensive-framework-review-and-v13-north-star.md
---

# v0.13 Lift — Systematic Execution Plan (subagent-parallel)

**Goal:** turn the 2026-07-01 comprehensive audit into shipped code, ordered so the framework is launch-ready. North star holds: **harness = product, receipts = proof, first-touch DX = funnel.** DX wave ships *before* Show-HN.

**Execution model:** work is grouped into **package-isolated bundles** that run as parallel subagents (no file collision across packages), plus **shared-file bundles** that run as a single sequential agent (builder.ts / reactive-agent.ts are hotspots — never two agents editing them at once). Each task carries an acceptance gate. A wave does not advance until its gate passes.

**Standing rules (non-negotiable, from project memory):**
- Clean types, no `any` / `as never` (the fixes must *remove* the `as never`, not add more).
- No metric-gaming: consolidation is additive facades + soft-deprecation of true aliases only — never `@deprecated` on working documented methods to hit a count.
- Verify from **inside** the repo (a `/tmp` probe tests the stale published tarball).
- `bunx turbo run build` is the authoritative type gate (tsup masks tsc errors — run `tsc --noEmit` separately too).
- Independently re-verify every subagent "all green" claim — green parts ≠ verified headline. Run the real probe.
- Pin bun 1.3.10. Scoped tests only, `--timeout 15000`, kill dangling servers.

**Warden routing (CANONICALIZED — pilot proved useful, 2026-06-15 verdict = keep, not revert):**
- Domain-scoped edits route through their warden via `Agent` dispatch. Each bundle below names its warden.
- **MissionBrief in / UpwardReport out** are retained — they were the proven-useful part (bounded authority + structured handoff caught scope creep). Load `.agents/skills/mission-brief` + `upward-report`.
- Dispatcher FSM still governs consumption: confidence ≥0.7 → verifier (typecheck + targeted tests) → accept; <0.7 → verifier + `ablation-warden` if new default-on mechanism; **never re-prompt a warden to review its own work** (M3 REWORK precedent). `denied-by-authority` / cross-package need → escalate, dispatch the correct warden.
- Cross-cutting / default-on toggles → `ablation-warden` (≥2 tiers, ≥3pp lift, ≤15% token overhead). Pre-tag → `release-warden`. Post-merge AAR → `debrief-scribe`.
- Follow-up: drop `PILOT`/expiry markers in AGENTS.md §Team-Ownership Dev Contract and log the canonicalize verdict (Wave 0 task 0.4).

---

## Wave 0 — Truth sync (no code; unblocks everything, ~1 agent, fast)

Cheap, high-value, zero-risk. Do first so downstream agents read accurate docs.

| Task | Files | Acceptance |
|---|---|---|
| 0.1 Refresh `wiki/Hot.md` | wiki/Hot.md | Reflects v0.12.0 released, durable Phase E shipped, 98-commit unpushed-main flag, this plan linked |
| 0.2 Fix channels wording | AGENTS.md | "In flight / not on main yet" removed — channels is merged |
| 0.3 Doc the shipped-but-hidden methods | apps/docs/reference/builder-api.md, README.md | `.withFabricationGuard`, `.withStallPolicy`, `.withThinking` (as method entry), `.withModelRouting` all have entries + README feature bullets |
| 0.4 Canonicalize warden contract | AGENTS.md §Team-Ownership Dev Contract | Drop `PILOT`/expiry markers; record 2026-06-15 verdict = canonicalize (proven useful); MissionBrief/UpwardReport now standing convention for domain-scoped edits |

**Agent:** 1× `general-purpose` (docs-only, no collision). **Gate:** `bun run docs:build` green; grep confirms all four methods documented + no `PILOT` expiry markers remain.

---

## Wave 1 — P0 First-Touch DX Wave (the funnel; ~1 week; BEFORE launch)

Every item was hit organically in live probing. This wave decides whether a launch-day visitor survives the first 10 minutes. Runs as **4 parallel bundles** (package-isolated) + Bundle D internally sequential.

### Bundle A — Tool authoring v2  (package: `packages/tools`)  → `tools-warden`
Highest-impact DX fix. A launch visitor's first real action is defining a tool.

| Task | Detail | Acceptance gate |
|---|---|---|
| A.1 Validate `defineTool` options | `define-tool.ts` — guard for missing/mistyped `input`/`handler`; reject `parameters`/`execute` with a message naming the correct field. No more `TypeError: schema.ast`. | RED test: `defineTool({parameters,execute})` → typed error w/ fix hint, not a crash |
| A.2 Canonical tool shape | Add schema + **plain async handler** + **inferred arg types** (Standard Schema: Effect/Zod/Valibot). Keep Effect-handler form as advanced. Arg types inferred from schema, not `Record<string,unknown>`. | `tool({ name, input: zod/effect schema, handler: async (typedArgs)=>... })` compiles with typed args; live probe: agent calls it on haiku |
| A.3 Kill the `as never` | `apps/examples/src/tools/healing-malformed-tool-call.ts:171` uses the new shape, cast removed | grep `as never` in examples = 0; example runs green |

**Gate:** `bun test packages/tools --timeout 15000` green + live probe (new tool shape, real haiku run) returns correct output from inside repo.

### Bundle B — Local provider resilience  (package: `packages/llm-provider`)  → `provider-warden`
| Task | Detail | Acceptance gate |
|---|---|---|
| B.1 Thread timeout | `providers/local.ts` — replace hardcoded `Effect.timeout('120 seconds')` (complete + stream) with a value from `.withTimeout()` / provider config; default scales for cold-load | `.withTimeout(300000)` reaches local.ts; unit test asserts wired value |
| B.2 Actionable timeout error | Timeout error carries model name + elapsed ms + "model may be cold-loading or GPU contended" hint | error message contains all three fields |
| B.3 Abort server-side on client timeout | On timeout, abort the in-flight ollama request (AbortController) so the server stops burning GPU after the client gives up | manual: client timeout → `ollama ps`/logs show request cancelled, not completing post-abandon |
| B.4 (adjacent) Provider error mapping | `providers/*.ts` — de-duplicate raw provider error JSON (the double-printed 404); map to a plain Error w/ one-line cause + suggestion | model-typo probe → single clean line, no internal stack in default console |

**Gate:** `bun test packages/llm-provider --timeout 15000` green + live: probe under GPU contention no longer dies bare; model-typo probe shows clean error.

### Bundle C — Fail-fast build() + minimal entry  (package: `packages/runtime` + `create-reactive-agent`)  → `runtime-warden`, single SEQUENTIAL agent (builder.ts hotspot)
All touch `builder.ts` / `reactive-agent.ts` — ONE agent, sequential, no parallel edits.

| Task | Detail | Acceptance gate |
|---|---|---|
| C.1 Unify key capture | Env read at one point; kill the module-import-vs-build-time split-brain (warning + successful paid call was inconsistent) | single read path; test: deleted key is seen consistently |
| C.2 Fail-fast `build()` | Missing key / unknown-model-for-provider = typed build error w/ fix instructions; `.withLazyValidation()` (or similar) opt-out for lazy envs | `build()` with no key → typed error before any run; opt-out flag restores old behavior |
| C.3 `.quick()` env-default entry | `ReactiveAgents.quick()` resolves provider+model+maxIterations from env/sensible defaults → 2-line hello agent | `const a = await ReactiveAgents.quick(); await a.run(...)` works live |
| C.4 Scaffold templates | `create-reactive-agent` — add `with-structured-output`, `with-approval-gates`, `with-memory` templates on current v0.12 API | each template scaffolds + `bun run build` green |

**Gate:** `bun test packages/runtime --timeout 15000` + `tsc --noEmit` + `bunx turbo run build` all green; live 2-line `.quick()` probe from inside repo.

### Bundle D — Error surface polish  (package: `packages/runtime`)  → FOLD INTO Bundle C agent
B.4 handles provider-side; the run()-boundary duplication + internal-stack leak lives in `reactive-agent.ts:776` (`unwrapError`). Same file family as Bundle C → same agent, after C.2.

| Task | Detail | Acceptance |
|---|---|---|
| D.1 Clean run() error boundary | Map to plain Error w/ cause; suppress internal stack from default console (keep behind a debug flag) | typo/tool-throw probes → one clean line |

**Wave-1 exit gate (run ALL, from inside repo):**
1. Full `bun test` green (authoritative count).
2. `tsc --noEmit` + `bunx turbo run build` green.
3. Re-run the 6 original audit probes (hello, tool+schema cloud, same-code local, missing-key, model-typo, local-timeout-under-contention) — every papercut resolved.
4. `/review-patterns` on all changed files.

---

## Wave 2 — P1 Launch Train (v0.13 core; after Wave 1 gate)

### 2.1 Merge abstention  (branch `feat/o3-abstention-trust-loop`)  → sequential, careful
Branch green, unmerged (HEAD `b968080a`; forced-path shipped + verified, model-initiated cut). **Green parts ≠ verified headline** — run the trap-task E2E on ≥2 tiers before merge. Rebase on current main first (main moved). Merge only after E2E + full `bun test`.

**Gate:** trap-task E2E shows harness-forced abstention fires; `terminatedBy:"abstained"` present; full suite green post-merge.

### 2.2 Public local-model bench  (the actual Receipts deliverable)  → `harness-warden` + general
Same task suite, qwen/llama 7–14B via Ollama, RA vs Mastra vs LangGraph.js vs raw AI SDK. First-attempt success + token cost. Model+provider+date pinned, ≥3 seed variance, raw traces published. **Self-publish the harness token-multiplier** as its own receipt (session baseline: hello=60 tok, tool-task ≈7k cloud / ≈11k local). Stop-the-line: external delta >15% from internal → fix harness, not result. **Warm each model before timing** (this session's timeouts were GPU-contention/cold-load artifacts — bench must preload + serialize, one model resident at a time).

**Gate:** bench reproduces with pinned seeds; traces + numbers in `wiki/Research/Harness-Reports/`.

### 2.3 Cost-governance demo
Budget + watchdog + approval killswitches composing on one agent, own measured overhead published. Mostly wiring existing pieces + a demo script in `apps/examples`.

### 2.4 Publish infra
- Push `main` to origin (98 commits ahead, never pushed) — launch prerequisite, syncs a month of work + auto-confirms #194 closure.
- OIDC trusted publishing (drop npm-token rotation).

**Wave-2 exit = launch-ready:** bench published, abstention merged, main pushed, docs accurate.

---

## Wave 3 — P2 Post-Launch (v0.13.x / v0.14; parallel, low-risk)

Package-isolated → all parallel. None block launch.

| Bundle | Package | Warden | Work |
|---|---|---|---|
| Builder consolidation | runtime | `runtime-warden` | Remove `compose()` public alias (=`withHarness`); ONE canonical memory/learning route; observability single-route. **Additive facades + soft-deprecation of true aliases ONLY.** |
| Provider base | llm-provider | `provider-warden` | Extract `BaseProviderAdapter` — ~200 LOC dedup across 5 adapters, centralize streaming quirks. Careful: per-provider streaming differs. |
| Strategy/kernel cleanup | reasoning | `kernel-warden` | `direct`+`reactive` → `coreReactive(maxIterations?)` w/ aliases; sub-agent path unification (`local-agent-tools` vs `spawn-handlers`, ~60 LOC); delete dead `patchStrategy`; loop-detector precedence comment/reorder. |
| Decomposition | reasoning | `kernel-warden` | `arbitrator.ts` (1,343) + `iterate-pass.ts` (1,028) submodule extraction. |
| Cortex timeline UI | apps/cortex | general | Land worktree `so-audit-fixes` timeline store/rows IF clean; else defer v0.14. |
| Canonical tool-exec Phase E | reasoning | `kernel-warden` + `ablation-warden` | Batch tool-results `.on()` symmetry (behind `RA_TOOL_OBSERVE_SYMMETRY`). |

> Two `kernel-warden` bundles both touch `packages/reasoning` — serialize them, or worktree-isolate (`isolation: worktree`), never concurrent on shared files.

---

## Do-NOT-build (hold the line; from audit §5/§7)

- **Agentic orchestration substrate** (2026-06-17 spec) — research-grade scope doubling. Defer to v0.14+ and only with post-launch adoption data on which patterns users need.
- **Memory v2 CAS/versioning** — superseded by memory-default-OFF (core risk already solved). Revisit only if multi-session becomes a real ask.
- **LATS / GoT heavy strategies** — empirical parity at 3–15× cost.
- Archive 2026-03 adoption-strategy + framework-gap-assessment (stale; revisit post-launch with real users).

---

## Dispatch summary (parallelism map)

```
Wave 0:  [docs: general]                                              ── serial, fast, first
Wave 1:  [A: tools-warden] ∥ [B: provider-warden] ∥ [C+D: runtime-warden seq]   ── 3 parallel wardens
         gate: full suite + tsc + build + re-run 6 probes
Wave 2:  [2.1 abstention seq] → [2.2 bench: harness-warden ∥ 2.3 demo] → [2.4 push: release-warden + OIDC]
Wave 3:  [consolidation: runtime-warden] ∥ [provider-base: provider-warden] ∥
         [strategy+decomp: kernel-warden serialized] ∥ [cortex: general] ∥ [phase-E: kernel+ablation]
```

Each domain warden gets a MissionBrief (end-state, why, authority-bounds, success-criteria) and returns an UpwardReport; the dispatching thread runs the verifier + its own inside-repo probe before accepting. Cross-cutting default-on changes additionally clear `ablation-warden`; the pre-tag release run goes through `release-warden`; post-merge debriefs to `debrief-scribe` → `wiki/Research/Debriefs/`.

**Collision rule:** never two agents in `packages/runtime/src/builder.ts` or `reactive-agent.ts` at once. Wave-1 Bundle C owns them alone. If two Wave-3 bundles need the same file, worktree-isolate (`isolation: worktree`) or serialize.

**Verification cadence:** after each bundle, the dispatching thread independently re-runs the bundle's live probe from inside the repo — does not trust the subagent's green claim. Wave gates are hard stops.
