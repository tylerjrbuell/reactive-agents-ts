---
tags: [debt, canonical, register, release-gate]
date: 2026-07-13
status: CANONICAL — single source of truth for technical debt
supersedes: scattered findings in Audit-Reports-2026-07-{07,08,09,10,11,12}
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

**Headline: half the public API surface (42/86) is unproven.** 9 withers actively lie.

---

## 2. P0 — PUBLIC API LIES (block the release; a user is misled today)

| # | Item | Reality | Evidence | Verdict |
|---|---|---|---|---|
| **P0-1** | **`.withReactiveIntelligence({autonomy, constraints})`** | **SAFETY.** `autonomy:'observe'`, `neverEarlyStop`, `neverHumanEscalate`, `lockedSkills`, `protectedSkills` are ALL no-ops. A user who asks for observe-only gets a fully autonomous controller. | `_riConstraints`/`_riAutonomy` written `wither-applies.ts:75-76`; **zero readers repo-wide** | FALSE |
| **P0-2** | **Calibration is a net REGRESSION** | A model with a calibration file **loses** its 4 live adapter hooks (`continuationHint`, `errorRecovery`, `synthesisPrompt`, `qualityCheck`) and gains 2 dead ones. Calibrating a model strictly weakens the harness. | `adapter.ts:322` early-returns `buildCalibratedAdapter(cal)`, discarding the tier adapter; that adapter sets only `systemPromptPatch`+`toolGuidance`, both zero-call-site | FALSE |
| **P0-3** | **`.withFallbacks()`** | Docs promise "switches after 3 consecutive errors" + cheaper-model fallback on 429. Switches on the **first** error; `errorThreshold` only decorates an event (`runtime.ts:447`); `models[]` has zero readers. All 11 tests are setter asserts. | `runtime.ts:411-470` | FALSE |
| **P0-4** | **Tool policy is suppression, not enforcement** | `forbiddenTools`/`allowedTools` gate exists ONLY in `act.ts:367`. The shared `executeToolAndObserve` choke point has **zero** policy checks ⇒ plan-execute, blueprint, code-action, inline can execute a forbidden tool that arrives via a planned step or hallucinated name. | `tool-observe.ts` — 0 matches for allowedTools/forbidden | FALSE |
| **P0-5** | **Abstention dead on 8 of 9 paths** | Only `reactive` forwards `terminatedBy`+`abstention`. An honest decline on any other strategy ships as an ordinary answer; `receipt.abstained` is permanently false. | `projectAbstention` needs both (`abstention-projection.ts:38`); `execution-engine.ts:1096` defaults `terminatedBy ?? "end_turn"` | FALSE |
| **P0-6** | Provide-and-forget layers | `.withIdentity()`, `.withInteraction()`, `.withOrchestration()` each merge a service layer **nothing resolves**. JSDoc promises agent behavior ("sign messages", "pause for human approval"). `.withOrchestration()` is a literal no-op. | `runtime.ts:823/982/990`; zero consumers | FALSE / ORPHAN |
| **P0-7** | `.withMemoryConsolidation()` | Service built; `consolidate()`/`notifyEntry()` **never invoked** — no scheduler, no fiber. | `runtime.ts:736` | FALSE |
| **P0-8** | `.withVerificationStep()` | Burns a real LLM call per run, writes verdict to `ctx.metadata.verificationFeedback` — **zero readers** (`engine/util.ts:221` allowlist omits it). User pays tokens for nothing. | `reasoning-harness-hooks.ts:191` | FALSE |
| **P0-9** | `.withCalibration("skip")` | Structurally un-passable: rewritten to `"auto"` whenever reasoning is on. The opt-out does not exist. | `runtime-construction.ts:525-530` | FALSE |
| **P0-10** | `.withSkills()` bare / `.withProgressCheckpoint()` | Bare `.withSkills()` = no-op (gates on `paths?.length`; `packages`/`overrides` dropped). `.withProgressCheckpoint()` dead-ends in a config struct; `autoResume` unimplemented. | `runtime-construction.ts:495/502` | FALSE |
| **P0-11** | Docs claim "7-hook adapter system **fully wired**" | 3 of 7 hooks have zero call sites (`taskFraming`, `toolGuidance`, `systemPromptPatch`). Docs even document their call-site timings. | `whats-new.mdx:446`, `llm-providers.md:214-216`, `llm-provider/index.ts:227` | FALSE |
| **P0-12** | Two benches measure PURE NOISE | `RA_RECITE` (dead since `034d28de`) and `RA_ASSEMBLY` (dead since Sprint-1 A2) still gate ablation arms ⇒ both arms byte-identical. Any finding read off them is fabricated. | `benchmarks/src/sessions/recitation-ablation.ts:39`, `sessions/context-stress.ts` | INERT |

---

## 3. The spine — 7 boundaries that produce ~all of the above

The ~200 findings are not 200 bugs. They are **7 boundaries where a value fails to cross**.
Fix the boundary, not the site. (This is the boundary-first rule; every per-site fix in July was
later obsoleted by the boundary fix that eventually arrived.)

| # | Boundary | What dies there | Closes |
|---|---|---|---|
| **B1** | **`executeToolAndObserve`** (`tool-observe.ts`) — hand-rolled strategies route tools here and inherit NOTHING; kernel strategies get everything free from `act.ts` | RunLedger minting + tool-policy gate | C8 + C10 across plan-execute, blueprint, code-action, inline (**2 columns × 4 rows**) |
| **B2** | **Strategy result `extraMetadata`** — only `reactive` forwards `terminatedBy` | Abstention + goalAchieved | **2 columns × 8 rows**, one line per strategy |
| **B3** | **Builder→runtime seam** — every field crosses via `self as unknown as BuilderRuntimeStateView`, a structural cast that will NOT catch a renamed/removed field. Tests assert private fields, not behavior. | 30 SILENT withers | Deleting one line in `runtime-construction.ts` typically leaves the whole suite green |
| **B4** | **Kernel→strategy projection** — `ReActKernelResult.metadata` is a **2-field** projection (`terminatedBy`, `status`) | 19 orphaned `KernelMeta` fields; the in-kernel verifier's verdict is written and dropped at `runner.ts:1425` | CompletionEnvelope was built to fix this and only rescued 5 fields |
| **B5** | **EventBus→public stream projection** (`execute-stream.ts`) | `PhaseStarted`/`PhaseCompleted` have zero stream writers — byte-identical to the tool-events bug fixed in `61f05489`. Advertised in `ui-core` + `apps/docs/features/streaming.md`. | A `density:"full"` consumer waits forever |
| **B6** | **`selectAdapter` early-return** (`adapter.ts:322`) | Calibration discards the tier adapter | P0-2 |
| **B7** | **`requirement` ledger kind: ZERO writers** | Two live readers (`assess.ts:207`, `standing-frame.ts:193`) always see `[]` ⇒ the meta-loop's requirement lifecycle (declared→satisfied→blocked) is **fiction**; Projector renders no outstanding work; `evidenceRefs` double-dead | The load-bearing hole in the architecture Waves A–G shipped |

---

## 4. Dead code — DELETE (deleting is the honest move)

| Item | LOC | Evidence |
|---|---|---|
| `packages/orchestration` | 935 | `OrchestrationService` zero consumers repo-wide; `worker-pool.spawn()` = struct in a Ref, no execution; `WorkflowEngine` needs an `executeStep` injector only tests supply |
| Ledger kinds `checkpoint-marker`, `deliverable-commit`, `contract-amended` (+ `amendContract()`) | — | zero writers AND zero readers |
| 19 orphaned `KernelMeta` fields | — | see B4 |
| `RunContract.acceptance` tiers/stakes, `RequirementSpec.acceptance`, `DeliverableSpec.acceptance`, `TaskRequirement.weight` | — | whole stakes-tiering + partial-credit vocabulary compiled, never consulted |
| `RunAssessment.health.repeatWaste`, `.contradictions`, `pace.projectedCompletion` | — | `contradictions` terminates the entire claim→grounding chain in a field nobody reads |
| 7 dead `RA_*` flags | — | `RA_RECITE`, `RA_ASSEMBLY`, `RA_POST_CONDITIONS`, `RA_SUPPRESS_DEPRECATION` (documented to users!), `RA_MINIMAL_PROMPT`, `RA_OVERFLOW_BUDGET`, `RA_ASSEMBLY_TRACE` |
| `packages/scenarios` | 100 | 5 hardcoded strings; merge into benchmarks |
| Orphan builder fields | — | `_memoryExplicitlyDisabled` (guards nothing), `_enableEvents`, `config.cacheTimeoutMs`, `fallbackConfig.models` |

**Unintegrated but real** (wire or demote, don't delete): `packages/interaction` (1,379), `packages/identity` (741).

---

## 5. Latent correctness bugs (new, not previously known)

1. **`adaptive` fallback discards the failed sub-strategy's steps** (`adaptive.ts:290-305`). If plan-execute wrote 2 of 3 files then returned partial, those real writes **vanish from the ledger** and the receipt reports produced deliverables as missing.
2. **`direct` drops honesty markers entirely** (`direct.ts:194`) — no `extraMetadata`, hardcodes `totalCost: 0`, can report `completed` on an unverified ship.
3. **Two verifiers, one receipt field, no linkage.** `runner.ts:1277`'s comment claiming the kernel verdict lands on `receipt.verifierVerdict` is **false**; the receipt's verdict comes from the result-boundary verifier.

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
