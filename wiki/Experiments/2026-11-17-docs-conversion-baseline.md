---
type: experiment
status: active
created: 2026-11-17
tags: [docs, umami, baseline, conversion, adoption]
---

# Docs conversion baseline (2026-11-17)

Pre-change snapshot for [[../Planning/Implementation-Plans/2026-11-17-docs-adoption-readiness]] Phase 1. Source: Umami
(website `4d58acb5-d15f-428c-8e0d-9f992fc5ba91`), window 2026-10-18 to 2026-11-17 unless noted; GitHub via `gh api`.
Compare any lift against this file, after filtering the bot traffic noted below.

## Traffic (30 days)
- Raw: 1,500 visitors, 1,525 visits, 1,738 pageviews, bounce 65.1%, 1.14 views/visit. Previous 30 days: 1,027 visitors, 77.3% bounce.
- Bot-like: Singapore 597 visitors (94.6% bounce, 0 s); `google.com` referrals 151 visitors (100% bounce, 0 s, obscure paths). Estimated real visitors 400-700.
- Channels: direct 1,154, referral 334 (aocr.org 317), organic search 157.
- US visitors 736 (bounce 45.5%, 1.28 views/visit).
- Retention: day-1/day-7 return 1-3% in every daily cohort (Oct 1 - Nov 16).
- Daily baseline 25-50 pageviews; spikes Sep 21 (166), Oct 6 (138), Nov 5 (192), Nov 6 (142), Nov 9 (160), Nov 13 (211) decay within 1-2 days.

## Events
- 30 days: scroll_depth 3,113; time_on_page 472; sidebar_nav 21; toc_click 12; outbound_click 8; linkcard_click 4; code_copy 2; github_star_cta 1; search_query 1.
- Lifetime (Mar 8 - Nov 17): hero_cta 42; outbound_click 55; code_copy 20; github_star_cta 3; search_query 27. No subscribe or feedback events exist.

## Top entry pages (30 days, views)
`/` 63, `/guides/reasoning/` 62, `/guides/local-models/` 45, `/reference/cli/` 35, `/guides/choosing-strategies/` 34, `/guides/cost-optimization/` 31, `/guides/whats-new/` 30, `/guides/tools/` 29, `/guides/quickstart/` 27, `/guides/troubleshooting/` 26.

## GitHub
32 stars, 6 forks, 0 watchers. Last 14 days: 276 views, 133 uniques (72 uniques on Nov 5). Referrers: aocr.org 68, github.com 19, docs.reactiveagents.dev 6, Google 4.

## Layout audit (2026-11-17)
Star button, newsletter form and feedback live in the right sidebar: width 0 at 913 px; at 1440 px star y=975 and subscribe y=1034 on a 20,000 px page (below the first screen); feedback at y=19,997.

## Success targets for Phase 1 (to review after 30 days of traffic)
- `github_star_cta` clicks per 100 real visitors above 3 (today about 0.2).
- `quickstart_click` or `install_copy` on at least 5% of entry-page visits.
- Newsletter and feedback events exist and fire; subscribers counted from the backend, not Umami alone.
- Views per visit above 1.5 for US/non-bot traffic (today 1.28).
