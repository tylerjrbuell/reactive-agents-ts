---
type: reference
status: active
created: 2026-11-17
tags: [docs, drift, generated-docs, audit]
---

# Docs derivation audit: every place docs restate a framework fact

Goal: fewer facts typed by hand, more generated from or checked against code. Each row names the source of truth, how the docs stay in step today, how likely that is to drift, and the proposed or implemented derivation. Companion: [[Docs-Indicators]] (the release window), [[2026-11-17-docs-adoption-readiness]]. Written 2026-11-17 by docs-warden.

Mechanism key: **generated** = machine-written from code (check mode fails when stale); **guard** = a test/script compares docs with code; **partial** = checked for some claims only; **none** = typed by hand, nothing catches drift.

| # | Fact | Source of truth | Sync mechanism today | Drift risk | Proposed / done |
|---|---|---|---|---|---|
| 1 | Current version (header chip, What's New badge, New/Updated window, window expiry) | latest reachable `v*` tag, then `VERSION` | **generated (done 2026-11-17)**: `deriveCurrentVersion` in `src/content/indicators.ts`, order env `RA_DOCS_VERSION` > tag > `VERSION`; test simulates a new tag | was high (hand-bumped constant) | Done. The release notes themselves (the `## vX.Y.Z` section of What's New) are still authored; a test fails if the top released heading and the derived version disagree |
| 2 | What's New "new" markers on Unreleased and the current release | page structure + derived version | **generated (done)**: `releaseStructureTags`, no hand tags | was high | Done, with a roll-up test |
| 3 | Package list, public/private split | `packages/*/package.json` | **generated + guard (done)**: `src/data/framework-facts.json`; `findDrift` | medium | Done |
| 4 | Package stability tier | `src/data/stability.json` (authored), `@unstable` JSDoc in package `index.ts` | **partial -> guard (done)**: table must list exactly the public packages; "All exports unstable" in code cannot sit beside `stable`; README `Stability:` lines checked by `check-package-readmes.ts` | high (tiers are a public promise) | Done for presence and contradiction. Full derivation from JSDoc is not possible: only `@unstable` exists in code, never `@stable` / `@experimental`. Decision for owner: adopt the three tags in package sources (not docs-warden's to add) and then generate the table |
| 5 | `create-reactive-agent` has no tier | none | none | low, but a gap in a public table | Listed in `STABILITY_EXEMPT` (visible debt); owner picks a tier |
| 6 | Package count, test count, strategy count, provider count, phase count | counted from code by `generate-metrics.ts` | **generated** (`metrics.json`) + `docs-consistency.test.ts` pins prose to the registry; `framework-facts` test cross-checks strategies, providers and phases against `metrics.json` | low | Done before; cross-check added |
| 7 | Strategy list and aliases | `strategy-registry.ts` bootstrap Map | **guard** (`docs-consistency.test.ts`: every count claim) + parse in `framework-facts.json` | low | Names per page are not generated; counts are pinned. Cheap next step: render the canonical list into `choosing-strategies` from `framework-facts.json` |
| 8 | Provider list | `provider-defaults.ts` | **guard (done)**: every registered provider key (except the `test` fixture) is named in `features/llm-providers.md` | medium | Done |
| 9 | Provider default models | `PROVIDER_DEFAULT_MODELS` | **none** (typed in `features/llm-providers.md` code samples) | medium (a model bump silently stales the page) | `framework-facts.json` carries `defaultModel` per provider. Next: render a "default model" table block from it |
| 10 | Lifecycle phase names | `LifecyclePhase` in `runtime/src/types.ts` | **guard (done)**: each phase is named in `reference/**`; count is in `metrics.json` | low | Done |
| 11 | `rax` command list | `case "<cmd>"` in `apps/cli/src/index.ts` | **guard (done)**: every command needs a section in `reference/cli.md`; 6 are undocumented today and listed as debt | high (found 6 missing: `bench`, `trace`, `skills`, `mcp`, `ps`, `attach`) | Guard done; the debt list can only shrink. Writing those sections needs the CLI owner's facts |
| 12 | Builder methods and config fields | builder prototype, `AgentConfigSchema` | **generated**: `docs:gen:api` blocks in `reference/builder-api.md` and `configuration.md`, `--check` in CI | low | Done before |
| 13 | Code examples compile | workspace source | **guard**: `docs:examples:check` typechecks every ts block against real packages | low | Done before |
| 14 | Env vars and defaults (`llm-config`, provider keys) | `packages/llm-provider/src/*config*`, `process.env` reads | **partial**: `configuration.md` config-field table is generated from the schema; env var names are typed in prose across guides (not audited page by page) | medium | Proposed: scan `process.env.X` reads in `packages/*/src`, and fail when a documented `X` no longer exists, or a read name appears nowhere in docs (report-only first, many internal reads) |
| 15 | Event names (`ToolCallStarted`, ...) | `AgentEvent` tags in `core/src/services/event-bus.ts` | **none** (stability.md and observability pages list tags by hand; "30+ tags" typed) | medium | Proposed: derive the tag list; fail when a docs-named event tag does not exist (catches renames) |
| 16 | Error kinds / tagged errors named in docs | `Data.TaggedError` classes | **none** | medium | Proposed: same name-exists check as events |
| 17 | Docs-sync of code paths to doc paths | `docs-sync-ledger.json` | **guard**: `check-docs-sync.ts` by git history | low | Done before |
| 18 | Stale public claims (Discord invite, Node roadmap, "requires Bun") | canonical strings | **guard**: `stale-claims.ts` | low | Done before |
| 19 | Package README stability and standard sections | `stability.json`, `Package-README-Standard` | **guard**: `check-package-readmes.ts` | low | Done before |
| 20 | Consumer skills (`apps/docs/skills/*/SKILL.md`) vs builder API | builder surface | **unverified**: no skill-vs-builder check was found in this audit; `update-docs` is a manual flow | medium | Proposed: reuse the generated builder-method list to assert each method named in a skill still exists |
| 21 | Which pages are new / updated and which sections | git diff since the latest tag | **evidence-driven (done)**: `bun run --cwd apps/docs docs:indicators:suggest` reports added/changed pages and new headings; tagging stays a human decision | medium (tags were hand-guessed) | Done, report-only |
| 22 | Page last-updated date | git log | **generated**: `last-commit.ts` | low | Done before |
| 23 | Sidebar and search agree with pages | content tree | **guard**: link validator, `ia-inventory.ts` | low | Done before |
| 24 | Counts typed in prose ("33 published packages" in `astro.config.mjs` `llms.txt` description, "12 phases") | `metrics.json` | **partial**: `stale-claims` checks counts it knows; `astro.config.mjs` string is hand-typed | medium | Proposed: build the `llms.txt` description from `metrics.json` at config load |

## What is implemented (2026-11-17)

1. Dynamic version (rows 1-2): tag-derived, tested by simulating a tag.
2. Framework facts file plus drift checks (rows 3-5, 8, 10, 11): `apps/docs/scripts/derive-framework-facts.ts`, committed `src/data/framework-facts.json` (regenerated in `prebuild`), tests in `apps/docs/tests/framework-facts.test.ts` including a "reverted" case per check.
3. Stability presence/contradiction guard (row 4).
4. `docs:indicators:suggest` (row 21).

Each check was shown red once by changing one real fact: removing `core` from `stability.json` fails the packages check, restoring it passes. The other checks run the same real inputs with one fact changed in memory, so they never touch another mission's pages.

## Open decisions for the owner

- Add `@stable` / `@experimental` JSDoc tags to package sources so row 4 can be generated rather than only guarded (a `packages/**` change).
- Tier for `create-reactive-agent` (row 5).
- Write or assign the six missing `rax` sections (row 11).
- Docs deploy runs on push to `main` for `apps/docs/**` only. A release tag does not by itself trigger a deploy; the chip moves at the next docs deploy. Add a `push: tags: ["v*"]` trigger if the chip should move at release time.
