// Google "Preferred Sources" configuration.
//
// Preferred Sources (Google Search, launched Aug 2025 in the US/India and
// expanding) lets a reader mark a publication as preferred, so its stories
// surface more prominently in Top Stories / the "From your preferred sources"
// module. For a developer-tools site this is a low-cost discoverability lever:
// a reader who already likes the docs can opt to see us first for agent /
// TypeScript / LLM queries.
//
// Rendered by src/components/PreferredSourceBadge.astro. When `enabled` is
// false the badge renders nothing, so shipping this with `enabled: false`
// is a no-op until the site is actually eligible and configured.
//
// HOW TO ENABLE:
//   1. Confirm the site is eligible: it must be indexed and appearing in
//      Google Top Stories for its topics (Google Search Console → Performance
//      → Search Appearance). Preferred Sources only affects Top-Stories-style
//      surfaces, so eligibility matters — enabling the badge before then just
//      links to a normal SERP.
//   2. Get the official share link: Google Search Central publishes a
//      "help readers add you as a preferred source" flow with a per-publisher
//      URL. See https://developers.google.com/search/blog (Preferred Sources
//      announcement) and the Search Console help center. Paste that URL into
//      `url` below. If you don't yet have the official deep link, the default
//      below points readers at a brand search where Google shows the
//      preferred-source star — functional, just one click longer.
//   3. Set `enabled: true` and redeploy.
//
// Keep `label` short — it renders inside a compact pill.
export const preferredSource = {
    enabled: false,
    // Default fallback: a Google search for the brand + topic, where the
    // preferred-source star appears in Top Stories. Replace with the official
    // publisher share link once available (see step 2 above).
    url: 'https://www.google.com/search?q=Reactive+Agents+TypeScript+AI+agent+framework',
    label: 'Add us as a preferred source on Google',
    // Shorter label for tight placements (e.g. footer).
    shortLabel: 'Preferred source on Google',
} as const
