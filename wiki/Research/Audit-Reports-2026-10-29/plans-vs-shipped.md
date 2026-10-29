---
type: audit
status: complete
created: 2026-10-29
tags: [audit, plans, cortex, checklist, llm-provider, docs, changeset]
scope: "118f45255..HEAD (86 commits) vs the three 2026-10-28 plans"
---

# Plans vs shipped (2026-10-29)

Read-only audit. Plans: [[2026-10-28-cortex-reliability-and-providers]] (P1), [[2026-10-28-cortex-run-visibility]] (P2), [[2026-10-28-plan-and-goal-primitives]] (P3, Phase 1 only). Evidence: `git log 118f45255..HEAD`, file existence, grep of code and tests, the pilot log. Tests and builds were NOT re-run by this audit; "DONE" means code + test file exist and a commit carries them.

Status key: DONE = shipped with test and commit. PARTIAL = shipped with a named gap. NOT DONE = absent. NOT VERIFIED = step needs a live, browser or TTY check that no report, log line or screenshot covers.

## Headline

- Every task in all three plans has code and tests in tree. No whole task is missing.
- No browser, screenshot or TTY evidence exists for any UI step (zero image files added in range; the pilot log says "Not verified: live URL in Cortex browser (blocked: localhost site permission)"). Seven browser steps and one TTY step are NOT VERIFIED.
- Docs and changeset trail the later waves. `cortex.mdx` says the to-do list is "off by default", which is false since `4284ba86c`. The changeset says the `todo` contract is "byte-identical", which is false since `512590d04`/`ce019ab83`.
- All three plans and the Planning-Index row still say draft.

## Table

### Plan 1: cortex-reliability-and-providers

| Task / step | Deliverable | Status | Evidence |
|---|---|---|---|
| T1 impl | `normalizeToolSchema`, `isStrictCompatible`, `SchemaRepair`; used by openai/anthropic/gemini/local/litellm | DONE | `5bc0ad368`; `schema-utils.ts`, `providers/openai.ts:243-244`, `anthropic.ts:125`, `gemini.ts:116`, `local.ts:335`, `litellm.ts:108` |
| T1 observability | one `tool-schema-repaired` event per tool | DONE | `schema-utils.ts:253-271` (Effect log, deduped) |
| T1 openai depth/size cap | strict only when compatible | DONE | `1a5e43e62` |
| T1 Step 1 "no-op over ALL registered built-in tool schemas" | deep-equal zero repairs for real built-ins | PARTIAL | `tests/tool-schema-normalize.test.ts:2-3` uses representative fixtures (tools depends on llm-provider). Log line 1842 says "Not verified: no-op over real built-in schemas". No test in `packages/tools` closes it |
| T1 Step 4 live gpt-4o x adaptive/reactive | no 400 | DONE (post-fix only) | `16e6ea415` plan section; the pre-fix 400 was not reproduced |
| T2 matrix test | every strategy, 2 turns, malformed tool, error names strategy | DONE | `1dd5bed11`, `caf3c19f5`; `chat-strategy-matrix.test.ts:27,141,171` strategy list read from `getCapabilityManifest()` |
| T2 Step 3 browser strategy switch | reactive to adaptive to plan-execute to reflexion | NOT VERIFIED | no report or screenshot |
| T3 provider list from framework | `/api/models/providers`, `providers.ts`, `PROVIDER_FALLBACK`, drift pin, groq/xai | DONE | `07e94365b`; `providers-endpoint.test.ts:16`, `providers.test.ts:7-15` |
| T3 Step 4 browser | groq/xAI in chat, Lab, Settings | NOT VERIFIED | no evidence |
| T4 discovery primitive | `listProviderModels`, `resolveProviderModels`, `ModelDiscoveryError`, cache, `isChatModel` | DONE | `e5d74f128`, `36400d021`, `1a5e43e62`; `model-discovery.ts` |
| T4 docs verification | endpoints vs official docs | DONE | `366697ac0` plan section (Gemini/xAI verified; OpenAI keywords and Groq `active` fixed) |
| T4 truthfulness | file header says endpoints "were NOT re-verified against live docs" | PARTIAL | `model-discovery.ts:5-8` is stale after `366697ac0`. Header contradicts the plan's verification table |
| T4 Step 4 live counts per provider | counts in commit body | PARTIAL | counts recorded in plan "Live checks" (`16e6ea415`), not in the `e5d74f128` body (empty). No-key hosted fallback unmeasured live (disclosed) |
| T5 Cortex pickers | `/api/models/:provider` returns `{models, live, error?}`; "built-in list" note | DONE | `6d1833d15`; `framework-model-options-local.ts:113` |
| T5 alias removal | `/framework` and `/ollama` routes removed | DONE | `5052515ec` |
| T5 Step 4 browser | pickers live where keyed, fallback where not | NOT VERIFIED | no evidence |
| T6 repetition guard | identical canonicalized args only | DONE | `a13cdf182`, `fd00b49b5` |
| T6 Step 5 probe | before/after n=5 on qwen3:14b, gemma4:12b | DONE | `868804b23`, `07b26b4a2`; report `2026-10-28-repetition-guard-probe.md`. Result is in the report, not in the `a13cdf182` commit body (empty) |
| T6 "true loops still trip" live | sequential identical-arg loop | PARTIAL | report TL;DR 3: never elicited live; unit tests only |
| T7 harnessSkill + withMetaTools notice | honest default; dropped-`recall` notice once | DONE | `3adc62be8`, `b5968d69d` (logger, not console), `fcb36d90f` docs |

### Plan 2: cortex-run-visibility

| Task / step | Deliverable | Status | Evidence |
|---|---|---|---|
| T1 `makeRunTree` | core resolver + test | DONE | `b63f04f6b`; `packages/core/src/run-tree.ts`, `__tests__/run-tree.test.ts` |
| T2 scope resolver + `SubAgentActivity` | `engine/stream-scope.ts`, wrapper, tests, root byte-identity, density | DONE | `8a0492f4e`, `333d6f673`; log 1862: execute-stream 914 to 739 LOC, fixture byte-identical, red-on-cut |
| T3 ui-core recursive fold | `subAgents` in turn trace and run state | DONE | `ed6414438`, `b283ce02d` (stable `run.key`), `44e0405db` |
| T4 sub-agent blocks | `ChatSubAgentBlock.svelte`, `sub-agent-view.ts`, hydrate | DONE (code) | `4efb701b5` |
| T4 Step 4 browser + both-theme screenshots | two parallel blocks, expand, reload | NOT VERIFIED | no screenshots in range |
| T5 Beacon hierarchy | run-id edges, collapsible grid, chat-spawned runs ingested | DONE (code) | `4d63ffdc0`, `af249dc73` (persist `parentRunId`), `e3389c7d0`; `run-hierarchy.ts` uses `makeRunTree`; `chat-ingest.test.ts` |
| T5 Step 4 browser | live tree on Beacon from a chat | NOT VERIFIED | no evidence |
| T6 cost persistence | `cost_usd`, `cost_known`, SQL totals, `costKnown:false` on failed child, "≥ $x" | DONE (code) | `5367fb12c`, `396cd514b`; `chat-cost.test.ts:38,58,80,114,153` |
| T6 Step 4 browser | cost survives reload; per-turn row | NOT VERIFIED | no evidence |
| T7 real traces + export | `run_id`, trace route with children, `traceRuns` setting, `/export`, Run trace tab | DONE (code) | `0159ca348`, `b76a069d4`, `31d7edf20`; `chat-trace-export.test.ts`, `chat-commands.ts:32` |
| T7 Step 4 browser | tab, copy, download, 3 export formats, pre-migration empty state | NOT VERIFIED | no evidence |
| Plan 2 "Cortex follow-up" | closing the failed-child cost fold gap in runtime | NOT DONE | plan names it a runtime-warden follow-up; not filed in `wiki/Architecture/DEBT-REGISTER.md` (`9525dad59` filed other items) |

### Plan 3: plan-and-goal-primitives (Phase 1)

| Task / step | Deliverable | Status | Evidence |
|---|---|---|---|
| T0 rulings | V1-V4 recorded in plan; Cortex default | DONE | plan "Lift-rule rulings"; owner override of V2 (`4284ba86c`, `0409ba3c0`). No dedicated `docs(plan): lift-rule rulings` commit |
| T0 V5 (added) | M4 aliases PASS | DONE | `512590d04`, `ce019ab83` |
| T0 V5 M1/M3-midrun probe | A0-A3 x 3 tiers, n>=5, verdict before any default | NOT DONE | mechanisms shipped opt-in (`2f0e07858`, `011087112`, `e41cb25c2`), but `wiki/Research/Prototypes/todo-guidance-probe-2026-10-28.ts` and `.sh` are untracked and no report exists in Harness-Reports. Opt-in so no default violation; the "behaves like Claude Code" claim stays unsupported |
| T1 core projector | types, `projectChecklist`, `makeChecklistTracker` | DONE | `dfe15f5e3`, `8bd2dd32f`, `59620989b`, `44d745ba9` |
| T2 ledger facts | self-describing requirements, `checklist-item`; parent rows | DONE | `1f936c492`; `adaptive.ts:518`, `config-field-census.test.ts:134` |
| T3 `todo` pure tool | `applyTodoChecklistAction`, `renderTodoChecklist` | DONE | `96460781d` |
| T4 kernel writes todo to ledger | round-local pending, commit on every exit, migration, restored publish, global Ref retired | DONE | `380d0b6b8`, `d5c1c63cf`; `checklist-round.test.ts`, `checklist-migrate.test.ts`, `todo-ledger-integration.test.ts` |
| T5 retire legacy API | exports deleted | DONE | `fa431827e`; legacy names only in the frozen oracle test and Cortex-local types |
| T6 runtime option + projection | `observability.checklist`, `ChecklistUpdated`, config drift test | DONE | `11f6ea1ad`; `checklist-stream.ts`, `checklist-option.test.ts` |
| T6 `docs:gen:api` | builder-api regenerated | PARTIAL | `builder-api.md` has no `checklist` mention; only `configuration.md:127` was updated |
| T7 ui-core | wire event, `RunState.checklist`, `TurnTrace.checklist` | DONE | `824ed7c9e` |
| T8 TUI | `checklist-status.ts`, renderer wiring | DONE (code) | `fef1372ab` |
| T8 Step 4 real-TTY manual check | scratch script, observed behaviour in commit body | NOT VERIFIED | commit body says "Manual real-TTY check NOT done" |
| T9 Cortex server | config parity, chat default, persisted checklist | DONE | `a15dbc440`; `config-parity.test.ts:74-75,156-157`. Default is now `todo:true` by owner override (`chat-defaults.ts:12`), so the "Defaults: todo false on every path" test text is superseded |
| T10 plan card + settings | `checklist-view.ts`, `ChatPlanCard.svelte`, toggles | PARTIAL | code and tests exist, but landed inside unrelated `31d7edf20` ("fix(cortex): tolerate unparseable root trace header"). No `feat(cortex): live plan card` commit. One-concern-per-commit broken; later `19c944617`, `52d4a6906` extend it |
| T10 Step 4 browser + both-theme screenshots | both sections live, survive reload, toggle hides | NOT VERIFIED | no evidence |
| T11 model-invisible test | ON/OFF/ON request identity | DONE | `7fe068273`; ablation-warden mutation check in plan |
| T11 ablation confirmation recorded "in the changeset and the spec" | | PARTIAL | recorded in the plan only; neither `.changeset/checklist-primitive.md` nor the spec carries it. Spec body still says "Status: draft, revision 2" (`...Design-Specs/2026-10-28-plan-and-goal-primitives.md:11`) though frontmatter is `approved` |
| T11 docs | builder-api prose, features/cortex, streaming guide, README | PARTIAL | `streaming.md` and `cortex.mdx` done (`5ec0ac295`); builder-api prose missing; README not touched for the option (it does not enumerate observability options beyond one example, so low risk) |
| T11 Step 4 full `bun test`, `bun run build`, counts reported | | NOT VERIFIED | only scoped counts in the pilot log; log 1850 records one pre-existing runtime failure (`as-unknown-as` ceiling). No full-suite or build count anywhere |
| T11 Step 5 commit message | `docs: live checklist primitive ... + changeset` | DONE | `5ec0ac295` |
| T11 wiki: spec `approved`, Planning-Index, pilot log | | PARTIAL | spec `approved`; pilot log has entries (plus 36 uncommitted lines in working tree); Planning-Index and plan frontmatter stale (see below) |

## Docs truthfulness

| Page | Finding |
|---|---|
| `features/streaming.md` | TRUE. `SubAgentActivity` shape includes `run.key` (`stream-types.ts:218-219`); `ChecklistUpdated` row and "Live checklist" section match code; `withMetaTools` exact-set note matches `b5968d69d`. |
| `features/cortex.mdx:159` | FALSE. Says "The to-do list is off by default; enable it per session". Chat defaults `todo: true` since `4284ba86c` (`apps/cortex/ui/src/lib/chat-defaults.ts:12`). Also missing: conversation to-do dock and carry-over between turns (`f5af2cf5f`, `52d4a6906`), the "keep the to-do current" guidance setting (`e41cb25c2`), context-usage ring persistence (`fdd0d2e9e`), provider/model link to a model page (`2ae40a137`), Beacon deterministic layout (`e3389c7d0`), groq/xai and live model discovery. |
| `guides/tools.mdx` | TRUE for withMetaTools exact-set, dropped-`recall` notice, harness skill needing `brief`/`pulse`, and the healing section (`healedFrom` is recorded on the tool-call trace: `meta-tool-handlers.ts:174-176`; helpers `healEnumArg`/`healParamNames`/`closestValid` exist in `packages/tools/src/skills/arg-healing.ts`). Gap: no mention of the `todo` closing line or of `update`/`set` aliasing beyond the example, and nothing on `brief`/`pulse` healing (`c8fc2c790`). |
| `reference/builder-api.md` | GAP. No `observability.checklist` text (Task 11 asked for prose). |
| `features/llm-providers.md` | GAP (AGENTS.md doc rule). `listProviderModels`/`resolveProviderModels` and the groq/xai Cortex listing are undocumented (not in the 4 doc files changed in range). |

## Changeset `.changeset/checklist-primitive.md`

Present and lists: checklist stream events, `observability.checklist`, TUI checklist, core projectors, `makeRunTree`, `checklist-item`, ui-core fold, breaking legacy `todo` removals, `brief` recall-key delta, schema normalization, live model discovery, repetition guard, named failure messages, URL documents / `DocumentIngestFailed`, HTML extraction, `withMetaTools` warning, child `TextDelta` leak fix. gpt-5 request params have their own changeset (`openai-gpt5-reasoning-params.md`, patch), which is acceptable.

Missing or wrong:

1. WRONG: "The `todo` tool contract is byte-identical." Since `512590d04` (alias table) and `ce019ab83` (description and result text changed, closing line, `update`/`set` healing) it is not. The plan itself records the 2026-10-29 owner override.
2. MISSING: `todo` action aliases and healing (tools); new public tools exports `healEnumArg`, `healParamNames`, `closestValid` (`e5ed31e5a`); `brief`/`pulse` section/param healing (`c8fc2c790`).
3. MISSING: opt-in `checklistGuidance: { reminder, systemLine }` on runtime config (`runtime/src/types.ts:723`, `011087112`, `2f0e07858`), default off.
4. MISSING: `initialAdvisory` on `RunEnvelope` and the chat-turn to-do carry (`906081a31`, `0d0b1ae8a`); requirement-status scoping fix for sub-agent facts (`671aea38c`, `45b55c849`).
5. MISSING: `litellm` omits `temperature` for OpenAI reasoning ids (`f44c2ca3b`) and Groq inactive-model skip (`1a5e43e62`) (small, patch-level).
6. MISSING for `@reactive-agents/cortex` (not in this changeset; the four Cortex changesets in `.changeset/` predate this wave): sub-agent blocks, cost persistence, Run trace tab and `/export`, Beacon hierarchy and layout, groq/xai and live pickers, plan card, to-do dock, context ring fix, model page link, chat to-do default.
7. MISSING: the ablation-warden confirmation (Task 11 Step 3).

## Wiki state

- `wiki/Planning/Planning-Index.md:42-44` still shows all three plans as "DRAFT" (row 44 also says "gated on plan 2 + todo probe + 09 sequencing"). Last touched by `23ac9fc6c`.
- Plan frontmatter `status: draft` in all three files. They should be `complete` (P1, P2) and `complete` (P3 Phase 1) with the deviations listed here, or `active` until the NOT VERIFIED steps are cleared.
- Spec frontmatter `approved` is current; its body status line is stale.
- `wiki/Hot.md` does not mention the checklist work (0 hits).

## Prioritized NOT DONE / PARTIAL / NOT VERIFIED

1. Browser verification of all UI steps (P1 T2/T3/T5; P2 T4/T5/T6/T7; P3 T10) with both-theme screenshots. Action: main thread (or harness-warden) runs Cortex and records a short report with screenshots under `wiki/Research/Harness-Reports/`.
2. Fix `cortex.mdx` falsehood and add the later-wave Cortex features. Action: main (docs).
3. Correct the changeset: drop "byte-identical", add aliases/healing, `checklistGuidance`, `initialAdvisory`, tools exports, add a Cortex changeset. Action: main; release-warden reviews before tag.
4. Add `observability.checklist` prose to `builder-api.md` and `listProviderModels` to `llm-providers.md`. Action: main (docs), then `bun run docs:gen:api`.
5. Full `bun test` and `bun run build` counts (Task 11 Step 4), including the known `as-unknown-as` ceiling failure. Action: release-warden.
6. TUI real-TTY check (P3 T8 Step 4). Action: main with a scratchpad script.
7. V5 guidance probe (A0-A3, 3 tiers) never produced a report; untracked scripts in `wiki/Research/Prototypes/`. Action: harness-warden to run or ablation-warden to confirm it stays opt-in; do not claim Claude-Code-like behaviour.
8. Real-built-in-schema no-op test for `normalizeToolSchema`. Action: tools-warden adds a test in `packages/tools` importing the registry (provider-warden cannot, dependency cycle).
9. Task 10 landed in `31d7edf20`; record the deviation. Action: main (note in plan; no history rewrite).
10. Stale `model-discovery.ts` header ("NOT re-verified"). Action: provider-warden.
11. Failed-child cost fold gap: file in `DEBT-REGISTER.md`. Action: main files; runtime-warden fixes later.
12. Flip plan frontmatter and Planning-Index rows; update `Hot.md`; record ablation confirmation in the spec. Action: main (wiki).
13. Sequential identical-arg tight loop only unit-tested live. Action: harness-warden, low priority.
