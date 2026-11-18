---
type: reference
status: applied
created: 2026-11-17
tags: [docs, stability, audit, trust, packages]
---

# Stability Tier Audit (2026-11-17)

Read-only audit. No tier, README, JSDoc or page was edited. Sources: `apps/docs/src/content/docs/reference/stability.md`, `apps/docs/src/data/stability.json`, every `packages/*/README.md` Stability line, page frontmatter `stability:`, `CHANGELOG.md` (v0.14 to v0.18), `.changeset/` (403 files, cumulative), `git log v0.15.0..HEAD`, package `src/index.ts` JSDoc, `packages/runtime/src/capabilities/registry.ts`, workspace `package.json` dependency edges.

## 1. Headline findings

1. **The tier mechanism is not what the page says.** `stability.md` says "Tier is declared by JSDoc tag on the export: `@stable`, `@unstable`, `@experimental`". The code has **0 `@stable` and 0 `@experimental` tags**. 14 `@unstable` tags exist (benchmarks, identity, llm-provider, prompts, react, reasoning, svelte, testing, vue). READMEs also say "individual newer surfaces are tagged `@unstable` or `@experimental`". Either add the tags or reword the page. Wording is the cheap, truthful fix.
2. **A2A tier disagrees across surfaces.** `stability.md` lists the A2A protocol surface as `@experimental`; the feature page is `experimental`; `stability.json` and `packages/a2a/README.md` say `unstable`. This is the only package where the page, JSON and README contradict.
3. **Feature-page tiers contradict `stability.md`.** `guides/durable-execution.mdx` and `guides/structured-output.mdx` are `experimental` while `stability.md` lists durable runs and typed structured output as stable. `features/eval.md` and `features/observe.mdx` and `features/agentic-ui-core.md` are `experimental` while their packages are `unstable`.
4. **`stability.md` has factual slips.** It names `ReasoningOptions.strategySwitching` (stable); the real option is `enableStrategySwitching` (`packages/runtime/src/reasoning-options-schema.ts:45`) and its default flipped to off in v0.18 (CHANGELOG line 326). It calls `.withHarness()` an alias of `.compose()`; `builder.ts:674-698` shows `withHarness` is overloaded (compose callback OR a `HarnessConfig` object); only the callback form aliases `.compose()`.
5. **Stale JSDoc.** `react`, `svelte`, `vue` `index.ts` say "zero tests" and "may change in v0.10.x". They now have 11, 9 and 4 test files. `prompts`, `testing`, `reasoning`, `llm-provider` `@unstable` blocks also cite v0.10.x and a deleted AUDIT doc.
6. **`create-reactive-agent` (33rd public package) has no tier** in `stability.json` (32 entries) and no README Stability line.
7. **Default-on vs "experimental".** `reactive-intelligence` is `defaultOn: true` in the capability registry (since v0.10, last ablation 2026-05-23) but tiered `experimental`.
8. **Dormant package marked merely unstable.** `identity` JSDoc says all four services are dormant, verdict DEFER, no `.withIdentity()` wither.

## 2. Criteria

Package tier = tier of the package's documented primary entry point. Sub-surfaces carry their own tag. A README must state the scope when the package is mixed.

| Tier | Requires (all) |
|---|---|
| stable | (a) no removal, rename or signature break of the documented entry points in the last 3 minors (v0.16, v0.17, v0.18; undocumented dead-code removals are listed but not disqualifying); (b) at least 5 test files covering the surface (package plus runtime seam tests); (c) it is the primary path (default-on or the documented builder method); (d) no `@unstable` tag on the entry point; (e) 30+ days at current shape (the page's own promotion rule) |
| unstable | shipped and used, but API or defaults changed in the window, or tests under 5, or schema still settling, or the page's own "not shipped yet" caveat applies |
| experimental | opt-in, or under about 3 months old, or dormant/unwired, or tracks an external spec that is still moving |
| deprecated | `@deprecated` plus a removal date. No package qualifies today |

Default-behavior flips (strategy switching v0.18, `withSkills` global opt-in v0.18, memory v0.12) are counted separately: they do not disqualify a source-compatible entry point but must be named in the stable-tier promise. The owner already softened that promise; this audit keeps it.

## 3. Evidence table, 33 public packages

`c15` and `c17` are commits touching `packages/<pkg>/src` since v0.15.0 and v0.17.0 (the v0.18 release is inside `c17`). `post18` is the same after tag v0.18.0. `tests` is test files in the package. `deps` is in-repo dependents (packages plus apps). Current = `stability.json`; README matches JSON for all 32 listed.

| Package | Current | c15 | c17 | post18 | tests | deps | Breaking in v0.16-v0.18 (CHANGELOG / changesets) | Proposed | Verdict |
|---|---|---|---|---|---|---|---|---|---|
| a2a | unstable | 11 | 5 | 5 | 10 | 4 | v0.17 dead-code removals (`A2AServer.setMessageHandler`, `createA2AServerLayer`); changeset `channels-fail-closed` minor | experimental | mismatch: page says experimental |
| channels | unstable | 25 | 25 | 25 | 30 | 2 | all 25 commits post-v0.18 (router "slice one"); `gateway-deploy-quick-fixes` breaking | unstable (judgment: experimental) | supported |
| compose | stable | 4 | 2 | 0 | 2 pkg + 2 runtime seam (4) | 3 | none in window | unstable (judgment) | weak: under 5 tests; killswitches reworked 2026-10-05..16 (4 fixes); `.withBudget` is unstable on the same page |
| core | unstable | 96 | 76 | 33 | 47 | 29 | v0.16 `LLMRequestStarted.contextSize` narrowed (event payload) | unstable | supported (README: event tags stable, but a payload broke) |
| cost | unstable | 5 | 1 | 1 | 11 | 4 | none | unstable | supported (routing primitives not a builder policy) |
| create-reactive-agent | none | 7 | 3 | 0 | 3 | 0 | n/a (templates change per minor) | unstable | missing |
| diagnose | unstable | 12 | 10 | 2 | 8 | 2 | new attribution reasons v0.18 | unstable | supported |
| eval | unstable | 7 | 5 | 2 | 13 | 5 | none | unstable | supported; page is experimental (mismatch) |
| gateway | unstable | 9 | 8 | 8 | 26 | 3 | `channels-fail-closed`, `allowedSenders` prefix, webhook replay default | unstable | supported (clear breaks) |
| guardrails | unstable | 6 | 4 | 3 | 6 | 3 | none | unstable | supported (opt-in wither) |
| health | unstable | 0 | 0 | 0 | 1 | 2 | none | unstable | supported (no churn but 1 test file) |
| identity | unstable | 0 | 0 | 0 | 3 | 3 | none | experimental (judgment) | weak: JSDoc "no consumer reads it", DEFER, no wither |
| interaction | unstable | 4 | 1 | 1 | 10 | 2 | none | unstable | supported |
| judgment | experimental | 16 | 4 | 3 | 11 | 9 | none | experimental | supported: created 2026-09-22 (v0.17), `.withJudgment()` opt-in |
| llm-provider | stable (scoped) | 76 | 58 | 17 | 108 | 17 | none to the documented provider surface; Capability port `@unstable` | stable (scoped) | supported: churn is mostly additive provider work |
| memory | unstable | 14 | 7 | 6 | 30 | 9 | `withSkills` global opt-in default flip (v0.18) touches loading | unstable | supported (default off; learning schema settling) |
| observability | unstable | 15 | 10 | 3 | 33 | 8 | none | unstable | supported |
| observe | unstable | 2 | 0 | 0 | 4 | 3 | none | unstable | supported; page is experimental (mismatch) |
| prompts | unstable | 0 | 0 | 0 | 11 | 4 | none | unstable | supported (`@unstable` ExperimentService) |
| react | unstable | 2 | 1 | 1 | 11 | 0 | none | unstable | supported; JSDoc stale |
| reactive-agents | stable | 17 | 13 | 12 | 1 | 2 | facade; follows runtime | stable | supported (re-exports; 1 own test file, depends on runtime tests) |
| reactive-intelligence | experimental | 28 | 16 | 5 | 71 | 3 | none | unstable (judgment, tunables stay experimental) | mismatch: `defaultOn: true`, 71 tests, but ablation is 6 months old |
| reasoning | stable (scoped) | 410 | 317 | 71 | 557 | 5 | v0.17 removed `overhaulEnabled`, `thoughtContinuityEnabled`, `toolObserveSymmetryEnabled` (undocumented, off by default) | stable (scoped) | supported for `withReasoning` + strategy names |
| replay | stable | 1 | 1 | 0 | 13 | 4 | none | stable | strongest evidence: 1 commit since v0.15 |
| runtime | stable (scoped) | 310 | 236 | 77 | 480 | 6 | `withSkills` global opt-in, strategy-switching default off (behavior only); no wither removed since v0.14 | stable (scoped) | supported (source-compatible; defaults flipped twice, named in page) |
| runtime-shim | unstable | 3 | 2 | 2 | 10 | 13 | none | unstable | supported (`fetchPinned` `@unstable`; 13 dependents, promotion candidate for the base primitives) |
| svelte | unstable | 2 | 1 | 1 | 9 | 0 | none | unstable | supported; JSDoc stale |
| testing | unstable | 9 | 7 | 0 | 9 | 0 | none | unstable | supported (JSDoc `@unstable`, verdict SHRINK) |
| tools | stable (scoped) | 122 | 83 | 29 | 159 | 9 | v0.14 `task-complete`/`rag-search`; v0.16-17 `writeResultToFileTool`, legacy `todo` API; v0.18 document-store internals | stable (scoped) | supported only for `defineTool()`/`tool()`/`.withTools()`; package-wide stable would be false (removals in 4 consecutive minors) |
| trace | unstable | 53 | 44 | 7 | 41 | 9 | none | unstable | supported (high churn) |
| ui-core | unstable | 38 | 38 | 26 | 33 | 4 | wire protocol versioned, additive | unstable | supported; page is experimental (mismatch) |
| verification | unstable | 1 | 1 | 0 | 7 | 3 | none | unstable | supported by page text ("replaceable verifier not shipped"); low churn makes it the first promotion candidate |
| vue | unstable | 2 | 1 | 1 | 4 | 0 | none | unstable | supported; JSDoc stale |

Capability registry (`packages/runtime/src/capabilities/registry.ts`, 4 entries): memory defaultOn false, reactive-intelligence defaultOn true, verifier defaultOn true, strategy-switching defaultOn false (opt-in since 2026-11-05 ablation, -6.2pp, +28% tokens).

Private packages (benchmarks, judge-server) are out of scope; benchmarks carries `@unstable` JSDoc.

## 4. Mismatch list

| # | Where | Current | Evidence | Problem |
|---|---|---|---|---|
| M1 | `stability.json` a2a, `packages/a2a/README.md` | unstable | `stability.md` line 72 lists A2A as experimental; page `features/a2a-protocol.md` experimental | three surfaces vs two |
| M2 | `guides/durable-execution.mdx` frontmatter | experimental | `stability.md` line 35 lists `.withDurableRuns()` stable; 22 commits since v0.17 on `durable-facade.ts`/`run-durable.ts`; 15+ durable test files | page and stable list disagree; the stable claim is the weaker one (22 commits in 2 minors) |
| M3 | `guides/durable-hitl.md` | experimental | `request_user_input` listed unstable; durable gates not listed | not in `stability.md` |
| M4 | `guides/structured-output.mdx` | experimental | line 34 stable (`withOutputSchema`, `streamObject`); 8 commits since v0.17; page also covers newer provenance/per-field confidence | scope mix: core stable, extras newer |
| M5 | `features/eval.md` | experimental | package `eval` unstable, 13 tests, no breaks | page stricter than package |
| M6 | `features/observe.mdx` | experimental | package `observe` unstable, 0 commits since v0.17 | page stricter than package |
| M7 | `features/agentic-ui-core.md` | experimental | package `ui-core` unstable, wire protocol versioned | page stricter than package |
| M8 | `guides/plan-then-execute.md` | experimental, `since: 0.19` | `agent.plan()` absent from `stability.md` | untiered in the reference |
| M9 | `stability.md` line 64 | `ReasoningOptions.strategySwitching` | actual `enableStrategySwitching`, default off since v0.18 | wrong name, no default note |
| M10 | `stability.md` line 39 | "`.compose()` (alias: `.withHarness()`)" | `builder.ts:674-722`: `withHarness` overload takes `HarnessConfig`; fields keep growing | only the callback form is the alias |
| M11 | `stability.md` line 18 and all READMEs | "declared by JSDoc tag" | 0 `@stable`, 0 `@experimental` | claim not true |
| M12 | `packages/react|svelte|vue/src/index.ts` | "zero tests", "v0.10.x" | 11/9/4 test files | stale JSDoc |
| M13 | `stability.json` | 32 packages | 33 public packages | `create-reactive-agent` missing |
| M14 | `stability.json` reactive-intelligence | experimental | default-on since v0.10; 71 tests | label contradicts criteria (see judgment J3) |
| M15 | `stability.json` identity | unstable | dormant per JSDoc, no wither | label overstates maturity (J4) |
| M16 | `stability.json` compose | stable | 4 related test files, killswitch fixes Oct 2026 | evidence below own bar (J1) |
| M17 | `stability.md` | heading "as of v0.18" | repo is on v0.19 dev; pages carry `since: 0.19` | refresh at release |
| M18 | Feature pages without any tier | gateway, cost-tracking, interaction, observability, prompts, verification, llm-providers, streaming, resilience, harness-control, intelligent-context-synthesis, create-reactive-agent, debrief-chat | package tiers exist for most | add tier derived from package JSON |

## 5. Proposed change list

### 5.1 Docs-only (docs-warden)

| File | Old | New | Evidence |
|---|---|---|---|
| `apps/docs/src/content/docs/reference/stability.md` L18 | "Tier is declared by JSDoc tag on the export" | "Tier is declared here and in `stability.json`; `@unstable` and `@deprecated` JSDoc tags mark individual exports" | M11 |
| same, L64 | `ReasoningOptions.strategySwitching` | `ReasoningOptions.enableStrategySwitching` (default off since v0.18) | M9 |
| same, L39 | alias claim | `.compose()` and the callback form of `.withHarness()`; `.withHarness({ ... })` config form noted separately | M10 |
| same, new bullets | none | add `agent.plan()` (experimental), durable HITL gates (unstable), `@reactive-agents/judgment` (experimental), `@reactive-agents/observe`, `eval`, `identity` placement | M3, M8, packages not listed |
| `stability.md` L72 vs JSON | json a2a unstable | json a2a experimental | M1 |
| `apps/docs/src/data/stability.json` | a2a unstable | experimental | M1 |
| `stability.json` | no entry | `create-reactive-agent: unstable` (also needs a Stability line in its README, which docs-warden owns) | M13 |
| `features/eval.md`, `features/observe.mdx`, `features/agentic-ui-core.md` frontmatter | experimental | unstable (matches package) | M5-M7 |
| `guides/durable-execution.mdx` | experimental | owner choice, see J2 | M2 |
| `guides/structured-output.mdx` | experimental | owner choice, see J2 | M4 |
| 13 untiered feature pages (M18) | none | add `stability:` equal to package JSON tier (gateway, cost, interaction, observability, prompts, verification unstable; llm-providers stable scoped) | M18 |
| `README.md` badges/text | n/a | re-check after any change | rule 4 |

### 5.2 README edits (authored here, applied by owning warden; `check-package-readmes` guards JSON/README parity)

| README | Change | Owner |
|---|---|---|
| `packages/a2a/README.md` | unstable to experimental | gateway-warden |
| `packages/identity/README.md` | only if J4 accepted: experimental | tools-warden |
| `packages/compose/README.md`, `reactive-intelligence/README.md`, `packages/*/README.md` Stability line | only if J1/J3 accepted | compose-warden / reactive-intelligence owner (check `repo scope`) |
| `packages/create-reactive-agent/README.md` | add `> **Stability:** unstable.` | docs-warden (explicit row) |
| `packages/reactive-agents/README.md` | reword "tagged `@unstable` or `@experimental`" to match M11 fix | runtime-warden applies docs-warden text |
| `packages/runtime/README.md` | same wording fix | runtime-warden |

### 5.3 Code changes (JSDoc only, `packages/**`, never docs-warden)

| Warden | Files | Change |
|---|---|---|
| cortex-warden | `packages/react/src/index.ts`, `svelte/src/index.ts`, `vue/src/index.ts` | drop "zero tests" and "v0.10.x"; keep `@unstable` |
| kernel-warden | `packages/reasoning/src/index.ts`, `packages/prompts/src/index.ts` | refresh "v0.10.x" wording |
| provider-warden | `packages/llm-provider/src/index.ts` | same |
| core-warden | `packages/testing/src/index.ts` | same |
| tools-warden | `packages/identity/src/index.ts` | add `@experimental` if J4 accepted |
| all domain wardens | entry-point exports | add `@stable`/`@experimental` tags ONLY if the owner wants the tag mechanism kept; recommended: do not, reword page instead (0 tags exist today; tagging 33 packages is churn with no reader) |
| core-warden | `packages/core` event-bus | consider an `@internal`-style note that payload types changed in v0.16 (README says "event tags stable") |

## 6. Judgment calls for the owner

- **J1 compose stable vs unstable.** Evidence under bar: 4 test files, killswitch rework Oct 2026, `.withBudget` (unstable) shares a mechanism. Recommend unstable until 30 days quiet; the package surface (`killswitches`, `maxIterations`, `budgetLimit`, ...) is small and likely to promote soon.
- **J2 durable runs and structured output.** Page says experimental, reference says stable. The stable claim has 22 and 8 commits in the last two minors. Recommend: keep `.withOutputSchema`/`result.object` stable; move `.withDurableRuns()` / `resumeRun` / `listRuns` to unstable in `stability.md` (honest about hardening churn), and set both pages to unstable. Alternative: keep stable and fix the pages. Trust cost favors the lower tier.
- **J3 reactive-intelligence.** Default-on, 71 tests, but last ablation 2026-05-23 and registry says re-verification recommended; entropy tunables really are experimental. Options: package unstable with tunables experimental (criteria-consistent), or leave experimental (conservative; "under-promise"). Do not promote.
- **J4 identity.** Dormant, no wither: recommend experimental. Alternative: deprecate (verdict DEFER) which is a code/product decision.
- **J5 channels.** All 25 commits are post-v0.18 and breaking changesets exist; page says unstable. Recommend keep unstable; experimental is defensible for the router "slice one".
- **J6 tools/runtime/reasoning "stable (scoped)".** Package-wide stable is false for tools (removals in four consecutive minors). Keep the scoped README wording; do not drop the tier to unstable, which would make the stable list inconsistent. Owner may prefer a two-field JSON (`tier`, `scope`).
- **J7 promotion candidates.** verification (1 commit since v0.15), prompts (0), health (0), runtime-shim base primitives (13 dependents): low churn but fail bar (b) or carry `@unstable` sub-surfaces. Do not promote now; revisit at v0.20 with consumer evidence.
- **J8 tag mechanism.** Reword (recommended) or tag everything. A tier page that cites tags that do not exist is a trust defect already.

## 6b. Applied (2026-11-17, docs-warden)

Owner decisions: compose stable to unstable (J1); durable runs stable to unstable, `.withOutputSchema` stays stable (J2); A2A experimental everywhere (M1); identity experimental (J4); reactive-intelligence unchanged, experimental (J3); channels unstable (J5); tools/runtime/reasoning/llm-provider stay "stable (scoped)" (J6); no promotions (J7); mechanism text reworded, no tags added (J8).

Tier changes:

| Item | Old | New | Evidence |
|---|---|---|---|
| `stability.json` a2a | unstable | experimental | M1 |
| `stability.json` compose | stable | unstable | J1: 4 test files, killswitch rework Oct 2026 |
| `stability.json` identity | unstable | experimental | J4: dormant, no wither |
| `stability.md` durable runs | stable | unstable | J2: 22 commits since v0.17 |
| `stability.md` compose API | stable | unstable | J1 |
| `stability.md` new entries | none | `agent.plan()`, `judgment`, `identity`, `reactive-intelligence` (experimental); durable HITL gates, `create-reactive-agent` (unstable) | M3, M8, M13 |
| page `features/eval`, `features/observe`, `features/agentic-ui-core` | experimental | unstable | M5-M7, match package |
| page `guides/durable-execution`, `guides/durable-hitl` | experimental | unstable | J2, M3 |
| page `guides/structured-output` | experimental | stable (note: provenance/confidence/abstention are unstable) | J2, M4 |
| 8 untiered feature pages | none | `gateway`, `cost-tracking`, `interaction`, `observability`, `prompts`, `verification`, `create-reactive-agent`: unstable; `llm-providers`: stable | M18, from package tier |

Text fixes in `stability.md`: tier mechanism (M11), `enableStrategySwitching` and its off-by-default (M9), `.withHarness()` alias scope (M10). `features/observe.mdx` no longer says `@stable as of v0.11`.

Left untiered, no evidence for a tier: `features/streaming`, `features/resilience`, `features/harness-control`, `features/intelligent-context-synthesis`, `features/debrief-chat` (no single owning package; mixed surfaces). Cortex pages under `features/cortex/**` (cortex-warden) carry no tier; cortex-warden decides, and any tier it adds must also be mapped in `stability.json`.

Guard: `stability.json` now has `pagePackages` (page slug to package) and `pageTiers` (page slug to feature tier). `findDrift` in `apps/docs/scripts/derive-framework-facts.ts` fails when a page's `stability:` differs from the mapped tier, when a mapped page has none, or when a page declares a tier without a mapping. Pinned in `apps/docs/tests/framework-facts.test.ts` (mutated-input cases, revert-once style).

Remaining for other owners: JSDoc refresh (5.3: react/svelte/vue "zero tests", reasoning/prompts/llm-provider/testing "v0.10.x", identity `@experimental`), `packages/reactive-agents` and `packages/runtime` README wording on tags (5.2), `stability.md` heading "as of v0.18" refresh at release (M17). READMEs for a2a, compose, identity, create-reactive-agent already match `stability.json`.

## 6c. Applied 2026-11-17, second pass (owner: fewer false "unstable")

Re-verified against `git log` (src only, window 2026-10-18..2026-11-17 = 30 days; 60-day column from 2026-09-18), test-file counts and `@unstable` tags. Result: **zero tier changes**. No candidate meets all of (a)-(e). `stability.json`, `stability.md`, READMEs and frontmatter already agree (guards green), so nothing was edited except this section. Structural badge noise: stable pages already render subdued (`StabilityBadge.astro`); only 3 pages carry `stable`, so removing them would drop a true positive signal for no gain. Unstable pages map to unstable packages, so they keep the badge.

| Package | Tier | Last src commit | 30d / 60d commits | Test files | `@unstable` in src | Failing criterion (keep tier) |
|---|---|---|---|---|---|---|
| verification | unstable | 2026-10-27 | 1 / 1 (internal `any` removal) | 7 | none | (e) 21 days, clock reaches 30 on 2026-11-26; page's own caveat "replaceable verifier not shipped" and "one production user" rule unverified. First to re-check after 11-26 |
| prompts | unstable | 2026-03-22 (content); 2026-11-17 JSDoc only | 1 / 1 (docs) | 11 | `ExperimentService` | a, b, c (`.withPrompts()`), e hold. Blocked by (d) only for the A/B sub-surface and by README wording "template ids and variables may change". Borderline: could be "stable (scoped)" excluding `ExperimentService` and built-in prompt wording. Needs owner call plus README edit (`packages/prompts/README.md`, outside docs-warden authority) |
| cost | unstable | 2026-11-15 | 1 / 5 | 11 | none | (e) changed 2 days ago (shadow judgments); routing primitives are not a builder policy (page caveat) |
| interaction | unstable | 2026-11-15 | 1 / 4 | 10 | none | (e) changed 2 days ago (chat session mode) |
| guardrails | unstable | 2026-11-12 | 4 / 6 | 6 | none | (e) PII detector behavior fixes 11-11/11-12 |
| eval | unstable | 2026-11-11 | 3 / 7 | 13 | none | (e) new graders 11-11 |
| diagnose | unstable | 2026-11-11 | 10 / 10 | 8 | none | (e) 10 commits in 30 days |
| observability | unstable | 2026-11-17 | 11 / 11 | 33 | none | (e) 11 commits in 30 days |
| runtime-shim | unstable | 2026-11-12 | 2 / 3 | 10 | `fetchPinned` (page lists it unstable) | (e) new surface 11-12; `@unstable` sub-surface |
| observe | unstable | 2026-09-24 | 0 / 1 | 4 | none | (b) 4 test files, under 5 |
| health | unstable | 2026-08-07 | 0 / 0 | 1 | none | (b) 1 test file |
| react / svelte / vue | unstable | 2026-11-17 (JSDoc) | 2 / 2 | 11 / 9 / 4 | file header "All exports unstable. Zero in-repo consumers" | (d) tag on entry point and 0 in-repo dependents; vue also fails (b) with 4 tests. JSDoc "zero tests"/"v0.10.x" wording already removed in `0f489f3ee` |
| compose | unstable | 2026-10-16 (32 days) | 0 / 0 | 4 (2 pkg + 2 runtime seam) | none | (b) only; (e) now holds. Re-check if 1+ more seam tests land, then promote with README edit |
| identity | experimental | 2026-07-02 | 0 / 0 | 3 | none | dormant, no wither (unchanged, J4) |

Unchanged and not candidates (churn): memory 7 commits/30d, trace 41, ui-core 37, channels 25, reactive-intelligence 16, a2a 5.

Blockers for the owning wardens (no edit made, `packages/**` is read-only for docs-warden): none for correctness. To apply the two near-misses later: prompts needs `packages/prompts/README.md` Stability line plus `stability.json`, `stability.md` scoped list and page frontmatter in one pass; compose needs 1 more test file first.

Authority note: the brief listed `packages/*/README.md` as editable, but the docs-warden manifest hard-refuses edits under `packages/**`. No README edit was needed, so nothing was denied in practice.

## 7. Not done

No edits to any tier, README, JSDoc or page. No gates run beyond read-only listing (`repo find`, `repo scope`, `git log`). `bun run repo check --all` was not run and is unaffected by this single new wiki file.

Caveats: `.changeset/` has 403 files and appears cumulative, so changeset counts are history, not "unreleased". `c17` includes the v0.18 release commits. Test-file counts include `tests/`, `test/` and colocated tests but not runtime seam tests for other packages (except compose, counted by hand).
