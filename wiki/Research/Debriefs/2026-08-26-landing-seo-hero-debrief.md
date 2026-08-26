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

---

## Increment 2 — evidence receipt showcase + carousel salvage (same day)

Follow-up on the debrief's "not done" list: surface the evidence receipt as the
on-brand proof, and rescue the FeatureCarousel.

- **EvidenceReceipt component** (`src/components/EvidenceReceipt.astro` +
  `src/data/evidence-receipt.json`). Renders a **real, unedited** `TrustReceipt`
  captured from the QA probe fleet — p2-multi-file, run on `gemma4:e4b` (a
  ~4B-class local Ollama model), verdict `tool-grounded`, 2 declared
  deliverables both checked against disk, 10 deterministic ledger checks
  passing. Values are verbatim from
  `wiki/Research/Harness-Reports/real-world-probes-2026-07-11/p2-multi-file.json`
  (model attribution per `2026-07-11-probe-fleet-qa-debrief.md`); schema is
  `packages/core/src/types/receipt.ts`. Card shows the verdict badge, run
  identity, a metric grid, deliverables, the verification ledger, an
  honest-scope footnote (verdict grades the evidence trail, not truth; Ed25519
  signing via `.withReceiptSigning()`), and an expandable raw-JSON view. New
  "The proof: every run returns a receipt" section on `index.mdx`, placed right
  after the "See it run" demo so the flow is watch-it-run → inspect-the-receipt.
  This is the most on-brand proof on the page: a real receipt from a 4B model,
  not an assertion.
- **FeatureCarousel salvage** — it was rendering **stale hardcoded numbers**
  that contradicted the stats panel (3,472 tests / 409 files / 25 packages / 5
  strategies vs. the real 8,920 / 1,158 / 34 / 8) — a credibility leak on a
  "verified" brand. Wired the numbers to `metrics.json` (providers, strategies,
  tests, testFiles, packagesTotal) so they never drift again. Enhancements:
  ARIA roving-tabindex arrow-key navigation on the tablist, and
  `prefers-reduced-motion` now leaves it manual (no auto-advance / progress
  animation).

Build re-verified green; `dist/index.html` shows the receipt (tool-grounded,
gemma4:e4b, ledger, raw JSON) and the corrected carousel numbers, with every
stale figure gone.

### Generator wiring (evidence receipt stays current)

`apps/docs/scripts/generate-evidence-receipt.ts` transforms the newest committed
QA-probe report (`wiki/Research/Harness-Reports/real-world-probes-<date>/<probe>.json`)
into `src/data/evidence-receipt.json` — verbatim values, absolute local paths
sanitized, `--probe`/`--model` overridable (model is the one asserted field; the
probe JSON doesn't record it). Deterministic and model-free (reads committed
JSON), so it's wired into docs `predev`/`prebuild` beside generate-metrics, plus
a `bun run receipt` alias. Re-running the probe fleet + a build refreshes the
landing receipt with no hand-editing.

## Increment 3 — hero visual redesign ("code → proof")

The abstract network-mark graphic (the brand glyph blown up to fill half the
splash) read as a generic "AI blob" that didn't say what the product does.
Prototyped three directions, user picked **B + mark accent**.

- **`src/components/Hero.astro`** — a Starlight `Hero` override (registered in
  astro.config `components.Hero`). Home page only; falls back to Starlight's
  default Hero on any other splash page. Left column: the brand glyph as a small
  accent + eyebrow, the gradient H1, tagline, CTAs, and a single props strip.
  Right column: a "code → proof" window — the builder snippet resolving into a
  live `tool-grounded` verdict whose values (`2/2 deliverables ✓ produced · 0
  tool failures · gemma4:e4b`) are pulled from the SAME `evidence-receipt.json`
  the receipt section renders, so the hero can't drift from the real receipt.
- Removed the now-duplicate `.ra-trustbar` from `index.mdx` (the hero carries
  the props strip) and the dead `<HeroInteraction />` (it animated the old big
  `.hero img`, which no longer exists).
- Fixes found via rendered screenshots: the code block's literal `{ }` braces
  broke Astro's JSX parser → moved code to a `set:html` string; on mobile the
  hero's `text-align:center` cascaded into the `<pre>` and staggered the
  monospace indentation → forced the code left-aligned.

Verified green in dark, light, and mobile via real Chromium renders.
