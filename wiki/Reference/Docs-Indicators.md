---
type: reference
status: active
created: 2026-11-17
tags: [docs, indicators, stability, docs-site]
---

# Docs Indicators: stability tags and New/Updated markers

How the docs site shows "how stable is this" and "what is new". Everything is authored and release-based. Nothing derives from git recency. Context: [[Docs-IA-Proposal]], events in [[Umami-Events]].

## The model

| Indicator | Authored where | Shown where | Expires |
|---|---|---|---|
| Stability tag (`stable`, `unstable`, `experimental`, `deprecated`) | page frontmatter `stability:` | text badge: page title row; sidebar when not `stable` | never |
| New in X (filled green dot) | frontmatter `since: "0.19"` | icon: after the page title, on the sidebar link | when X leaves the window |
| Updated in X (blue ring) | frontmatter `updated: "0.19"` | icon: same places | when X leaves the window |
| Section marker | `<Since version="0.19" />` in a heading (`.mdx`) | same icon inline, and on the TOC link | when X leaves the window |

Rules:

- New/Updated are icons only, no text pill. The tooltip and accessible name read "New in 0.19" / "Updated in 0.19". Stability is a text badge on the page title and a compact glyph in the sidebar (see v2 below).
- A nav label must not repeat the tier its badge shows ("Plan Review (experimental)"). The docs loader (page `title`, `sidebar.label`) and `route-middleware.ts` (every sidebar label, including `astro.config.mjs`) throw on that, so the build fails.
- `astro.config.mjs` holds no hand-typed badge. The What's New group's `v0.18` badge and the header version chip come from the release constant below.
- New outranks Updated. Set `since` when a page is created, `updated` only when the page is materially changed in a release. Do not tag a page because it was touched by a docs-wide pass (topic tagging, link repoints).
- Evidence for every tag: the release's [[Changelog]] / `guides/whats-new` entry, a `.changeset/*.md`, or `git diff vX.Y.0 HEAD -- <page>`. No evidence, no tag.
- Authors never write badge text. `src/components/StabilityBadge.astro`, `Since.astro` and `sidebarBadgeFor` own labels and colours (`STABILITY_BADGE` in `src/content/indicators.ts`).
- Package-level tiers live in `apps/docs/src/data/stability.json`. `check-package-readmes.ts` fails (report-only by default, `--fail` in CI mode) when a package README's `Stability:` line disagrees with it. Mirror changes in `reference/stability.md`.

## The release window

The current release is one build-time constant, `CURRENT_VERSION` / `CURRENT_RELEASE` in `src/content/indicators.ts`, derived (env > latest tag > the `VERSION` file at the repo root, see v2 below; `VERSION` is stamped by the release flow; workspace `package.json` files stay at the 0.10.6 baseline by design, so they are never read). The header chip (`v0.18.0`, links to `/guides/whats-new/`; hidden below 40rem to keep the CTAs visible on phones), the What's New sidebar badge and the window all read it. A test fails if the constant and the top released heading of `guides/whats-new` disagree. The window is the current minor, the previous minor, and the next (unreleased) minor: with `VERSION=0.18.0`, tags `0.17`, `0.18` and `0.19` show; `0.16` does not. Bumping `VERSION` to `0.19.0` expires every `0.17` marker with no content edit. `WINDOW_MINORS` in `indicators.ts` sets the width.

Authored versions must be minor strings (`"0.18"`) and not beyond the next minor. The docs loader throws on a malformed, future, or inverted (`updated` older than `since`) value, so the build fails.

## Section markers

Use `.mdx`, import once, then tag the heading:

```mdx
import Since from '../../../components/Since.astro';

## Ollama Cloud <Since version="0.19" />
## Streaming rewrite <Since version="0.19" type="updated" />
```

The icon renders only inside the window. A client script puts the same icon on the matching TOC link. `type="deprecated"` is a stability fact: it never expires and is never hidden by the toggle.

## "Highlight what's new" toggle

Switch in the page title row, default ON, saved to `localStorage` key `ra-whats-new`. OFF sets `data-ra-whats-new="off"` on `<html>` (an inline head script does it before first paint) and CSS hides `.ra-ind-marker`, `.ra-marker-icon` and the sidebar/TOC icons. Stability tags carry `.ra-ind-stability` and are never hidden. Event: `whats_new_toggle`.

## What still reads git

Only the "Last updated" date and commit hash on the title row, from one `git log` pass (`src/content/last-commit.ts`). It is display data and drives no marker.

## Cortex pages

`features/cortex/**` is owned by cortex-warden. They carry no `since`/`updated` yet. `git diff --diff-filter=A v0.18.0 HEAD` lists 14 added pages under `features/cortex/`; cortex-warden should decide which are genuinely new (not moved from an older Cortex page) and give those `since: "0.19"`. Add and `stability: experimental` where the channel hub, Living Skills or other items listed in `reference/stability.md` apply.

## v2 (2026-11-17): tokens, roll-ups, TOC, derived version

- **Design tokens.** `--ra-ind-new` (violet), `--ra-ind-updated` (cyan, darkened in light mode by mixing toward `--sl-color-white`), `--ra-ind-experimental`, `--ra-ind-unstable` (Starlight orange), `--ra-ind-deprecated` (Starlight red) in `custom.css`. No literal colours below the token block (a test pins it). New = filled dot with halo, Updated = ring, so shape carries the meaning as well as hue.
- **Sidebar is compact.** Stability is a trailing glyph (flask = experimental, warning triangle = unstable, struck circle = deprecated) drawn by CSS mask from `data-ra-stability`; the tooltip and accessible name say "Experimental". The sidebar never gets a text pill: the row is a flex line, indicator slots `flex: none`, label `min-width: 0`, wraps at word boundaries. The full-text `StabilityBadge` stays on the page title only.
- **Roll-ups.** A sidebar group shows a dot/ring when a descendant page is new/updated (its badge text, "5 new or updated in 0.19: A, B, ...", is the accessible name and tooltip). A page counts as marked when its frontmatter marker is in the window or any `<Since>` heading is.
- **Hub rows.** Router tables, link lists and link cards decorate the primary link of each row with the same icon; the tooltip names the sections ("Updated in 0.19: Ollama Cloud, Images, Audio and Files"). Data: `#ra-marker-index` JSON from `route-middleware.ts`, applied by `NewContentMarkers.astro`.
- **TOC.** `#ra-toc-markers` JSON (slug to kind/label) from `tocMarks()`: every in-window `<Since>` heading at every depth the TOC shows, parents roll up marked children without hiding them. Names read "New in 0.18".
- **What's New is derived from structure.** Headings under "Unreleased" are new in the upcoming minor; headings under the current release's `## vX.Y.Z` are new in the current minor; older releases and `guides/whats-new/*` archive pages get nothing. No hand tags.
- **"What changed" line** under the title (`WhatChanged.astro`): the top-most marked sections as anchors, first 4 visible, the rest behind "and N more". Hidden by the toggle.
- **The version is derived.** Order: `RA_DOCS_VERSION` env, then the highest `vX.Y.Z` tag reachable from HEAD (`git tag --merged HEAD`; the docs deploy uses `fetch-depth: 0` and `fetch-tags: true`), then the `VERSION` file. Tagging a release moves the chip, the What's New badge, the window and its expiry and the "Unreleased" minor with no edit; a test creates a temp repo and tags it to prove this. Still manual: writing the `## vX.Y.Z` release section (a test fails if it disagrees with the derived version).
- **Evidence for tags:** `bun run --cwd apps/docs docs:indicators:suggest` (report only). Other derivations and drift checks: [[Docs-Derivation-Audit]].
