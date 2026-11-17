---
type: experiment
status: complete
created: 2026-11-17
tags: [docs, astro, starlight, upgrade, spike]
---

# Astro 6.1.2 / Starlight 0.38.2 to Astro 7.4.12 / Starlight 0.43.1 upgrade spike

Verdict: **GO, with two conditions** (visual check at 390/913/1440 px before merge, and a decision on the skills discovery URL change). Applied only in a worktree; nothing committed.

## Method

Worktree `agent-a6815e0d96e810f3c`, Node v24.14.1 (Astro 7 needs `>=22.23.4`), Bun 1.3.10. Baseline first (frozen install, build, `docs:sync:check`, `repo test apps/docs`), then bump, then fix. No browser/Playwright was used in this spike (out of scope), so runtime and visual behaviour is NOT verified.

## Versions

| Package | Before | After |
|---|---|---|
| astro | 6.1.2 | 7.4.12 |
| @astrojs/starlight | 0.38.2 | 0.43.1 |
| @astrojs/rss | ^4.0.18 | ^4.0.19 |
| astro-skills | ^0.0.5 | ^0.1.1 |
| starlight-links-validator | ^0.24.0 | ^0.27.0 |
| starlight-llms-txt | ^0.8.1 | ^0.12.0 |
| starlight-image-zoom | ^0.14.1 | ^0.16.3 |
| starlight-scroll-to-top | ^1.0.1 | ^2.0.0 |

`@astrojs/mdx` (8.x) and `@astrojs/sitemap` are Starlight's own deps; we do not depend on them directly. `bun install` warns that `astro-skills` wants `typescript ^5.9.3` and the repo has 6.0.3 (peer warning only, build unaffected).

## Breakages and fixes (the complete diff list)

1. **Sidebar autogenerate groups** (Starlight 0.39 removal; hard build error). `astro.config.mjs`: `Cookbook` and `API Reference` groups changed from `autogenerate: {...}` to `items: [{ autogenerate: {...} }]`.
2. **astro-skills 0.1.x silently published zero skills.** The new version implements Agent Skills Discovery v0.2.0 and requires `type`, `digest`, `skillMdRaw` on each collection entry. Our custom `starlightSafeSkillsLoader` did not provide them, so `getStaticPaths` filtered every skill out: build was green, `index.json` existed, and all 25 `SKILL.md` files were missing (dead URLs). Fixed in `src/content/skills-loader.ts` (adds `type: "skill-md"`, `skillMdRaw`, `sha256` digest) and `src/content.config.ts` (schema). **This is the trap in this upgrade: a green build hides it. Keep a post-build assertion that `dist/.well-known/agent-skills/<id>/SKILL.md` exists for every skill.**
3. **Skills URL moved** from `/.well-known/skills/` to `/.well-known/agent-skills/` (library hardcodes it; index schema now `schemas.agentskills.io/discovery/0.2.0`, entries have `url`+`digest` instead of `files`). Updated `src/components/SkillsMarkdownLinks.astro`. Sub-files under a skill dir are no longer served (no current skill has any; all 25 are bare `SKILL.md`).
4. `package.json` bumps and `bun.lock` (770 lines changed).
5. `apps/docs/.astro/*` is tracked in git and regenerated (schema/types). Noise, not a real change. Question for the owner: why is `.astro/` tracked?

Nothing else needed changing: route middleware, Head/Header/PageTitle/Footer/PageSidebar/Hero overrides, docs loader with git metadata, new-page indicators, image zoom, llms.txt, scroll-to-top, links validator all built unmodified.

## Results

| Check | Baseline (6.1.2 / 0.38.2) | Upgraded |
|---|---|---|
| `astro build` | pass, 113 pages, 45.6 s wall (42 s Astro) | pass, 113 pages, 36.9 to 42.9 s wall (~35.7 to 41.5 s Astro) |
| Link validator | all valid | all valid |
| `bun run docs:sync:check` | in sync | in sync |
| `bun run repo test apps/docs` | 11 pass | 11 pass |
| `bun run repo check --all` | n/a | 36 pass, 0 fail |
| Pagefind pages / index time | 113 / 1.41 s | 113 / 0.41 s |
| `dist/` total | 21.8 MB | 23.5 MB |
| HTML total | 15.1 MB | 16.5 MB (+9%) |
| `_astro/` | 1.09 MB | 1.08 MB |
| `pagefind/` | 1.65 MB | 1.91 MB |
| quickstart page gzip | 30.5 KB | 31.3 KB (+0.9 KB) |
| home page gzip | 42.2 KB | 44.2 KB (+2.0 KB) |
| external CSS files / gzip | 5 / 30.2 KB | 4 / 28.2 KB |
| JS gzip | 30.0 KB | 29.3 KB |

Build time is flat to ~15% faster (noisy; one run each side plus two upgraded runs). Page weight: HTML grows (an ~11 KB stylesheet is now inlined per page, plus ~2 KB larger nav markup); gzipped it is +3% per page, offset by one fewer CSS request. Not a blocker.

Warnings after upgrade: `[content] The collection "i18n" does not exist or is empty` (new, harmless: Starlight probes it; silence by adding nothing or ignore) and `Could not render /404 ... conflicts with higher priority route /404` (also present at baseline). The baseline vite `matchHostname ... never used` warning is gone.

dist diff vs baseline: only the skills paths (above) plus hashed asset names.

## Risks not covered by this spike (verify with Playwright at 390/913/1440 px before merge)

- **Starlight 0.43 `scopedStyleStrategy` default changed** from `:where()` to attribute selectors (higher specificity). Our overrides carry scoped styles (Header, PageSidebar, EmailSubscribe, HeroStarBadge, FeedbackButton/Modal). Safest is to set `scopedStyleStrategy: "where"` in `astro.config.mjs` to keep old specificity; not applied here because it is an unverified guess either way. Child components receiving a `class` from a parent no longer inherit scope.
- **0.42 mobile menu markup rewrite** (popover-based, drops `data-mobile-menu-expanded`, `starlight-menu-button`). A grep of `src/`, `public/`, config found no references, so low risk, but the sidebar toggle below ~1152 px is exactly the area the docs-adoption plan cares about; look at it.
- **0.43 theme select refactor**: `StarlightThemeProvider.updatePickers()` removed. No usage found.
- **Browser floor** raised: Chrome/Edge 116, Safari 17.0, Firefox 125.
- `astro check` is not wired (needs `@astrojs/check`), so no type-level verification of `.astro` files was done (same as baseline).
- Dev server (`astro dev`), preview and Pagefind UI in a browser were not run.

## New features: keep / skip

| Feature | Verdict | Reason |
|---|---|---|
| Starlight Pagefind `excludeSelectors` (0.43) | KEEP, later | Lets us drop nav/footers/generated reference noise from the index. Pagefind index grew 16% this upgrade; worth a small follow-up, needs search-quality check. Not applied. |
| Starlight sidebar perf (0.41.11, 0.42.4) | Free | Active automatically. |
| Hero `fetchpriority` (0.42.7), TOC layout-shift fix (0.42.7), search contrast (0.42.10) | Free | Automatic; helps LCP/CLS. |
| JS-less mobile menu (0.42) | Free, verify | Automatic; see risk above. |
| Smaller install (YAML swap, 0.42.9) | Free | Automatic. |
| `starlight-links-validator` 0.27, `llms-txt` 0.12 | Free | Build clean with unchanged config. |
| Astro live content collections, route caching, CSP, fonts API, responsive images | SKIP | Static GitHub Pages site: live collections and route caching need a server; CSP on static hosting is only via meta tags and our Umami/inline scripts would need an audit; fonts API replaces `@fontsource-variable/geist` for little gain; Astro already generates our webp images. None is a docs-user win now. |
| View transitions | SKIP | Starlight has `ClientRouter` support but interacts with our Umami tracking and `umami-deep.js` per-page events; adds risk to CTA measurement (plan rule 5). |
| `build.inlineStylesheets: "never"` | SKIP for now | Would remove the +11 KB inline CSS per page; trade is one extra request. Revisit with real numbers. |

I implemented no optional features; the measured deltas above come from the upgrade alone.

## Rollback

Revert `apps/docs/package.json`, `bun.lock`, `astro.config.mjs`, the three skills files and `.astro/`: `git checkout <base> -- apps/docs bun.lock`. The old astro-skills path `/.well-known/skills/` returns. No data migrations.

## CI changes needed (`.github/workflows/docs.yml`)

- `node-version: '22'` resolves to 22.23.5 today, which satisfies `>=22.23.4`, so it works unchanged; pin `'22.23'` or move to `'24'` so a runner image cannot go back below the floor. (Not applied: the file was outside the minimal diff.)
- Bun cache step is fine; lockfile hash changes automatically. No other changes. `astro` CLI runs under Node via the shebang even with Bun as the installer.
- Other workflows or contributors on older Node 22 will fail the engines check; note in contributing docs. Repo `AGENTS.md` says Node 22.5+ is supported for the runtime; the docs build now needs 22.23.4+.

## Go / no-go

**GO** once: (1) Playwright pass at 390/913/1440 px on home, a guide page, a Cortex feature page, search and the mobile menu; (2) owner decides how to handle the skills URL move (`/.well-known/skills/*` to `/.well-known/agent-skills/*`; `AGENTS.md:270`, the `agent-skills` guide, any listings and external `npx skills add` users still point at the old path; decide whether to add redirect pages for the old path or accept the break; check what the `skills` CLI actually probes); (3) a build assertion for the skills output (see breakage 2).

## Landed (2026-11-17, docs-warden, main tree on `dev`)

Owner approved the upgrade and chose to serve BOTH skills paths. Re-applied onto the current tree (not copied): same versions as the table above, `bun install` clean (one `astro-skills` typescript peer warning), `bun.lock` regenerated.

Final: astro 7.4.12, @astrojs/starlight 0.43.1, @astrojs/rss ^4.0.19, astro-skills ^0.1.1, starlight-links-validator ^0.27.0, starlight-llms-txt ^0.12.0, starlight-image-zoom ^0.16.3, starlight-scroll-to-top ^2.0.0. Node used for the build: v24.14.1.

Deviations from the spike:
- Only the Cookbook sidebar group needed the `items: [{ autogenerate }]` fix; the API Reference group is now explicit (split hubs), so nothing to convert there.
- `scopedStyleStrategy: 'where'` is a top-level **Astro** option, not a `starlight()` option (putting it under `starlight()` fails config validation: "Unrecognized key"). Set in `astro.config.mjs` with a comment. Confirmed in built HTML: scoped selectors render as `:where(.astro-xxxx)`.
- Skills loader/content.config/`SkillsMarkdownLinks.astro` fixes applied as in the spike.
- `.astro/` generated files regenerated by the build (still tracked; unchanged question to the owner).

Dual skills paths:
- What the `skills` CLI probes (read from `skills@1.9.0` source): `.well-known/agent-skills/index.json` first, then `.well-known/skills/index.json`. It accepts the v0.2.0 index (`$schema` set, `url`+`digest`) and the legacy v0.1 index (no `$schema`, `files` array incl. `SKILL.md`) at either path. Older CLIs know only the legacy path and schema.
- Canonical `/.well-known/agent-skills/` is served by astro-skills 0.1.1 (v0.2.0). `/.well-known/skills/` is generated by `apps/docs/scripts/skills-dist.mjs` after `astro build`: a legacy v0.1 index plus every skill file copied from `apps/docs/skills/`. Deterministic, no network.
- `apps/docs` `build` is now `astro build && node scripts/skills-dist.mjs`; the script then asserts all 25 skills exist (content-equal to source) under both paths, both indexes list all of them, and digests match. Non-zero exit fails the build. Proven: deleting `dist/.well-known/agent-skills/builder-api-reference/SKILL.md` made it exit 1 with `missing agent-skills SKILL.md`. Unit tests: `apps/docs/tests/skills-dist.test.ts` (6).
- Caveat: root `bun run docs:build` runs bare `astro build` (no prebuild, no skills step). CI (`docs.yml`) runs `bun run build` in `apps/docs`, so it is covered; the root script is not (outside this warden's paths).

Results on the landed tree: build exit 0, 141 pages (the spike counted 113 on an older base), links valid, Pagefind indexed 141 files, `llms.txt`/`llms-full.txt`/`llms-small.txt` and `sitemap-index.xml` generated, 25 skills under both paths (`ls` gives 26 entries each: 25 dirs plus `index.json`). `repo test apps/docs` 138 pass; `docs:sync:check` in sync. Warnings recorded: `[content] collection "i18n" does not exist or is empty` (new, harmless) and `Could not render /404 ... conflicts with higher priority route /404` (also at baseline). `repo check --all`: 35 pass, 1 fail (`check-file-size`: `reasoning/src/kernel/state/kernel-state.ts` grew to 1294 vs ceiling 1292; `act.ts` shrank to 1097 vs ceiling 1098; kernel-warden's files, unrelated to docs).

CI: `.github/workflows/docs.yml` `node-version` pinned to `'22.23'`.

Still unverified visually: everything in "Risks not covered" above (scoped-style cascade after the `where` setting, 0.42 mobile menu, search UI, theme select) needs the Playwright pass at 390/913/1440 px. No browser was used here.

## Exact diff

```
apps/docs/.astro/collections/docs.schema.json      | 1245 ++++++++++----------
apps/docs/.astro/content-assets.mjs                |    4 +-
apps/docs/.astro/content.d.ts                      |    7 +
apps/docs/astro.config.mjs                         |    4 +-
apps/docs/package.json                             |   16 +-
apps/docs/src/components/SkillsMarkdownLinks.astro |    2 +-
apps/docs/src/content.config.ts                    |    3 +
apps/docs/src/content/skills-loader.ts             |   11 +-
bun.lock                                           |  770 +++++++-----
```

Source-only change is ~35 lines; the rest is lockfile and generated `.astro/` output.
