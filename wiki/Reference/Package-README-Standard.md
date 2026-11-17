---
type: reference
status: active
created: 2026-11-17
tags: [docs, npm, readme, standard, packages]
---

# Package README Standard

Every public `@reactive-agents/*` package ships a `README.md`. npm renders it as the package's landing page, so it is the first thing an adopter reads after a search hit. This standard makes the 33 public READMEs read as one family. Owner: docs-warden (standard and guard). Each domain warden applies it to the READMEs it owns (map below). Plan context: [[2026-11-17-docs-adoption-readiness]].

Guard: `bun apps/docs/scripts/check-package-readmes.ts` (report-only; `--fail` or `README_CHECK_FAIL=1` exits nonzero; `--json` for machine output). Tests: `apps/docs/tests/check-package-readmes.test.ts`.

## Principles

1. A README answers four questions in this order: what is it, how do I install it, how do I use it, where do I learn more. Nothing else earns space.
2. One canonical home per fact. The README is a landing page, not a manual. Anything longer than a screen belongs in the docs; link to it. This is how TanStack, Vercel AI SDK, Effect and tRPC package READMEs work: pitch, install, one minimal example, links.
3. Truth first. No claim without a source in code, `apps/docs/src/data/metrics.json`, `reference/stability.md` or a committed experiment. Unknown means leave it out.
4. No marketing superlatives ("blazing", "revolutionary", "best-in-class", "production-grade" without evidence).

## Required sections, in order

The guard accepts the listed heading aliases (case-insensitive, H2 only). Extra H2 sections are allowed between the required ones, but the required ones must keep this relative order.

| # | Section | Heading (aliases) | Content |
|---|---|---|---|
| 0 | Title | `# <exact package name>` | H1 equals `name` in `package.json`, for example `# @reactive-agents/core`. Optional npm-version and docs badges below it. |
| 0 | Pitch | blockquote `> ...` | One sentence, max 220 characters, directly under the H1. Says what the package does for whom. |
| 0 | Stability | `> **Stability:** stable\|unstable\|experimental.` | One line under the pitch. Tier follows `apps/docs/src/content/docs/reference/stability.md` and the JSDoc `@stable`/`@unstable`/`@experimental` tags. Add one clause on what may change when not stable. |
| 1 | Install | `## Install` (`Installation`) | `bun add <real package name>` plus `# or: npm install <name>`. Mention the facade (`bun add reactive-agents`) only when it re-exports this package. |
| 2 | Usage | `## Usage` (`Quick start`, `Quick example`, `Example`) | One minimal working example in a fenced `ts`, `typescript` or `tsx` block. Must run as written with the stated install. Longer recipes link to the cookbook. |
| 3 | API | `## API` (`Key exports`, `Exports`, `API reference`) | A short list or table of the main exports and when you need each. Not a full reference: the reference is generated or lives in docs. |
| 4 | Documentation | `## Documentation` (`Docs`, `Learn more`) | At least one link to a real `https://docs.reactiveagents.dev/<route>/`. Use the package-to-page map below. Relative links (`../core/README.md`) are banned: they break on npm. Link siblings by npm URL or docs page. |
| 5 | Runtime | `## Runtime` (`Runtime support`, `Requirements`) | One line: `Bun >= 1.1.0 (recommended) or Node.js 22.5+.` Packages with narrower needs say so (browser-only bindings: name the framework version and note that server code needs Bun or Node 22.5+). SQLite-backed packages add that FTS5 is absent on Node and search falls back to `LIKE`. |
| 6 | License | `## License` | `MIT` and a link to the repo `LICENSE`. |

Optional, placed between API and Documentation when needed: `## Limitations` (honest gaps), `## Related packages` (npm URLs, no relative links).

Do not add: a community or Discord block (the docs and the facade README own that), a changelog, a contributor guide, a roadmap, competitor comparisons, or a re-explanation of Reactive Agents architecture. Link to the concept page instead.

## Size budget

- Default: 8,000 bytes (about 1,200 words). Best existing READMEs here are 3 to 7.5 KB.
- Facade `reactive-agents`: 20,000 bytes. It is the npm landing page for the whole framework and the source for the repo README; docs-warden owns it.
- Over budget means move content to the docs and link. Do not raise a budget without docs-warden review.

## Banned and restricted claims

The guard enforces each of these; `stale:*` rules come from `apps/docs/scripts/stale-claims.ts`.

| Rule | Banned | Instead |
|---|---|---|
| `hand-typed-count` | Counts of tests, packages, providers, strategies typed by hand ("100+ providers", "18 packages", "9,000 tests") | Link to the page that owns the number, or read `metrics.json`. |
| `unsourced-number` | A percentage with no source on the same line ("recovers 87% of malformed calls", "86.7%") | Link the experiment in the same line (`[source](...)`), say "measured", or remove it. This is the uncertainty rule: unmeasured numbers are removed. |
| `downloads-badge` | npm download or npm-stat badges | None. Version and docs badges only. |
| `stale:non-canonical-discord-invite` | Any Discord invite other than `https://discord.gg/Mp99vQam3Q` | Leave Discord to the docs and facade README. |
| `stale:bun-required`, `stale:node-on-roadmap` | "Requires Bun", "Node on the roadmap" | "Bun (recommended) or Node 22.5+". |
| `runtime-version`, `stale:node-old-floor`, `stale:bun-old-floor` | Bun floor other than 1.1.0, Node floor other than 22.5 | Match `AGENTS.md` Runtime Policy. |
| `stale:any-absolute` | "no any", "zero any" | Drop the claim. The repo has an `as any` ceiling gate, not zero. |
| `stale:*-duplicate` | Re-stating a strategy table, durable-runs or gateway explanation that already has a canonical docs home | Link the canonical page. |
| `relative-link`, `wikilink` | `../x/README.md`, `[[Obsidian]]` links | Absolute `https://` URLs. |
| competitor claims | Comparisons without a dated "corrections welcome" footer | Link `guides/reactive-agents-vs-*` instead. |

## Template

Copy, replace `<...>`, delete what does not apply, keep the order.

````markdown
# <@reactive-agents/name>

> <One sentence: what this package does and for whom.>

> **Stability:** <stable|unstable|experimental>. <One clause on what may change, if not stable.>

## Install

```bash
bun add <@reactive-agents/name>
# or: npm install <@reactive-agents/name>
```

## Usage

```ts
import { <export> } from "<@reactive-agents/name>";

// <the smallest example that runs as written>
```

## API

| Export | Use it when |
|---|---|
| `<export>` | <one line> |

## Documentation

- [<Canonical page title>](https://docs.reactiveagents.dev/<route>/)

## Runtime

Bun >= 1.1.0 (recommended) or Node.js 22.5+.

## License

MIT. See [LICENSE](https://github.com/tylerjrbuell/reactive-agents-ts/blob/main/LICENSE).
````

## Package to docs page map

Routes were checked against `apps/docs/src/content/docs` on 2026-11-17 (the guard re-checks every link). The map picks the single best canonical page; add secondary links only when they are a different kind (reference vs how-to).

| Package | Canonical docs page | Notes |
|---|---|---|
| `reactive-agents` | `/guides/quickstart/` | Facade; also `/guides/installation/` |
| `create-reactive-agent` | `/features/create-reactive-agent/` | |
| `@reactive-agents/runtime` | `/reference/builder-api/` | |
| `@reactive-agents/core` | `/concepts/architecture/` | |
| `@reactive-agents/llm-provider` | `/features/llm-providers/` | |
| `@reactive-agents/reasoning` | `/guides/reasoning/` | Strategy table lives in `/guides/choosing-strategies/` only |
| `@reactive-agents/reactive-intelligence` | `/features/reactive-intelligence/` | |
| `@reactive-agents/tools` | `/guides/tools/` | MCP: `/guides/tools/mcp-tools/` |
| `@reactive-agents/memory` | `/guides/memory/` | |
| `@reactive-agents/guardrails` | `/guides/guardrails/` | |
| `@reactive-agents/identity` | `/concepts/architecture/` | No dedicated page; docs-warden to add or confirm |
| `@reactive-agents/verification` | `/features/verification/` | |
| `@reactive-agents/judgment` | `/features/judgment-layer/` | README missing |
| `@reactive-agents/cost` | `/features/cost-tracking/` | |
| `@reactive-agents/observability` | `/features/observability/` | |
| `@reactive-agents/observe` | `/features/observe/` | |
| `@reactive-agents/trace` | `/concepts/decision-tracing/` | |
| `@reactive-agents/diagnose` | `/concepts/decision-tracing/` | CLI: `/reference/cli/` |
| `@reactive-agents/replay` | `/features/snapshot-replay/` | |
| `@reactive-agents/eval` | `/features/eval/` | |
| `@reactive-agents/gateway` | `/features/gateway/` | |
| `@reactive-agents/channels` | `/guides/channel-adapters/` | Also `/guides/messaging-channels/` |
| `@reactive-agents/a2a` | `/features/a2a-protocol/` | |
| `@reactive-agents/interaction` | `/features/interaction/` | |
| `@reactive-agents/prompts` | `/features/prompts/` | |
| `@reactive-agents/compose` | `/reference/compose-api/` | |
| `@reactive-agents/testing` | `/cookbook/testing-agents/` | |
| `@reactive-agents/health` | `/reference/configuration/` | No dedicated page |
| `@reactive-agents/runtime-shim` | `/guides/installation/` | No dedicated page; Node support lives there |
| `@reactive-agents/ui-core` | `/features/agentic-ui-core/` | |
| `@reactive-agents/react`, `vue`, `svelte` | `/guides/web-integration/` | |

Private, not audited: `@reactive-agents/benchmarks` (`/features/benchmarks/` for reference), `@reactive-agents/judge-server`.

## Package to owning warden

From `bun run repo scope packages/<pkg>/README.md` (2026-11-17). Each warden fixes the READMEs below with this standard; docs-warden reviews wording and links.

| Warden | Packages |
|---|---|
| core-warden | core, observability, observe, runtime-shim, testing |
| runtime-warden | runtime, reactive-agents (docs-warden authors the text), cost, health, interaction |
| kernel-warden | reasoning, reactive-intelligence, prompts |
| gateway-warden | gateway, channels, a2a |
| tools-warden | tools, guardrails, identity |
| provider-warden | llm-provider |
| memory-warden | memory |
| eval-warden | eval, judgment (no README yet), verification |
| harness-warden | trace, diagnose, replay |
| compose-warden | compose |
| cortex-warden | react, vue, svelte, ui-core |
| none | create-reactive-agent (`bun run repo scope` reports no owner; parent decides, docs-warden is the natural fit) |

## Appendix: baseline findings (2026-11-17)

`bun apps/docs/scripts/check-package-readmes.ts`: 33 public packages audited, 0 clean, 189 findings. Private skipped: benchmarks, judge-server. The guard is report-only until the parent wires it.

| Rule | Findings | Fix |
|---|---|---|
| section-missing | 73 | Add the missing sections (mostly Runtime, Documentation, License, API). |
| stability | 28 | Add the Stability line. Tier from `reference/stability.md`. |
| relative-link | 26 | Replace `../x/README.md` with docs or npm URLs. |
| docs-link-broken | 16 | See broken routes below. |
| pitch | 15 | Move the pitch into a `>` blockquote under the H1. |
| docs-link | 12 | Add a link from the map above. |
| unsourced-number | 4 | Source or remove (87%, 86.7% healing claims in reactive-agents, reasoning, tools). |
| stale:gateway-duplicate | 3 | Link the gateway docs instead of re-explaining (channels, gateway, runtime). |
| hand-typed-count | 3 | "100+ providers" (llm-provider), "18 packages" and "8 strategies" (reactive-agents). |
| example-ts | 2 | create-reactive-agent, diagnose: add a `ts` block or a CLI-appropriate `ts` usage. |
| size | 2 | runtime, ui-core over 8,000 bytes: move content to docs. |
| runtime-version | 1 | runtime-shim says Node 20. Floor is 22.5. |
| stale:node-old-floor | 1 | runtime-shim. |
| stale:durable-runs-duplicate | 1 | interaction. |
| stale:strategy-table-duplicate | 1 | reasoning: link `/guides/choosing-strategies/`. |
| missing-readme | 1 | judgment. |

Per package (findings count, rules):

| Package | Warden | Findings | Rules |
|---|---|---|---|
| a2a | gateway-warden | 4 | stability, section-missing x3 |
| channels | gateway-warden | 9 | stability, section-missing x2, docs-link-broken x2, relative-link x3, stale:gateway-duplicate |
| compose | compose-warden | 5 | stability, section-missing x3, docs-link |
| core | core-warden | 4 | pitch, stability, section-missing, docs-link |
| cost | runtime-warden | 4 | pitch, stability, section-missing, docs-link-broken |
| create-reactive-agent | none | 9 | pitch, stability, section-missing x5, example-ts, docs-link |
| diagnose | harness-warden | 6 | stability, section-missing x4, example-ts |
| eval | eval-warden | 5 | pitch, stability, section-missing x2, docs-link-broken |
| gateway | gateway-warden | 11 | stability, section-missing x3, docs-link-broken x3, relative-link x3, stale:gateway-duplicate |
| guardrails | tools-warden | 3 | pitch, stability, section-missing |
| health | runtime-warden | 4 | pitch, stability, section-missing, docs-link |
| identity | tools-warden | 4 | pitch, stability, section-missing, docs-link |
| interaction | runtime-warden | 5 | pitch, stability, section-missing, docs-link-broken, stale:durable-runs-duplicate |
| judgment | eval-warden | 1 | missing-readme |
| llm-provider | provider-warden | 9 | stability, section-missing x2, docs-link-broken x2, relative-link x3, hand-typed-count |
| memory | memory-warden | 7 | stability, section-missing x2, docs-link-broken, relative-link x3 |
| observability | core-warden | 4 | pitch, stability, section-missing, docs-link-broken |
| observe | core-warden | 6 | stability, section-missing x3, docs-link, relative-link |
| prompts | kernel-warden | 4 | pitch, stability, section-missing, docs-link |
| react | cortex-warden | 4 | section-missing x4 |
| reactive-agents | runtime-warden (docs-warden text) | 9 | pitch, stability, section-missing x3, unsourced-number x2, hand-typed-count x2 |
| reactive-intelligence | kernel-warden | 4 | pitch, stability, section-missing, docs-link-broken |
| reasoning | kernel-warden | 8 | stability, section-missing, docs-link-broken, relative-link x3, unsourced-number, stale:strategy-table-duplicate |
| replay | harness-warden | 5 | stability, section-missing x3, docs-link |
| runtime | runtime-warden | 13 | stability, section-missing x2, docs-link-broken, relative-link x7, size, stale:gateway-duplicate |
| runtime-shim | core-warden | 9 | pitch, stability, section-missing x4, docs-link, runtime-version, stale:node-old-floor |
| svelte | cortex-warden | 3 | section-missing x3 |
| testing | core-warden | 4 | pitch, stability, section-missing, docs-link |
| tools | tools-warden | 8 | stability, section-missing x2, docs-link-broken, relative-link x3, unsourced-number |
| trace | harness-warden | 5 | stability, section-missing x3, docs-link |
| ui-core | cortex-warden | 6 | section-missing x5, size |
| verification | eval-warden | 4 | pitch, stability, section-missing, docs-link |
| vue | cortex-warden | 3 | section-missing x3 |

Broken docs routes to repoint (README, dead route, suggested page):

| README | Dead route | Use instead |
|---|---|---|
| channels | `/guides/channels/`, `/guides/bots/` | `/guides/channel-adapters/`, `/guides/messaging-channels/` |
| cost | `/guides/cost-management/` | `/features/cost-tracking/` |
| eval | `/guides/evaluation/` | `/features/eval/` |
| gateway | `/guides/gateway/`, `/guides/gateway-chat/`, `/guides/webhooks/` | `/features/gateway/` |
| interaction | `/guides/interaction-modes/` | `/features/interaction/` |
| llm-provider | `/guides/providers/`, `/guides/calibration/` | `/features/llm-providers/` |
| memory | `/guides/calibration/` | `/guides/memory/` |
| observability | `/guides/observability/` | `/features/observability/` |
| reactive-intelligence | `/guides/reactive-intelligence/` | `/features/reactive-intelligence/` |
| reasoning | `/architecture/kernel/` | `/concepts/composable-kernel/` |
| runtime | `/api/builder/` | `/reference/builder-api/` |
| tools | `/guides/mcp/` | `/guides/tools/mcp-tools/` |

## Appendix: README code-example baseline (2026-11-17)

`bun apps/docs/scripts/check-readme-examples.ts` type-checks every ts/tsx block in the root README and the 33 public package READMEs against workspace source. Report-only (`--fail` exits 1, `--json` for machines). No placeholder globals or auto-imports: a README snippet must carry its own imports. A block is skipped with `<!-- skip-typecheck -->` above the fence or a standalone `...` placeholder. Baseline: 68 blocks, 37 pass, 28 fail, 3 skipped.

Failing blocks per README, with the owner (from `tools/repo/ownership.json`) who fixes it. Fixes are either a real API drift (fix the snippet) or an elided import or variable (add it, or mark the block pseudo).

| README | failing / checked | Owner | Dominant diagnostic |
|---|---|---|---|
| README.md (root) | 9 / 16 | docs-warden | missing `ReactiveAgents` import or `agent` from an earlier block |
| packages/reactive-agents | 3 / 5 | runtime-warden | missing `ReactiveAgents` import, undefined `agent` |
| packages/cost | 1 / 2 | runtime-warden | `agent.run({ input })` where a string is expected |
| packages/core | 1 / 1 | core-warden | Effect type passed where a plain value is expected |
| packages/observability | 2 / 2 | core-warden | `model` option not in provider config type; undefined `rawEvent` |
| packages/testing | 2 / 3 | core-warden | undefined `mySearchTool`, `agent` |
| packages/prompts | 2 / 2 | kernel-warden | string passed for a typed input; `model` option not in provider config type |
| packages/reactive-intelligence | 1 / 1 | kernel-warden | `model` option not in provider config type |
| packages/reasoning | 1 / 1 | kernel-warden | `model` option not in provider config type |
| packages/replay | 1 / 1 | harness-warden | undefined `myAgent` |
| packages/eval | 1 / 2 | eval-warden | eval case missing required `name` |
| packages/verification | 1 / 2 | eval-warden | `model` option not in provider config type |
| packages/ui-core | 3 / 4 | cortex-warden | undefined `connectRunStream`, `state`, `agentStream` |

The `model` diagnostic repeats in five READMEs: the snippet passes `model` inside the provider config; the type wants it elsewhere (check `withModel`).

## Maintenance

- Wiring the guard into `check-docs-sync` or CI is the parent's call once the baseline is fixed. Until then it is report-only.
- When a docs route is renamed, rerun the guard; broken README links show up as `docs-link-broken`.
- When the standard changes, change this page and `apps/docs/scripts/check-package-readmes.ts` together.
