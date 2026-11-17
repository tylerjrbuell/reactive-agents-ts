---
type: plan
status: draft
created: 2026-11-17
tags: [adoption, docs, readme, positioning, cortex, conversion, launch-readiness]
---

# Docs and adoption readiness (2026-11-17)

Goal: close the biggest adoption leaks **before** driving traffic (Show HN, Reddit). A visitor who lands today
reads one page and leaves; the repo has 32 stars. Fix the funnel, unify the pitch, refresh Cortex, then launch.

Builds on, does not replace: [[../Research/Audit-Reports-2026-06-06/README-adoption-readiness-audit]],
[[2026-05-06-v0.11-launch-readiness]], [[2026-07-01-docs-revamp]], [[../Reference/Umami-Events]],
[[../Architecture/Design-Specs/2026-11-12-harness-positioning-and-portability]] (positioning, section 6.3 wording),
[[../Research/2026-06-26-launch-copy-ready]] and [[../Reference/Distribution/show-hn-post]] (both stale).
No new north star: positioning amendments go to 09 via the positioning spec.

## 1. Evidence (all measured 2026-11-17)

**Umami, last 30 days (docs.reactiveagents.dev):**
- 1,500 visitors raw, up 46%. About 750 are not human: Singapore 597 visitors (94.6% bounce, 0 s), Google referrals 151 (100% bounce, 0 s). Real visitors are roughly 400-700 a month.
- 1.14 views per visit. Retention day-1 and day-7 is 1-3% in every cohort.
- Conversion events over the whole life of the site (Mar 8 - Nov 17): `github_star_cta` 3, `hero_cta` 42, `code_copy` 20, `outbound_click` 55. **No subscribe or feedback event exists at all.**
- Spikes (Sep 21, Oct 6, Nov 5-6, 9, 13) decay inside two days. Nothing is annotated, so posts cannot be attributed.
- Entry pages are deep: `/guides/reasoning/`, `/guides/local-models/`, `/reference/cli/`, `/guides/choosing-strategies/`. The homepage got about 63 entries.

**GitHub:** 32 stars, 6 forks, 133 unique views in 14 days (72 of them on Nov 5).

**Docs audit (112 pages, 197k words; script + DOM checks):**
- The star button and newsletter form exist (`HeroStarBadge`, `EmailSubscribe` sidebar variant, `FeedbackButton`) but live only in the right sidebar. That column is hidden below about 1152 px (width 0 at 913 px) and so is invisible on tablets and phones. At 1440 px the star button sits at y=975 and the subscribe form at y=1034 of a 20,000 px page, under the table of contents, below the first screen.
- Feedback block is at y=19,997 of 20,334: the very bottom. The page ends with "What's Next" internal links only.
- Deep pages carry no install snippet or star CTA in content (checked `/guides/reasoning/`: 0 repo links, no install in first 1,500 chars).
- The header has Playground, GitHub, Discord, npm. No "Get started", no star count.
- Oversize pages: `builder-api` 13.8k words, `whats-new` 11.1k, `tools` 9.1k, `messaging-channels` 7.2k, `chat-and-composer` 5.6k.
- 21 pages still mention v0.10-v0.15 (context to be checked, some are legitimate "since" notes). `code-action.mdx` still says "7 strategies"; `whats-new` says "2x packages".
- Cortex docs: 14 pages, 7 with zero screenshots. 4 of the 10 Cortex screenshots date from 2026-04-09 (beacon, builder, chat-session, run-details), the rest from 2026-11-12.

**README and npm README:**
- Root README is 59 KB. Badge says "Bun >=1.0 required" while the text says Node 22.5+ is supported.
- `packages/reactive-agents/README.md` (the npm page): **Discord invite `discord.gg/498xEG5A` returns 404** (docs and root use `Mp99vQam3Q`, which works). It says "Requires Bun >= 1.1.0 ... Node.js support is on the roadmap" (false). It claims "no `any`" (removed from root in 2026-06 as falsifiable), shows an npm-downloads badge (vanity, removed from root), TypeScript 5.7+ (root says 6.0+).
- Third-party listing (ecosyste.ms) repeats "Bun required, Node planned, 5 strategies".
- `wiki/Reference/Distribution/show-hn-post.md` is stale: 19 packages, 5 strategies, 6 providers, 1,381 tests.

**Market (secondhand, Reddit + HN reads):** "harness" and "reliable agents" Show HNs already exist (Gambit, Zot, Pu.sh,
agent-harness-kit). Mastra's jump came from one HN moment (1,500 to 7,500 stars in a week). r/AI_Agents winners are
problem-plus-number posts (140-340 upvotes); the weekly Project Display thread is low reach (top comment 4 points).
Top asks: reliability on multi-step work, small-model tool calling, silent failures and recovery, cost control,
always-on agents, MCP. Verify against the primary threads before quoting.

## 2. Unified framing

One sentence (replaces the current four variants across README, npm, docs meta, llms.txt, GitHub About):

> TypeScript agents that finish the job on a 4B local model or a frontier API, with a signed receipt for every run
> and a trace that explains every failure.

Five pillars, in this order, each backed by something a reader can run or inspect in under a minute:

| # | Pillar | Proof that exists | Proof to add |
|---|---|---|---|
| 1 | Finishes on small local models | live replay on gemma4:e4b (homepage) | measured pass-rate with/without harness (see 5.1) |
| 2 | Receipt for every run | `TrustReceipt`, Ed25519 | "verify a receipt" 20-line snippet |
| 3 | Failures explain themselves | `rax-diagnose cause`, replay, trace | 60 s demo GIF |
| 4 | Durable, always-on, human-in-the-loop | durable resume, gateway, HITL | one-command always-on template |
| 5 | Cortex studio | Cortex (refreshed this release) | new screenshots + 90 s tour |

Rules: keep "harness" as the lead word and keep "framework" in titles and meta for search (positioning spec 2.3);
state **Node 22.5+ and Bun** as equals, Bun recommended for native SQLite; never claim "no any" or other absolutes;
numbers come from `apps/docs/src/data/metrics.json`, never typed by hand.

## 2.1 Owner decisions (2026-11-17)

- Bun is preferred, never required. Copy says "Bun (recommended) or Node 22.5+" on every surface.
- Newsletter form works (owner tested a real subscription). There are no other subscribers yet, so no cadence or release blast is built; roll that out once the list grows. Scope in this plan: make the form visible and measured, nothing more.
- `docs-warden` created (`.claude/agents/docs-warden.md`, `.claude/wardens.yaml`, `tools/repo/ownership.json`): owns `apps/docs/**` including consumer skills (`apps/docs/skills/**`) and root `README.md`. The npm README is runtime-warden-owned in the map because the `ownership-coverage` gate needs one `packages/reactive-agents/**` row; docs-warden authors its content and runtime-warden applies it.
- Benchmark work (Phase 5.1) is deferred. The pitch stays as drafted in section 2 and is refined after the other phases land.
- New scope: upgrade Astro and Starlight (Phase 3a) and build canonical navigation (Phase 3b). The goal is trust, accuracy and adoption together.

## 3. Phases

Each phase ends with a verifiable gate. Do not start Phase 6 (launch) until Phases 0-2 pass.

### Phase 0: stop the bleeding (1-2 days)

Items that are wrong or dead today. All small.
- Fix the npm README: working Discord invite, remove "Node on the roadmap", Node 22.5+ and Bun both stated, drop the "no any" claim and the downloads badge, align TypeScript badge and Bun badge wording with root. Confirm which file npm publishes (`packages/reactive-agents/README.md`) and that the release flow does not overwrite it.
- Root README badge: "Bun >=1.0 required" becomes "Bun >=1.0 or Node 22.5+".
- Add a CI check (extend `check-docs-sync`) that fails on any Discord invite not equal to the canonical one, and on "Node.js support is on the roadmap" or "Bun required" strings.
- Refresh `llms.txt` description (says 35 packages, check against metrics), `code-action.mdx` ("7 strategies"), `whats-new` "2x packages", `reference/stability.md` (still titled v0.12).
- Correct the third-party listings we control (ecosyste.ms submit, awesome-list entries, npm keywords).
- Replace or archive the stale Show HN draft and June launch copy (rewrite in Phase 6, not now).
- GitHub About, topics and social-preview image match section 2.

Gate: `bun run repo check --all` green; grep for the stale strings returns nothing; the npm README renders correctly in `npm pack` preview.

### Phase 1: conversion and retention infrastructure (3-5 days)

Close the CTA, feedback and newsletter gaps. The components exist; the problem is placement, visibility and measurement.
- **Make CTAs visible on every viewport.** Add a Starlight `PageFrame` or `Footer` override that renders, on every page: a slim top bar (or sticky bottom bar on mobile) with "Quickstart" and "Star on GitHub (count)", and an end-of-page block with install snippet, star, Discord, newsletter. Move the newsletter out of the sidebar-only slot.
- Header: add "Get started" (primary) and live star count; keep Playground, Discord, npm.
- End-of-page "What's next" gets one recommended next step per page (not four) plus the shared block. Top ten entry pages get a first-screen install snippet and "Run it on a local model" link: `/guides/reasoning/`, `/guides/local-models/`, `/reference/cli/`, `/guides/choosing-strategies/`, `/guides/cost-optimization/`, `/guides/whats-new/`, `/guides/tools/`, `/guides/quickstart/`, `/guides/troubleshooting/`, cookbook MCP and Ollama pages.
- **Feedback:** move "Was this page helpful?" and a floating "Report an issue" (prefilled GitHub issue with page URL) from page bottom to a persistent control; keep the modal. Route thumbs-down text to a GitHub issue or Discord channel the team reads.
- **Newsletter:** name and promise it ("Release notes + one harness failure mode explained, monthly"); confirm double opt-in end to end (`api.reactiveagents.dev/v1/subscribe` answers OPTIONS 204; a real submit has not been tested and needs the owner's go since it sends mail), welcome email, unsubscribe, and where the list is stored. Add the form to the README and the npm README as a link.
- **Measurement (Umami):** add events `star_cta_view`, `star_cta_click`, `subscribe_view`, `subscribe_submit`, `subscribe_success`, `subscribe_error`, `feedback_open`, `feedback_submit`, `quickstart_click`, `install_copy`. Document in `wiki/Reference/Umami-Events.md`. Add an Umami annotation for every post or release. Filter SG and Google bounce-only sessions in saved segments so dashboards show humans.
- Baseline before changing anything: snapshot the last 30 days of stats and events into `wiki/Experiments/` so the lift is measurable.

Gate: on a 390 px and a 1440 px viewport every page shows the CTA bar without scrolling; each new event fires in a manual test; baseline file committed.

### Phase 2: unify messaging (2-3 days, after Phase 0)

- Apply section 2 to: homepage hero, docs `description`, root README first 30 lines, npm README, `llms.txt`, GitHub About, Discord rules/pinned, package.json descriptions of the top packages, `create-reactive-agent` template banner.
- Cut the root README from 59 KB: keep pitch, 60-second quickstart, pillars with proof, comparison, links. Move the package table, long feature lists and architecture to docs. Target under 15 KB.
- Comparison pages (`reactive-agents-vs-*`) get a "harness vs framework vs runtime" row (positioning spec 6.3) and a dated corrections footer (pattern from the 2026-06 audit).
- Persona entry paths on the docs home: "I run local models", "I need durable production agents", "I am a TypeScript web dev" each linking to a three-step path.

Gate: one-sentence grep shows identical wording on all surfaces; README under target size; `check-docs-sync` green.

### Phase 3a: Astro and Starlight upgrade (spike, then land)

Current: `astro` 6.1.2, `@astrojs/starlight` 0.38.2, `astro-skills` 0.0.5. Latest on npm (2026-11-17): Astro 7.4.12, Starlight 0.43.1 (peer `astro ^7.2.10`, needs Node >=22.23.4), `astro-skills` 0.1.1, `starlight-links-validator` 0.27.0, `starlight-llms-txt` 0.12.0, `starlight-image-zoom` 0.16.3, `starlight-scroll-to-top` 2.0.0 (major). Astro 7 and Starlight 0.43 are a major jump over five Starlight minors, so this is a spike on a worktree, not a blind bump.
- Read the Astro 7 and Starlight 0.39-0.43 changelogs first; list what we use that changed (content config, `components` overrides, `lastUpdated`, `editLink`, expressive-code, plugin APIs, Node engine).
- Check CI and deploy Node: workflows pin `node-version: '22'`; confirm it resolves to >=22.23.4 or pin it in `docs.yml` and the local `.nvmrc` equivalent.
- Upgrade in one commit per concern: core (astro + starlight), plugins, then `astro-skills`. After each: `astro build`, link validator, `check-docs-sync`, Playwright pass at 390/913/1440 px on 10 representative pages, and a before/after bundle size and Lighthouse number.
- Adopt features only if they pay for themselves. Candidates to evaluate: Starlight route data and page-frame overrides (for Phase 1's CTA bar and canonical nav without forking components), built-in sidebar badges, `starlight-page-actions`-style copy-as-markdown and "open in LLM" buttons for agent builders, content collections loaders, view transitions or prefetch for faster navigation, built-in Pagefind tuning for search ranking, image and font optimisations, Astro's server islands for the live star count. Record each keep or skip in `wiki/Experiments/2026-11-17-astro-starlight-upgrade.md`.
- Gate: build and link check green, no visual regressions on the sampled pages, deploy preview works with the coi service worker and the StackBlitz playground, verdict file committed.

### Phase 3b: canonical navigation and discoverability (starts with an information-architecture audit)

**Refocus (owner, 2026-11-17):** the sidebar is not the main problem; the same topic is explained in several sections. Priority is content consolidation: one canonical page per topic holding the full explanation, every other mention a short summary plus link, facts stated once. Sidebar regrouping in `wiki/Reference/Docs-IA-Proposal.md` is secondary and optional. Status: inventory and proposal done (112 pages, 0 orphans, 7 oversize, 5 harmful conflicts); conflict-fix mission dispatched (`docs-fix-five-conflicts`). Next: a topic-consolidation mission driven by Docs-IA-Proposal.md section 1 (clusters and canonical homes), followed by the 7 page splits.

Problem: relevant context is scattered (for example three pages explain strategies, `whats-new` at 11k words doubles as a feature list, CLI, config and builder facts repeat across reference and guides). A reader should reach any fact by one obvious route.
- **Inventory.** From the 112 pages build a table: page, type (concept, how-to, reference, feature, cookbook), audience, owner topic, inbound links, sidebar position, duplicate-of. Flag orphans, near-duplicates and pages with two homes. Script it (frontmatter plus link graph) so it is rerunnable.
- **One canonical page per topic.** Pick the winner per topic (strategies, tools, memory, cost, gateway, MCP, Cortex, CLI, config, durable runs); turn the rest into short pointers or merge. Add redirects for any removed path (Astro `redirects`) so inbound links and search results survive.
- **Sidebar by task, not by internal package.** Proposed top level: Start here (install, quickstart, first agent, choosing a stack), Build (agents, reasoning, tools, memory, structured output, streaming), Run in production (durable runs, HITL, gateway, guardrails, cost, observability, deploy), Cortex (tour, setup, run view, lab, chat), Reference (builder API, config, CLI, stability, harness tags, events), Cookbook, Compare and migrate, Concepts. Every page appears once.
- **Wayfinding on every page.** A "Related" block generated from frontmatter (`topic`, `related`) instead of hand-written "What's next" lists; breadcrumb; one recommended next step; "Reference for this" and "Cookbook for this" links between feature, reference and recipe pages.
- **Home as a router.** The three persona paths from Phase 2 plus a task finder ("I want to... run on a local model, make runs resumable, add a human approval, track cost, expose over HTTP, connect MCP").
- **Search.** Review zero-result and high-volume queries, set Pagefind weights (titles, headings, `keywords` frontmatter), and add synonyms for the terms people use ("agent loop", "function calling", "human in the loop", "durable").
- **Consumer skills and llms.txt follow the same map.** Skill names and descriptions mirror the sidebar topics; `llms.txt` ordering mirrors the sidebar.
- **Guard it.** Extend `check-docs-sync` (or a new docs gate) to fail on orphan pages, pages missing `topic`/`related`, duplicate titles and dead redirects.
- Gate: inventory shows zero orphans and zero unresolved duplicates; a "find X" test list of 25 questions is answerable in at most two clicks from home (checked with Playwright).

### Phase 3: content quality and stickiness (1-2 weeks, parallelizable; follows 3b's page map)

- Split oversize pages: `builder-api` (reference index plus per-domain pages), `whats-new` (current release plus archive), `tools`, `messaging-channels`, `chat-and-composer`. Target under 3,500 words per page.
- Triage the 21 pages with old-version mentions: keep "since vX" notes, remove stale current-state claims.
- Every guide and cookbook page: runnable block copyable in under 30 s, "Expected output", and a "Try on a local model" line.
- Add "Why not LangGraph/Mastra here" honesty callouts where the comparison pages already hold facts.
- Add Cortex and `rax-diagnose` into the main learning path (quickstart step 4: "see why it did that").
- Search: log zero-result queries (`search_query` fires rarely; review the 27 total) and add pages or redirects for the top ones.

Gate: no page over 3,500 words except generated reference; link validator green; top-10 pages pass the "install in first screen" check.

### Phase 4: Cortex refresh (tied to the Cortex release)

Cortex is fully featured and visually overhauled for the next release. Docs must ship in the same release, not after.
- Re-capture every Cortex screenshot from the overhauled UI with one repeatable script (Playwright against a seeded Cortex data dir, fixed viewport, light and dark). Retire the four April images. Output to `apps/docs/src/assets/`, replace in all 14 `features/cortex/*` pages; give the 7 zero-screenshot pages at least one image each (`connect-your-app`, `memory-and-skills`, `local-setup-recipes`, `judgments-and-evals`, `gateway-and-channels`, `goals-plans-loops`, `approvals-and-questions`).
- Cortex landing page: 90 s tour video or GIF (beacon, run view with trace and Continue, plan card, Lab builder), "run it now" command, feature matrix.
- Cortex section in root and npm README with one hero screenshot; `apps/cortex/README.md` refreshed (5 KB today).
- Add the screenshot script to the release checklist so the next UI change cannot leave stale images (a `check` that flags assets older than the latest Cortex UI commit).
- Owner: cortex-warden for the capture script and README; docs pages by the main thread.

Gate: no Cortex screenshot older than the overhaul commit; every Cortex page has at least one image; tour asset embedded on the homepage.

### Phase 5: proof assets (parallel with 3-4)

- 5.1 **Measured result:** same multi-step tool task, small local model, with and without the harness, n at least 5 per cell, reported with standard error (bench cells are Bernoulli; 5 tasks x n<=5 has about 13 pp SE, so run more or report ranges). Existing evidence to mine first: the local-vs-frontier GIF and the ablation reports. τ-bench (W5) is still unrun. No number goes public until the owner approves the claim.
- 5.2 60 s `rax-diagnose cause <runId>` demo GIF (failed run explained). 5.3 verify-a-receipt snippet. 5.4 one-command always-on agent template (gateway). 5.5 90 s overview video with captions.
- 5.1 (measured result) is deferred by owner decision; the launch gate in Phase 6 will need it or an equivalent honest proof.
- Optional, gated on a demand spike (per the spike-before-build rule): MCP server (`agent.serveMCP()`, positioning spec G1) because many asks above want it.

Gate: each asset linked from the docs home and README.

### Phase 6: launch (only after Phases 0-2 pass and 5.1 exists)

- Rewrite Show HN from section 2 and the 5.1 number; first-comment technical detail; weekday US morning; clean-install test on macOS, Linux, Node and Bun in the 24 hours before; author stays in the thread.
- Reddit main post (r/LocalLLaMA or r/LLMDevs) as problem-plus-number with the repo link in a comment; weekly Project Display comment afterwards, not first.
- UTM-tagged links and an Umami annotation per post. Review rules per subreddit first.
- Retro 7 days later: stars, subscribers, quickstart clicks, install copies against the Phase 1 baseline.

## 4. Ownership

`docs-warden` (created 2026-11-17) owns `apps/docs/**`, the consumer skills in `apps/docs/skills/**` and root `README.md`; missions go through the dispatch FSM in AGENTS.md. `packages/reactive-agents/README.md` is runtime-warden-owned in the map (coverage gate); docs-warden authors the text. Cortex capture script and `apps/cortex/README.md` go to cortex-warden, which also edits `features/cortex/*` content for its own features while docs-warden owns their structure, navigation and CTAs. Release checks go to release-warden. Changeset for any user-facing docs behavior.

Suggested mission order for docs-warden: (1) Phase 0 fixes, (2) Phase 1 CTA, feedback and event work, (3) Phase 3b inventory, (4) Phase 3a upgrade spike, (5) Phase 2 messaging, (6) Phase 3 content, (7) Phase 4 with cortex-warden. Phases 3a and 3b touch the same files, so run them one after another, not in parallel.

## 5. Open decisions

1. Pitch sentence and pillar order: provisional, refine after Phases 0-3.
2. Newsletter name and cadence: deferred until there are subscribers.
3. Benchmark (5.1): deferred.

## 6. Risks

- Stars may plateau regardless; stars are not retention. Track subscribers, quickstart clicks and repeat visitors as primary metrics.
- Over-claiming: every public number must trace to metrics.json or a committed experiment file.
- Phase 4 depends on the Cortex release date; if it slips, ship Phases 0-3 and hold only the Cortex screenshots.
- Reddit evidence here is secondhand and partial; re-read primary threads before copying phrasing into posts.
