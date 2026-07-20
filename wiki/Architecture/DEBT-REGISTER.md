---
tags: [debt, canonical, register, release-gate]
date: 2026-07-13
status: CANONICAL — single source of truth for technical debt
supersedes: scattered findings in Audit-Reports-2026-07-{07,08,09,10,11,12}; open lists of 2026-07-10-harness-root-cause-closure-program (SUPERSEDED) and 2026-07-10-goal-reliability-and-feedback-loop-program (SUPERSEDED) — absorbed in §3b below (2026-07-19 absorb-or-defer pass)
---

# Debt Register — CANONICAL

**This is the only debt list.** Audit reports are evidence; this is the ledger. Nothing is "known debt"
unless it has a row here. Every row: verdict, evidence (file:line), and the gate that will keep it fixed.

**Ratchet law:** the counts in §1 may only go DOWN. A PR that increases any count fails review.
Adding a new declaration without a writer, a reader, and a red-on-cut test increases a count.

**Verdict taxonomy** (exactly one per item):

| Verdict | Meaning |
|---|---|
| PROVEN | Consumer reads it AND a test goes red if the consumer is cut |
| SILENT | Consumer exists; no test asserts the behavior. Works by luck; a refactor kills it invisibly |
| ORPHAN | Declared; zero non-test writers OR zero non-test readers |
| INERT | Written, but structurally cannot fire |
| FALSE | Docs/JSDoc promise behavior the code does not implement |

Only **PROVEN** counts as shipped.

---

## 1. The ratchet (2026-07-13 baseline)

| Surface | Total | PROVEN | SILENT | FALSE | ORPHAN/INERT |
|---|---|---|---|---|---|
| Builder withers (public API) | 86 | 44 | 30 | 9 | 3 |
| Declaration members (ledger/receipt/envelope/stream/hooks/meta/env/config) | — | — | — | — | **50** |
| Strategy × mechanism cells | 90 | 41 | 12 | — | **31 MISSING** |
| Packages | 36 | 31 | — | — | 5 (1 dead, 2 unintegrated, 1 stub, 1 merge) |
| Published claims (README/docs/errors/CHANGELOG) | 38 | 9 | — | **23** | 6 UNVALIDATED |
| **Failing tests on main** | — | — | — | **0 env-independent** (was 3 — fixed Wave 0, 2026-07-19) + Docker-daemon flakes (env-dependent) | — |

**Headline (2026-07-13 baseline): half the public API surface (42/86) is unproven. 9 withers actively lie. 23 published claims are false.
Main is red. Every published benchmark number came from an instrument that scored "did not crash" as a pass.**

**Wave 0 (2026-07-19): main GREEN, both anti-rot gates wired to CI.**
**Wave 1 (2026-07-19): the lies are gone.** All 9 lying withers RESOLVED (P0-1,2,3,6,7,8,9,10,11 —
removed, wired, or fixed; wither count 89→85) and every published benchmark number taken down
(P0-13,14,17,18,19; CHANGELOG `[Unreleased]` rewritten covering ~23 landed changes + meta-tools
opt-in). Still open: P0-4/P0-5 (forbidden-tool enforcement + abstention — Wave 2 spine, boundaries
B1/B2), P0-12 (noise benches — Wave 3), P0-16 (README quickstart ships only when v0.14 cuts from
main — Wave 6).

---

## 2. P0 — PUBLIC API LIES (block the release; a user is misled today)

| # | Item | Reality | Evidence | Verdict |
|---|---|---|---|---|
| **P0-1** | **`.withReactiveIntelligence({autonomy, constraints})`** | **SAFETY.** `autonomy:'observe'`, `neverEarlyStop`, `neverHumanEscalate`, `lockedSkills`, `protectedSkills` are ALL no-ops. A user who asks for observe-only gets a fully autonomous controller. | `_riConstraints`/`_riAutonomy` written `wither-applies.ts:75-76`; **zero readers repo-wide** | ✅ RESOLVED Wave 1 — options REMOVED (compile-error + runtime-throw); no-op safety switch gone |
| **P0-2** | **Calibration is a net REGRESSION** | A model with a calibration file **loses** its 4 live adapter hooks (`continuationHint`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`) and gains 2 dead ones. Calibrating a model strictly weakens the harness. | `adapter.ts:322` early-returns `buildCalibratedAdapter(cal)`, discarding the tier adapter; that adapter sets only `systemPromptPatch`+`toolGuidance`, both zero-call-site | ✅ RESOLVED Wave 1 — B6 fixed: `selectAdapter` now COMPOSES tier+calibration (additive, never removes capability); mutation test pins it |
| **P0-3** | **`.withFallbacks()`** | Docs promise "switches after 3 consecutive errors" + cheaper-model fallback on 429. Switches on the **first** error; `errorThreshold` only decorates an event (`runtime.ts:447`); `models[]` has zero readers. All 11 tests are setter asserts. | `runtime.ts:411-470` | ✅ RESOLVED Wave 1 — lying `models`/`errorThreshold` REMOVED; honest provider cascade kept (extracted `llm-fallback-cascade.ts`, behavioral+mutation tests replace 6 setter tests) |
| **P0-4** | **Tool policy is suppression, not enforcement** | `forbiddenTools`/`allowedTools` gate exists ONLY in `act.ts:367`. The shared `executeToolAndObserve` choke point has **zero** policy checks ⇒ plan-execute, blueprint, code-action, inline can execute a forbidden tool that arrives via a planned step or hallucinated name. | `tool-observe.ts` — 0 matches for allowedTools/forbidden | ✅ RESOLVED Wave 2 B1 — `evaluateToolPolicy` (allowed+forbidden, deny>allow) enforced INSIDE `executeToolAndObserve`; act.ts delegates + now enforces the contract deny-list on the kernel path too; plan-execute/blueprint inherit; mutation test red-on-cut. **code-action still bypasses the primitive (`toolSvc.execute()` direct) — residual, tracked for a follow-up.** |
| **P0-5** | **Abstention dead on 8 of 9 paths** | Only `reactive` forwards `terminatedBy`+`abstention`. An honest decline on any other strategy ships as an ordinary answer; `receipt.abstained` is permanently false. | `projectAbstention` needs both (`abstention-projection.ts:38`); `execution-engine.ts:1096` defaults `terminatedBy ?? "end_turn"` | ✅ RESOLVED Wave 2 B2 — all 7 non-reactive strategies forward `terminatedBy`+`abstention` via the shared `deriveTerminatedBy` (honest mapping, no DEFECT-3 fabrication); abstention descriptor crosses on plan-execute/ToT/reflexion/direct/adaptive; mutation test red-on-cut |
| **P0-6** | Provide-and-forget layers | `.withIdentity()`, `.withInteraction()`, `.withOrchestration()` each merge a service layer **nothing resolves**. JSDoc promises agent behavior ("sign messages", "pause for human approval"). `.withOrchestration()` is a literal no-op. | `runtime.ts:823/982/990`; zero consumers | ✅ RESOLVED Wave 1 — all 3 withers REMOVED (packages kept for direct use); dead workspace deps dropped; wither count 89→85 |
| **P0-7** | `.withMemoryConsolidation()` | Service built; `consolidate()`/`notifyEntry()` **never invoked** — no scheduler, no fiber. | `runtime.ts:736` | ✅ RESOLVED Wave 1 — WIRED: entry-count trigger in MEMORY_FLUSH phase invokes consolidate(); red-on-cut wiring test |
| **P0-8** | `.withVerificationStep()` | Burns a real LLM call per run, writes verdict to `ctx.metadata.verificationFeedback` — **zero readers** (`engine/util.ts:221` allowlist omits it). User pays tokens for nothing. | `reasoning-harness-hooks.ts:191` | ✅ RESOLVED Wave 1 — WIRED: a REVISE verdict re-runs once with feedback, changing the output; mutation test proves it |
| **P0-9** | `.withCalibration("skip")` | Structurally un-passable: rewritten to `"auto"` whenever reasoning is on. The opt-out does not exist. | `runtime-construction.ts:525-530` | ✅ RESOLVED Wave 1 — `unset` sentinel added; explicit `"skip"` now HONORED even with reasoning on; behavioral test |
| **P0-10** | `.withSkills()` bare / `.withProgressCheckpoint()` | Bare `.withSkills()` = no-op (gates on `paths?.length`; `packages`/`overrides` dropped). `.withProgressCheckpoint()` dead-ends in a config struct; `autoResume` unimplemented. | `runtime-construction.ts:495/502` | ✅ RESOLVED Wave 1 — `withSkills` THROWS on no-op/removed keys; `withProgressCheckpoint` REMOVED (→ `withDurableRuns`) |
| **P0-11** | Docs claim "7-hook adapter system **fully wired**" | 3 of 7 hooks have zero call sites (`taskFraming`, `toolGuidance`, `systemPromptPatch`). Docs even document their call-site timings. | `whats-new.mdx:446`, `llm-providers.md:214-216`, `llm-provider/index.ts:227` | ✅ RESOLVED Wave 1 — 3 orphan hooks DELETED from the contract + all writers; 4 live hooks + `parseToolCalls` remain; docs restated |
| **P0-12** | Two benches measure PURE NOISE | `RA_RECITE` (dead since `034d28de`) and `RA_ASSEMBLY` (dead since Sprint-1 A2) still gate ablation arms ⇒ both arms byte-identical. Any finding read off them is fabricated. | `benchmarks/src/sessions/recitation-ablation.ts:39`, `sessions/context-stress.ts` | ✅ RESOLVED Wave 3 (2026-07-20) — `recitation-ablation.ts` **DELETED** (byte-identical arms) + registry entry. **`context-stress.ts` was NOT noise — register was stale:** its dead `RA_ASSEMBLY` arm was already excised Sprint-1 A2; it is a valid single-arm cross-tier pin (kept, misleading comments fixed). The real additional noise was **4 probe scripts** (`scripts/probes/{assembly-ab-grid.sh,diag-context-stress.ts,diag-summarize-arms.ts,postconditions-ablation.sh}`) that actively wrote dead flags — **DELETED** (zero invokers). |

---

## 2b. P0 — PUBLISHED CLAIMS (the docs lie to visitors today)

**Main is GREEN as of Wave 0 (2026-07-19).** Verified `bun test` twice: **8,224 pass / 0 fail / 8,253 tests / 1,045 files**.
Fixed: `.withBudget()` ×2 (assertions now pin the real broadened message), **WS-5 ceiling** (new
`reactive-agent.ts` killSwitchAction site TYPED to `Effect<void>` — count back to 21, ceiling not raised),
plus 3 order-dependent full-suite failures root-caused to **leaked `mock.module` registrations**
(`@anthropic-ai/sdk` mock without `stream`; `ollama` mock leaking into runtime's live timeout test) —
every mock site of those two modules now captures the real module and restores it in `afterAll`.
Live-Anthropic tests now probe-gate (skip on missing key / drained credits / network down).
Residual leak exposure: `openai` / `@google/genai` / litellm-fetch mocks (no observed victims; needs
the same all-sites treatment if one appears). Docker-daemon tests remain env-dependent flakes.

| # | Claim | Reality | Verdict |
|---|---|---|---|
| **P0-13** | **Every published benchmark number.** "86.7% recovery · +80pp accuracy · 10× cheaper" (**13 sites incl. the docs homepage hero**), "bare ReAct 85% → harness 100%", "local 91–94%", "35-task suite", "38.6% tokens saved" | The instrument that produced them scored **"did not crash"** as a pass (found `1daa3910`, 2026-07-09). Provenance of 86.7%/+80pp is a **15-case hand-authored unit fixture** (`m4-healing-measurement.test.ts`) — **not a live-model benchmark**, and "+80pp accuracy" is not measured by it at all. The committed `real-world-full.json` is 3 tasks × 1 model and shows **`passRate: 1` while `accuracy: 0`** in 5 of 6 cells. | ✅ RESOLVED Wave 1 — 17 sites taken down (grep-zero across README + apps/docs), replaced with qualitative capability statements; no numbers re-published |
| **P0-14** | `apps/docs/src/data/benchmark-report.json` feeds the docs benchmark component | **`"runs": []`** — a 626 KB file whose runs array is empty. The site renders benchmarks off nothing. | ✅ RESOLVED Wave 1 — json file + `BenchmarkResults.astro` consumer DELETED; benchmarks page reframed as internal harness (run-it-yourself) |
| **P0-15** | README test/package counts | **FIXED Wave 0 (2026-07-19):** synced to measured **8,253 / 1,045** via `metrics:sync-readme` (script-written, all 4 sites); `metrics-cache.json` refreshed; `metrics:check` now **wired into CI** (`docs-gates` job) so drift fails the build. | PROVEN |
| **P0-16** | README headline quickstart: `import { createAgent }`, `.withLongHorizon()`, `.withAdaptiveHarness()`, `.withReceiptSigning()` | **Absent from published `0.13.6`** (tarballs unpacked). Exists only on main. If v0.14 doesn't ship from main, README's **first code block is broken for every visitor**. | FALSE (today) |
| **P0-17** | "**27-signal** complexity router" (5 sites) | `complexity-router.ts` has **4 named factors** + length thresholds. No registry, no weights. | ✅ RESOLVED Wave 1 — 3 docs sites rewritten to "multi-factor" (named factors); remaining 2 sites (wiki/CHANGELOG) out of docs scope |
| **P0-18** | README lists **6** providers in its Multi-Provider + Architecture tables | The same README claims **8**. Code has 8. Internal contradiction. | ✅ RESOLVED Wave 1 — both tables + package description set to 8 (Groq/xAI added) |
| **P0-19** | `errors.ts` suggestions | `:247` renders **syntactically invalid TS** (`violation` is a joined summary, not a key). `:256` says "call `agent.resume()`" — but `resume()` only completes a pause deferred and KillSwitch fires on stop/terminate (unresumable); its `reason === "manual"` branch is **dead** (no writer emits it). `:134,147` JSDoc names `agent.resume(runId)` — the real method is `resumeRun(runId)`. The ee9a1471 "honesty pin" is green against **fixture values production never emits**. | ✅ RESOLVED Wave 1 — invalid snippet fixed; dead `"manual"` branch removed; resume→resumeRun JSDoc; honesty-pin test rebuilt on real emitted values |
| **P0-20** | CHANGELOG `[Unreleased]` | Contains **only** the 3-wither removal, while **~40 user-facing feat/fix commits** landed since v0.13.6 — including the **meta-tools going opt-in** (a behavior change users must know about). | ✅ RESOLVED Wave 1 — `[Unreleased]` rewritten: Wave 1b removals/fixes, meta-tools opt-in, receipt-truthfulness sweep, Groq/xAI, CompletionEnvelope |
| **P0-21** | The docs example gate | **INSTRUMENT FIXED Wave 0 (2026-07-19):** wired into CI (`docs-gates` job); `--fix-fragments` **deleted**; parse-error suppression fixed (in-process compiler API, per-file syntactic+semantic diagnostics — proven with a deliberately broken pair); skip-count **ratchet added** (`SKIP_CEILING = 283`, only falls). **REMAINING (Wave 1):** the 283 skips themselves, incl. **6 that hide real drift**: `.withContextProfile({budgetTokens})` (keys don't exist), `SessionOptions {persist,id}` (both fabricated), the documented **ToolBuilder→withTools flow does not compile**, and `withTelemetry`/`withTerminalTools`/`withoutTracing` (**removed in v0.14**, still documented). | PARTIAL — gate PROVEN, skips remain |

> **Structural note:** every stale number traces to a **sync gate that exists but isn't wired to CI**, and every hidden API
> drift traces to a **doc gate that isn't wired to CI and ships a command to silence itself**. The claims did not rot
> randomly — the two mechanisms built to prevent rot were never connected to anything that could fail. Same disease,
> one level up.

---

## 3. The spine — 7 boundaries that produce ~all of the above

The ~200 findings are not 200 bugs. They are **7 boundaries where a value fails to cross**.
Fix the boundary, not the site. (This is the boundary-first rule; every per-site fix in July was
later obsoleted by the boundary fix that eventually arrived.)

| # | Boundary | What dies there | Closes |
|---|---|---|---|
| **B1** ✅ | **`executeToolAndObserve`** (`tool-observe.ts`) — hand-rolled strategies route tools here and inherit NOTHING; kernel strategies get everything free from `act.ts` | RunLedger minting + tool-policy gate | **RESOLVED Wave 2 (2026-07-19):** policy gate (`evaluateToolPolicy`) + ledger mint (`recordToolDispatch`, single-writer-safe) now IN the primitive; plan-execute/blueprint pass config + inherit; act.ts delegates the gate; mutation test red-on-cut. Closes P0-4. **code-action bypasses the primitive (`toolSvc.execute()` direct) — residual follow-up.** |
| **B2** ✅ | **Strategy result `extraMetadata`** — only `reactive` forwards `terminatedBy` | Abstention + goalAchieved | **RESOLVED Wave 2 (2026-07-19):** direct/ToT/reflexion/plan-execute/blueprint/code-action/adaptive all forward `terminatedBy` (+abstention where they can decline) via the shared `deriveTerminatedBy`; execution-engine no longer defaults `end_turn`; mutation test red-on-cut. Closes P0-5. Rode along: §5.1, §5.2 below. |
| **B3** ◐ | **Builder→runtime seam** — every field crosses via `self as unknown as BuilderRuntimeStateView`, a structural cast that will NOT catch a renamed/removed field. Tests assert private fields, not behavior. | 30 SILENT withers | **PARTIAL Wave 2 (2026-07-20):** the "30 SILENT" was a pre-Wave-1 baseline (Wave 1 removed 9 lying withers + proved several). New `builder-seam-behavioral.test.ts` converts **7 SILENT→PROVEN** with red-on-cut behavioral tests (withPersona/withTaskContext/withTools/withReasoning/withMaxIterations/withOutputValidator/withOutputSchema); ~12 confirmed already PROVEN; the rest are **not deterministically observable with the `test` provider** (withCostTracking reports cost 0, withThinking stripped on test path, withEnvironment/withContextProfile/withResultCompression/withStallPolicy/withGrounding/withReactiveIntelligence need long/grounded runs) — flagged for a live-provider probe. **Seam type-safety (compile-error on renamed field) blocked by `private _*` fields → Wave 4 codegen candidate.** Surfaced: `withSystemPrompt` double-wired (robust), `createRuntime` `systemPrompt:` arg + a `runtime-construction.ts:418` line are dead/redundant. |
| **B4** ✅ | **Kernel→strategy projection** — `ReActKernelResult` carries output/steps/tokens/cost/toolsUsed/iterations/terminatedBy/rawTerminatedBy/finalAnswerCapture/abstention + `CompletionEnvelope` | in-kernel verifier verdict written+dropped; the "19 orphaned `KernelMeta` fields" claim | **RESOLVED Wave 2 (2026-07-20):** TRIAGE (see B4 report) reclassified the "19" — the honesty 5 already rode the envelope, the rest are IN-KERNEL-consumed (arbitrator/oracle/curator/guards/iterate-pass) and were miscounted. The only genuine write-only boundary-drops were the **verifier verdict fields — DELETED** (`verifierVerdict`, `verifierRejected` decls + all `runner.ts` writes; `verifierEscalation` undeclared stowaway). §5.3 linkage fixed (see §5 #3). `lastDialectObserved` noted as partial-projection telemetry (reactive/direct only). Mutation tests red-on-cut (`b4-envelope-boundary.test.ts`). |
| **B5** ✅ | **EventBus→public stream projection** (`execute-stream.ts`) | `PhaseStarted`/`PhaseCompleted` have zero stream writers — byte-identical to the tool-events bug fixed in `61f05489`. Advertised in `ui-core` + `apps/docs/features/streaming.md`. | **RESOLVED Wave 2 (2026-07-20):** `execute-stream.ts` now projects `ExecutionPhaseEntered`/`Completed` → public `PhaseStarted`/`PhaseCompleted` chunks (gated `density:"full"`, mirrors 61f05489); reused existing stream-types; ui-core + docs shapes already matched; mutation test red-on-cut. |
| **B6** | **`selectAdapter` early-return** (`adapter.ts:322`) | Calibration discards the tier adapter | P0-2 |
| **B7** ✅ | **`requirement` ledger kind: ZERO writers** | Two live readers (`assess.ts:207`, `standing-frame.ts:193`) always see `[]` ⇒ the meta-loop's requirement lifecycle (declared→satisfied→blocked) is **fiction**; Projector renders no outstanding work; `evidenceRefs` double-dead | **RESOLVED Wave 2 (2026-07-20):** two writers via the ledger-home emitter — `recordRequirementsDeclared` at contract-compile (`runner.ts:369`), `recordRequirementTransitions` at the gate (`iterate-pass.ts:481`); single-writer invariant green; 8-test mutation suite red-on-cut. **#39** false-positive killed by reusing `assess()`'s entity-keyed authority (orders.json ≠ rates.json requirement). Residual: generic per-entity tool-coverage (`cardinality:"per-entity"`) needs a new condition type — `TaskRequirement`/`RequirementSpec` carry no entity field today; out of boundary. |
| **B8** ✅ | **Subagent detached-runtime dispatch boundary** (`spawn-handlers.ts`, `local-agent-tools.ts`, `sub-agent-executor.ts`) — fresh root fiber per spawn; parent EventBus/Trace/Logger dropped | Invisible workers, no cancellation, flat teams, not-background, unattributable logs — **five symptoms, one line**. H-risk #1 of the 07-12 audit. | **RESOLVED Wave 2 (2026-07-20, RATIFIED RE-SCOPED — Tasks 1–5).** T1 `RunContext` spine + T2 trace-correlation base; **T3 G1** — child events reach the parent's EventBus (shared-bus overlay) tagged `parentAgentId`; **T4** — the child now `Effect.forkScoped`+`Fiber.await`s in the parent's fiber tree (both dynamic + fixed `.withAgentTool` paths), so `agent.terminate()` **interrupts in-flight children** (no orphans); a failed child's `Exit`→`SubAgentResult{success:false}` — **no-cascade gate stayed green**; the `as ...,any,never` cast deleted. **T3b** — child trace bookends carry `depth:1`/`rootRunId`. **T5 (G7)** — recursion cap LIVE: guard reads `RunContext.depth` (literal `0` gone), children get spawn tools below the cap (gated on explicit `maxRecursionDepth`), refusal is an observation; sub-agents sub-delegate to depth 2. All red-on-cut pinned. **Task 7 already done (`311bce38`); Task 16 → Wave 3. DEFERRED as new capability (bench-gated, NOT debt): Phases 3–5 (background subagents, typed hand-off, M8 bench) + logging Tasks 6/8/9/10.** Residual: per-iteration child events default run-scoped (only run bookends carry depth:1) — sufficient to reconstruct the tree by `rootRunId`. |

## 3b. Absorbed open work (from the superseded 07-10 programs — absorb-or-defer pass, 2026-07-19)

Every item below was open in the root-cause closure or goal-reliability programs and had NO row here.
That silence violated this register's own exhaustiveness clause; corrected now. Wave = burndown wave.

| Item | Source | Wave | Status |
|---|---|---|---|
| **Bench P2**: 7 llm-judge tasks → deterministic graded (suite sd 0.50 → ≤0.30) + immediate re-baseline | root-cause #11 | **Wave 5 ENTRY GATE** — re-earning numbers on an sd-0.50 instrument repeats July | OPEN |
| **Bench P3**: more `horizon:long` tasks (only lh-1 + rw-7 exist) | root-cause #12 | Wave 5 entry gate | OPEN |
| **#39 per-entity requirements** (gate tracks tool NAMES; `orders.json` read satisfied a `rates.json` requirement; dead `cardinality:"per-entity"`) | root-cause T1.2 | Wave 2 (rode B7) | ◐ PARTIAL Wave 2 B7 — entity-carrying conditions (ArtifactProduced by path) now correctly entity-keyed via `assess()`; false-positive killed. Generic per-entity tool-coverage (`cardinality:"per-entity"`) still OPEN — needs a new condition type + tool cardinality metadata. |
| **#44 kernel→engine signal unification** (`ctx.toolResults`/`lastResponse` empty on kernel path; memory extraction erratically reachable) | root-cause T1.3 | Wave 2 (sibling of B4 — same projection disease, engine side) | ✅ RESOLVED Wave 2 (2026-07-20) — the "empty" claim was STALE: `reasoning-think.ts:402` sets `lastResponse`, `reasoning-post-think.ts:178` bridges `ctx.toolResults` from the kernel's action steps (order: think→post-think→memory-flush). Residual FALSE-signal fixed: the synthetic `result` carried the `toolName(args)` CALL text, not the paired `observation` (tool RESULT) — now sources observation content so `memory-flush.ts:184` extraction sees the kernel path's real tool results. Mutation tests red-on-cut (`kernel-path-tool-results.test.ts`). Reachability was already deterministic (multi-tool gate); the memory-flush gate itself (`substantialResponse ‖ ≥2 tools`) is deliberate cost policy — left as-is. |
| **#38 thought-continuity ablation** (flag shipped, never measured; prereq: Ollama provider discards `thinking` ⇒ inert on local tier) | root-cause T1.1 | Wave 5 (needs the fixed instrument) | OPEN |
| **M6 contract-driven terminal gate** missing on blueprint/code-action/inline | matrix sweep | **DEFERRED by design** — receipt recompiles the contract strategy-agnostically at the boundary (`builder/helpers.ts:182`), so the receipt stays truthful; only in-loop steering is absent. Revisit if Wave 5 bench shows those paths stopping short. | DEFERRED |
| **#36 adaptive-ablation re-cut** (Phase-6 exit gate unmet; verdict INCONCLUSIVE n=1) | root-cause #13 | Wave 5 | OPEN |
| **Compaction never fires** (threshold ≈ whole window; failed tool results pinned) | root-cause T3.9 | Wave 3 (wire-or-delete: fix the threshold or delete the documented `recencyBudgetChars` role) | OPEN |
| **Tool-roster consolidation** (two terminators; three overlapping memory tools; superseded-yet-exported tools) | root-cause T3.10 | Wave 3 | OPEN |
| **runtime pkg 67 `as any`** (runtime.ts 12, telemetry-emit.ts 7, execution-engine.ts 6) | 07-12 audit §3.6 | Wave 2 (rode B3) | ✅ RESOLVED Wave 2 B3 (2026-07-20) — real code casts **63→2**; the priority trio (runtime.ts 12, telemetry-emit.ts 7, execution-engine.ts 6) all →0; 2 justified holdouts (dynamic-import Tag resolve; cross-package SessionStore message shape). No new `as unknown as` (cast ceiling untouched at 42). |
| **check-control-plane GRANDFATHERED list** (4 forcing sites, never shrunk) | root-cause T2.7 | Wave 3 (one site per PR, ratcheted) | OPEN |
| **Probe-fleet residue**: success+empty-output edge, ToT trivial-task cost floor, reflexion empty-generate budget collision, output⊆observations grounding depth | probe debriefs | Wave 5 (fleet is part of the instrument) | OPEN |

---

## 4. Dead code — DELETE (deleting is the honest move)

| Item | LOC | Evidence |
|---|---|---|
| ~~`packages/orchestration`~~ ✅ **DELETED Wave 3 (2026-07-20)** | 935 | Entire package removed (net **−2833 LOC** incl. tests/example/docs); published `reactive-agents/orchestration` subpath + exports-map entry + `apps/examples/09-orchestration` removed (v0.14 breaking); consumer-grep clean (3 intentional negative-guard assertions kept). |
| ~~Ledger kinds `checkpoint-marker`, `deliverable-commit`, `contract-amended` (+ `amendContract()`)~~ ✅ **DELETED Wave 3 (2026-07-20)** | — | 3 kinds + entry interfaces + `amendContract`/`ContractAmendment` removed (grep-proven zero non-test writers/readers); ledger-writes invariant green; `process-model.md` doc table corrected. |
| ~~19 orphaned `KernelMeta` fields~~ → **3 DELETED, remainder reclassified** (Wave 2 B4, 2026-07-20) | — | `verifierVerdict`/`verifierRejected`/`verifierEscalation` deleted (write-only, grep-proven dead). The other ~16 were miscounted: honesty 5 ride the `CompletionEnvelope`; the rest are in-kernel-consumed (arbitrator/oracle/curator/guards). No declared boundary-drop orphans remain; `lastDialectObserved` = partial-projection telemetry (noted, low-value). |
| `RunContract.acceptance` tiers/stakes, `RequirementSpec.acceptance`, `DeliverableSpec.acceptance`, `TaskRequirement.weight` | — | ◐ **Wave 3 (2026-07-20): 3 DELETED, 1 KEPT.** `RunContract.acceptance`+`AcceptancePolicy`, `DeliverableSpec.acceptance` (+ its dead `stakes` computation), `TaskRequirement.weight` removed. **`RequirementSpec.acceptance` KEPT — register was WRONG:** live reader at `pace-actions.ts:66` (`.filter(req.spec.acceptance !== "self-critique")`, wired via `triageSteerText`/`shouldForceTerminalSynthesis`). |
| `RunAssessment.health.repeatWaste`, `.contradictions`, `pace.projectedCompletion` | — | ✅ **DELETED Wave 3 (2026-07-20)** — all 3 fields + the `contradictions` claim→grounding loop + `repeatWaste++` branch + `projectedCompletion` computation removed (every reader was a test). |
| dead `RA_*` flags ✅ **CLEANED Wave 3 (2026-07-20)** | — | Per-flag verified: **6 DEAD, removed** (`RA_RECITE`, `RA_ASSEMBLY`, `RA_POST_CONDITIONS`, `RA_SUPPRESS_DEPRECATION`, `RA_MINIMAL_PROMPT`, `RA_OVERFLOW_BUDGET` — dead env-reads/guards/stale-comments removed; `stability.md` doc lie fixed). **2 register errors corrected:** `RA_ASSEMBLY_TRACE` is a LIVE log label inside the live `RA_ASSEMBLY_DEBUG` block (not a flag — KEPT); `RA_ASSEMBLY_DEBUG` is live (KEPT). |
| ~~`packages/scenarios`~~ ✅ **DELETED Wave 3 (2026-07-20)** | 100 | Package removed; its 5 scenario strings inlined into the sole consumer (`runtime/tests/e2e-haiku-ablation.test.ts`); workspace/changeset/keywords entries + `@reactive-agents/scenarios` deps removed; bun.lock refreshed. |
| Orphan builder fields ✅ **DELETED Wave 3 (2026-07-20)** | — | `_memoryExplicitlyDisabled` + `_enableEvents` DELETED (grep-proven dead); `fallbackConfig.models` already gone (Wave 1 P0-3). **`withCacheTimeout()` / `config.cacheTimeoutMs` REMOVED** — confirmed no-op orphan (threaded builder→runtime-construction→`runtime.ts:330` but `ToolResultCacheLive()` takes NO args and ignored it; cache always used its default 300s TTL). Removed at 21 sites: framework (builder method+ctor field, `_state`/to-config/runtime-construction/runtime-types/types/agent-config schemas, `builder-methods` registry, `runtime.ts` passthrough, feature-matrix) + 4 framework tests + docs (README, cost-optimization "Semantic Cache 40-60%" **lie section deleted**, builder-api ×3 regen, configuration, COVERAGE) + **the full cortex `cacheTimeout` UI→API→service control** (was a user-facing knob that did nothing: AgentConfigPanel.svelte control, lab page, chat/runs APIs, 6 services, UI type+default+post-body, parity/drift gates + 4 cortex tests). |

**Unintegrated but real** (wire or demote, don't delete): `packages/interaction` (1,379), `packages/identity` (741).

---

## 5. Latent correctness bugs (new, not previously known) — **owned by burndown Wave 2** (ride B2/B4)

1. ✅ RESOLVED Wave 2 B2 — **`adaptive` fallback discards the failed sub-strategy's steps** (`adaptive.ts:290-305`). If plan-execute wrote 2 of 3 files then returned partial, those real writes **vanish from the ledger** and the receipt reports produced deliverables as missing. *Fix: fallback merges the prior sub-strategy's steps (`allSteps = [...steps, ...priorSubSteps, ...finalSubResult.steps]`, double-count-guarded); mutation test asserts the step survives.*
2. ✅ RESOLVED Wave 2 B2 — **`direct` drops honesty markers entirely** (`direct.ts:194`) — no `extraMetadata`, hardcodes `totalCost: 0`, can report `completed` on an unverified ship. *Fix: forwards real cost/tokens + `honestPartialMetadata` + `terminatedBy`/`abstention`/`error`.*
3. ✅ RESOLVED Wave 2 B4 (2026-07-20) — **Two verifiers, one receipt field, no linkage.** `runner.ts`'s comment claiming the kernel verdict lands on `receipt.verifierVerdict` was **false**; the receipt's verdict is authored by the result-boundary verifier (`runtime/engine/finalize/result-verification.ts`), which runs on EVERY path BY DESIGN. Disposition = option (b): the boundary verifier owns the receipt; the in-kernel verifier owns control flow (status/error) + the honesty markers that cross via the `CompletionEnvelope` (`verificationWarning`, `harnessAuthoredOutput`). Deleted the false comment + the dead write-only `meta.verifierVerdict`/`verifierRejected`/`verifierEscalation` writes and declarations. `result-boundary-verification.test.ts` pins boundary-owns-receipt (works on strategy paths with no in-kernel verifier); `b4-envelope-boundary.test.ts` pins in-kernel honesty crossing via the envelope.

---

## 6. The gates that keep it fixed (no fix is done without one)

| Gate | Kills | Level |
|---|---|---|
| Derive declarations FROM implementations (`type LedgerKind = keyof typeof emitters`; hook union from dispatch table) | ORPHAN class — becomes a **compile error** | types |
| `scripts/check-orphans.sh` — every declared member needs ≥1 non-test writer + reader; rides the existing auto-globbed CI script lane | residue that can't be typed (env flags, cross-package projections) | CI |
| **Builder-seam test lane** — one test per wither asserting the built agent's *behavior* changes | 30 SILENT withers (**highest-leverage test work in the repo**) | test |
| Probe fleet (`f65722f6`) | written-but-meaningless (a seam that always returns null) | behavioral |

**Definition of done, binding:** declaration + non-test writer + non-test reader + a mutation that goes red.
Prose findings do not discharge debt. Only gates do.

---

*Method: 5 parallel read-only sweeps (withers, strategy×mechanism matrix, declaration orphans, package
liveness, public claims), each verdict re-verified against primary evidence by the main session before
landing here. Two agent claims were rejected on verification (`packages/testing/src/gate/` is wired — CI
runs `gate:check` at `ci.yml:88`; `.withAdaptiveHarness()` has drifted to PROVEN for `plan.strategy`).*
