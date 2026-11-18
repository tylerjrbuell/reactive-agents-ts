/**
 * Heading-id slugging for the RSS feed. Starlight derives heading ids with
 * `github-slugger`, so the feed must use the same function or its item links
 * land on no heading (e.g. `## v0.19.0 - Title` has id `v0190---title`).
 */
import GithubSlugger from "github-slugger";

/** Heading text -> the id Starlight gives that heading. */
export const headingId = (heading: string): string => new GithubSlugger().slug(heading);

/**
 * Absolute item URL with the fragment intact. Passing a relative link to
 * `@astrojs/rss` appends a trailing slash after the fragment, which breaks it.
 */
export const releaseItemLink = (site: string, heading: string): string =>
  new URL(`/guides/whats-new/#${headingId(heading)}`, site).href;
