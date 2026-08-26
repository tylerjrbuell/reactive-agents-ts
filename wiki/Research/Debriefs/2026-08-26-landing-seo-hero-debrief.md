# Debrief — Landing SEO/AEO + hero redesign (2026-08-26)

## Ask

Optimize SEO/ASO for the docs site (incl. a "preferred sources" badge), and
build a dedicated marketing hero that sells Reactive Agents' current-state
capabilities — "see it in action" in an exciting way, showcasing that it works
even on a 4B model, and that developers can take full control of a composable,
transparent harness.

## Key decision — pushed back on "demo as the promotion strategy"

The original framing leaned on an on-landing interactive demo as the headline.
Pushed back, and we realigned:

- **A scripted hero demo fights the brand.** The product claim is *transparent,
  verifiable, "not magic."* A hand-authored animation is the one thing the
  framework says it isn't. `TerminalReplay.astro`'s own docstring already flags
  this bait-and-switch risk.
- **A live 4B model can't run on the page** (needs a hosted backend → cost,
  latency, abuse surface). So an on-page demo is either scripted (credibility
  cost) or an ops liability.
- **Demos convert; they don't discover.** For a dev framework the biggest levers
  are being *found at the moment of intent* (AEO/answer engines + SEO) and being
  *cheap to verify*, not a hero animation.

**Chosen posture (user-confirmed):** discoverability first, then a tasteful
composio-inspired hero rewrite crafted to cut bounce; the demo stays as an
**honest, clearly-labeled replay of the real `rax demo`** that ends in a
run-it-yourself CTA — a trailer, not a substitute. The on-page terminal must
keep mirroring the real CLI scenario (Hacker News) to preserve the
honest-preview contract; it was NOT swapped to a fake incident-triage animation.

## Shipped

Tier 1 — discoverability:
- `src/preferred-source.ts` + `src/components/PreferredSourceBadge.astro` —
  Google Preferred Sources badge, opt-in (`enabled:false` by default, renders
  nothing until eligible + official share link set — same discipline as
  `site-verification.ts`). Wired near the email-subscribe block.
- `src/components/Head.astro` — JSON-LD fixes: `softwareVersion` now read from
  repo-root `VERSION` at build (was hardcoded 0.12.0 while site shipped v0.15);
  added `sameAs` (GitHub/npm/Discord) on software + org + source entities,
  `keywords`, `featureList`, `isAccessibleForFree`, `installUrl`, and a new
  `SoftwareSourceCode` entity on the home page.

Tier 2 — hero:
- `src/content/docs/index.mdx` — tightened hero tagline (was a 4-parenthetical
  wall → two scannable sentences); sharpened `description` for intent keywords;
  added a "See it run ↓" hero action anchoring to the demo; added a compact
  credibility **trust bar**; added `#see-it-run` anchor + honest run-it-yourself
  CTAs on both the model-tier GIF and the interactive terminal; added a
  "recorded replay of the real `rax demo`" label above the terminal.
- `src/styles/custom.css` — styles for trust bar, demo CTAs, honest-replay
  label (pulsing red REC dot, reduced-motion safe), and the preferred-source
  badge, all on the existing violet-cyan token system.

## Verification

`bun run build` green (exit 0), all internal links valid, sitemap emitted.
Rendered `dist/index.html` confirms: `softwareVersion:"0.15.0"`,
`SoftwareSourceCode` + `sameAs` present, trust bar / replay label /
`#see-it-run` / demo CTAs present, and the disabled badge renders nothing.

## Owner follow-ups (need human/eligibility)

- Fill `src/site-verification.ts` (Google Search Console + Bing tokens), then
  submit `sitemap-index.xml`.
- Once eligible in Google Top Stories, set `preferred-source.ts` `enabled:true`
  and swap in the official publisher share link.

## Not done (candidate next steps)

- A real, inspectable evidence-receipt artifact on the page (most on-brand proof).
- A live benchmarks table with reproducible numbers.
- `npx`/StackBlitz one-click "run it in 60s" surfaced above the fold.
