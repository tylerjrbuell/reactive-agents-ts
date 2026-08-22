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

**Wave 2 (2026-07-20): the spine.** All 7 boundaries shipped (B1–B8) with red-on-cut mutation tests
(see §3). **Wave 3 (2026-07-20): delete + §3b.** Rounds 1+2: `packages/orchestration` (−2833 LOC) +
`packages/scenarios`, dead RA flags, noise benches, 4 corrupted probes, dead ledger-kinds/vocabulary/
health-fields, orphan builder fields. Remainder: **`withCacheTimeout` removed (public-wither count
85→84)** + its full cortex control; the Wave-1 `progressCheckpoint` cortex landmine; dead tools
`task-complete` + `rag-search` (§3b T3.10); compaction doc-lie + dead `agedBudgetChars` (T3.9);
control-plane guard tightened 4→2 (T2.7). Deferred (behavioral, needs bench/kernel PR): earlier
compaction, control-plane resolver-routing of the 2 real forcing sites.

---

## 2. P0 — PUBLIC API LIES (block the release; a user is misled today)

| # | Item | Reality | Evidence | Verdict |
|---|---|---|---|---|
| **P0-1** | **`.withReactiveIntelligence({autonomy, constraints})`** | **SAFETY.** `autonomy:'observe'`, `neverEarlyStop`, `neverHumanEscalate`, `lockedSkills`, `protectedSkills` are ALL no-ops. A user who asks for observe-only gets a fully autonomous controller. | `_riConstraints`/`_riAutonomy` written `wither-applies.ts:75-76`; **zero readers repo-wide** | ✅ RESOLVED Wave 1 — options REMOVED (compile-error + runtime-throw); no-op safety switch gone |
| **P0-2** | **Calibration is a net REGRESSION** | A model with a calibration file **loses** its 4 live adapter hooks (`continuationHint`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`) and gains 2 dead ones. Calibrating a model strictly weakens the harness. | `adapter.ts:322` early-returns `buildCalibratedAdapter(cal)`, discarding the tier adapter; that adapter sets only `systemPromptPatch`+`toolGuidance`, both zero-call-site | ✅ RESOLVED Wave 1 — B6 fixed: `selectAdapter` now COMPOSES tier+calibration (additive, never removes capability); mutation test pins it |
| **P0-3** | **`.withFallbacks()`** | Docs promise "switches after 3 consecutive errors" + cheaper-model fallback on 429. Switches on the **first** error; `errorThreshold` only decorates an event (`runtime.ts:447`); `models[]` has zero readers. All 11 tests are setter asserts. | `runtime.ts:411-470` | ✅ RESOLVED Wave 1 — lying `models`/`errorThreshold` REMOVED; honest provider cascade kept (extracted `llm-fallback-cascade.ts`, behavioral+mutation tests replace 6 setter tests) |
| **P0-4** | **Tool policy is suppression, not enforcement** | `forbiddenTools`/`allowedTools` gate exists ONLY in `act.ts:367`. The shared `executeToolAndObserve` choke point has **zero** policy checks ⇒ plan-execute, blueprint, code-action, inline can execute a forbidden tool that arrives via a planned step or hallucinated name. | `tool-observe.ts` — 0 matches for allowedTools/forbidden | ✅ RESOLVED Wave 2 B1 — `evaluateToolPolicy` (allowed+forbidden, deny>allow) enforced INSIDE `executeToolAndObserve`; act.ts delegates + now enforces the contract deny-list on the kernel path too; plan-execute/blueprint inherit; mutation test red-on-cut. **code-action residual CLOSED (2026-07-21, `d22e784f`): sandbox handler closures gate through the shared `evaluateToolPolicy`; red-on-cut mutation suite. P0-4 fully discharged.** |
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
| **P0-16** | README headline quickstart: `import { createAgent }`, `.withLongHorizon()`, `.withAdaptiveHarness()`, `.withReceiptSigning()` | Was: absent from published `0.13.6`, existed only on main. **The conditional resolved itself — v0.14 DID ship from main.** Re-verified 2026-07-23 by unpacking the live tarballs: `@reactive-agents/runtime@0.14.0` contains all four (`createAgent`, `withLongHorizon`, `withAdaptiveHarness`, `withReceiptSigning`, plus `withDurableRuns`/`withFabricationGuard`), 3 dist files each. **Probe caveat for whoever re-checks:** grepping the `reactive-agents` facade package is INVALID — its dist entries are re-export stubs (~38 B), so every symbol reads as absent. Unpack `@reactive-agents/runtime`. | ✅ RESOLVED (v0.14.0 release, re-verified 2026-07-23) |
| **P0-17** | "**27-signal** complexity router" (5 sites) | `complexity-router.ts` has **4 named factors** + length thresholds. No registry, no weights. | ✅ RESOLVED Wave 1 — 3 docs sites rewritten to "multi-factor" (named factors); remaining 2 sites (wiki/CHANGELOG) out of docs scope |
| **P0-18** | README lists **6** providers in its Multi-Provider + Architecture tables | The same README claims **8**. Code has 8. Internal contradiction. | ✅ RESOLVED Wave 1 — both tables + package description set to 8 (Groq/xAI added) |
| **P0-19** | `errors.ts` suggestions | `:247` renders **syntactically invalid TS** (`violation` is a joined summary, not a key). `:256` says "call `agent.resume()`" — but `resume()` only completes a pause deferred and KillSwitch fires on stop/terminate (unresumable); its `reason === "manual"` branch is **dead** (no writer emits it). `:134,147` JSDoc names `agent.resume(runId)` — the real method is `resumeRun(runId)`. The ee9a1471 "honesty pin" is green against **fixture values production never emits**. | ✅ RESOLVED Wave 1 — invalid snippet fixed; dead `"manual"` branch removed; resume→resumeRun JSDoc; honesty-pin test rebuilt on real emitted values |
| **P0-20** | CHANGELOG `[Unreleased]` | Contains **only** the 3-wither removal, while **~40 user-facing feat/fix commits** landed since v0.13.6 — including the **meta-tools going opt-in** (a behavior change users must know about). | ✅ RESOLVED Wave 1 — `[Unreleased]` rewritten: Wave 1b removals/fixes, meta-tools opt-in, receipt-truthfulness sweep, Groq/xAI, CompletionEnvelope |
| **P0-21** | The docs example gate | **INSTRUMENT FIXED Wave 0 (2026-07-19):** wired into CI (`docs-gates` job); `--fix-fragments` **deleted**; parse-error suppression fixed (in-process compiler API, per-file syntactic+semantic diagnostics — proven with a deliberately broken pair); skip-count **ratchet added** (`SKIP_CEILING = 283`, only falls). **DRIFT DISCHARGED (release-readiness sweep 2026-07-21):** all 6 drift-hiding skips fixed against verified code + un-skipped; **SKIP_CEILING ratcheted 283 → 256 → 250**; docs:examples:check 348 blocks / 0 fail. Sweep also purged 26 live doc sites teaching v0.14-removed APIs (withTelemetry/withTerminalTools/withoutTracing/withCacheTimeout/withInteraction/task-complete/rag-search) incl. README + 4 skills + the 21-interaction-modes example (rewritten onto `@reactive-agents/interaction` directly, runs green). **Register error corrected:** the `SessionOptions {persist,id}` "fabricated" claim was an over-count — both keys are REAL and test-pinned (`reactive-agent.ts:2276`); the actual rot was a fabricated `context` key, wrong table name (`agent_sessions`→`chat_sessions`), false `end()`-deletes-row claim, and the dead `persistOnEnd` key (JSDoc now says NOT WIRED). `.withContextProfile` had 3 fabricated keys (budgetTokens/compactionLevel/maxStepsBeforeCompaction); ToolBuilder→withTools non-compile CONFIRMED + all doc blocks rewritten to the working pattern. | ◐ gate PROVEN, drift-skips discharged; 250 benign skips remain (ratcheted) |

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
| **B1** ✅ | **`executeToolAndObserve`** (`tool-observe.ts`) — hand-rolled strategies route tools here and inherit NOTHING; kernel strategies get everything free from `act.ts` | RunLedger minting + tool-policy gate | **RESOLVED Wave 2 (2026-07-19):** policy gate (`evaluateToolPolicy`) + ledger mint (`recordToolDispatch`, single-writer-safe) now IN the primitive; plan-execute/blueprint pass config + inherit; act.ts delegates the gate; mutation test red-on-cut. Closes P0-4. **code-action residual CLOSED (2026-07-21, `d22e784f`): the sandbox handler closures now gate every dispatch through the shared `evaluateToolPolicy` (deny-list defaults to the `.withContract` contract, which production spreads into strategy params); red-on-cut mutation suite.** |
| **B2** ✅ | **Strategy result `extraMetadata`** — only `reactive` forwards `terminatedBy` | Abstention + goalAchieved | **RESOLVED Wave 2 (2026-07-19):** direct/ToT/reflexion/plan-execute/blueprint/code-action/adaptive all forward `terminatedBy` (+abstention where they can decline) via the shared `deriveTerminatedBy`; execution-engine no longer defaults `end_turn`; mutation test red-on-cut. Closes P0-5. Rode along: §5.1, §5.2 below. |
| **B3** ◐ | **Builder→runtime seam** — every field crosses via `self as unknown as BuilderRuntimeStateView`, a structural cast that will NOT catch a renamed/removed field. Tests assert private fields, not behavior. | 30 SILENT withers | **PARTIAL Wave 2 (2026-07-20):** the "30 SILENT" was a pre-Wave-1 baseline (Wave 1 removed 9 lying withers + proved several). New `builder-seam-behavioral.test.ts` converts **7 SILENT→PROVEN** with red-on-cut behavioral tests (withPersona/withTaskContext/withTools/withReasoning/withMaxIterations/withOutputValidator/withOutputSchema); ~12 confirmed already PROVEN; the rest are **not deterministically observable with the `test` provider** (withCostTracking reports cost 0, withThinking stripped on test path, withEnvironment/withContextProfile/withResultCompression/withStallPolicy/withGrounding/withReactiveIntelligence need long/grounded runs) — flagged for a live-provider probe. **Seam type-safety (compile-error on renamed field) blocked by `private _*` fields → Wave 4 codegen candidate.** Surfaced: `withSystemPrompt` double-wired (robust), `createRuntime` `systemPrompt:` arg + a `runtime-construction.ts:418` line are dead/redundant. |
| **B4** ✅ | **Kernel→strategy projection** — `ReActKernelResult` carries output/steps/tokens/cost/toolsUsed/iterations/terminatedBy/rawTerminatedBy/finalAnswerCapture/abstention + `CompletionEnvelope` | in-kernel verifier verdict written+dropped; the "19 orphaned `KernelMeta` fields" claim | **RESOLVED Wave 2 (2026-07-20):** TRIAGE (see B4 report) reclassified the "19" — the honesty 5 already rode the envelope, the rest are IN-KERNEL-consumed (arbitrator/oracle/curator/guards/iterate-pass) and were miscounted. The only genuine write-only boundary-drops were the **verifier verdict fields — DELETED** (`verifierVerdict`, `verifierRejected` decls + all `runner.ts` writes; `verifierEscalation` undeclared stowaway). §5.3 linkage fixed (see §5 #3). `lastDialectObserved` noted as partial-projection telemetry (reactive/direct only). Mutation tests red-on-cut (`b4-envelope-boundary.test.ts`). |
| **B5** ✅ | **EventBus→public stream projection** (`execute-stream.ts`) | `PhaseStarted`/`PhaseCompleted` have zero stream writers — byte-identical to the tool-events bug fixed in `61f05489`. Advertised in `ui-core` + `apps/docs/features/streaming.md`. | **RESOLVED Wave 2 (2026-07-20):** `execute-stream.ts` now projects `ExecutionPhaseEntered`/`Completed` → public `PhaseStarted`/`PhaseCompleted` chunks (gated `density:"full"`, mirrors 61f05489); reused existing stream-types; ui-core + docs shapes already matched; mutation test red-on-cut. |
| **B6** | **`selectAdapter` early-return** (`adapter.ts:322`) | Calibration discards the tier adapter | P0-2 |
| **B7** ✅ | **`requirement` ledger kind: ZERO writers** | Two live readers (`assess.ts:207`, `standing-frame.ts:193`) always see `[]` ⇒ the meta-loop's requirement lifecycle (declared→satisfied→blocked) is **fiction**; Projector renders no outstanding work; `evidenceRefs` double-dead | **RESOLVED Wave 2 (2026-07-20):** two writers via the ledger-home emitter — `recordRequirementsDeclared` at contract-compile (`runner.ts:369`), `recordRequirementTransitions` at the gate (`iterate-pass.ts:481`); single-writer invariant green; 8-test mutation suite red-on-cut. **#39** false-positive killed by reusing `assess()`'s entity-keyed authority (orders.json ≠ rates.json requirement). Residual: generic per-entity tool-coverage (`cardinality:"per-entity"`) needs a new condition type — `TaskRequirement`/`RequirementSpec` carry no entity field today; out of boundary. |
| **B8** ✅ | **Subagent detached-runtime dispatch boundary** (`spawn-handlers.ts`, `local-agent-tools.ts`, `sub-agent-executor.ts`) — fresh root fiber per spawn; parent EventBus/Trace/Logger dropped | Invisible workers, no cancellation, flat teams, not-background, unattributable logs — **five symptoms, one line**. H-risk #1 of the 07-12 audit. | **RESOLVED Wave 2 (2026-07-20, RATIFIED RE-SCOPED — Tasks 1–5).** T1 `RunContext` spine + T2 trace-correlation base; **T3 G1** — child events reach the parent's EventBus (shared-bus overlay) tagged `parentAgentId`; **T4** — the child now `Effect.forkScoped`+`Fiber.await`s in the parent's fiber tree (both dynamic + fixed `.withAgentTool` paths), so `agent.terminate()` **interrupts in-flight children** (no orphans); a failed child's `Exit`→`SubAgentResult{success:false}` — **no-cascade gate stayed green**; the `as ...,any,never` cast deleted. **T3b** — child trace bookends carry `depth:1`/`rootRunId`. **T5 (G7)** — recursion cap LIVE: guard reads `RunContext.depth` (literal `0` gone), children get spawn tools below the cap (gated on explicit `maxRecursionDepth`), refusal is an observation; sub-agents sub-delegate to depth 2. All red-on-cut pinned. **Task 7 already done (`311bce38`); Task 16 → Wave 3. DEFERRED as new capability (bench-gated, NOT debt): Phases 3–5 (background subagents, typed hand-off, M8 bench) + logging Tasks 6/8/9/10.** Residual: per-iteration child events default run-scoped (only run bookends carry depth:1) — sufficient to reconstruct the tree by `rootRunId`. |

**Wave C.1 (2026-07-22): C1 convergence slices 1–3.** Equivalence invariant ratified
([[../Decisions/2026-07-22-c1-equivalence-invariant|decision]]) — `steps[]` chokepoint-only
(single-writer gate tightened) + ledger ≡ projection(steps) pinned red-on-cut
(`equivalence.test.ts`); all 8 strategies forward `runLedger` across the result boundary
(reflexion projects it from merged steps for completeness rather than dropping it); receipt
tool-call + deliverable evidence re-based onto ledger queries (steps-derived fallback kept
for paths with no ledger); `LedgerEntryAppended` live tap (`kernel/loop/runner.ts`) → EventBus
→ public `stream(density:"full")` chunks + `run_events` journal row. **DEFERRED to Wave C.2:**
engine-phase ledger entries (making `run_events` a pure ledger journal end-to-end) and the
llm-exchange/replay re-base (byte-sensitive seam, deliberately not touched this wave).

**Carried-forward debt (small, surfaced by Wave C.1 review — not silently dropped):**

| Item | Note |
|---|---|
| No dedicated durable-RESUME-path test for the `onLedgerAppend` tap | Covered indirectly by adjacent tests + the requirement-lifecycle idempotency tests; residual risk assessed LOW. |
| ~~`TaskResult.metadata` is a hand-enumerated literal (`execution-engine.ts` ~:1290-1330)~~ **CLOSED (cross-cutting cascade Task 9, `c5d225cd`, 2026-07-23)** | Was: any future `extraMetadata` field silently dies at that boundary unless explicitly enumerated there — `reasoningSteps`/`receiptToolCalls`/`confidence`/`runLedger` all had to be added by name. Fixed with a typed, namespaced extension slot: `ResultMetadataSchema.extensions` / `ReasoningMetadataSchema.extensions` (`Schema.Record({key: Schema.String, value: Schema.Unknown})`); the engine forwards `rr.metadata.extensions` verbatim with ONE conditional spread. Deliberately NOT a deny-list pass-through of top-level keys (would invert silent-loss into silent-leak). `verdict` also added to the enumerated forwards (was missing; terminal judgment now reaches `TaskResult` for receipts). Also required fixing `normalizeReasoningResult`/`ExecutionReasoningResult` (`engine/util.ts`) — a SECOND, undiscovered hand-enumerated whitelist boundary upstream of the engine literal that would have silently dropped `extensions`/`verdict` before they ever reached `rr`. `runLedger`/other pre-existing fields at that upstream boundary were left untouched (out of Task 9's scope) — see report for detail; may warrant its own debt row. |
| `post-conditions.ts:96-99` `writtenPathSatisfies` docstring is stale | Claims the resolved absolute path lands in `toolCall.arguments.path`; the arguments object is never mutated. Safe direction (false-UNMET, not false-MET), so left as a doc fix, not a behavior fix. |
| code-action + reflexion ledger entries carry a single static `iteration` tag | Cosmetic only — `kind`/`toolName`/`toolCallId` are correct per-entry; the iteration counter just doesn't advance per-entry within those two strategies. |
| ToT degenerate no-`bestLeaf` branch ships `runLedger: []` untested | Reviewer traced the branch as effectively unreachable in practice (requires a tree search that produces zero viable leaves); left unpinned rather than adding a test for dead-in-practice code. |
| ~~**`rr.metadata.runLedger` never reaches `TaskResult.metadata` via the real `ReasoningService` path**~~ **CLOSED (2026-07-23)** | Was: `normalizeReasoningResult` (`packages/runtime/src/engine/util.ts`) is a SECOND hand-enumerated whitelist boundary, upstream of the execution-engine literal. `runtime/src/types.ts` DECLARED `runLedger` on `ctx.metadata.reasoningResult` and two engine sites read it, but the rebuild never COPIED it — two types describing one slot, one narrower in fact, so no compile error and total data loss. Every real strategy run through `ExecutionEngine` landed `TaskResult.metadata.runLedger === undefined`; the Wave-C1 "receipts read the ledger" guarantee held only for tests calling the receipt helpers directly. **Fixed** by adding `runLedger` to `ExecutionReasoningResult["metadata"]` + an `Array.isArray`-guarded copy in the rebuild (NOT folded under `extensions` — it has named readers and folding would lose typing). Pinned end-to-end through the real engine by `packages/runtime/tests/metadata-run-ledger-boundary.test.ts` (probe strategy → real mint → real normalize → real engine), red-on-cut verified. |

**Cross-cutting cascade — OPEN gaps after the whole-branch review (2026-07-23). The branch's own records named two gaps and OMITTED these; listed here so the set is complete:**

| Item | Verdict | Note |
|---|---|---|
| ~~**Sub-agents inherit NONE of the seven cross-cutting fields**~~ **POLICY HALF + APPROVAL CLOSED (2026-07-23); detach rails stay out by design** | **Was OPEN — pre-existing.** `SubAgentExecutorDeps` enumerated infra only (provider/model/tools/MCP/reasoning/guardrails/observability/contextProfile/costTracking/testScenario) — ZERO references to the cross-cutting fields, so a child ran UNJUDGED and a `requiresApproval` tool it called executed with no decision (the `fe5dc93b` class, one process boundary out). **Fixed** by threading `taskContract` + `fabricationGuard` + `grounding` + `approvalPolicy` parent→child: added to `LightRuntimeOptions`, mapped in the new pure `buildLightRuntimeConfig` (runtime.ts), declared on `SubAgentExecutorDeps`, passed through `tool-mcp-registrations` + `builder.ts`. The child builds its OWN `RunEnvelope` from these, so its answer is judged against the same contract/guard/grounding. **The child-pause design question — the reason this was deferred — DISSOLVED once block-mode approval was made to enforce (prior commit):** `createLightRuntime` COERCES any inherited approval policy to `mode:"block"` (a light runtime has no durable store; detach would strand the child with an unresumable pause sentinel), and block decides in-process with deny-by-default. So a child gates or refuses a gated tool, never pauses, never executes one unattended — and a detach PARENT no longer strands its children. The F2 autofeed runs in the child too, so `requiresApproval` built-ins gate even when unnamed. **Still OUT by design:** the detach HITL *rails* (`approvalDecision` / `interactionResponse` — one-shot FiberRef resume values) and durable child pause-and-resume. A child cannot pause for a human; it denies instead. That is the correct safe degrade, not a gap. Gated by `check-cross-cutting.sh` check 5/5 (both ends of the seam, red-on-cut). Pins: `sub-agent-light-config.test.ts` (mapping + block coercion + autofeed, red-on-cut), `subagent/inheritance-dispatch.test.ts` (live dispatch + detach-parent-no-strand), block BEHAVIOR in `approval-block-mode-gate.test.ts`. |
| ~~`verdict` is not projected onto the PUBLIC `AgentResult.metadata`~~ **CLOSED (2026-07-23)** | Was: Task 9 carried the terminal judgment to `TaskResult.metadata.verdict`, but `AgentResultMetadata` (`runtime/src/builder/types.ts`) — the type users see off `agent.run()` — did not declare it. Note the value was ALREADY present at runtime: `reactive-agent.ts:1473` builds `enrichedMetadata` by SPREAD, so `verdict` and `extensions` both rode onto the public object and were merely unreadable without a cast. **Fixed** by declaring both `verdict` and `extensions` on `AgentResultMetadata` (type-only change, no runtime effect), pinned by `packages/runtime/tests/agent-result-metadata-surface.test.ts` — compile-time assertions, red-on-cut verified under `tsc`. |
| Auxiliary-pass fence has no run-level evidence store | **OPEN — accepted residual, review C1** | The C1 fix marks verification-retry / post-think-continuation passes `auxiliaryPass: true` so the terminal mint judges but does not enforce on them (a fragment's grounding evidence lives in a sibling pass; judging it as a terminal destroyed correct answers). The *correct* fix would be a run-level evidence ledger the mint can read across passes — then every pass could be judged honestly. What ships instead: enforcement is skipped on fragments, plus a mirror guard (`isEnforcedAbstention`, `runtime/src/engine/util.ts`) so a fragment can never OVERWRITE an abstention the terminal pass produced. Residual: on a genuinely ungrounded run the FIRST pass is still the one that enforces; a fragment adds no enforcement of its own. **Wave C.2 slice 1 (2026-07-24) built the store the correct fix needs** — the RunLedger is now run-scoped, so every pass's facts are reachable from one place (`engine/run-ledger-scope.ts`, provenance-stamped). Retiring the exemption in favour of judging fragments against sibling evidence is a BEHAVIOUR change and is deliberately NOT part of slice 1; it needs its own pins. |
| ~~`terminatedBy` cast omitted `"abstained"` — and an abstention was scored as a SUCCESS~~ **CLOSED (2026-07-23)** | **FOUND while fixing the cast; this was a live behavior bug, not just a type lie.** `execution-engine.ts` cast `terminatedBy` to a hand-written 5-value union omitting `"abstained"`, and FOUR more sites re-declared that same 5-value union (`debrief.ts`, `engine/finalize/{telemetry-emit,local-learning,debrief-synthesis}.ts`). The runtime string reached all of them regardless — the type just told the code a case it had to handle could not occur — and every one classified an abstention by falling through to the clean-termination branch: `AgentDebrief.outcome = "success"`, telemetry `outcome = "success"`, learning-engine `outcome = "success"`, and worst, `recordOutcome(skillId, outcome !== "failure")` **CREDITED the procedural-memory skill that led the agent to decline**. Widening the engine cast to core's canonical `TerminatedBy` is what surfaced the other four (the compiler named them). **Fixed** boundary-first: all five bound to `TerminatedBy`, and the three hand-copied outcome ternaries replaced by ONE `deriveRunOutcome` (`engine/util.ts`) that maps `abstained → "failure"`. Every non-abstained member reproduces the prior truth table exactly (pinned), so non-abstaining runs are byte-identical. Pinned by `packages/runtime/tests/abstained-outcome-classification.test.ts`, red-on-cut verified. |
| `deriveRunOutcome`: `llm_error` with an empty `errorsFromLoop` classifies as `"success"` | **OPEN — pre-existing, deliberately preserved** | Inherited verbatim from the ternary `deriveRunOutcome` replaced. It looks wrong (a provider failure scoring as a success), but fixing it silently inside an unrelated extraction would have been an unrequested behavior change riding along on the abstention fix. Pinned as-is in `abstained-outcome-classification.test.ts` so that whoever does change it does so knowingly. Note `debrief.ts`'s separate `deriveOutcome` already maps `llm_error → "failed"`, so the two classifiers disagree on this member — worth reconciling when this is picked up. |
| `extensions` slot has zero PRODUCTION writers | **OPEN — by design, not a defect** | Assessed 2026-07-23 and deliberately NOT "fixed". The slot is pinned end-to-end by `packages/runtime/tests/metadata-extension-slot.test.ts` (probe strategy → real engine, plus the deny-list-inversion guard), so the mechanism is proven wired. It exists so a FUTURE strategy-contributed field needs no engine edit; manufacturing a production writer to make the count non-zero would be metric-gaming. `runLedger` was deliberately NOT folded into it (named readers + typing). |
| ~~`.withApprovalPolicy({ mode: "block" })` was an INERT safety switch~~ **CLOSED (2026-07-23)** | **The most serious finding of the sub-agent scoping pass — a live P0-1-shape hole.** Every approval gate site keyed on `mode === "detach"`; NOTHING read `"block"`, so a `requiresApproval` tool executed with no human decision. And `"block"` is the mode you get from `.withApprovalPolicy(...)` WITHOUT `.withDurableRuns()` — the common configuration. `builder.ts:1618` even claimed block "falls back to the in-process approval gate"; that gate did not exist. Empirically confirmed before the fix: a gated tool executed identically under block mode and under no policy at all (control arm dispatched, block arm dispatched). The existing `builder-approval-policy.test.ts` missed it — setter-asserts (`expect(agent).toBeDefined()`), no behavior. **Fixed** with a DENY-BY-DEFAULT in-process gate: new `capabilities/act/approval-gate.ts` (`resolveBlockApproval` + fail-closed `wrapApprovalDecider`); a gated call with no configured `onApprove` is REFUSED, never executed. Gate homes mirror the detach gate exactly (drift-proof siblings): the canonical `executeToolAndObserve` primitive (covers kernel-single + plan-execute + blueprint + any future caller), the kernel parallel-batch loop in `act.ts` (bypasses the primitive), and a `code-action` refusal (its sandbox tools run past every gate). New public `onApprove` callback on `ApprovalPolicyConfig` (option on an existing wither — ratchet-safe). Pinned by `approval-block-mode-gate.test.ts` (behavioral, control-validated), `approval-gate.test.ts` (unit, incl. fail-closed), and block-mode coverage in `approval-gate-strategy-coverage.test.ts`; primitive gate red-on-cut verified. |
| ~~The `approvalPolicy` shape is hand-copied at FOUR sites~~ **CLOSED (2026-07-24)** | **The drift class this register tracks, one level up — and it had already bitten.** `KernelInput["approvalPolicy"]`, `ReactiveAgentsConfig.approvalPolicy` (`runtime/types.ts`), `RuntimeOptions.approvalPolicy` (`runtime-types.ts`) and `ApprovalPolicyConfig` (`runtime/builder/types.ts`) each re-declared `{ mode, tools, requireFor, … }` by hand; adding `onApprove`/`decide` for the block-mode fix required editing all four. A copy that misses a field drops it silently — which is how `mode: "block"` shipped gating nothing. **Fixed** by making the three stages STRUCTURALLY DERIVED from one canonical declaration in `reasoning/kernel/capabilities/act/approval-gate.ts`: `ResolvedApprovalPolicy` (kernel/envelope — `tools` Set, Effect `decide`) → `ConfiguredApprovalPolicy = Omit<Resolved, "tools"\|"decide"> & { tools: readonly string[]; onApprove? }` (agent config / RuntimeOptions) → `AuthoredApprovalPolicy = Partial<Configured>` (the public wither argument). `mode` and `requireFor` now exist in exactly one place, so a field added to the canonical shape reaches all three stages by construction. `BlockApprovalPolicy` (a fifth, near-duplicate slice with `mode` optional) collapsed into `ResolvedApprovalPolicy`. Gated two ways: `check-cross-cutting.sh` **Check 6** pins the `"detach" \| "block"` union to the owning file alone (a re-declaration anywhere in `packages/*/src` fails, as does removal of the canonical union itself — both mutations verified red), and `approval-policy-stages.test.ts` pins the derivation at COMPILE time via invariant `Equal<>` asserts plus a behavioural authored→configured→resolved round-trip (hand-writing a stage that drops `requireFor` fails typecheck — verified). |
| Wave C.2 slice 1: the RunLedger is run-scoped | **SHIPPED (2026-07-24)** | A run is not a pass. The engine executes reasoning up to three ways — the terminal pass (`reasoning-think.ts`), the verification retry (`verification-think-retry.ts`) and the post-think continuation (`reasoning-harness-hooks.ts`, four sites) — each a SEPARATE kernel execution whose ledger starts at seq 0, and each auxiliary pass OVERWRITES `ctx.metadata.reasoningResult`. The engine forwarded `rr.metadata.runLedger` — whichever pass finished LAST — so on any multi-pass run the terminal pass's tool calls, artifacts and verdicts were discarded before the receipt saw them. **Shipped:** `kernel/ledger/run-scope.ts` (`mergePassLedger` re-bases seq + stamps a `pass` provenance: `verification-retry` / `continuation` / `sub-agent:<name>`), the engine seam `engine/run-ledger-scope.ts` (`seedRunLedger` for the primary pass, `absorbedLedgerMetadata` for auxiliaries), all five pass sites wired, and both engine readers switched to the run-scoped ledger with the per-pass copy kept as fallback. A single-pass run is byte-identical to Wave C.1 (pinned). Seq re-base is sound only while nothing REFERS to an entry by seq — pinned by a repo-wide tripwire in `run-scope.test.ts`. Also fixed en route: `ExecutionReasoningResult.metadata.runLedger` was a hand-written STRUCTURAL MIRROR of `RunLedger` (the drift its own comment warned about, waiting to recur); it is now the real type. Gated by `check-cross-cutting.sh` **Check 7** (a file that normalizes and stores a reasoning result must absorb its ledger — red-on-cut verified) and pinned end-to-end by `run-scoped-ledger.test.ts` through the real engine, with a control arm that fails if the continuation never fires; both halves of the wiring mutation-tested. |
| Wave C.2 slice 2: a sub-agent's ledger merges into its parent | **SHIPPED (2026-07-24)** | The gap that opened this arc: a delegated run left NO trace in its parent beyond a summary string — the child's tool calls / artifacts / verdicts died at the boundary. Now the child's run-scoped ledger crosses back and merges into the parent's, stamped `sub-agent:<name>`, so a delegation is fully attributable. **Chain:** `sub-agent-executor.ts` reads the child's `TaskResult.metadata.runLedger`, stamps it via `mergePassLedger(…, "sub-agent:<name>")`, and hangs it on `SubAgentResult.childRunLedger` (typed `unknown` — tools must not depend on reasoning) → the tool-observation builders attach it to the spawn observation step's `subAgentLedger` metadata → `stepToEntries` (slice 1's merge) folds it into the parent ledger. **The load-bearing fix was `inline-act.ts`:** the engine's inline agent loop (the path delegation actually runs on — the nesting tests use it) built canonical action/observation STEPS but no LEDGER, so `TaskResult.metadata.runLedger` was empty for every default-path run. It now projects its steps into the run-scoped ledger (`projectStepsToLedger`) and carries the merge — WITHOUT this the whole chain was inert (the kernel primitives I first hooked, `tool-observe`/`executeNativeToolCall`, are not on the parent's spawn path; empirically mapped, not assumed). Nested provenance is innermost-wins: `mergePassLedger` now stamps `pass ?? provenance`, so a grandchild keeps its `sub-agent:<grandchild>` attribution through the parent merge (pinned). **Sub-agent tool improvements shipped alongside:** the child ledger is stripped from the MODEL-visible observation (`subAgentResultForDisplay` — potentially large, pure noise) while the merge still gets the untrimmed ledger, and BOTH the single `spawn-agent` result and the batch `spawn-agents` `{ results: [...] }` wrapper are handled (`subAgentChildLedgerEntries` flattens the batch, so N parallel children all cross and all strip). Also attached `subAgentLedger` on `act.ts`'s parallel-batch obs step (the one path that bypasses the tool-observe primitive) so a batched spawn merges too. Pinned by `subagent/ledger-merge.test.ts` (e2e through the real engine — parent + child + grandchild attribution, seq density, control arm; the inline-act attach is red-on-cut) and `sub-agent-display.test.ts` (carrier never leaks to the model, single + batch; flatten). |
| Wave C.2 slice 3: the ledger reaches the STREAM, through one announced seam | **SHIPPED (2026-07-25)** | C1's ruling has two halves — READER convergence and A SINGLE WRITE PATH (ratified: `wiki/Decisions/2026-07-22-c1-equivalence-invariant`). Only the first was enforced. **3a (`416cfccd`):** the C.1 `LedgerEntryAppended` tap published on the EventBus, but `toTraceEvent` had no case for it, so it fell to `default: null` — the ledger never reached the trace JSONL at all. Added the `ledger-entry` TraceEvent kind + normalize case (the ratified point 3 names *stream* as a canonical ledger reader). **3b-i (`ab6b3571`):** the inline path — the DEFAULT path, and the one delegation runs on — grew a ledger nothing published; closes the registered `runLedger`-on-the-live-engine-path drop. **3b-ii (`c168ee57`) — the structural fix:** `check-ledger-writes.sh` fenced the append API to `kernel/ledger/`, but `projectStepsToLedger` calls that API from INSIDE the fence and was callable from anywhere — and the script only searched `packages/reasoning`, so the engine's inline loop was never covered. **Four ledger factories existed where the invariant assumes one, and three announced nothing.** Measured on the real engine: `code-action` object=`[tool-invocation, tool-result×2]` / stream=`[]`; `reflexion` object=`[tool-result×2]` vs stream=`[requirement, verdict]×2` — **DISJOINT**, neither view containing the other; `inline-act` object=2 / stream=0. That is **GH #188's stream divergence — which C1 exists to kill — alive in the tree**. Trace-side readers (analyze, debrief, cohort) consume serialized JSONL and cannot reach `TaskResult.metadata`, so those runs were structurally invisible to them. **Fix:** ONE announced seam, `kernel/ledger/ledger-sink.ts` `growRunLedger` — projection and publication are a single act, so a caller cannot obtain the grown ledger without the delta being published. Announced at CONSTRUCTION, so the stream stays **live**; a terminal reconciler was considered and rejected (it would make trace consumers wait for run end and re-introduce a second, lagging store). `inline-act`, `code-action` and `reflexion` (3 exits) migrated; the kernel keeps `transitionState` + the runner tap. After: all three satisfy object ⊆ stream (code-action 0→3 exact parity; reflexion's disjoint views became containment). **Gate:** `check-ledger-writes.sh` now confines `projectStepsToLedger` to the ledger home across BOTH packages, exempting only `kernel-state.ts` (the `transitionState` chokepoint, announced by the runner tap). Pinned per-strategy by `ledger-announced-seam.test.ts` with a control assertion (so it cannot pass vacuously on two empty sets); red-on-cut verified at gate AND test. The widening cast is centralized (`ledgerEntriesForEvent`) rather than duplicated per publisher — the `as-unknown-as` ceiling was designed back down to 75, not raised. **Method:** both defects were found by probe-with-control, not by reading code; the structural read got `reflexion` WRONG (predicted lossy-subset, actual disjoint). **3c SHIPPED (`27e81ca8`):** `analyze.ts` reads the ledger for tool facts. `tool-call-*` events record only what a run invoked DIRECTLY, so a delegating parent showed `[spawn-agent]` against a 9-entry ledger spanning two children, and `deliverableProduced` reported "no deliverable-file write seen" for a run whose delegate had written it — a WRONG answer, not a thin one. Ledger-preferred with event fallback (historical JSONL + golden fixtures byte-stable), and the ledger view is declined when it carries no tool entries so a richer substrate cannot regress. `tools[]` stays event-based (transport-level `calls`/`truncated`; `resultTruncated` has no ledger counterpart). Pinned by `ledger-tool-facts.test.ts`, both mechanisms red-on-cut. **Test-honesty note:** the first draft asserted `honesty.label` and passed VACUOUSLY (cutting the fix left the label unchanged); re-targeted at the evidence string, which is what actually moves — caught by RUNNING red-on-cut rather than trusting green. **WAVE C.2 COMPLETE**; llm-exchange re-base was a false premise (raw prompts for golden replay, not ledger facts) and is out of scope. |
| Wave C.2 close-out: the success authority reads ONE substrate | **SHIPPED (2026-07-26, `ec4880bb` + `36665b8f`)** | Two defects, both found while closing the residuals the delegated-deliverable fix left named rather than silently dropped. **(a) A DELEGATED deliverable was refused (`ec4880bb`).** The post-condition spine is the run's success authority and judged `ArtifactProduced` from `steps` — the CURRENT agent's own steps, which structurally cannot contain a child's work. An orchestrator that delegated the write reported `success:false` with *"You still must: write the file ./cryptos.md"* while the file existed on disk and `receipt.toolsUsed` listed `file-write`; the same script SUCCEEDED on a re-run where the model wrote the file itself — the tell that the gate keyed on WHO did the work. Fixed by pointing it at the run-scoped ledger's `artifact` entries (merged under `sub-agent:<name>` by slice 2), which is generic over depth: no sub-agent special-casing, so nested and parallel delegation are covered by construction. Verified live (ollama `gemma4:e4b`, 3 fanned-out children). The sibling `ToolCalled` condition was checked BEFORE assuming symmetry and was already delegation-aware via `delegatedToolsUsed` — pinned so the two halves cannot drift. **(b) The ledger was INCOMPLETE on the default path (`36665b8f`).** `artifact` entries are not step-derived — they are minted from a tool's DECLARED `produces:"file"` — and `deriveArtifactEntries` was called only from the kernel's `act.ts`. The inline loop (the default path, and the one delegation runs on) grew a ledger with tool-invocation/tool-result facts and NO artifact facts at all, so a ledger-preferred reader was reading an incomplete substrate. `inline-act` now derives them and hands them to the SAME announced seam (`growRunLedger` gained `extraEntries`), keeping the published delta equal to the whole growth — pinned e2e in BOTH views (`ledger-artifact-parity.test.ts`, with a control that the write actually executed). **Also closed:** the receipt could report a DELETED file as produced — the ledger reached `computeDeliverableReport` flattened to a list of paths, dropping `op`; it is now passed whole to the same `verify()` gate, so "was this artifact produced?" is decided in exactly one place for the receipt, the arbitrator and terminate, and the duplicate path-matching in `deliverable-report.ts` is gone. `ToolCalled` now reads the ledger first (`delegatedToolsUsed` is one delegation level deep by construction; the merged ledger is not, so a GRANDCHILD's tools now satisfy a parent's condition) with the steps scan kept as the no-ledger fallback — both are sound positive evidence, so their union cannot produce a false-met. And the runtime's structural mirror of a ledger entry, hand-copied at FOUR sites each with a different subset of fields, is declared once in `types.ts` and imported. Red-on-cut verified for all three new mechanisms. |
| `low_delta_guard` terminates runs that are demonstrably progressing | **MEASURED 2026-07-27 — lift rule PASSES; promotion is now an owner decision, no longer an unmeasured one.** Full report: `wiki/Research/Harness-Reports/low-delta-2026-07-27/RESULT.md`. On `claude-haiku-4-5` / rw-7, n=12 per arm: the misfire reproduced in **11 of 12** baseline runs (`tokenDelta` ~185, `artifactsAvailable` 4–5 — the original rw-7 signature), graded accuracy went **0.000 → 0.417** (+41.7pp) at **+8.6% tokens**, exact permutation test **p = 0.00002**. Every baseline run scored exactly 0; eleven of twelve evidence runs scored above 0. Both halves of the 09 §6 lift rule pass. On `gpt-4o-mini` the guard fires **0/4** in BOTH arms — the mechanism never executes, so that tier is evidence of the safety property (costs nothing where unneeded) and nothing else. **Two methodological corrections came out of this and are worth more than the number:** (1) this session's own header instructed the reader to gate on the guard-FIRE RATE and ignore accuracy if it did not drop — the rate moved 11/12→7/12 at p=0.155 (null) while accuracy moved at p=0.00002, so following that instruction would have discarded the result; the reset DELAYS the fire rather than preventing it, letting the run finish first. Guidance corrected in the session file. (2) tier 2 first read as legacy 17702 vs evidence 22248 tokens = **+25.7%**, which fails the ceiling and would have blocked promotion — but with zero fires the mechanism cannot have caused it, and re-running the LEGACY arm gave 20217 tokens for the identical config (a 14% within-arm swing). The overhead was noise; the false negative was caught only by re-measuring the baseline's fire rate instead of trusting the first number. **Scope:** one task, so this qualifies rw-7's class (long-horizon multi-file debug with NO declared file deliverable) — rw-4 is out of scope, already shielded by the unproduced-deliverable rule (confirmed live: 34 iterations, 12 tool calls, no fire). Original note: | The single dominant bottleneck in the live sweep: `low_delta_guard` terminated **5 of 9** traced real-world runs, every one with `artifactsAvailable` 3–5 — i.e. the run had produced substantive artifacts and was still working. rw-7's trace ends mid-repair, at the exact turn the model said *"Now let me run the tests to see which ones fail:"* (`tokenDelta: 188`, 6 file-reads + 1 file-write completed). rw-4's ended after fetching posts, fetching comments and computing the enriched array (`tokenDelta: 0`, `artifactsAvailable: 4`). The guard measures TOKEN delta, which is ~0 exactly when a model emits short tool calls against large results — the audit 02-#3 misfire. **The fix already exists**: `nextLowDeltaCount` resets the counter when `assessment.evidenceDelta > 0`, but it is gated on `horizon !== undefined` (long-horizon profile only) per Wave E2's lift-gate discipline. Making it default-on is a per-task-class lift-rule + ablation-warden decision (09 §6), not a wiring one — deliberately NOT flipped. What DID ship 2026-07-26: the guard now also declines to fire while a declared deliverable is unproduced (`unproducedDeliverables`, judged by the same `verify()` gate incl. the run-scoped ledger, so a sub-agent's write counts). That covers the rw-4 shape; rw-7 declares no file deliverable (its criterion is `bun test` exit 0), so it remains exposed until the evidence-delta reset is measured and promoted. **Instrument update (2026-07-26, same day):** with the test provider's channel split in, the misfire now reproduces DETERMINISTICALLY and for free — `packages/runtime/tests/low-delta-guard-misfire.test.ts` (un-skipped) records `low_delta_guard terminate {tokenDelta: 0, consecutiveLowDeltaCount: 6, artifactsAvailable: 2}` on the legacy arm and no low-delta termination on the evidence-reset arm, which is the rw-4 signature (`tokenDelta 0`, artifacts 4) at zero tokens and ~1s. The cell carries BOTH controls the project's own doctrine demands: tools actually executed, and the legacy arm still REPRODUCES the misfire — without the second, "no misfires under the reset" would pass vacuously the moment the guard stopped firing for any unrelated reason. The lift/ablation decision is still owner-gated and still needs cross-tier arms; what changed is that the mechanism-level signal no longer costs a live sweep to observe. **THREE live arm-sets attempted 2026-07-27, ALL VOID — recorded so they are not repeated.** (1) `qwen3:14b`, n=3/arm: `low_delta_guard` fired ZERO times in either arm; the local tier emits long per-iteration reasoning, so `tokenDelta` never approaches the 500 threshold — the same void outcome previously recorded for `qwen3:4b`, now confirmed one tier up. (2) `claude-haiku-4-5`, n=3/arm: also ZERO fires — so this is NOT simply a "local models are too verbose" story. (3) Root cause of (2) was the PROBE, not the tier: a hand-rolled four-file task completes cleanly in ~13 iterations, and the consecutive-low-delta counter never builds. The original misfire came from rw-4/rw-7, where the model issues SHORT calls against LARGE results over many iterations. **What a valid measurement requires:** the registered `low-delta-ablation` session against the real rw-4/rw-7 tasks — a multi-hour campaign, owner-gated on time and cost. Hand-rolled task shapes do not reproduce the conditions and should not be attempted again. The deterministic cell (`low-delta-guard-misfire.test.ts`) DOES reproduce the misfire exactly (`consecutiveLowDeltaCount: 6`, `artifactsAvailable: 2`) and remains the cheap mechanism-level evidence. |
| ~~Scripted tool calls never reach the KERNEL act phase — the whole kernel is untestable deterministically~~ **CLOSED (2026-07-26)** | **The instrument was eating the script. There was no kernel defect — and the wrong diagnosis is the more useful half of this entry.** What was recorded here a day earlier was a real measurement (identical task, identical `withTestScenario`, only the path differing: inline executed the scripted call, kernel executed nothing, and nothing changed under `.withRequiredTools({adaptive:false})` or `.withLeanHarness()`) attached to a wrong conclusion — "structural to the kernel path" — which condemned all of Waves D/E/F to live-only verification. **Actual cause:** the deterministic provider served harness-internal LLM calls out of the AGENT's single turn cursor. The tool-relevance classifier runs BEFORE the agent's first think and retries on a decode failure; it cannot answer a `toolCall` turn (reads back as `empty content (stopReason=tool_use)`) but it CONSUMED one per attempt. So it ate the scenario, `think` reached the trailing text turn, and the run terminated `end_turn` at one step having called nothing. The decisive evidence was one log line the earlier probe never printed — `[classify] LLM call failed — falling back to empty (JSON Parse error: Unexpected identifier "Done")` — "Done." being the LAST turn of a scenario the agent had not started. **Fixed** in three linked parts, each mutation-tested red-on-cut: (1) `LlmCallPurpose` declared once at the provider boundary (`llm-provider/src/types.ts`) with the kernel's `LlmPurpose` now an ALIAS, not a second hand-maintained copy; (2) the gateway — the single mediator for every kernel LLM call — stamps `purpose` onto the wire request in `finalize()`, pinned by `llm-gateway.test.ts` (the provider's own tests pass `purpose` directly and CANNOT catch a missing stamp); (3) the provider splits agent (`think`, or no purpose = the inline path) from harness (everything else): a harness call skips agent-only turns, and if reaching its turn required stepping over one it PEEKS rather than consumes. A harness call that skips nothing consumes exactly as before, so non-interleaved scenarios are byte-identical — the whole suite stayed green apart from two cells that had relied on a harness call eating a turn, and those were fixed by degrading to an empty response instead of throwing. Pinned by `llm-provider/tests/harness-calls-do-not-eat-agent-turns.test.ts` (5 cases incl. the retry shape and the must-still-consume-its-own-turn converse). **Also surfaced:** a scenario that scripts the kernel must open with the classifier's `json` turn naming the tools the agent will use, or the tool surface prunes to empty and the act phase has nothing to dispatch to. **Consequence, reversed:** the guards, RunAssessment, the Projector and the control plane ARE deterministically testable; the parked cell was un-skipped and now reproduces the `low_delta_guard` misfire at zero cost (below). *Method note: the earlier probe measured `tool-call-end`, which is the ENGINE's event — the kernel records tool execution on the RunLedger and never emits it. Two independent instrument faults pointed the same wrong way, and the conclusion was published off a single un-controlled probe rather than held as a hypothesis.* |
| ~~A semantic-cache HIT returns an answer with NO run evidence~~ **CLOSED (2026-07-26, `85771bcf`) — and it was WORSE than this row described: the trust signal was INVERTED.** Probed rather than reasoned about, same task run twice: the grounded run (wrote the file) shipped `verdict=partially-grounded, confidence=0.6, verifierVerdict=escalate`; the CACHE HIT shipped `verdict=ungrounded, confidence=0.8, verifierVerdict=pass`. A consumer gating on `verifierVerdict === "pass"` would have ACCEPTED the evidence-free replay and REJECTED the run that did the work. **Two causes.** (1) The result-boundary verifier ran on the empty record; every check it performs detects a PROBLEM in the evidence (scaffold leak, harness parrot, continuation-intent, fabricated measurement), so handed nothing it found nothing and returned `pass` — a vacuous pass, the same class of defect caught three times elsewhere this session. It now DECLINES on a replay, leaving `verifierVerdict` ABSENT, which `TrustReceipt` documents as "unverified" and never as "clean". (2) Nothing marked the run as a replay: `cacheHit` was set on the execution context and read only by cost-tracking, so the shipped result was indistinguishable from a real one. It now rides to BOTH receipt sites as `replayed: true` (plus `metadata.cacheHit`) by the same mechanism the boundary verdict already used. Both fields additive and absent on ordinary runs → existing receipts byte-identical. **A first draft gated the verifier on `steps.length === 0` as a proxy for "no evidence" and the suite caught it** — a bare-builder inline run answering from the model's own knowledge also reaches that boundary with no steps, and it genuinely WAS verified; gating on the explicit replay signal has no collateral. Pinned by `cache-hit-receipt-honesty.test.ts` (with a control that the second run really is a replay and the first really ran — without it the cell passes on two ordinary runs); all four cells red-on-cut, both halves. **CONFIRMED LIVE** (ollama `qwen3:14b`, kernel path): real run `tool-grounded / 0.9 / verifier=pass / replayed=false`, artifact on disk, 11 ledger entries; replay `partially-grounded / 0.6 / verifier ABSENT / replayed=true`, 0 steps, 0 llmCalls. The declared-deliverable cap makes the live replay rank strictly BELOW the grounded run (0.6 < 0.9) rather than above it. | Original note: | Surfaced by Check 7, which flagged `cache-check.ts` as a site that stores a `reasoningResult` without absorbing a ledger. It is correctly exempt (no kernel pass runs on a cache hit, so there is nothing to absorb) but the underlying fact is worth naming: a cache hit synthesises `{ output: cached, steps: [], stepsCount: 0 }`, so the run has no ledger, no steps and no tool-call evidence — the trust receipt for a cache hit is derived from nothing. Related to the 2026-07-22 finding that cost tracking's semantic cache served a pause sentinel back as an answer ([[../../.claude/memory|project_hitl_gate_strategy_bypass_2026_07_22]]): the cache stores and replays an OUTPUT while dropping everything that justified it. Fix direction: cache the run's evidence alongside its answer, or mark cache-hit receipts as unverified rather than letting them read as clean. |
| ~~Kernel PARALLEL-batch members bypass the tool-POLICY gate~~ **CLOSED (2026-07-26, `02c17f15`)** | In `act.ts` the per-call loop ran `evaluateToolPolicy` on the batch LEADER only; followers `continue`d past it (`batchFollowers.has`) and were re-collected in the `plannedBatch` branch, which guard-checked and block-approval-checked every member but never policy-checked them. So a forbidden/non-allowlisted tool riding as a non-leader member of a `nextMovesPlanning` batch executed uninspected, gated only by human approval if one happened to cover it. Parallel batching is opt-in, which narrowed exposure, but the hole was real and was confirmed live in the then-current code by a test written BEFORE any implementation change. **Fixed** by running `evaluateToolPolicy` on every batch member with the identical predicate the leader path uses (`allowedTools` + `forbiddenTools(state.meta.runContract)`), placed to mirror the block-approval gate already in that loop — same reasoning in both cases: the loop bypasses the canonical primitive, so the gate must fire there too. Pinned by `packages/reasoning/tests/kernel/act/batch-tool-policy.test.ts` (blocked case + an allowed-both control proving the gate does not over-block). **Independently re-verified 2026-07-26** rather than taken on the commit message: mutation-tested here, and cutting the follower check reddens exactly the blocked-member cell and not the control. |
| ~~`scripts/check-cross-cutting.sh` was still evadable after I2~~ **CLOSED (review I4, 2026-07-23)** | was FALSE (hardened gate still promised more than it caught) | A second, adversarial review got TWELVE violations past the I2 hardening. Root cause of five of them: checks 1–3 matched LINE BY LINE, so the repo's own `.prettierrc.json` (`printWidth: 80`, `singleQuote: true`) was itself the evasion — a Prettier-wrapped `extends Pick<KernelInput, …>`, a wrapped `interface X`⏎`  extends Bundle {`, a wrapped `Pick<` in a `type` alias, `const n: KernelInput =`⏎`  { … }` and `} as`⏎`  KernelInput;` all passed. **Now:** checks 1–3 run against the whole comment-stripped, string-blanked file with `\s` free to cross newlines (offsets mapped back to real `file:line`), so formatting is not semantically significant. Also closed: check 1 catches a field sharing the brace line (`interface X { readonly approvalPolicy?: … }`, invisible to the `^\s*field` anchor — the prior wave's own demo file contained one and it was never reported), single-quoted `Pick`, and ANY `Omit<KernelInput, …>` (which re-declares every field it does not name); rule (b) widened to all of `packages/reasoning/src` while rules (a)/(c) stay in `strategies/` where `interface … extends` is a sound over-approximation. Check 2 resolves per-file import ALIASES (`import type { KernelInput as KI }` + `as KI`). Check 3 matches `Context.make`/`Context.add`, `Layer.sync`/`Layer.effect`/`Layer.scoped`, and a `)` inside argument 1 of `provideService`. **Check 4 was the consequential one (I3 regression re-entry):** rule (b)'s window was `n-6 … n+95`, so an envelope-less `execute({…})` injected UPSTREAM of the existing `envelope:` in the REAL `reasoning-harness-hooks.ts` reported `OK (4/4)` — any new continuation pass added within ~95 lines above an existing one would ship with `.withApprovalPolicy()`/`.withFabricationGuard()`/`.withContract()` disarmed and CI green; it is now scoped to the enclosing call expression by brace matching, and rule (a) keys on the imported TYPE (`ReasoningServiceLike`/`ReasoningService`) rather than on `[Rr]easoning…\.execute\(`, so binding the service to a neutral identifier or destructuring `execute` no longer hides the file. Every one of the twelve was written as a probe, confirmed passing the old script, then confirmed failing the new one with a useful message; all canonical forms re-verified as still firing; a prose/string false-positive probe re-verified clean. |


## 3b. Absorbed open work (from the superseded 07-10 programs — absorb-or-defer pass, 2026-07-19)

Every item below was open in the root-cause closure or goal-reliability programs and had NO row here.
That silence violated this register's own exhaustiveness clause; corrected now. Wave = burndown wave.

| Item | Source | Wave | Status |
|---|---|---|---|
| **Bench P2**: 7 llm-judge tasks → deterministic graded (suite sd 0.50 → ≤0.30) + immediate re-baseline | root-cause #11 | **Wave 5 ENTRY GATE** | ◐ CONVERSION DONE Wave 5 (2026-07-20); **re-baseline RUN still owed.** "7" was stale — only **2** remained (rw-1..rw-9 converted in the 2026-07-11 wave). `rw-5` → deterministic partial-credit `verifiable` (7 structural checks, format-pinned prompt, `hiddenFixtures`; GOOD 1.0 / placeholder 0.14). `rw-10` (behavioural scope-discipline) → **stays llm-judge by design** (a deterministic marker check would be gameable + invalid — the repo's own philosophy keeps fabrication/behaviour judgment in the judge), rubric binary→**graded** (0.25/behaviour) to pull its mean off the p=0.5 peak. `type:"llm-judge"` fields: 7→1. **sd framing CORRECTED:** the plan's "sd 0.50→0.30" conflates two quantities. The gate's `sd = max cellSpread = √(p̃(1−p̃))` (Agresti-smoothed Bernoulli spread on the metric MEAN, `gate.ts:52`) feeds `runsNeeded` for a 3pp lift (556→147) — it is **not** a pass/fail threshold and is **mean-driven**, so determinism lowers it only by moving graded means off 0.5 (empirical, must NOT be gamed with easy checks), NOT automatically. Determinism's GUARANTEED win is **reproducibility** (identical output→identical score; no judge-model/outage dependency) + graded partial-credit's non-central means. **Owed:** a real re-baseline run (≈147 runs/arm is a multi-hour local-tier/Ollama campaign; frontier credits drained) to record the actual post-conversion suite sd + numbers — a deliberate run, not gamed to a target. Build green; 398 benchmarks tests pass. |
| **Bench P3**: more `horizon:long` tasks (only lh-1 + rw-7 exist) | root-cause #12 | Wave 5 entry gate | OPEN |
| **#39 per-entity requirements** (gate tracks tool NAMES; `orders.json` read satisfied a `rates.json` requirement; dead `cardinality:"per-entity"`) | root-cause T1.2 | Wave 2 (rode B7) | ◐ PARTIAL Wave 2 B7 — entity-carrying conditions (ArtifactProduced by path) now correctly entity-keyed via `assess()`; false-positive killed. Generic per-entity tool-coverage (`cardinality:"per-entity"`) still OPEN — needs a new condition type + tool cardinality metadata. |
| **#44 kernel→engine signal unification** (`ctx.toolResults`/`lastResponse` empty on kernel path; memory extraction erratically reachable) | root-cause T1.3 | Wave 2 (sibling of B4 — same projection disease, engine side) | ✅ RESOLVED Wave 2 (2026-07-20) — the "empty" claim was STALE: `reasoning-think.ts:402` sets `lastResponse`, `reasoning-post-think.ts:178` bridges `ctx.toolResults` from the kernel's action steps (order: think→post-think→memory-flush). Residual FALSE-signal fixed: the synthetic `result` carried the `toolName(args)` CALL text, not the paired `observation` (tool RESULT) — now sources observation content so `memory-flush.ts:184` extraction sees the kernel path's real tool results. Mutation tests red-on-cut (`kernel-path-tool-results.test.ts`). Reachability was already deterministic (multi-tool gate); the memory-flush gate itself (`substantialResponse ‖ ≥2 tools`) is deliberate cost policy — left as-is. |
| **#38 thought-continuity ablation** (flag shipped, never measured; prereq: Ollama provider discards `thinking` ⇒ inert on local tier) | root-cause T1.1 | Wave 5 (needs the fixed instrument) | **INSTRUMENT UNBLOCKED 2026-07-26 — the flag is LIVE and now deterministically observable; the lift measurement itself is still OPEN.** "Needs the fixed instrument" was literally true and the missing piece was smaller than expected: the deterministic provider could not express a turn carrying BOTH assistant text and a tool call — the dominant real-model shape (Anthropic emits a text block then a tool_use block). `RA_THOUGHT_CONTINUITY` renders the recorded thought on replayed assistant turns, so with no text on a tool turn there was nothing to replay and the flag read as INERT no matter what it did. A census built on trace event kinds duly reported it dead. Fixed by allowing optional `text` on the `toolCall`/`toolCalls` variants (`llm-provider/src/testing.ts`); a turn without text streams byte-identically, so every existing scenario is unchanged. With a thought present the flag moves the prompt immediately. Pinned in `packages/runtime/tests/mechanism-liveness.test.ts`, red-on-cut verified. **Still owed:** the actual ablation (does replaying the model's own reasoning help, at what token cost, on ≥2 tiers) — a lift-rule question needing live arms. **The Ollama `thinking`-discard prereq is now CONFIRMED live, not just asserted (2026-07-27):** two arms on `qwen3:14b`, n=3 each, flag off vs on, produced byte-identical prompts (`promptChars` 14106 in both) with identical tool counts and iteration counts. The flag is genuinely INERT on the local tier because there is no recorded thought to replay — so any local-tier ablation of this mechanism is VOID by construction, not merely underpowered. A valid measurement needs a tier whose reasoning survives into the step record. |
| **M6 contract-driven terminal gate** missing on blueprint/code-action/inline | matrix sweep | **DEFERRED by design** — receipt recompiles the contract strategy-agnostically at the boundary (`builder/helpers.ts:182`), so the receipt stays truthful; only in-loop steering is absent. Revisit if Wave 5 bench shows those paths stopping short. | DEFERRED |
| **#36 adaptive-ablation re-cut** (Phase-6 exit gate unmet; verdict INCONCLUSIVE n=1) | root-cause #13 | Wave 5 | OPEN |
| **Compaction never fires** (threshold ≈ whole window; failed tool results pinned) | root-cause T3.9 | Wave 3 (wire-or-delete) | ✅ RESOLVED Wave 3 (2026-07-20) — **DELETE branch taken.** The register's premise (`recencyBudgetChars` governs the compaction threshold) was a DOC LIE: `compactHistoryStage` fires at `window×4` chars (full-window safety valve) and never referenced `recencyBudgetChars`; the field's REAL live role is the generous per-result cap for the LATEST tool result (`project-results.ts:108`, pinned by `capability.test.ts`/`project-results.test.ts`). Corrected the `capability.ts` docstring to the true role + documented the full-window safety-valve threshold honestly. **Bonus:** deleted `agedBudgetChars` — computed + exposed on `ResolvedCapability`, asserted in one test, ZERO stage/production readers (grep-proven dead). Assembly suite green (136). Proactive earlier compaction (firing <100% window) is a BEHAVIORAL change that can drop recall context → deferred to Wave 5 bench, not forced blind here. |
| **Tool-roster consolidation** (two terminators; three overlapping memory tools; superseded-yet-exported tools) | root-cause T3.10 | Wave 3 | ◐ MOSTLY RESOLVED Wave 3 (2026-07-20). **Verified against the live registration truth** (`tool-capabilities.ts` registers recall/writeResultToFile/**find**/checkpoint/discover-tools/brief/pulse/todo; `metaToolDefinitions` is doc-only). Several claims were STALE. **DELETED 2 dead unregistered-yet-exported tools:** `task-complete` (vestigial 2nd terminator — `final-answer` is sole termination authority via `act.ts`; task-complete had no live handler, referenced only by tests) removed entirely + off `metaToolDefinitions`; `rag-search` (superseded by the unified `find`, whose handler already takes `ragStore: ragMemoryStore`) — its `ragSearchTool`+`makeRagSearchHandler` exports removed (kept the LIVE `makeInMemorySearchCallback`+types that `find.ts` imports). Fixed 6 stale runtime docstrings + the model-facing rag-ingest description that still named "rag-search" → `find`. CHANGELOG v0.14 Removed entry added; build 20/20, 931 tool+runtime tests green. **Corrected register errors:** "three overlapping memory tools" was already TWO — `scratchpad` tool was removed earlier and its store ref repurposed to back `recall`; rag-search *feature* (`.withDocuments()`/`ingest()`) is LIVE via `find`, only the tool name was dead. **Still OPEN (not delete-wave):** `file-write` append/patch + `file-read` ranged-read are feature ADDs → Wave 5/backlog; `crypto-price`/`gws-cli` niche-in-core = a packaging/relocation product call, not debt. |
| **runtime pkg 67 `as any`** (runtime.ts 12, telemetry-emit.ts 7, execution-engine.ts 6) | 07-12 audit §3.6 | Wave 2 (rode B3) | ✅ RESOLVED Wave 2 B3 (2026-07-20) — real code casts **63→2**; the priority trio (runtime.ts 12, telemetry-emit.ts 7, execution-engine.ts 6) all →0; 2 justified holdouts (dynamic-import Tag resolve; cross-package SessionStore message shape). No new `as unknown as` (cast ceiling untouched at 42). |
| **check-control-plane GRANDFATHERED list** (4 forcing sites, never shrunk) | root-cause T2.7 | Wave 3 (one site per PR, ratcheted) | ◐ PARTIAL Wave 3 (2026-07-20) — **"4 sites" was a miscount of 2.** Two entries (`strategy-switch.ts`, `force-abstention.ts`) were never migration targets: they DEFINE the primitives the resolver drives (the regex `applyStrategySwitch\(` matched `export function applyStrategySwitch(`). Refined the guard to match CALLS not definitions (new `$DEFINITIONS` exclude) and dropped both definition files from GRANDFATHERED (**4→2**). This also HARDENS the guard: a stray forcing CALL added inside a definition file is now caught, where the blanket file-grandfather would have missed it. **2 remaining sites — but routing them is CEREMONY, NOT a real harden (analysis 2026-07-22, WON'T-FORCE):** `runner.ts:825 decideForcedAbstention` is **POST-loop** — the P5 race the resolver exists to reconcile (abstention vs strategy-switch firing in the SAME iteration) **cannot occur after the loop ends**, so wrapping it in a single-proposal `resolveControlPlane([abstain])` returns the same action with added indirection. `iterate-pass.ts:934/1480 applyStrategySwitch` **actuates an already-decided** `dispatcher-strategy-switch`, and the strategy-switch SEAM already calls `resolveControlPlane` (`:1060/:1210/:1453`, with `inLoopAbstentionProposal` ranking abstain above switch — the real reconciliation is already there). Forcing these two through the resolver purely to shrink the grandfathered count = **metric-gaming** (violates the no-metric-gaming doctrine). Guard stays at 2 grandfathered CALLS (honest); the guard still catches any NEW forcing site. Revisit only if a real post-loop/actuation race is ever observed. |
| **Probe-fleet residue**: success+empty-output edge, ToT trivial-task cost floor, reflexion empty-generate budget collision, output⊆observations grounding depth | probe debriefs | Wave 5 (fleet is part of the instrument) | ◐ **success+empty-output edge RESOLVED (verified 2026-07-22):** the `status:"completed" ⟹ output.length>0` invariant is enforced at the SHARED boundary — `sense/step-utils.ts:84` forces empty→`status:"failed"` (HS-106/M7), all 8 strategies route through it, pinned red-on-cut by 4 cases in `build-strategy-result.test.ts`. Register over-count (Nth instance — VERIFY every row vs code). Remaining 3 edges unverified; likely also stale — check each against code before treating as debt. |

---

**Eval-arena honesty chain (2026-07-22) — 3 defects, one probe.** `ab-trap-5` × qwen3.5:latest
(deterministic scorer, zero API tokens) measured `abstentionAccuracy: 0`, `fabricationUnderTrapRate: 1`.
Root-caused + fixed, each red-on-cut:
1. **`d64e51aa` grounding was tool-agnostic.** "Any non-pseudo tool succeeded" counted as grounded, so a
   successful `list-directory` grounded a run whose required `file-read` failed 3×. That falsified
   `secondUngroundedTerminal` AND satisfied `hasDeliverable` — the FIRST short-circuit in
   `decideForcedAbstention`. Forced abstention could never fire on the shape it exists for.
   Fix: `hasSuccessfulRequiredToolCall` — grounding measured against DECLARED required tools.
2. **`fe1ef444` abstention rendered as success.** Both abstention sentinels
   (`no_substantive_output`, `model-abstained`) fell through `deliverableToContent`'s `default` to
   **"Task complete."** — an honest decline surfaced as a success claim, and a test PINNED it.
3. **`e6d25f13` the instrument mislabelled the fix.** `analyzeRun`'s honesty keystone had no concept of
   abstention: `status=done` + no substantive tool ⇒ `dishonest-success-suspected`. It reported the
   harness's most honest outcome as its most dishonest — corrupting cohort honesty guards, weakness-queue
   and `trustVerdict`.

Verified: abstentionAccuracy 0 → 0.5, fabrication 1 → 0.5, abstained runs now `trust=honest-failure` with
honest output text. n=3 ⇒ **MECHANISM confirmation (deterministic barrier removed), NOT a lift claim.**

New rows (open):
| Item | Verdict | Note |
|---|---|---|
| `RunCompletedEvent` carries no `terminatedBy`/`abstention` | ORPHAN (projection gap) | Terminal reason observable only via the last `kernel-state-snapshot`; `analyzeRun` had to source it there. Any consumer reading the completion event alone cannot see an abstention. |
| `honest-uncertainty` dimension needs a live judge | INERT without judge-server | Scores 0 and reports "Judge unreachable — score not measured"; a 0 here is NOT a measurement. Bench summary shows it as 0% regardless. |
| `long-horizon-arm` `ablation: []` on single-task runs | — | `harnessLift` not computed, so no lift verdict is available from that shape; the arm's token delta is not a lift signal. |

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
| Orphan builder fields ✅ **DELETED Wave 3 (2026-07-20)** | — | `_memoryExplicitlyDisabled` + `_enableEvents` DELETED (grep-proven dead); `fallbackConfig.models` already gone (Wave 1 P0-3). **`withCacheTimeout()` / `config.cacheTimeoutMs` REMOVED** — confirmed no-op orphan (threaded builder→runtime-construction→`runtime.ts:330` but `ToolResultCacheLive()` takes NO args and ignored it; cache always used its default 300s TTL). Removed at 21 sites: framework (builder method+ctor field, `_state`/to-config/runtime-construction/runtime-types/types/agent-config schemas, `builder-methods` registry, `runtime.ts` passthrough, feature-matrix) + 4 framework tests + docs (README, cost-optimization "Semantic Cache 40-60%" **lie section deleted**, builder-api ×3 regen, configuration, COVERAGE) + **the full cortex `cacheTimeout` UI→API→service control** (was a user-facing knob that did nothing: AgentConfigPanel.svelte control, lab page, chat/runs APIs, 6 services, UI type+default+post-body, parity/drift gates + 4 cortex tests). **Follow-on: cortex `progressCheckpoint` control REMOVED too** — Wave 1 (P0-10) deleted `withProgressCheckpoint()` from the builder + pinned it, but MISSED the cortex consumer (cross-package sole-caller-grep gap): `build-cortex-agent.ts` still called `b.withProgressCheckpoint(...)`, a runtime `is not a function` landmine whenever a run set it >0. Removed the same full-stack cortex surface (UI input + `ckpt/N` badge, chat/runs APIs, 6 services, parity/drift gates + 3 tests). Cortex `tsc --noEmit` now 0 errors (was 1); 323 cortex tests green. |

**Unintegrated but real** (wire or demote, don't delete): `packages/interaction` (1,379), `packages/identity` (741).

---

## 5. Latent correctness bugs (new, not previously known) — **owned by burndown Wave 2** (ride B2/B4)

1. ✅ RESOLVED Wave 2 B2 — **`adaptive` fallback discards the failed sub-strategy's steps** (`adaptive.ts:290-305`). If plan-execute wrote 2 of 3 files then returned partial, those real writes **vanish from the ledger** and the receipt reports produced deliverables as missing. *Fix: fallback merges the prior sub-strategy's steps (`allSteps = [...steps, ...priorSubSteps, ...finalSubResult.steps]`, double-count-guarded); mutation test asserts the step survives.*
2. ✅ RESOLVED Wave 2 B2 — **`direct` drops honesty markers entirely** (`direct.ts:194`) — no `extraMetadata`, hardcodes `totalCost: 0`, can report `completed` on an unverified ship. *Fix: forwards real cost/tokens + `honestPartialMetadata` + `terminatedBy`/`abstention`/`error`.*
3. ✅ RESOLVED Wave 2 B4 (2026-07-20) — **Two verifiers, one receipt field, no linkage.** `runner.ts`'s comment claiming the kernel verdict lands on `receipt.verifierVerdict` was **false**; the receipt's verdict is authored by the result-boundary verifier (`runtime/engine/finalize/result-verification.ts`), which runs on EVERY path BY DESIGN. Disposition = option (b): the boundary verifier owns the receipt; the in-kernel verifier owns control flow (status/error) + the honesty markers that cross via the `CompletionEnvelope` (`verificationWarning`, `harnessAuthoredOutput`). Deleted the false comment + the dead write-only `meta.verifierVerdict`/`verifierRejected`/`verifierEscalation` writes and declarations. `result-boundary-verification.test.ts` pins boundary-owns-receipt (works on strategy paths with no in-kernel verifier); `b4-envelope-boundary.test.ts` pins in-kernel honesty crossing via the envelope.

### D-2026-07-28-A — every pre-`2f97ca1e` token figure is unverified

**Class:** instrument fault, already fixed; the DEBT is the contaminated record.

Anthropic `usage.input_tokens` counts only the uncached remainder. Both provider
paths reported it as `inputTokens`/`totalTokens` while computing `estimatedCost`
off the correct total, so cost was right and tokens were wrong, and the error
scaled with cache effectiveness.

**Blast radius:** every token-overhead comparison in `wiki/Research/`, the
555–640% figure in 09 §7 (retracted 2026-07-28), and any arm-vs-arm token delta
where the arms cached differently. Cost figures are unaffected.

**Discharge:** the corrected composite re-baseline (gap-closure plan Phase 3).
Until then, no document may cite a pre-`2f97ca1e` token overhead.

**Gate:** `packages/llm-provider/tests/cached-input-tokens-are-counted.test.ts`
(4 cells, red-on-cut) prevents recurrence.

### D-2026-07-28-B — the request prefix churns, so the cache never hits

See [[../Failure-Modes/RUNNING-CATALOGUE#F10]]. Per-iteration mutation of the
`tools` array sits at position zero of Anthropic's cache prefix and invalidates
all three `cache_control` breakpoints every turn; the system prompt compounds it
by carrying the standing frame and `Remaining steps:` inside the cached block.

**Measured:** cacheRead=0 on the default kernel path; the non-pruning arm costs
17% LESS money despite 1.7× the tokens.

**Discharge:** gap-closure plan Phase 2, promoted to default only if it clears
the §6 lift rule on rungs 2 and 3 of the ladder.

**Gate:** `scripts/check-volatile-placement.sh` (Task 10).

### D-2026-07-28-C — `goal_state` is write-only in production

**Class:** dead-signal defect, same family as the H1 composed-but-never-rendered
regression already fixed once in this codebase.

`packages/reasoning/src/assembly/stages/system-prompt.ts:55` reads
`c.log.byKind("goal_state").at(-1)?.remaining`. The sole live adapter that
builds a real run's `AssemblyInput.log` — `assembly/from-kernel-state.ts`,
consumed by both the reactive kernel and every plan-execute sub-kernel — never
appends a `goal_state` event. Confirmed by exhaustive grep: the only four
occurrences of the literal string in `packages/` are the type definition, the
read site above, and two hand-authored unit-test fixtures
(`system-prompt.test.ts`, `volatile-placement.test.ts`) that construct
`AssemblyInput` directly rather than going through a live kernel run.

**Consequence:** the `Remaining steps:` line has likely never fired on a real
run. F10's cache-churn analysis is unaffected for the standing-frame/
`priorContext` volatility (confirmed live, via the H1 strategy-switch handoff
path) — only the `goal_state` half of that analysis is unverified in practice.

**Found while adding** `packages/benchmarks/golden/planned-tool-loop.jsonl`
(gap-closure plan Task 5) — a golden built specifically to exercise
`goal_state` recorded zero occurrences of it despite forcing a full
`plan-execute-reflect` decomposition.

**Discharge:** wire `goal_state` through `step-executor.ts` → kernel state →
`from-kernel-state.ts`, or delete the dead read path if it is truly
unreachable. Separate task — out of scope for the gap-closure plan, which does
not touch kernel state population.

### D-2026-07-28-D — plan-execute replay-lane `argsHash` divergence

**Class:** latent correctness bug in the replay/observability boundary, not in
the kernel itself.

`step-executor.ts`'s `ledgerSteps` action-step stores PRE-heal (relative) tool
args in `metadata.toolCall.arguments` — the plan's declared intent, by design;
only `isArtifactProduced` reconciles relative-vs-absolute at match time. The
observability trace records POST-heal (absolute) paths for the same call.
`packages/benchmarks/src/replay-agent.ts`'s `toolCallsFromResult` hashes the
pre-heal args with no reconciliation, so a plan-execute golden with
path-taking tools diverges from its own trace on every tool call.
`reactive`-strategy goldens never hit this — the ReAct kernel's action-step
construction has no pre/post-heal asymmetry.

**Measured:** `planned-tool-loop` (3 tool calls, all path-taking) diverges on
all 3 — confirmed via `bun test packages/benchmarks/tests/replay-lane.test.ts`,
`tool-sequence divergence` on `file-write`/`file-read`/`file-write`.

**Current handling:** skipped, not fixed, in
`packages/benchmarks/tests/replay-lane.test.ts` (`KNOWN_ARGS_HASH_DIVERGENCE`),
so the corpus stays green without silently losing this golden's other
coverage (recorder determinism, sidecar shape) or misrepresenting the gap as
resolved.

**Discharge:** reconcile in `replay-agent.ts` (or store post-heal args in
`step-executor.ts`) — separate task, requires its own review since it touches
the replay/observability boundary rather than the assembly pipeline this plan
is scoped to.

### D-2026-07-29-E — root cause unconfirmed: real agent showed empty tool surface the isolated heuristic doesn't predict

**Class:** unconfirmed — filed with evidence rather than guessed at, per this
project's standing rule against publishing findings that weren't checked
against a real run.

Live run (`scratch.ts`, ollama/gemma4:e4b, task never literally names a tool)
showed `tool-surface-resolved.visible = [recall, discover-tools]` only — no
domain tool visible on iteration 0, discovered via the new
`tool-surface-reporter.ts` console line (`75feee6a`). Working hypothesis
going in: `filterToolsByRelevance`'s literal/near-literal keyword heuristic
(`packages/reasoning/src/kernel/capabilities/attend/tool-formatting.ts`) is
too weak for natural-language task phrasing, and — post-TE-1 (`0f4476ab`,
classifier no longer default-on) — this heuristic is now the ONLY thing that
can populate the lazy-disclosure allow-set for an unclassified run, so its
weakness has real teeth it didn't have before.

**That hypothesis did NOT survive a direct check.** Probed
`filterToolsByRelevance` in isolation with the exact task text and realistic
full-description schemas for `file-write`/`file-read`/`web-search`/`gh-cli`
(in-repo probe, `bun packages/reasoning/tmp-probe/heuristic-probe.ts`,
deleted after use): all 4 came back `primary`. The word-matching itself is
NOT obviously broken on this input.

**What's left unexplained:** why the live run's visible set was empty
despite the heuristic (in isolation) matching. Candidate causes, none
confirmed: (a) local-tier's compact `toolSchemaDetail` profile
("names-and-types") stripping tool `description` before the heuristic sees
the schemas, rather than only after tool-surface resolution as think.ts's
comments claim; (b) `lazyMode` or `hasClassification` resolving unexpectedly
for this run, short-circuiting the heuristic branch in
`computePromptSchemas` (tool-surface.ts:118) entirely; (c) `taskText` not
actually reaching `resolveToolSurface` with the full string in this code
path despite `think.ts:358` passing `input.task` directly.

**Discharge:** instrument `computePromptSchemas` (or re-run scratch.ts with
`RA_VERBOSE_RULES=1` / a temporary in-repo probe, never `/tmp`) to capture
the REAL `effectiveSchemas` descriptions, `lazyMode`, and `hasClassification`
values on this exact run, before attempting a fix. Do not patch the
heuristic's word-matching based on the isolated-probe result above — it
already showed that surface isn't where the gap is.

---

### D-2026-07-30-F — `renderValue("bullets")` explodes nested user-objects into ~20 URL noise fields — ✅ RESOLVED (compact preview, 2026-07-30)

**✅ RESOLVED 2026-07-30:** added `renderValue(value, format, { compact })` +
`NOISE_KEY` (render-result.ts). `ResultStore.preview` now renders `compact:true`
(drops `*_url`/`node_id`/`gravatar_id`/`avatar` — never selection criteria, full
data recoverable by `result_ref`); `materialize` (the file deliverable) stays
byte-complete. Measured 30,266→6,345 chars (79% saved) on the 25-commit
user-object shape, message/author.login/sha all retained. Red-on-cut tests:
render-result.test.ts (compact vs full) + result-store.test.ts (preview compact,
materialize complete). Tools 985/0, reasoning 0 fail. **Possible future
refinement (not done):** recursive nested-salient extraction
(`author={login,…}`→`author=login`) would beat the keyword-class drop, but the
non-fragile URL-class drop banks the bulk of the win safely.

**Class:** confirmed correctness/waste — measured against workspace src (NOT
the `~/.bun/install/cache` published v0.14.0; see the probe-resolution note
in D-2026-07-30-J).

The active tool-result renderer (`packages/tools/src/skills/render-result.ts`,
used live via `assembly/ResultStore.preview`/`materialize`) leads each record
with its salient field (`9e36b78d`) but `compactObject` then appends EVERY
other flattened scalar. For a GitHub commit whose `author`/`committer` is the
full REST user object, that is ~20 navigation-URL fields per record
(`author.avatar_url`, `.events_url`, `.followers_url`, …). **Measured: a
25-commit `--jq '{sha, message, author: .author}'` result renders to 30,266
chars vs 2,043 for message-only — ~93% is data the model never needs to
reason about (it acts on the full data by `result_ref`).** Pure token waste on
every tier; on overflow it also buries the salient fields the model DOES need.

**Verdict:** SILENT — works (no crash) but wastes context every structured-API
call with nested objects.

**Do NOT bandaid with a `*_url` keyword blocklist** (measured only 51%
reduction, and it's fragile — hides fields a task may need). Principled fix:
a nested object field should render its OWN salient identity
(`author={login,…20 fields}` → `author=HarperZ9`) via recursive `findSalient`,
not a full flatten. Design tension to resolve first: `renderValue` is shared
by `ResultStore.preview` (lean is fine — full data is recoverable by ref) AND
`materialize` (the actual `write-result-to-file` deliverable — must not lose
columns the user asked for). Likely a preview-only compact mode.

**Discharge:** before/after token measurement on ≥2 shapes (nested-user-object
+ nested `commit.author`) AND a live gemma4 run confirming the model still gets
author identity; red-on-cut render-result test.

### D-2026-07-30-G — `applyAgeAwareCuration` is dead code (zero callers, "DEFAULT-ON" comment lies) — ✅ RESOLVED (deleted 2026-07-30)

**✅ RESOLVED 2026-07-30:** deleted `applyAgeAwareCuration` + `curationAgeAware`
+ `recentCharBudget`/`agedCharBudget` + the fraction/floor consts
(tool-formatting.ts) and `age-aware-curation.test.ts`. Confirmed zero
production callers + not exported before deleting. Reasoning suite 2582/0.

**Class:** ORPHAN / FALSE.

`applyAgeAwareCuration` + `curationAgeAware` +
`recentCharBudget`/`agedCharBudget` (`kernel/capabilities/attend/tool-formatting.ts`
~L549–700) carry an extensive "DEFAULT-ON (opt-out via RA_CURATION_AGEAWARE=0)…
the kernel calls applyAgeAwareCuration whenever curationAgeAware() is true"
doctrine. **Grep: zero non-test callers repo-wide.** The live tool-result
compression path is `assembly/ResultStore` via `think.ts:201`
`fromKernelState`→`project()` (unconditional). The legacy
`compressToolResult` still runs at `tool-execution.ts:623` but only to POPULATE
the scratchpad (full value → ResultStore); its `[STORED:]` preview text is a
fallback used only when a result has no `storedKey` — superseded for anything
large. `conversation-assembly.ts`'s `TOOL_RESULT_INLINE_CAP` choice is
re-materialized away by `fromKernelState`.

**Impact on recent fixes:** `e204ab49` (compressToolResult NDJSON +
conversation-assembly) patched these superseded/dead paths — its
"live-verified end to end" claim is not credible for the mechanism described.
`9e36b78d` (render-result bullets) DOES reach the live path but is incomplete
(see D-2026-07-30-F).

**Discharge:** DELETE `applyAgeAwareCuration` + `curationAgeAware` + the two
budget helpers + their tests (§4 dead-code move), OR wire it and prove lift —
but ResultStore already owns this seam, so deletion is the honest move.

### D-2026-07-30-H — tuning inversion: `mid` old-result preserve budget (1200) < `local` (4000)

**Class:** tuning smell — NOT a bug. Filed to prevent a wrong-layer spot-fix.

**First read (WRONG, corrected here):** "profile tier resolves `mid` while the
Ollama probe says `local` — a divergence like the window bug." **Checked:** it
is NOT a divergence. `resolveProfile` DELIBERATELY maps capable local models
(8B+: gemma4, cogito:14b, qwen3.5:27b → `mid`; only small ones like
llama3.2:3b → `local`), and the probe's `tier` field is explicitly
"informational" (local-probe.ts `tierFromParameterSize` comment). The budget
correctly uses the PROFILE tier. So `mid` for gemma4 is intended — do NOT
"fix" the tier to `local`.

**The actual (minor) smell:** `CONTEXT_PROFILES` sets `local.toolResultMaxChars
= 4000` (bumped 2026-05-28 for filter tasks) but `mid = 1200` (legacy). So a
CAPABLE model (mid) preserves LESS of an OLD tool result than a TINY model
(local, 4000), despite equal/larger windows — an inverted budget. Whether 1200
causes real harm (extra recall/re-fetch churn when the model needs an older
result) is UNMEASURED.

**Discharge:** owner-gated tuning. Do NOT change budgets speculatively — first
produce evidence (a multi-iteration task where an old result's compression to
1200 forces a recall the 4000 budget would have avoided), then run a cross-tier
ablation on the `mid` preserve value. Absent that evidence this stays a note,
not a fix.

### D-2026-07-30-I — `predictNumCtx` + `BUCKETS` designed but never wired (demand-driven num_ctx)

**Class:** ORPHAN.

`ResolvedCapability.predictNumCtx(assembledPromptTokens)` +
`BUCKETS = [8192…131072]` (`assembly/capability.ts`) implement demand-driven
context bucketing (allocate the next bucket ≥ actual assembled size). **Grep:
zero callers.** The wire `num_ctx` (`local.ts resolveOllamaNumCtx`) is instead
a FIXED per-model value (`capability.recommendedNumCtx`), so small prompts
over-allocate KV cache and there's no automatic growth for big results within
the model's max. Wiring this would cut local wall-clock/VRAM on small turns and
lift the ceiling on big ones — but it's a behavioral change needing a
cross-tier ablation, not a silent flip.

**Discharge:** owner-gated; wire `predictNumCtx` → `resolveOllamaNumCtx` with a
before/after VRAM+latency measurement, or delete the dead machinery.

### D-2026-07-30-J — out-of-repo probe scripts resolve the published `~/.bun` cache, not workspace src

**Class:** methodology hazard (reinforces the standing bun-cache trap).

During this session a measurement script under the scratchpad imported
`@reactive-agents/tools` and silently resolved
`~/.bun/install/cache/@reactive-agents/tools@0.14.0/dist/index.js` (the
PUBLISHED build), not workspace `packages/tools/src` — so it measured stale
code and manufactured a false "parseNdjson fails" result. `require.resolve`
returned the cache path both in AND out of repo, yet the LIVE `bun run
scratch.ts` used workspace src (proven: the just-added R4 `[ctx]` console
line, which exists ONLY in workspace, appeared in the live run). **Rule:
diagnostic probes must import workspace src by relative path
(`.../packages/tools/src/skills/render-result.ts`), never the package name,
and never run from outside the repo.** Not code debt — a pin for future
diagnosis so a probe never lies again.

### D-2026-07-30-K — `emitCuratorDecision` + `emitGuardFired` + `llm-exchange` observability gaps — ✅ RESOLVED (harness-improvement hunt)

**✅ RESOLVED 2026-07-30** via the harness-improvement loop (real bench runs,
qwen3:4b/cogito:8b/haiku × rw-2, trace-driven).
- **`emitCuratorDecision` had 0 callers** despite a full consumer chain (event →
  execution-engine rationaleLog → normalize → diagnose debrief → blindspot
  detector). Wired at the projection boundary (`think.ts`); budget-inversion
  evidence (the 838935cb class) now reaches the debrief. `a8bdc606`.
- **normalize.ts dropped the projection event's window/tier/compressions** — R4
  (`c6572c8c`) reached the console but not `rax diagnose replay`. Fixed:
  `events.ts` + `normalize.ts` carry them. `a8bdc606`.
- **analyze.ts blindspot detector lied**: reasons claimed "emitCuratorDecision 0
  callers", "emitGuardFired wired at terminal only" (actually ~9 loop sites),
  "llm-exchange does not fire on live path" (fires — 881 events/trace). Reasons
  rewritten to per-run facts; `emitCuratorDecision` removed from
  KNOWN_DEAD_EMITTERS. `db5cd724`.

### D-2026-07-30-L — open catalog from the 2026-07-30 hunt (not yet fixed)

**Class:** cataloged, lower priority.
- **`emitAlternativesConsidered` is genuinely dead** (0 callers, verified) — the
  counterfactual/alternatives signal is blind. Delete (event + normalize case +
  helper) OR wire at the decision/arbitration site. Clean §4 candidate.
- **Weak-model (qwen3:4b) file-deliverable thrash:** on rw-2, qwen3:4b burned
  16.7K tokens / 69s, called `final-answer` 3× but never `file-write`, and the
  harness assembled a fallback the verifier correctly rejected
  (`terminatedBy=harness_deliverable`). cogito:8b (8K/67%) and haiku (10.5K/83%)
  succeed on the SAME task, so it's model weakness, NOT a harness bug — BUT the
  harness spends the MOST tokens on the run most likely to fail (no early-abort
  for a doomed weak-model trajectory). Possible `budget-guard`/early-terminate
  opportunity; risky (could cut recoverable runs) — needs an ablation, do NOT
  spot-fix. The harness is otherwise clean on capable models (haiku rw-2 = 3
  iterations, 3 tools, 0 harness signals, no waste).

### D-2026-08-07-M — Cascade B last authority: missing-required-tool gate was ledger-blind — ✅ RESOLVED

**Class:** success-authority substrate divergence (Sys-audit 2026-07-29 RC#1 / Cascade B, the substrate-unification half). Move 2 (`49a1c94f`/`7dbb270d`/`92dc591e`) gave authorities #1 (post-condition terminal gate) and #4 (deliverable report → `goalAchieved`) disk ground-truth behind `verifyDelivery`. It did NOT touch authority #3 — the missing-required-tool gate (`runner.ts` §8) that fails the run and NULLS output — which read `missingRequiredToolsForInput` from `state.steps` only (+ one-level `delegatedToolsUsed`), while `isToolCalled` reads the run-scoped RunLedger (deep sub-agent merge, incl. grandchildren). Two authorities, two definitions of "called": a required tool a run delegated 2+ levels deep was CALLED per #1 and MISSING per #3 → false-fail + nulled deliverable.

**Fix (2026-08-07):** threaded `state.ledger` into the requirement-state counters + the run-failing kernel call sites (§8 + `iterate-pass.ts:1561` in-loop redirect + `loop-resolution.ts` nudge); `low_delta_guard`'s site (`iterate-pass.ts:836`) deliberately left steps-blind (inverted polarity, unmeasured). Ledger tool-result successes de-duped against local steps by `toolCallId` (projected from the same `meta.toolCallId`, so no double-count); ledger-omitted ⇒ byte-identical. Reachability source-traced (`transitionState`→`stepToEntries` folds `subAgentLedger` in-loop). Report: `wiki/Research/Harness-Reports/2026-08-07-qa-sweep-findings.md#F6`.

**Verdict:** PROVEN (unit) — 4 red-on-cut tests in `requirement-state.test.ts`, mutating the ledger read reddens 2. **Residual (honest):** no end-to-end kernel-delegation cell — blocked by test-provider scripting limits (the OB-3 "sub-agent merge on the kernel parent path untested" area); a false-negative *rate* drop is owner-gated live-arm work, not claimed.

### D-2026-08-21-N — fabrication-guard "block degrades to warn" doesn't actually restore success — live false-fail on cortex

**Class:** correctness bug (guard enforcement leaves the run mis-terminated after the documented degrade).

Caught via cortex's own run history (`apps/cortex/.cortex/cortex.db`, run `01M0KB5MTA4NJP907V93RHKFGK`, 2026-08-21, `ollama`/`gemma4:e4b`, `reactive` strategy). The run is a genuine success being reported as a failure end-to-end: `terminationReason: "end_turn"` (clean stop), debrief `outcome: "success"` / `confidence: "high"`, `gh-cli` called twice with 100% tool success, and a complete, well-formed markdown report as the answer — yet `cortex_runs.status = "failed"` and `error_message` contains that SAME full report text verbatim (not an error).

Root cause traced through the kernel:
1. Task ("fetch the last 10 commits... summarize... in a nice markdown report") has a small local model synthesize `gh-cli`'s raw output into categorized prose + a markdown table.
2. `verifier.ts` check 4e (`detectFabricatedListedEntities`, `packages/reasoning/src/kernel/capabilities/verify/verifier.ts:640-646`) — part of the always-on fabrication-guard family broadened by the same-day commit `2f8432fa` — flags the bold list items / table rows as unverifiable "invented named entities" against the tool-evidence corpus. A model's reasonable paraphrase/categorization of real tool output is exactly the shape this heuristic risks false-positiving on.
3. In `block` mode this is documented as "suppress + retry, degrades to warn" (`verifier.ts:651` comment) — i.e. after one retry the answer should still ship, just flagged, not fail the run.
4. It doesn't degrade cleanly: `execution-engine.ts:1226` (`rr.status === "failed" ? executionSucceeded = false`) still reads the pre-degrade failed status, and `run-finalize.ts:74` (`!executionSucceeded && result.error ? { error: result.error }`) then ships the full answer text as `error` — so the "degrade" the comment promises isn't actually clearing status/error by the time the result reaches `TaskResult`/`AgentCompleted`.

Only 1 sample so far (cortex's DB had 4 total runs, 1 failed) — not yet cross-tier confirmed, but the mechanism is traced to specific lines, not inferred from the symptom alone. Prime suspects for who else hits this: any local/weaker model doing prose synthesis (summaries, reports, categorized write-ups) from tool output, since check 4e's heuristic is aimed at exactly that shape.

**Discharge:** find the actual "degrades to warn" implementation site referenced by `verifier.ts:651`'s "see runner" and confirm whether it (a) never runs for the 4c/4d/4e fabrication-guard family (only for the opt-in numeric-grounding check 5), or (b) runs but doesn't propagate the restored status back through `execution-engine.ts`'s `rr.status`/`ctx.metadata.lastResponse` read path. Needs a red-on-cut regression test pinning "block mode + fabrication flag + retry + still-flagged → ships as `status: completed` with a warn-level verdict, not `status: failed` with the answer as the error." Owner-gated — kernel retry/degrade state machine, not a one-line fix.

---

## 6. The gates that keep it fixed (no fix is done without one)

| Gate | Kills | Level |
|---|---|---|
| Derive declarations FROM implementations (`type LedgerKind = keyof typeof emitters`; hook union from dispatch table) | ORPHAN class — becomes a **compile error** | types | ✅ **Wave 4 (2026-07-20)** — `LedgerEntryKind = LedgerEntry["kind"]` (`run-ledger.ts`): the kind union now DERIVES from the entry interfaces, so a kind literal no interface declares is a compile error and a new interface's kind joins automatically (removed the `kind` field from `LedgerEntryBase` to keep it non-circular). **Assessed + NOT forced (would be speculative scaffolding):** `TrustReceipt` required fields are already compile-checked by their builder (no separate kind-union to derive; optionals → the CI guard); adapter-hook orphans are NOT reliably grep-guardable (hooks called via `adapter.hook?.({…})` optional-chaining + `typeof` guards + aliases) — the `ProviderAdapter` interface is already the single source of truth and its dead-hook purge (7→5) holds. |
| `scripts/check-orphans.sh` — every declared member needs ≥1 non-test writer + reader; rides the existing auto-globbed CI script lane | residue that can't be typed (env flags, cross-package projections) | CI | ✅ **Wave 4 (2026-07-20)** — ships. Guards the residue types can't: every declared ledger kind must have ≥1 non-test WRITER (a literal `kind: "X"` mint) outside the declaration file — catches a kind interface that exists but nothing appends (an always-empty projection = silent lie). `handoff` is the one ratcheted `ORPHAN_BASELINE` entry (read/render/compaction-protect path is real in `standing-frame.ts` but no writer mints it — the intended cross-strategy handoff is a bench-gated feature-wave change; baseline may only shrink — a baselined kind that gains a writer FAILS the guard). Discovered by the CI shell loop + `enforcement-scripts.test.ts` (readdirSync auto-glob → cannot itself be orphaned). **Red-on-cut proven** by a fixture-based mutation test (`declaration-orphans.test.ts`, 5 cases): green on the real tree, red when a fixture kind loses its writer, red when a baselined kind gains one. Writer-based (a kind minted nowhere is the "always-empty" lie); reader-drift is secondary waste, left to prose. |
| **Builder-seam test lane** — one test per wither asserting the built agent's *behavior* changes | 30 SILENT withers (**highest-leverage test work in the repo**) | test |
| Probe fleet (`f65722f6`) | written-but-meaningless (a seam that always returns null) | behavioral |
| `scripts/check-cross-cutting.sh` — strategy input interfaces re-declaring / `Pick`-ing / `Omit`-ing / `extends`-inheriting an envelope field, a hand-authored `KernelInput` (literal OR `as`/`satisfies`-cast, incl. under an import alias) outside the sanctioned sites, a second `RunEnvelope` provision site, or a reasoning execute request built without an `envelope` | cross-cutting cascade defect class — a run-wide field named by hand at N boundaries silently dropped wherever one is missed | CI | ✅ **Cross-cutting cascade Task 10 (2026-07-23)**, hardened TWICE the same day — first by the whole-branch review (I2), then by an adversarial review **of the gate itself** (I4). Rides the existing auto-globbed CI lane (`scripts/check-*.sh`) + `enforcement-scripts.test.ts` discovery, zero wiring edits needed. 4 checks, all proven red-on-cut, plus a `SCAN-EMPTY` guard so a check whose scan root matches nothing fails instead of passing vacuously. See §3's cross-cutting open-gaps block for exactly which evasions are closed and which residual gaps remain. **Honest scope — updated, do not overstate:** still a SHAPE gate, not a proof of the invariant; a sufficiently novel shape can still slip (an envelope field re-declared under a computed key, a service reached through an untyped `unknown` cast). What changed is the CLASS of thing it is blind to. It no longer keys on formatting — checks 1–3 match whole-file, whitespace-normalized, comment-stripped, string-blanked source, so Prettier wrapping (`printWidth: 80`) and quote style are semantically irrelevant to it, where previously the repo's own formatter output was itself a working evasion of five checks. Check 4 no longer keys on the *spelling of an identifier* (`svc.execute(…)`, destructured `execute(…)`) but on the imported TYPE, and its rule (b) is scoped to the enclosing call expression by brace matching instead of an asymmetric `n-6 … n+95` line window that let a new envelope-less pass borrow a neighbour's `envelope:` line. The compile-enforced terminal mint (`JudgedReasoningResult`) remains the load-bearing guarantee; this gate is the net for what a type cannot express. |

**Definition of done, binding:** declaration + non-test writer + non-test reader + a mutation that goes red.
Prose findings do not discharge debt. Only gates do.

---

*Method: 5 parallel read-only sweeps (withers, strategy×mechanism matrix, declaration orphans, package
liveness, public claims), each verdict re-verified against primary evidence by the main session before
landing here. Two agent claims were rejected on verification (`packages/testing/src/gate/` is wired — CI
runs `gate:check` at `ci.yml:88`; `.withAdaptiveHarness()` has drifted to PROVEN for `plan.strategy`).*
